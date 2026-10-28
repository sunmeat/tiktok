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

Edit just one line in `server/src/config.ts`:

```ts
export const STREAMER_USERNAME = "alex.stream.games";
```

Put the username of any streamer whose LIVE is currently running. Use the same line for your own stream or someone else's; omit the `@` prefix. The server connects directly to that username and retries if the connection drops. It does not scan for streams or filter by viewer count.

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
