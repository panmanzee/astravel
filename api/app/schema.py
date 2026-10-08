"""Database schema (idempotent) + first-run seed content for ASTRAVEL."""
import json

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  picture       TEXT,
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'Member',
  status        TEXT NOT NULL DEFAULT 'Active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS roles (
  name   TEXT PRIMARY KEY,
  staff  BOOLEAN NOT NULL DEFAULT TRUE,
  perms  JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS catalog (
  id       TEXT PRIMARY KEY,
  kind     TEXT NOT NULL,
  title    TEXT NOT NULL,
  summary  TEXT NOT NULL DEFAULT '',
  about    JSONB NOT NULL DEFAULT '[]',
  why      TEXT NOT NULL DEFAULT '',
  know     TEXT NOT NULL DEFAULT '',
  img      INT,
  thumb    INT,
  photos   JSONB NOT NULL DEFAULT '[]',
  season   TEXT NOT NULL DEFAULT '',
  car      TEXT NOT NULL DEFAULT '',
  cost     INT NOT NULL DEFAULT 0,
  lat      DOUBLE PRECISION,
  lng      DOUBLE PRECISION,
  zoom     INT,
  days     JSONB,
  budget   JSONB,
  explore  BOOLEAN NOT NULL DEFAULT TRUE,
  suggest  TEXT,
  sort     INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reviews (
  id         BIGSERIAL PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (catalog_id, user_id)
);
CREATE TABLE IF NOT EXISTS trips (
  id         TEXT PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  descr      TEXT NOT NULL DEFAULT '',
  tags       JSONB NOT NULL DEFAULT '[]',
  days       JSONB NOT NULL DEFAULT '[]',
  budget     JSONB NOT NULL DEFAULT '[]',
  public     BOOLEAN NOT NULL DEFAULT FALSE,
  img        INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trips_owner ON trips(owner_id);
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, catalog_id)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id     BIGSERIAL PRIMARY KEY,
  ts     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  ip     TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Success'
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts DESC);
CREATE TABLE IF NOT EXISTS req_stats (
  bucket TIMESTAMPTZ PRIMARY KEY,
  n      INT NOT NULL DEFAULT 0,
  errors INT NOT NULL DEFAULT 0
);
"""

MODULES = ["Users", "Reports", "Settings", "Audit Log"]          # permission matrix rows
# columns: view, create, edit, delete
ROLES = {
    "Super Admin": (True, [[1, 1, 1, 1]] * 4),
    "Admin":       (True, [[1, 1, 1, 1], [1, 1, 1, 0], [1, 1, 1, 0], [1, 0, 0, 0]]),
    "Editor":      (True, [[1, 0, 0, 0], [1, 1, 1, 0], [1, 0, 0, 0], [0, 0, 0, 0]]),
    "Developer":   (True, [[1, 0, 0, 0], [1, 1, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]]),
    "Support":     (True, [[1, 0, 1, 0], [1, 0, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0]]),
    "Viewer":      (True, [[1, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    "Member":      (False, [[0, 0, 0, 0]] * 4),
}
SETTINGS = {"name": "ASTRAVEL Admin", "lang": "English", "tz": "UTC+7", "datefmt": "DD/MM/YYYY", "maint": False}

PHOTOS_JP = [7197, 7201, 7209, 1737]

CATALOG = [
    dict(id="japan", kind="Country", title="JAPAN", img=6801, thumb=1737, photos=PHOTOS_JP, season="Spring", car="No Car", cost=120,
         lat=36.2, lng=138.25, zoom=5, sort=1, explore=True,
         summary="Four main islands, 2,000-year-old temples, trains that run on the minute and some of the best food in the world. Plan around cherry blossom in spring and red leaves in autumn.",
         about=["Japan stretches from subtropical Okinawa to snowy Hokkaido. Most first trips combine Tokyo (modern city life), Kyoto and Nara (temples, gardens and old streets) and Osaka (food). Trains connect them on time to the minute, so you can travel easily without a car.",
                "Each season gives a different trip: cherry blossoms from late March to April, green mountains and festivals in summer, red maple leaves in November, and skiing in the north in winter."],
         why="For the mix of old and new: shrines next to skyscrapers, a food culture that runs from street snacks to world-class sushi, safe cities and an efficient rail network.",
         know="Carry some cash: small shops and shrines often do not take cards. Get a Suica or ICOCA IC card for trains and buses. Keep quiet on public transport, take your shoes off where asked and do not tip. Golden Week (early May), Obon (mid-August) and New Year are crowded and expensive. Costs shown are rough estimates in USD per person per day."),
    dict(id="template-japan", kind="Plan template", title="Japan in one day", img=6805, thumb=1737, photos=[], season="Spring", car="No Car", cost=85,
         lat=35.68, lng=139.74, zoom=11, sort=2, explore=True,
         summary="A one-day Tokyo route: fish market breakfast, Tokyo's oldest temple, a forest shrine, the Shibuya crossing and a night view from Tokyo Tower.",
         about=["This one-day plan covers old and new Tokyo using the subway. Start early at the Tsukiji Outer Market, go north to Senso-ji in Asakusa, then west to Meiji Jingu, finish with Shibuya Crossing and a night view of the city.",
                "Use it as it is or change it: press START WITH THIS TEMPLATE to copy it into your own trip, then add, remove or move stops. Prices are rough estimates in USD."],
         why="Gives you a first look at Tokyo in a single day with short, easy subway rides.",
         know="Buy a 24-hour Tokyo Subway Ticket for the subway. Most food stalls at Tsukiji open early and close by early afternoon. Temples and shrines are free, but dress modestly and be quiet.",
         days=[{"date": None, "stops": [
             {"name": "Tsukiji Outer Market", "lat": 35.6655, "lng": 139.7707, "note": "Breakfast on the go: fresh sushi, tamagoyaki (sweet omelette) and grilled seafood skewers.", "time": "08:00 - 09:30", "mode": "Walk", "cost": 15, "done": False},
             {"name": "Senso-ji Temple", "lat": 35.7148, "lng": 139.7967, "note": "Tokyo's oldest temple. Walk through Kaminarimon gate and the Nakamise shopping street.", "time": "10:00 - 11:30", "mode": "By train", "cost": 0, "done": False},
             {"name": "Meiji Jingu", "lat": 35.6764, "lng": 139.6993, "note": "A quiet shrine inside a forest in the middle of the city, next to Harajuku.", "time": "13:00 - 14:30", "mode": "By train", "cost": 0, "done": False},
             {"name": "Shibuya Crossing", "lat": 35.6595, "lng": 139.7005, "note": "The famous scramble crossing. Watch it from the Starbucks window or the Shibuya Sky deck.", "time": "16:00 - 17:30", "mode": "Walk", "cost": 20, "done": False},
             {"name": "Tokyo Tower", "lat": 35.6586, "lng": 139.7454, "note": "Finish with the night view from the Main Deck of the 333 m red-and-white tower.", "time": "19:00 - 20:30", "mode": "By train", "cost": 10, "done": False}]}],
         budget=[{"name": "Food for the day", "cat": "food", "amount": 40, "who": None}, {"name": "24-hour subway ticket", "cat": "transport", "amount": 6, "who": None},
                 {"name": "Observation decks", "cat": "tickets", "amount": 30, "who": None}]),
    dict(id="fukuoka", kind="Place", title="FUKUOKA", img=3735, thumb=3735, photos=[3735, 1733], season="Spring", car="No Car", cost=70,
         lat=33.5904, lng=130.4017, zoom=12, sort=3, explore=True,
         summary="Kyushu's biggest city: pork-bone ramen, open-air yatai food stalls, beaches and castle ruins, with the airport only a few subway stops from the centre.",
         about=["Fukuoka is the largest city on Kyushu island and a relaxed base for a trip. It is compact: Hakata Station, the Tenjin shopping area and the Nakasu entertainment island are all a short subway ride apart, and the airport is inside the city.",
                "It is known for Hakata ramen (rich pork-bone broth), motsunabe hotpot, mentaiko (spicy cod roe) and the yatai, small open-air food stalls that set up along the river every evening."],
         why="Great food at fair prices, a walkable city with beaches and parks, and easy day trips to Dazaifu shrine and the Yanagawa canals.",
         know="Yatai stalls are small and seat about eight people, so expect a short wait and bring cash. Summer is hot and humid; spring and autumn are the most comfortable. The Hakata Gion Yamakasa festival takes place in July."),
    dict(id="uminonakamichi", kind="Place", title="Uminonakamichi Seaside Park", img=3739, thumb=3739, photos=[3739], season="Spring", car="Bike", cost=20,
         lat=33.6637, lng=130.3560, zoom=13, sort=4, explore=True, suggest="Flowers",
         summary="A huge national park on Hakata Bay with seasonal flower fields, cycling paths, a beach and an amusement area.",
         about=["Uminonakamichi Seaside Park is a national government park on a sandbar between Hakata Bay and the open sea, in the north of Fukuoka. It is best known for its flower fields, which change with the season: nemophila in April, tulips and poppies in spring, and kochia and cosmos in autumn.",
                "There is plenty of room to cycle, a sandy beach for swimming in summer, a small zoo and a family amusement area."],
         why="Come for the flower fields and the open space: rent a bicycle, swim in summer or simply walk by the sea.",
         know="The park covers more than 300 hectares, so rent a bike or use the park's bus. Flower peaks change each year, so check the park's website before you go. It takes about 30 minutes from Hakata Station by train."),
    dict(id="fukuoka-castle", kind="Place", title="Fukuoka Castle Ruins", img=1733, thumb=1733, photos=[1733], season="Spring", car="No Car", cost=0,
         lat=33.5842, lng=130.3837, zoom=15, sort=5, explore=False,
         summary="Stone walls, moats and gates of a 17th-century castle in Maizuru Park, famous for its cherry blossoms.",
         about=["Fukuoka Castle (also called Maizuru Castle) was built in the early 1600s by Kuroda Nagamasa, the first lord of the Fukuoka domain. The main keep no longer stands, but the large stone walls, moats and several gates remain inside Maizuru Park, next to Ohori Park."],
         why="It is free to walk around, offers views of the city from the old keep platform, and about a thousand cherry trees bloom here in spring.",
         know="Entry is free. Cherry blossom is usually late March to early April and the park is crowded then. Nearest subway stations: Ohorikoen and Tojinmachi."),
    dict(id="meguro-river", kind="Place", title="Meguro River", img=7197, thumb=7197, photos=[7197], season="Spring", car="No Car", cost=0,
         lat=35.6414, lng=139.6988, zoom=15, sort=6, explore=False, suggest="Sakura",
         summary="A Tokyo canal lined with about 800 cherry trees around Nakameguro, at its best in late March.",
         about=["The Meguro River runs through Nakameguro in Tokyo. In spring the cherry trees on both banks form a pink tunnel over the water, and cafes and small shops along the river stay open into the evening."],
         why="One of the easiest places in Tokyo to see cherry blossoms without leaving the city.", know="Peak bloom is usually late March to early April. Weekends are very crowded; go on a weekday morning."),
    dict(id="mount-fuji", kind="Place", title="Mount Fuji", img=6801, thumb=6801, photos=[6801], season="Summer", car="Car helpful", cost=40,
         lat=35.3606, lng=138.7274, zoom=10, sort=7, explore=False, suggest="Mountain",
         summary="Japan's highest peak at 3,776 m. The official climbing season is early July to early September.",
         about=["Mount Fuji is an active volcano on the border of Yamanashi and Shizuoka prefectures. It can be seen from Tokyo on clear days and is climbed by hundreds of thousands of people each summer."],
         why="For the view of the symmetrical cone and for the sunrise from the summit.", know="Outside the official season the trails are closed and dangerous. Book a mountain hut in advance, bring warm clothes and allow time to adjust to the altitude."),
    dict(id="tokyo-tower", kind="Place", title="Tokyo Tower", img=None, thumb=None, photos=[], season="Autumn", car="No Car", cost=10,
         lat=35.6586, lng=139.7454, zoom=15, sort=8, explore=False,
         summary="A 333 m red-and-white tower in Minato, Tokyo, opened in 1958, with observation decks and a night-time light-up.",
         about=["Tokyo Tower was built in 1958 and is one of the symbols of the city. The Main Deck is at 150 m and the Top Deck at 250 m (separate ticket)."],
         why="A classic city view, and it looks best at dusk when the lights come on.", know="Buy tickets online to skip the queue. Weekday evenings are the quietest."),
    dict(id="himeji-castle", kind="Place", title="Himeji Castle", img=1737, thumb=1737, photos=[1737], season="Spring", car="No Car", cost=15,
         lat=34.8394, lng=134.6939, zoom=15, sort=9, explore=False, suggest="Castle",
         summary="Japan's best-preserved feudal castle, a UNESCO World Heritage Site known as the White Heron Castle.",
         about=["Himeji Castle in Hyogo prefecture is a hilltop castle complex whose main keep dates from the early 1600s. It survived wars and earthquakes and was listed as a UNESCO World Heritage Site in 1993. Its white walls give it the nickname Shirasagi-jo, the White Heron Castle."],
         why="It is one of the few original castles in Japan, and the keep, gates and winding paths show how a real fortress was designed.", know="It is about a 20 minute walk from Himeji Station. Early April, when the cherry trees bloom, is the busiest time. Expect to climb steep wooden stairs inside the keep and take your shoes off."),
]


def seed(cur):
    cur.execute("SELECT count(*) AS n FROM roles")
    if cur.fetchone()["n"] == 0:
        for name, (staff, perms) in ROLES.items():
            cur.execute("INSERT INTO roles(name, staff, perms) VALUES (%s,%s,%s)", (name, staff, json.dumps(perms)))
    cur.execute("SELECT count(*) AS n FROM settings")
    if cur.fetchone()["n"] == 0:
        for k, v in SETTINGS.items():
            cur.execute("INSERT INTO settings(key, value) VALUES (%s,%s)", (k, json.dumps(v)))
    cur.execute("SELECT count(*) AS n FROM catalog")
    if cur.fetchone()["n"] == 0:
        for c in CATALOG:
            cur.execute(
                "INSERT INTO catalog(id,kind,title,summary,about,why,know,img,thumb,photos,season,car,cost,lat,lng,zoom,days,budget,explore,suggest,sort)"
                " VALUES (%(id)s,%(kind)s,%(title)s,%(summary)s,%(about)s,%(why)s,%(know)s,%(img)s,%(thumb)s,%(photos)s,%(season)s,%(car)s,%(cost)s,%(lat)s,%(lng)s,%(zoom)s,%(days)s,%(budget)s,%(explore)s,%(suggest)s,%(sort)s)",
                {**{k: None for k in ("days", "budget", "suggest")}, **c, "about": json.dumps(c.get("about", [])), "photos": json.dumps(c.get("photos", [])),
                 "days": json.dumps(c["days"]) if c.get("days") else None, "budget": json.dumps(c["budget"]) if c.get("budget") else None})
