# ASTRAVEL

A trip planner. Plan a trip on a map, add places day by day, track the budget, and share it with friends.

Built with Python (FastAPI), PostgreSQL and plain JavaScript. Maps come from OpenStreetMap.

## Features

- Sign up with email, or with Google
- Build a trip: days, places on a map, costs
- Wishlist, follow other travellers, reviews
- Public or private trips, invite friends to edit
- Admin console: users, roles, reports, audit log

## Run it

You need Docker and a PostgreSQL database.

```bash
docker build -t astravel .
docker run -p 8000:8000 \
  -e DATABASE_URL=postgresql://user:password@host/astravel \
  -e SESSION_SECRET=any-long-random-string \
  astravel
```

Open http://localhost:8000. The database tables are created on first start.

## Settings

| Variable | What it is |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `SESSION_SECRET` | long random string (required) |
| `ADMIN_EMAILS` | emails that become Super Admin after a Google sign-in |
| `GOOGLE_CLIENT_ID` | enables the Google button (optional) |
| `COOKIE_SECURE` | set to `1` when served over https |

## Folders

- `api/` the backend
- `web/site/` the web pages (no build step)
- `Dockerfile` builds the API and the web pages into one image

## License

MIT
