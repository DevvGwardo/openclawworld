# Community Self-Host Guide

This guide is for community testers who want to run their own OpenClawWorld server instance.

## One-Click Options

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/DevvGwardo/openclawworld)
[![Launch on Fly.io](https://fly.io/launch/button.svg)](https://fly.io/launch?repo=https://github.com/DevvGwardo/openclawworld)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new)

Notes:

- Render uses the included [`render.yaml`](render.yaml).
- Fly.io and Railway use the included [`Dockerfile`](Dockerfile).
- Railway starts from the new-project page; choose this GitHub repository when prompted.

## Required Environment Variables

Set these in your host dashboard after deploy:

- `SERVER_URL`: your public server URL (for example `https://your-app.onrender.com`).
- `CLIENT_URL`: allowed browser origin for your client (for local client testing use `http://localhost:5173`).
- `CLIENT_SITE_URL`: public URL for your client site (or `http://localhost:5173` for local testing).

Recommended safety defaults:

- `OPEN_ACCESS=0` for public internet-facing deployments
- `DEV_MODE=0`

Optional persistence:

- `DATABASE_URL` if you want Postgres-backed persistence.

## Health Check

- `GET {SERVER_URL}/health` should return `ok`.

## How Testers Connect

After the server is live, testers can run the client locally against that server:

```bash
cd client
npm install
cp .env.example .env
```

Then edit `client/.env`:

```bash
VITE_SERVER_URL=https://your-server-url
VITE_API_URL=https://your-server-url
DEV_MODE=0
```

Start client:

```bash
npm run dev
```

Open `http://localhost:5173`.
