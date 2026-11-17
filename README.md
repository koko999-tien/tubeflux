# Tubeflux

Self-hosted adult video tube. Node 24 + Express + `node:sqlite` (no native build step),
a vanilla frontend, upload + streaming with range support, thumbnails, categories,
tags, search, comments and an admin panel.

## Requirements

- Node.js **22.5+** (24 recommended — `node:sqlite` is used directly, no better-sqlite3)
- Optional: `ffmpeg-static` installs automatically as an optional dependency and is used
  to auto-generate thumbnails and read durations. If it fails to install, uploads still
  work — you just supply your own thumbnail.

## Setup

```powershell
cd D:\tubeflux
copy .env.example .env      # then edit it
npm install
npm start
```

Open http://localhost:3000 and http://localhost:3000/admin.html

On first boot an admin user is created from `ADMIN_USER` / `ADMIN_PASS` in `.env`
(defaults `admin` / `changeme123`). Change it in the admin panel right after login.

## Configuration (.env)

| key | default | meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `SITE_NAME` | `Tubeflux` | branding |
| `JWT_SECRET` | random | session signing key — set a long random string for persistence |
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `changeme123` | seeded admin (first boot only) |
| `DATA_DIR` | `./data` | SQLite database location |
| `MEDIA_DIR` | `./media` | uploaded videos |
| `THUMB_DIR` | `./thumbs` | thumbnails |
| `MAX_UPLOAD_MB` | `4096` | max upload size per file |

## Layout

```
server.js            express app, static mounts, error handler
config.js            env -> config
db.js                schema, slug helpers, admin + category seeding
lib/media.js         ffmpeg probe / thumbnail generation (optional)
middleware/auth.js   JWT cookie session
routes/api.js        public API
routes/admin.js      admin API (auth required, multipart uploads)
public/              frontend (index, watch, admin, css, js)
data/ media/ thumbs/ runtime storage (gitignored)
```

## API (public)

- `GET /api/videos?page=&limit=&q=&category=&tag=&sort=new|top|views`
- `GET /api/videos/:slug` · `GET /api/videos/:slug/related`
- `POST /api/videos/:slug/view` · `POST /api/videos/:slug/like`
- `GET /api/categories` · `GET /api/tags`
- `GET /api/comments/:slug` · `POST /api/comments/:slug`
- `GET /api/stats` · `GET /api/health`

## Notes

- Streaming uses `express.static` with range support — seeking works out of the box.
- `mkv` / `mov` are served with their container content-type; browsers play `mp4`/`webm`
  natively. For broad compatibility transcode to H.264/AAC mp4 before upload.
- Content is marked `noindex` and gated behind an 18+ age check.
- Deleting a video removes its row, its video file and its thumbnail.
