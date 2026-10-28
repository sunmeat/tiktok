# TikTok Live Arena

TypeScript monorepo for a real-time TikTok LIVE overlay. The Node.js server owns the TikTok connection and WebSocket stream; the React/Vite client is a reconnectable, transparent OBS Browser Source with PixiJS gift effects.

## Architecture

```text
TikTok LIVE -> tiktok-live-connector -> server/ (Node.js + TypeScript + Express + ws)
                                           |
                                      typed WebSocket
                                           v
                           client/ (React + TypeScript + Vite + PixiJS)
                                           ^
                                      shared/ contracts
```

## Quick start

Requirements: Node.js 22+ and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. The client runs at `http://localhost:5173`; the backend runs at `http://localhost:3000`. Without `SIGN_API_KEY`, the interface remains available but live TikTok events are disabled.

## Workspaces

- `server/`: TikTok connection, event normalization, player scoring, health endpoint and WebSocket broadcast.
- `client/`: React overlay, chat, leaderboard, reconnecting WebSocket client and PixiJS gift effects.
- `shared/`: common TypeScript event and player contracts.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start frontend and backend for development |
| `npm run build` | Build shared types, backend and frontend |
| `npm start` | Run the compiled backend |
| `npm run typecheck` | Type-check all workspaces |

## WebSocket events

`init`, `update_leaderboard`, `chat_message`, `gift_alert`, and `connection_status`.

## Environment

See `.env.example`. Set `SIGN_API_KEY` and optionally `TIKTOK_USERNAME` in your local environment or Render settings. Keep secrets out of Git.

## Deployment

The included `render.yaml` builds the workspaces and runs the long-lived Node.js process. The `/health` endpoint is used for health checks. The frontend may also be hosted as static files, but set `VITE_WS_URL` to the public `wss://` endpoint before building. The TikTok connector should run in a persistent service, not a serverless function.
