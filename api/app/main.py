"""ASTRAVEL API: real accounts (email + Google), PostgreSQL storage, trips, social, reviews and an admin back office."""
import csv
import hashlib
import io
import json
import os
import re
import secrets
import threading
import time
import urllib.request
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field, field_validator

from .schema import MODULES, SCHEMA, seed

DATABASE_URL = os.environ["DATABASE_URL"]
PEPPER = os.environ["SESSION_SECRET"]
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}
COOKIE = "astravel_session"
SESSION_DAYS = 30
STARTED = time.time()
ph = PasswordHasher()
pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=8, kwargs={"row_factory": dict_row}, open=False)

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
MODES = {"Walk", "By car", "By train", "By bus", "By bike", "Flight", "Boat"}
DUMMY_HASH = ph.hash("not-a-real-password")


# ───────────────────────────── helpers
def db_all(sql, params=()):
    with pool.connection() as c:
        return c.execute(sql, params).fetchall()


def db_one(sql, params=()):
    with pool.connection() as c:
        return c.execute(sql, params).fetchone()


def db_run(sql, params=()):
    with pool.connection() as c:
        return c.execute(sql, params).rowcount


def client_ip(req: Request):
    return (req.headers.get("cf-connecting-ip") or req.headers.get("x-real-ip") or (req.client.host if req.client else "") or "")[:64]


def audit(actor, action, target="", ip="", status="Success"):
    try:
        db_run("INSERT INTO audit(actor, action, target, ip, status) VALUES (%s,%s,%s,%s,%s)", (actor[:120], action[:80], target[:160], ip, status))
    except Exception:
        pass


def hash_token(t):
    return hashlib.sha256((PEPPER + t).encode()).hexdigest()


def iso(d):
    return d.isoformat() if d else None


def initials_safe(s):
    return re.sub(r"\s+", " ", (s or "").strip())[:60]


# in-memory request counter (flushed to req_stats every 20 s) and login throttle
_lock = threading.Lock()
_reqs = {}
_fails = {}


def _bucket(ts=None):
    ts = ts or time.time()
    return datetime.fromtimestamp(ts - ts % 600, tz=timezone.utc)


def count_request(status):
    with _lock:
        b = _bucket()
        n, e = _reqs.get(b, (0, 0))
        _reqs[b] = (n + 1, e + (1 if status >= 500 else 0))


def flush_loop():
    while True:
        time.sleep(20)
        with _lock:
            batch, _reqs_copy = dict(_reqs), None
            _reqs.clear()
        for b, (n, e) in batch.items():
            try:
                db_run("INSERT INTO req_stats(bucket, n, errors) VALUES (%s,%s,%s) ON CONFLICT (bucket) DO UPDATE SET n = req_stats.n + EXCLUDED.n, errors = req_stats.errors + EXCLUDED.errors", (b, n, e))
            except Exception:
                with _lock:
                    n0, e0 = _reqs.get(b, (0, 0)); _reqs[b] = (n0 + n, e0 + e)


def throttle(key, limit, window):
    now = time.time()
    with _lock:
        arr = [t for t in _fails.get(key, []) if now - t < window]
        _fails[key] = arr
        return len(arr) >= limit


def note_fail(key):
    with _lock:
        _fails.setdefault(key, []).append(time.time())


@asynccontextmanager
async def lifespan(app):
    pool.open(wait=True, timeout=30)
    with pool.connection() as c:
        c.execute("SELECT pg_advisory_lock(7777)")
        try:
            c.execute(SCHEMA)
            with c.cursor() as cur:
                seed(cur)
            c.commit()
        finally:
            c.execute("SELECT pg_advisory_unlock(7777)")
            c.commit()
    threading.Thread(target=flush_loop, daemon=True).start()
    yield
    pool.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-requested-with") != "astravel":
        return JSONResponse({"detail": "Bad request"}, status_code=400)
    try:
        resp = await call_next(request)
    except Exception:
        count_request(500)
        raise
    count_request(resp.status_code)
    if request.url.path.startswith("/api/"):          # pages and assets set their own caching (see web.py)
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ───────────────────────────── auth plumbing
def load_user(request: Request):
    tok = request.cookies.get(COOKIE)
    if not tok:
        return None
    row = db_one(
        "SELECT u.*, r.staff, r.perms FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.name = u.role "
        "WHERE s.token_hash = %s AND s.expires_at > now() AND u.status = 'Active'", (hash_token(tok),))
    if row and (datetime.now(timezone.utc) - row["last_active"]).total_seconds() > 60:
        db_run("UPDATE users SET last_active = now() WHERE id = %s", (row["id"],))
    return row


def setting(key, default=None):
    r = db_one("SELECT value FROM settings WHERE key = %s", (key,))
    return r["value"] if r else default


def need_user(request: Request):
    u = load_user(request)
    if not u:
        raise HTTPException(401, "Please sign in")
    if not u["staff"] and setting("maint", False):
        raise HTTPException(503, "The site is under maintenance")
    return u


def need_perm(module, action):
    idx = {"view": 0, "create": 1, "edit": 2, "delete": 3}[action]
    mi = MODULES.index(module)

    def dep(request: Request):
        u = load_user(request)
        if not u:
            raise HTTPException(401, "Please sign in")
        if not u["staff"]:
            raise HTTPException(403, "Not allowed")
        if u["role"] != "Super Admin" and not u["perms"][mi][idx]:
            raise HTTPException(403, "Your role can't do this")
        return u
    return dep


def need_staff(request: Request):
    u = load_user(request)
    if not u:
        raise HTTPException(401, "Please sign in")
    if not u["staff"]:
        raise HTTPException(403, "Not allowed")
    return u


def public_user(u):
    return {"id": u["id"], "name": u["name"], "picture": u.get("picture")}


def me_json(u):
    perms = {m: [bool(x) for x in (u["perms"][i] if u["role"] != "Super Admin" else [1, 1, 1, 1])] for i, m in enumerate(MODULES)}
    return {"id": u["id"], "name": u["name"], "email": u["email"], "picture": u["picture"], "role": u["role"], "staff": bool(u["staff"]), "perms": perms,
            "hasPassword": bool(u["password_hash"])}


def start_session(resp: Response, request: Request, user_id):
    tok = secrets.token_urlsafe(32)
    db_run("INSERT INTO sessions(token_hash, user_id, expires_at, ip, ua) VALUES (%s,%s,%s,%s,%s)",
           (hash_token(tok), user_id, datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS), client_ip(request), (request.headers.get("user-agent") or "")[:200]))
    resp.set_cookie(COOKIE, tok, max_age=SESSION_DAYS * 86400, httponly=True, secure=os.environ.get("COOKIE_SECURE", "1") == "1", samesite="lax", path="/")


def role_for_new_user(email, verified=False):
    """The owner's address becomes Super Admin only when Google has verified it; a password sign-up proves nothing about the email."""
    return "Super Admin" if verified and email.lower() in ADMIN_EMAILS else "Member"


# ───────────────────────────── models
class RegisterIn(BaseModel):
    email: str = Field(max_length=320)
    name: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _e(cls, v):
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=128)


class GoogleIn(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)


class StopIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    note: str = Field(default="", max_length=400)
    time: str = Field(default="", max_length=24)
    mode: str = "Walk"
    cost: float = Field(default=0, ge=0, le=1_000_000)
    done: bool = False

    @field_validator("mode")
    @classmethod
    def _m(cls, v):
        return v if v in MODES else "Walk"


class DayIn(BaseModel):
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    stops: list[StopIn] = Field(default_factory=list, max_length=40)

    @field_validator("date")
    @classmethod
    def _d(cls, v):
        if v is not None:
            date.fromisoformat(v)       # rejects 2027-13-45
        return v


class BudgetIn(BaseModel):
    name: str = Field(max_length=80)
    cat: str = Field(default="other", max_length=24)
    amount: float = Field(default=0, ge=0, le=10_000_000)
    who: int | None = None


class TripIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    desc: str = Field(default="", max_length=600)
    tags: list[str] = Field(default_factory=list, max_length=12)
    days: list[DayIn] = Field(default_factory=list, max_length=30)
    budget: list[BudgetIn] = Field(default_factory=list, max_length=100)
    public: bool | None = None

    @field_validator("tags")
    @classmethod
    def _t(cls, v):
        return [t.strip()[:24] for t in v if t and t.strip()]


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str = Field(min_length=3, max_length=400)


class MeIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class InviteIn(BaseModel):
    email: str = Field(max_length=320)


class UserAdminIn(BaseModel):
    role: str | None = None
    status: str | None = None


class SettingsIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    lang: str = Field(max_length=20)
    tz: str = Field(max_length=12)
    datefmt: str = Field(max_length=12)
    maint: bool


class PermsIn(BaseModel):
    perms: list[list[int]]


# ───────────────────────────── public config + bootstrap
@app.get("/api/healthz")
def healthz():
    db_one("SELECT 1")
    return {"ok": True}


def trip_summary(t, member_count=0, owner_name=None):
    days = t["days"] or []
    dates = sorted(d["date"] for d in days if d.get("date"))
    cost = round(sum(float(b.get("amount") or 0) for b in (t["budget"] or [])), 2)
    if not cost:
        cost = round(sum(float(s.get("cost") or 0) for d in days for s in d.get("stops", [])), 2)
    status = "Upcoming"
    if dates and dates[-1] < date.today().isoformat():
        status = "Past"
    season = ""
    if dates:
        m = int(dates[0][5:7])
        season = "Winter" if m in (12, 1, 2) else "Spring" if m in (3, 4, 5) else "Summer" if m in (6, 7, 8) else "Autumn"
    return {"id": t["id"], "name": t["name"], "desc": t["descr"], "img": t["img"], "public": t["public"], "cost": cost, "status": status, "season": season,
            "from": dates[0] if dates else None, "to": dates[-1] if dates else None, "stops": sum(len(d.get("stops", [])) for d in days),
            "ownerId": t["owner_id"], "ownerName": owner_name, "members": member_count, "updated": iso(t["updated_at"])}


def catalog_row(c, full=False):
    out = {k: c[k] for k in ("id", "kind", "title", "summary", "img", "thumb", "season", "car", "cost", "lat", "lng", "zoom", "explore", "suggest")}
    if full:
        out.update({"about": c["about"], "why": c["why"], "know": c["know"], "photos": c["photos"], "days": c["days"], "budget": c["budget"]})
    return out


@app.get("/api/bootstrap")
def bootstrap(request: Request):
    u = load_user(request)
    out = {"googleClientId": GOOGLE_CLIENT_ID or None, "appName": setting("name", "ASTRAVEL"), "maint": bool(setting("maint", False)), "me": None,
           "catalog": [catalog_row(c) for c in db_all("SELECT * FROM catalog ORDER BY sort")], "trips": [], "wishlist": [], "following": [], "followers": []}
    if not u:
        return out
    out["me"] = me_json(u)
    if out["maint"] and not u["staff"]:
        return out
    rows = db_all(
        "SELECT t.*, (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id) AS mc, o.name AS oname FROM trips t JOIN users o ON o.id = t.owner_id "
        "WHERE t.owner_id = %s OR t.id IN (SELECT trip_id FROM trip_members WHERE user_id = %s) ORDER BY t.updated_at DESC", (u["id"], u["id"]))
    out["trips"] = [trip_summary(t, t["mc"], t["oname"]) for t in rows]
    out["wishlist"] = [r["catalog_id"] for r in db_all("SELECT catalog_id FROM wishlist WHERE user_id = %s ORDER BY added_at DESC", (u["id"],))]
    out["following"] = [public_user(r) for r in db_all("SELECT u.id, u.name, u.picture FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = %s ORDER BY u.name", (u["id"],))]
    out["followers"] = [dict(public_user(r), iFollow=r["i_follow"]) for r in db_all(
        "SELECT u.id, u.name, u.picture, EXISTS(SELECT 1 FROM follows x WHERE x.follower_id = %s AND x.followee_id = u.id) AS i_follow "
        "FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = %s ORDER BY u.name", (u["id"], u["id"]))]
    return out


# ───────────────────────────── auth
def issue(request, user, how):
    resp = JSONResponse({"ok": True})
    start_session(resp, request, user["id"])
    db_run("UPDATE users SET last_active = now() WHERE id = %s", (user["id"],))
    audit(user["email"], "Login", how, client_ip(request))
    return resp


@app.post("/api/auth/register")
def register(body: RegisterIn, request: Request):
    ip = client_ip(request)
    if throttle("reg:" + ip, 8, 3600):
        raise HTTPException(429, "Too many sign-ups from this network. Try again later.")
    note_fail("reg:" + ip)
    if body.email in ADMIN_EMAILS:
        raise HTTPException(400, "This address is reserved for Google sign-in. Use the Google button.")
    if db_one("SELECT 1 FROM users WHERE email = %s", (body.email,)):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    row = db_one("INSERT INTO users(email, name, password_hash, role) VALUES (%s,%s,%s,%s) RETURNING *",
                 (body.email, initials_safe(body.name), ph.hash(body.password), "Member"))
    audit(body.email, "Register", "email", ip)
    return issue(request, row, "email")


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request):
    ip = client_ip(request); email = body.email.strip().lower()
    if throttle("ip:" + ip, 20, 600) or throttle("em:" + email, 8, 900):
        raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")
    u = db_one("SELECT * FROM users WHERE email = %s", (email,))
    ok = False
    try:
        if u and u["password_hash"]:
            ok = ph.verify(u["password_hash"], body.password)
        else:
            ph.verify(DUMMY_HASH, body.password)
    except VerifyMismatchError:
        ok = False
    except Exception:
        ok = False
    if not ok:
        note_fail("ip:" + ip); note_fail("em:" + email)
        audit(email, "Login attempt", email, ip, "Failed")
        raise HTTPException(401, "Wrong email or password")
    if u["status"] != "Active":
        audit(email, "Login attempt", "inactive account", ip, "Failed")
        raise HTTPException(403, "This account is inactive. Contact support.")
    return issue(request, u, "email")


@app.post("/api/auth/google")
def google_login(body: GoogleIn, request: Request):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured yet")
    ip = client_ip(request)
    if throttle("ip:" + ip, 30, 600):
        raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")
    from google.auth.transport import requests as grequests
    from google.oauth2 import id_token
    try:
        info = id_token.verify_oauth2_token(body.credential, grequests.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        note_fail("ip:" + ip)
        audit("google", "Login attempt", "invalid Google token", ip, "Failed")
        raise HTTPException(401, "Google sign-in failed. Try again.")
    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com") or not info.get("email_verified"):
        raise HTTPException(401, "Your Google email is not verified")
    sub, email = info["sub"], info["email"].lower()
    name = initials_safe(info.get("name") or email.split("@")[0]); pic = info.get("picture")
    u = db_one("SELECT * FROM users WHERE google_sub = %s", (sub,)) or db_one("SELECT * FROM users WHERE email = %s", (email,))
    if u:
        if u["status"] != "Active":
            audit(email, "Login attempt", "inactive account", ip, "Failed")
            raise HTTPException(403, "This account is inactive. Contact support.")
        # Google has verified this address, so whoever holds the Google account owns it. Drop any password set earlier by someone who only typed the email.
        u = db_one("UPDATE users SET google_sub = %s, picture = COALESCE(%s, picture), password_hash = CASE WHEN google_sub IS NULL THEN NULL ELSE password_hash END WHERE id = %s RETURNING *", (sub, pic, u["id"]))
        if email in ADMIN_EMAILS and u["role"] == "Member":
            u = db_one("UPDATE users SET role = 'Super Admin' WHERE id = %s RETURNING *", (u["id"],))
    else:
        u = db_one("INSERT INTO users(email, name, picture, google_sub, role) VALUES (%s,%s,%s,%s,%s) RETURNING *", (email, name, pic, sub, role_for_new_user(email, verified=True)))
        audit(email, "Register", "google", ip)
    return issue(request, u, "google")


@app.post("/api/auth/logout")
def logout(request: Request):
    tok = request.cookies.get(COOKIE)
    if tok:
        db_run("DELETE FROM sessions WHERE token_hash = %s", (hash_token(tok),))
    resp = JSONResponse({"ok": True}); resp.delete_cookie(COOKIE, path="/")
    return resp


@app.delete("/api/me")
def delete_me(request: Request, u=Depends(need_user)):
    if u["role"] == "Super Admin" and db_one("SELECT count(*) AS n FROM users WHERE role = 'Super Admin' AND status = 'Active'")["n"] <= 1:
        raise HTTPException(400, "You are the only Super Admin. Give the role to someone else first.")
    db_run("DELETE FROM users WHERE id = %s", (u["id"],))
    audit(u["email"], "Deleted own account", "", client_ip(request))
    resp = JSONResponse({"ok": True}); resp.delete_cookie(COOKIE, path="/")
    return resp


@app.patch("/api/me")
def update_me(body: MeIn, u=Depends(need_user)):
    db_run("UPDATE users SET name = %s WHERE id = %s", (initials_safe(body.name), u["id"]))
    return {"ok": True}


# ───────────────────────────── catalog, reviews, wishlist
@app.get("/api/catalog/{cid}")
def catalog_item(cid: str, request: Request):
    c = db_one("SELECT * FROM catalog WHERE id = %s", (cid,))
    if not c:
        raise HTTPException(404, "Not found")
    u = load_user(request)
    revs = db_all("SELECT r.id, r.rating, r.body, r.created_at, r.user_id, u.name, u.picture FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.catalog_id = %s ORDER BY r.created_at DESC LIMIT 100", (cid,))
    out = catalog_row(c, full=True)
    out["reviews"] = [{"id": r["id"], "rating": r["rating"], "body": r["body"], "created": iso(r["created_at"]), "userId": r["user_id"], "name": r["name"], "picture": r["picture"],
                       "mine": bool(u and u["id"] == r["user_id"])} for r in revs]
    out["avg"] = round(sum(r["rating"] for r in revs) / len(revs), 1) if revs else None
    return out


@app.put("/api/catalog/{cid}/review")
def put_review(cid: str, body: ReviewIn, u=Depends(need_user)):
    if not db_one("SELECT 1 FROM catalog WHERE id = %s", (cid,)):
        raise HTTPException(404, "Not found")
    db_run("INSERT INTO reviews(catalog_id, user_id, rating, body) VALUES (%s,%s,%s,%s) ON CONFLICT (catalog_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, created_at = now()",
           (cid, u["id"], body.rating, body.body.strip()))
    return {"ok": True}


@app.delete("/api/reviews/{rid}")
def del_review(rid: int, request: Request):
    u = need_user(request)
    r = db_one("SELECT user_id FROM reviews WHERE id = %s", (rid,))
    if not r:
        raise HTTPException(404, "Not found")
    if r["user_id"] != u["id"]:
        if not (u["staff"] and (u["role"] == "Super Admin" or u["perms"][0][3])):
            raise HTTPException(403, "Not allowed")
        audit(u["email"], "Deleted review", str(rid), client_ip(request))
    db_run("DELETE FROM reviews WHERE id = %s", (rid,))
    return {"ok": True}


@app.put("/api/wishlist/{cid}")
def wish_add(cid: str, u=Depends(need_user)):
    if not db_one("SELECT 1 FROM catalog WHERE id = %s", (cid,)):
        raise HTTPException(404, "Not found")
    db_run("INSERT INTO wishlist(user_id, catalog_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", (u["id"], cid))
    return {"ok": True}


@app.delete("/api/wishlist/{cid}")
def wish_del(cid: str, u=Depends(need_user)):
    db_run("DELETE FROM wishlist WHERE user_id = %s AND catalog_id = %s", (u["id"], cid))
    return {"ok": True}


# ───────────────────────────── trips
def trip_access(tid, user, need_owner=False):
    t = db_one("SELECT t.*, o.name AS oname, o.picture AS opic FROM trips t JOIN users o ON o.id = t.owner_id WHERE t.id = %s", (tid,))
    if not t:
        raise HTTPException(404, "Trip not found")
    is_owner = bool(user and user["id"] == t["owner_id"])
    is_member = bool(user and db_one("SELECT 1 FROM trip_members WHERE trip_id = %s AND user_id = %s", (tid, user["id"])))
    if not (is_owner or is_member or t["public"]):
        raise HTTPException(404, "Trip not found")     # don't reveal that private trips exist
    if need_owner and not is_owner:
        raise HTTPException(403, "Only the trip owner can do this")
    return t, is_owner, is_member


def trip_full(t, is_owner, is_member):
    mem = db_all("SELECT u.id, u.name, u.picture FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = %s ORDER BY m.added_at", (t["id"],))
    s = trip_summary(t, len(mem), t["oname"])
    s.update({"days": t["days"], "budget": t["budget"], "tags": t["tags"], "owner": {"id": t["owner_id"], "name": t["oname"], "picture": t["opic"]},
              "members": [public_user(m) for m in mem], "isOwner": is_owner, "canEdit": is_owner or is_member})
    return s


def pick_img(tid):
    return [1371, 1367, 1737, 1733, 3739, 3735][int(hashlib.md5(tid.encode()).hexdigest(), 16) % 6]


@app.post("/api/trips")
def create_trip(body: TripIn, request: Request, u=Depends(need_user)):
    if db_one("SELECT count(*) AS n FROM trips WHERE owner_id = %s", (u["id"],))["n"] >= 100:
        raise HTTPException(400, "You reached the limit of 100 trips")
    tid = "t" + secrets.token_hex(5)
    db_run("INSERT INTO trips(id, owner_id, name, descr, tags, days, budget, public, img) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
           (tid, u["id"], body.name.strip(), body.desc, Jsonb(body.tags), Jsonb([d.model_dump() for d in body.days]), Jsonb([b.model_dump() for b in body.budget]), bool(body.public), pick_img(tid)))
    return {"id": tid}


@app.get("/api/trips/{tid}")
def get_trip(tid: str, request: Request):
    u = load_user(request)
    t, o, m = trip_access(tid, u)
    return trip_full(t, o, m)


@app.put("/api/trips/{tid}")
def put_trip(tid: str, body: TripIn, u=Depends(need_user)):
    t, is_owner, is_member = trip_access(tid, u)
    if not (is_owner or is_member):
        raise HTTPException(403, "You can't edit this trip")
    pub = t["public"] if (body.public is None or not is_owner) else body.public
    db_run("UPDATE trips SET name=%s, descr=%s, tags=%s, days=%s, budget=%s, public=%s, updated_at=now() WHERE id=%s",
           (body.name.strip(), body.desc, Jsonb(body.tags), Jsonb([d.model_dump() for d in body.days]), Jsonb([b.model_dump() for b in body.budget]), pub, tid))
    return {"ok": True}


@app.delete("/api/trips/{tid}")
def del_trip(tid: str, u=Depends(need_user)):
    trip_access(tid, u, need_owner=True)
    db_run("DELETE FROM trips WHERE id = %s", (tid,))
    return {"ok": True}


@app.post("/api/trips/{tid}/members")
def invite(tid: str, body: InviteIn, request: Request, u=Depends(need_user)):
    t, *_ = trip_access(tid, u, need_owner=True)
    em = body.email.strip().lower()
    f = db_one("SELECT id, name FROM users WHERE email = %s AND status = 'Active'", (em,))
    if not f:
        raise HTTPException(404, "No ASTRAVEL account uses that email yet. Ask your friend to sign up first.")
    if f["id"] == u["id"]:
        raise HTTPException(400, "You are already the owner of this trip")
    if db_one("SELECT count(*) AS n FROM trip_members WHERE trip_id = %s", (tid,))["n"] >= 12:
        raise HTTPException(400, "A trip can have up to 12 members")
    db_run("INSERT INTO trip_members(trip_id, user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", (tid, f["id"]))
    return {"ok": True, "name": f["name"]}


@app.delete("/api/trips/{tid}/members/{uid}")
def remove_member(tid: str, uid: int, u=Depends(need_user)):
    t, is_owner, _ = trip_access(tid, u)
    if not (is_owner or uid == u["id"]):
        raise HTTPException(403, "Not allowed")
    db_run("DELETE FROM trip_members WHERE trip_id = %s AND user_id = %s", (tid, uid))
    return {"ok": True}


# ───────────────────────────── people
@app.get("/api/users/{uid}")
def user_profile(uid: int, request: Request):
    u = load_user(request)
    p = db_one("SELECT id, name, picture, created_at FROM users WHERE id = %s AND status = 'Active'", (uid,))
    if not p:
        raise HTTPException(404, "Profile not found")
    trips = db_all("SELECT t.*, (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id) AS mc FROM trips t WHERE t.owner_id = %s AND t.public ORDER BY t.updated_at DESC", (uid,))
    return {**public_user(p), "joined": iso(p["created_at"]), "trips": [trip_summary(t, t["mc"], p["name"]) for t in trips],
            "followers": db_one("SELECT count(*) AS n FROM follows WHERE followee_id = %s", (uid,))["n"],
            "following": db_one("SELECT count(*) AS n FROM follows WHERE follower_id = %s", (uid,))["n"],
            "iFollow": bool(u and db_one("SELECT 1 FROM follows WHERE follower_id = %s AND followee_id = %s", (u["id"], uid))), "isMe": bool(u and u["id"] == uid)}


@app.put("/api/follow/{uid}")
def follow(uid: int, u=Depends(need_user)):
    if uid == u["id"]:
        raise HTTPException(400, "You can't follow yourself")
    if not db_one("SELECT 1 FROM users WHERE id = %s AND status = 'Active'", (uid,)):
        raise HTTPException(404, "Profile not found")
    db_run("INSERT INTO follows(follower_id, followee_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", (u["id"], uid))
    return {"ok": True}


@app.delete("/api/follow/{uid}")
def unfollow(uid: int, u=Depends(need_user)):
    db_run("DELETE FROM follows WHERE follower_id = %s AND followee_id = %s", (u["id"], uid))
    return {"ok": True}


@app.delete("/api/followers/{uid}")
def remove_follower(uid: int, u=Depends(need_user)):
    db_run("DELETE FROM follows WHERE follower_id = %s AND followee_id = %s", (uid, u["id"]))
    return {"ok": True}


# ───────────────────────────── admin
def user_row(r):
    return {"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"], "status": r["status"], "picture": r["picture"],
            "joined": iso(r["created_at"]), "lastActive": iso(r["last_active"]), "trips": r.get("trips", 0)}


@app.get("/api/admin/stats")
def admin_stats(u=Depends(need_staff)):
    one = db_one(
        "SELECT (SELECT count(*) FROM users WHERE last_active > now() - interval '24 hours') AS active, (SELECT count(*) FROM users) AS users,"
        " (SELECT count(*) FROM trips) AS trips, (SELECT count(*) FROM reviews) AS reviews,"
        " (SELECT count(*) FROM users WHERE created_at > now() - interval '24 hours') AS new_today,"
        " (SELECT count(*) FROM audit WHERE status = 'Failed' AND ts > now() - interval '1 hour') AS fails")
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    with _lock:
        mem = {b: v for b, v in _reqs.items()}
    rows = db_all("SELECT bucket, n, errors FROM req_stats WHERE bucket >= %s ORDER BY bucket", (since - timedelta(minutes=10),))
    series = {r["bucket"]: (r["n"], r["errors"]) for r in rows}
    for b, (n, e) in mem.items():
        a, c = series.get(b, (0, 0)); series[b] = (a + n, c + e)
    cur = _bucket(); pts = []
    for i in range(6, -1, -1):
        b = cur - timedelta(minutes=10 * i)
        pts.append({"t": b.isoformat(), "n": series.get(b, (0, 0))[0]})
    hour_n = sum(v[0] for k, v in series.items() if k >= since - timedelta(minutes=10)); hour_e = sum(v[1] for k, v in series.items() if k >= since - timedelta(minutes=10))
    t0 = time.time(); db_one("SELECT 1"); db_ms = round((time.time() - t0) * 1000, 1)
    size = db_one("SELECT pg_database_size(current_database()) AS s")["s"]
    web_ok = True
    try:
        urllib.request.urlopen("http://astravel:8080/", timeout=2).read(1)
    except Exception:
        web_ok = False
    alerts = [{"text": f"{r['action']}: {r['target'] or r['actor']}", "ts": iso(r["ts"]), "level": "f" if r["status"] == "Failed" else ""} for r in db_all(
        "SELECT ts, actor, action, target, status FROM audit WHERE status = 'Failed' OR action IN ('Updated user role','Deleted user','Changed settings','Updated role permissions','Register') ORDER BY ts DESC LIMIT 6")]
    return {"activeUsers": one["active"], "users": one["users"], "trips": one["trips"], "reviews": one["reviews"], "newToday": one["new_today"], "failsHour": one["fails"],
            "requestsHour": hour_n, "errorRate": round(100 * hour_e / hour_n, 2) if hour_n else 0.0, "uptimeSec": int(time.time() - STARTED), "series": pts, "alerts": alerts,
            "health": [{"name": "API server", "ok": True, "detail": "responding"}, {"name": "Database (PostgreSQL)", "ok": True, "detail": f"{db_ms} ms, {round(size / 1048576, 1)} MB"},
                       {"name": "Web server (nginx)", "ok": web_ok, "detail": "serving the site" if web_ok else "not responding"}]}


@app.get("/api/admin/users")
def admin_users(role: str = "", status: str = "", q: str = Query("", max_length=80), page: int = Query(1, ge=1), per: int = Query(10, ge=1, le=50), u=Depends(need_perm("Users", "view"))):
    where, p = ["TRUE"], []
    if role:
        where.append("u.role = %s"); p.append(role)
    if status:
        where.append("u.status = %s"); p.append(status)
    if q:
        where.append("(lower(u.name) LIKE %s OR lower(u.email) LIKE %s)"); p += [f"%{q.lower()}%"] * 2
    w = " AND ".join(where)
    total = db_one(f"SELECT count(*) AS n FROM users u WHERE {w}", p)["n"]
    rows = db_all(f"SELECT u.*, (SELECT count(*) FROM trips t WHERE t.owner_id = u.id) AS trips FROM users u WHERE {w} ORDER BY u.last_active DESC LIMIT %s OFFSET %s", p + [per, (page - 1) * per])
    return {"total": total, "page": page, "per": per, "users": [user_row(r) for r in rows]}


@app.patch("/api/admin/users/{uid}")
def admin_user_edit(uid: int, body: UserAdminIn, request: Request, u=Depends(need_perm("Users", "edit"))):
    t = db_one("SELECT * FROM users WHERE id = %s", (uid,))
    if not t:
        raise HTTPException(404, "User not found")
    if uid == u["id"]:
        raise HTTPException(400, "You can't change your own role or status")
    if body.role is not None:
        if not db_one("SELECT 1 FROM roles WHERE name = %s", (body.role,)):
            raise HTTPException(400, "Unknown role")
        if u["role"] != "Super Admin" and "Super Admin" in (body.role, t["role"]):
            raise HTTPException(403, "Only a Super Admin can change Super Admin roles")
    if body.status is not None and body.status not in ("Active", "Inactive"):
        raise HTTPException(400, "Unknown status")
    new_role = body.role if body.role is not None else t["role"]; new_status = body.status if body.status is not None else t["status"]
    if t["role"] == "Super Admin" and (new_role != "Super Admin" or new_status != "Active"):
        if db_one("SELECT count(*) AS n FROM users WHERE role = 'Super Admin' AND status = 'Active'")["n"] <= 1:
            raise HTTPException(400, "There must be at least one active Super Admin")
    db_run("UPDATE users SET role = %s, status = %s WHERE id = %s", (new_role, new_status, uid))
    if new_status != "Active":
        db_run("DELETE FROM sessions WHERE user_id = %s", (uid,))
    if new_role != t["role"]:
        audit(u["email"], "Updated user role", f"{t['name']} ({new_role})", client_ip(request))
    if new_status != t["status"]:
        audit(u["email"], "Changed user status", f"{t['name']} ({new_status})", client_ip(request))
    return {"ok": True}


@app.delete("/api/admin/users/{uid}")
def admin_user_delete(uid: int, request: Request, u=Depends(need_perm("Users", "delete"))):
    t = db_one("SELECT * FROM users WHERE id = %s", (uid,))
    if not t:
        raise HTTPException(404, "User not found")
    if uid == u["id"]:
        raise HTTPException(400, "You can't delete your own account here")
    if t["role"] == "Super Admin" and u["role"] != "Super Admin":
        raise HTTPException(403, "Only a Super Admin can delete a Super Admin")
    if t["role"] == "Super Admin" and db_one("SELECT count(*) AS n FROM users WHERE role = 'Super Admin' AND status = 'Active'")["n"] <= 1:
        raise HTTPException(400, "There must be at least one active Super Admin")
    db_run("DELETE FROM users WHERE id = %s", (uid,))
    audit(u["email"], "Deleted user", f"{t['name']} <{t['email']}>", client_ip(request))
    return {"ok": True}


@app.get("/api/admin/roles")
def admin_roles(u=Depends(need_staff)):
    rows = db_all("SELECT r.name, r.staff, r.perms, (SELECT count(*) FROM users x WHERE x.role = r.name) AS members FROM roles r ORDER BY r.staff DESC, r.name")
    order = ["Super Admin", "Admin", "Editor", "Developer", "Support", "Viewer", "Member"]
    rows.sort(key=lambda r: order.index(r["name"]) if r["name"] in order else 99)
    return {"modules": MODULES, "roles": [{"name": r["name"], "staff": r["staff"], "perms": r["perms"], "members": r["members"]} for r in rows]}


@app.put("/api/admin/roles/{name}")
def admin_role_save(name: str, body: PermsIn, request: Request, u=Depends(need_perm("Users", "edit"))):
    r = db_one("SELECT * FROM roles WHERE name = %s", (name,))
    if not r:
        raise HTTPException(404, "Role not found")
    if name == "Super Admin":
        raise HTTPException(400, "The Super Admin role always has every permission")
    if not r["staff"]:
        raise HTTPException(400, "Members never get access to the admin console")
    if u["role"] != "Super Admin" and name == u["role"]:
        raise HTTPException(403, "You can't change the permissions of your own role")
    p = body.perms
    if len(p) != len(MODULES) or any(len(row) != 4 for row in p):
        raise HTTPException(400, "Invalid permissions")
    db_run("UPDATE roles SET perms = %s WHERE name = %s", (Jsonb([[1 if x else 0 for x in row] for row in p]), name))
    audit(u["email"], "Updated role permissions", name, client_ip(request))
    return {"ok": True}


@app.get("/api/admin/audit")
def admin_audit(user: str = "", action: str = "", q: str = Query("", max_length=80), page: int = Query(1, ge=1), per: int = Query(10, ge=1, le=100), u=Depends(need_perm("Audit Log", "view"))):
    where, p = ["TRUE"], []
    if user:
        where.append("actor = %s"); p.append(user)
    if action:
        where.append("action = %s"); p.append(action)
    if q:
        where.append("lower(actor || ' ' || action || ' ' || target) LIKE %s"); p.append(f"%{q.lower()}%")
    w = " AND ".join(where)
    total = db_one(f"SELECT count(*) AS n FROM audit WHERE {w}", p)["n"]
    rows = db_all(f"SELECT * FROM audit WHERE {w} ORDER BY ts DESC LIMIT %s OFFSET %s", p + [per, (page - 1) * per])
    return {"total": total, "page": page, "per": per, "rows": [{"ts": iso(r["ts"]), "actor": r["actor"], "action": r["action"], "target": r["target"], "ip": r["ip"], "status": r["status"]} for r in rows],
            "actors": [r["actor"] for r in db_all("SELECT DISTINCT actor FROM audit ORDER BY actor LIMIT 100")], "actions": [r["action"] for r in db_all("SELECT DISTINCT action FROM audit ORDER BY action")]}


@app.get("/api/admin/settings")
def admin_settings_get(u=Depends(need_staff)):
    return {r["key"]: r["value"] for r in db_all("SELECT key, value FROM settings")}


@app.put("/api/admin/settings")
def admin_settings_put(body: SettingsIn, request: Request, u=Depends(need_perm("Settings", "edit"))):
    for k, v in body.model_dump().items():
        db_run("INSERT INTO settings(key, value) VALUES (%s,%s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (k, Jsonb(v)))
    audit(u["email"], "Changed settings", "General settings" + (" (maintenance " + ("on" if body.maint else "off") + ")"), client_ip(request))
    return {"ok": True}


def parse_range(frm, to):
    try:
        a = date.fromisoformat(frm) if frm else date.today() - timedelta(days=30)
        b = date.fromisoformat(to) if to else date.today()
    except ValueError:
        raise HTTPException(400, "Invalid date")
    if a > b or (b - a).days > 800:
        raise HTTPException(400, "Invalid date range")
    return a, b + timedelta(days=1)


@app.get("/api/admin/reports")
def admin_reports(frm: str = Query("", alias="from"), to: str = "", u=Depends(need_perm("Reports", "view"))):
    a, b = parse_range(frm, to)
    k = db_one("SELECT (SELECT count(*) FROM users WHERE created_at >= %s AND created_at < %s) AS new_users, (SELECT count(*) FROM trips WHERE created_at >= %s AND created_at < %s) AS trips,"
               " (SELECT count(*) FROM reviews WHERE created_at >= %s AND created_at < %s) AS reviews, (SELECT count(*) FROM wishlist WHERE added_at >= %s AND added_at < %s) AS saves", (a, b) * 4)
    growth = db_all("SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, count(*) AS n FROM users WHERE created_at >= date_trunc('month', now()) - interval '11 months' GROUP BY 1 ORDER BY 1")
    by_m = {r["m"]: r["n"] for r in growth}; months = []
    d0 = date.today().replace(day=1)
    for i in range(11, -1, -1):
        y, m = d0.year, d0.month - i
        while m <= 0:
            m += 12; y -= 1
        months.append({"m": f"{y}-{m:02d}", "n": by_m.get(f"{y}-{m:02d}", 0)})
    req = db_all("SELECT date_trunc('day', bucket) AS d, sum(n) AS n FROM req_stats WHERE bucket >= %s AND bucket < %s GROUP BY 1 ORDER BY 1", (a, b))
    peak = db_one("SELECT max(n) AS n FROM req_stats WHERE bucket >= %s AND bucket < %s", (a, b))["n"]
    return {"from": a.isoformat(), "to": (b - timedelta(days=1)).isoformat(), "kpi": k, "growth": months,
            "requests": [{"d": r["d"].date().isoformat(), "n": int(r["n"])} for r in req], "peakPerMin": round(peak / 10, 1) if peak else 0,
            "totals": db_one("SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM trips) AS trips, (SELECT count(*) FROM reviews) AS reviews")}


def csv_response(name, header, rows):
    def gen():
        buf = io.StringIO(); w = csv.writer(buf); w.writerow(header); yield buf.getvalue()
        for r in rows:
            buf.seek(0); buf.truncate(); w.writerow([("'" + c if isinstance(c, str) and c and c[0] in "=+-@" else c) for c in r]); yield buf.getvalue()
    return StreamingResponse(gen(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/admin/export/{what}")
def admin_export(what: str, request: Request, frm: str = Query("", alias="from"), to: str = "", u=Depends(need_perm("Reports", "view"))):
    a, b = parse_range(frm, to)
    if what == "users":
        rows = db_all("SELECT id, name, email, role, status, created_at, last_active FROM users WHERE created_at >= %s AND created_at < %s ORDER BY id", (a, b))
        out = csv_response("users.csv", ["id", "name", "email", "role", "status", "joined", "last_active"], [[r["id"], r["name"], r["email"], r["role"], r["status"], iso(r["created_at"]), iso(r["last_active"])] for r in rows])
    elif what == "trips":
        rows = db_all("SELECT t.id, t.name, o.email, t.public, jsonb_array_length(t.days) AS days, t.created_at FROM trips t JOIN users o ON o.id = t.owner_id WHERE t.created_at >= %s AND t.created_at < %s ORDER BY t.created_at", (a, b))
        out = csv_response("trips.csv", ["id", "name", "owner_email", "public", "days", "created"], [[r["id"], r["name"], r["email"], r["public"], r["days"], iso(r["created_at"])] for r in rows])
    elif what == "audit":
        if not (u["role"] == "Super Admin" or u["perms"][3][0]):
            raise HTTPException(403, "Your role can't view the audit log")
        rows = db_all("SELECT * FROM audit WHERE ts >= %s AND ts < %s ORDER BY ts", (a, b))
        out = csv_response("audit_log.csv", ["time", "user", "action", "target", "ip", "status"], [[iso(r["ts"]), r["actor"], r["action"], r["target"], r["ip"], r["status"]] for r in rows])
    else:
        raise HTTPException(404, "Unknown report")
    audit(u["email"], "Exported report", what, client_ip(request))
    return out


# Serve the web app from this process when STATIC_DIR is set (single-container deployments).
# Keep this LAST: its catch-all route must come after every /api route.
from .web import mount_static  # noqa: E402

mount_static(app)
