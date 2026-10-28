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

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The client runs at `http://localhost:5173`; the backend runs at `http://localhost:3000`. Without `SIGN_API_KEY`, the interface remains available but TikTok connection and stream discovery are disabled.

## Choosing a test stream

Edit `server/src/config.ts`:

- `USE_MY_STREAM = true`: connect to your own stream, `MY_TIKTOK_USERNAME = "alex.stream.games"`.
- `USE_MY_STREAM = false`: scan `DISCOVERY_USERNAMES` and select a live stream whose current viewer count is within `TARGET_VIEWERS` through `TARGET_VIEWERS + VIEWER_COUNT_TOLERANCE`.
- `TARGET_VIEWERS = 10`: change to `50` or `100` when needed.
- `DISCOVERY_USERNAMES`: add candidate TikTok usernames without the `@` sign.
- `DISCOVERY_RETRY_MS`: how long to wait before scanning again if no suitable live is found.

Example:

```ts
export const USE_MY_STREAM = false;
export const MY_TIKTOK_USERNAME = "alex.stream.games";
export const TARGET_VIEWERS = 10;
export const VIEWER_COUNT_TOLERANCE = 5;
export const DISCOVERY_USERNAMES = [
  "candidate_one",
  "candidate_two",
];
```

The discovery process checks candidates one by one, logs their live status and viewer counts, then connects to the first closest match in the configured range. If no match is found, it retries later. TikTok does not provide a public official endpoint for enumerating every current LIVE, so this implementation searches the configured candidate pool rather than claiming to find every stream on the platform. The connector is unofficial and TikTok may change its internal protocol.

A `SIGN_API_KEY` is required by this project's current server configuration. Set it in the root `.env` file and keep it out of Git.

## Workspaces

- `server/`: TikTok connection, discovery, event normalization, player scoring, health endpoint and WebSocket broadcast.
- `client/`: React overlay, chat, leaderboard, reconnecting WebSocket client and PixiJS gift effects.
- `shared/`: common TypeScript event and player contracts.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start frontend and backend for development |
| `npm run dev:server` | Start only the backend |
| `npm run dev:client` | Start only the frontend |
| `npm run build` | Build shared types, backend and frontend |
| `npm start` | Run the compiled backend |
| `npm run typecheck` | Type-check all workspaces |

## WebSocket events

`init`, `update_leaderboard`, `chat_message`, `gift_alert`, and `connection_status`.

## Deployment

The included `render.yaml` builds the workspaces and runs the long-lived Node.js process. The `/health` endpoint is used for health checks. The frontend may also be hosted as static files, but set `VITE_WS_URL` to the public `wss://` endpoint before building. The TikTok connector should run in a persistent service, not a serverless function.
