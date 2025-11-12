
# Auction Site

A simple multi-auction website with an admin panel.

## Features
- Admin at `/admin` with login
- Default credentials: **admin / changeme123** (change in Admin > Credentials)
- Create auctions with:
  - Title, slug
  - Start time (local) and duration (minutes)
  - Starting bid, min and max increment
  - Description (shown below the bid button)
- Bidders see:
  - Dark blue theme
  - Current bid in the middle, countdown, item info below
- Bidding is only allowed between start and end

## Run locally
```bash
npm install
npm start
# open http://localhost:3000
```


---

## Host the code on GitHub

1. Create a new GitHub repository (no README/license/\.gitignore).
2. In your terminal:
   ```bash
   cd auction-site
   git init
   git add .
   git commit -m "Initial commit: multi-auction site with admin"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

## Deploy (quick options)

### Render (recommended for simplicity)
- Connect your GitHub repo to Render.
- Click **New \> Web Service**, pick the repo.
- Runtime: **Node** (auto), Build Command: `npm install`, Start Command: `node server.js`.
- Add environment variable `SESSION_SECRET` (any random string).
- Optional: add a persistent disk if you want `data.json` to persist across restarts.

### Railway
- Create a new project from your GitHub repo.
- Railway will auto-detect Node. Set the start command to `node server.js`.
- Add `SESSION_SECRET` environment variable.

> **Note on persistence**: This app stores data in `data.json`. Many hosts use ephemeral filesystems. 
> For production, mount a persistent disk or switch to a database (e.g., SQLite/Postgres). The app’s functionality is unchanged.
