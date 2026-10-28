# AquaLife

AquaLife is an interactive underwater arena for TikTok LIVE. Viewers appear as fish in a living aquarium, swim around the reef, and compete in a continuous ecosystem. Likes make fish swim faster, while ongoing engagement helps them grow stronger.

The project is a TypeScript monorepo built with React, PixiJS 8, and WebSockets. The server receives TikTok LIVE events and broadcasts normalized events to the browser-based aquarium.

## Features

- Real-time aquarium rendered with PixiJS 8.
- Viewer fish with names, health (HP), and attack damage (ATK).
- Like activity controls swimming speed, using a rolling five-second activity window and gradual speed changes.
- Every 5 accumulated likes grants +1 HP.
- Every 100 accumulated likes increases fish size.
- Gifts can increase health and attack damage and unlock fish appearances.
- Fish enter smoothly from the left or right edge at varied heights.
- Fish continue under AI control after a viewer leaves.
- Jellyfish, reef scenery, swimming animations, and viewer comments above their fish.
- Responsive portrait-first layout for TikTok LIVE and browser-based streaming overlays.
- WebSocket reconnection and a server health endpoint.

## Requirements

- Node.js 22 or newer
- npm

## Getting started

Run these commands from the repository root.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Add your TikTok connector signing key as `SIGN_API_KEY` in `.env` if you want to receive real LIVE events. If the environment file already exists, edit it instead of overwriting it.

The development command builds the shared package and starts the server and client together. Vite opens the client at [http://localhost:5173](http://localhost:5173). The server listens at [http://localhost:3000](http://localhost:3000), and its health endpoint is available at [http://localhost:3000/health](http://localhost:3000/health).

Without `SIGN_API_KEY`, the interface can still be opened locally, but the server will not connect to TikTok LIVE.

## Choose the TikTok LIVE account

Set the target username in `server/src/config.ts`:

```ts
export const STREAMER_USERNAME = "your_username";
```

Use the username without the `@` prefix. The server connects to this configured account rather than searching for other live streams.

## Project structure

- `client/`: React interface, PixiJS aquarium scene, and visual effects.
- `server/`: TikTok LIVE connection, event normalization, WebSocket broadcasting, and HTTP health endpoint.
- `shared/`: shared TypeScript types, aquarium simulation, fish movement, combat, and rewards.
- `scripts/`: local development helpers.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Build shared code and start the server and client |
| `npm run dev:server` | Start only the server |
| `npm run dev:client` | Start only the Vite client |
| `npm run build` | Build all workspace packages |
| `npm run typecheck` | Type-check all workspace packages |
| `npm test` | Run shared package tests |

## Deployment

The repository is structured as a client/server monorepo. The client can be hosted as a static site, but live TikTok event integration also requires a running server with the required environment variables and a WebSocket connection configured for the deployment. Keep `SIGN_API_KEY` on the server and never expose it through client-side `VITE_*` variables.

For a public shareable page, deploy the client and server to a hosting setup that supports the server process and WebSockets, then configure the client's `VITE_WS_URL` to point to the deployed WebSocket endpoint when the client and server use different hosts.

## License

No license has been specified yet.


## Viewer presence and SQLite history

When the TikTok connector provides an identifiable viewer-leave event, the viewer is removed from the online leaderboard immediately. Their fish continues to wander for up to 30 seconds, fades during the final 1.2 seconds, and is then removed. Departure statistics are written to the SQLite `departed_viewers` table after the grace period. The database path can be configured with `AQUALIFE_DB_PATH`; otherwise it is stored under `data/aqualife.sqlite` (or `DATA_DIR` if configured). On hosting platforms, use a persistent disk for `DATA_DIR` if the history must survive redeploys.

The connector must expose a real leave signal for this lifecycle to trigger. A silent viewer who sends no likes is not considered to have left, and their fish keeps swimming at its calm idle speed.
