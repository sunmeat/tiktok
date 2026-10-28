# Game Engine Architecture and Performance Rules

This document is the source of truth for architecture decisions in this repository. Read it before implementing gameplay or refactoring rendering. New game rules will be added here as they are agreed.

## Product and runtime goals

- The game runs as a TikTok LIVE browser overlay / OBS Browser Source and must also remain usable on ordinary desktop and mobile browsers.
- Target smooth 60 FPS on supported hardware. Treat this as a measured performance goal, not a guarantee: profile representative devices and keep a graceful fallback for weaker hardware.
- Incoming TikTok events can arrive in bursts. Rendering must remain responsive even when chat, likes, follows, and gifts spike.
- Preserve existing functionality unless a requested game rule explicitly changes it. Make small, verifiable changes and do not silently replace working behavior.

## Rendering architecture

1. **PixiJS is the game renderer.** The repository already uses PixiJS 8. Use its WebGL-backed renderer for moving game entities, characters, particles, projectiles, effects, and other frequently changing visuals.
2. **Do not render moving game entities as individual React/DOM elements.** React is for menus, settings, accessible controls, and low-frequency overlay UI. PixiJS owns the dynamic scene.
3. Keep the scene organized into explicit layers, for example: background, world, characters, effects, foreground/UI. Add layers only when they have a real purpose.
4. Avoid recreating the PixiJS Application, textures, containers, graphics, and text every frame. Initialize renderer resources once, update existing objects, and destroy them only when their lifecycle ends.
5. Use texture atlases/spritesheets for repeated artwork when practical. Reuse textures and styles; avoid unnecessary texture uploads and excessive distinct draw calls.
6. Avoid per-frame layout work, DOM reads/writes, large React state updates, sorting, filtering, allocations, and string construction. Precompute or cache stable values where useful.
7. Cap renderer resolution on high-DPI screens. Start with a sensible device-pixel-ratio limit and make quality adjustable if profiling shows a need. Resize cleanly when the overlay changes dimensions.
8. Respect reduced-motion preferences where practical and keep essential game information legible without animation.

## Simulation and frame loop

- Separate **game simulation**, **incoming event handling**, and **rendering**. Network callbacks must not directly create a storm of visual objects or perform expensive scene updates.
- Use a single well-defined ticker / frame loop. Avoid starting duplicate tickers or nested animation loops.
- Use delta time for visual motion. For gameplay that depends on consistent timing, use a fixed simulation step with an accumulator and a bounded catch-up count; render/interpolate separately when needed.
- Clamp unusually large frame deltas after tab suspension or a stall so the simulation does not jump across the screen or perform an unbounded catch-up loop.
- Keep coordinate spaces and resize behavior explicit. Do not hardcode gameplay positions to a single screen size; derive layout from the logical game viewport.
- Make randomness injectable/seedable for tests and reproducible bug reports where gameplay logic needs deterministic outcomes.

## Memory, object lifetime, and pooling

- Reuse high-churn entities through object pools when profiling or expected event volume justifies it. Particle/effect pools must have a capacity and an explicit overflow policy.
- Prefer resetting and reusing PixiJS objects over repeatedly creating/destroying Graphics, Text, Containers, and sprites in hot paths.
- Every entity must have a clear lifecycle: acquire/create, activate, update, deactivate, release/destroy.
- Bound queues, histories, particles, chat entries, effects, and other collections. Never allow a long-running stream to grow memory without limit.
- Clean up ticker callbacks, WebSocket listeners, timers, workers, event handlers, textures, and PixiJS resources on shutdown/unmount. Do not leave callbacks that reference destroyed objects.
- Do not use a timer per particle/entity. Update timed effects from the central frame loop or a small number of managed timers.

## TikTok event and networking pipeline

- Treat WebSocket messages as input data, not rendering commands. Validate message shape and normalize events at the boundary.
- Buffer and aggregate bursts. Apply game-state changes in bounded batches, ideally at a controlled cadence aligned with the frame loop, rather than triggering one React render or visual effect per raw event.
- Coalesce high-frequency likes and repeated gifts when the game rules allow it. Preserve semantically important events such as comments or distinct gifts; aggregation must never silently change scoring rules.
- Bound pending event queues and define backpressure/overflow behavior. Prioritize gameplay-critical events over cosmetic effects during overload.
- Keep network I/O and TikTok connector work off the rendering path. Use Web Workers only when profiling shows expensive parsing/processing on the browser main thread; the TikTok connection itself remains on the server.
- Keep the server authoritative for incoming TikTok event interpretation and shared game rules where appropriate. The client should receive normalized, typed messages rather than provider-specific payloads.
- Reconnect safely and cleanly. Avoid duplicate subscriptions, duplicate event application, and reconnect loops that grow without bounds.

## CPU/GPU work and optional advanced techniques

- Prefer simple, measurable optimizations first: fewer allocations, pooled effects, batched state updates, shared textures, bounded queues, and avoiding redundant renders.
- Consider Web Workers for CPU-heavy pure computation or parsing only when profiling justifies the added complexity.
- Consider OffscreenCanvas only after checking target-browser / OBS Browser Source support and measuring a meaningful benefit. Keep a fallback path if compatibility is not universal.
- Do not add a rendering framework, worker, custom shader, or elaborate abstraction just because it might be faster. Every added layer must solve a demonstrated need.
- Do not assume every PixiJS object equals one GPU draw call. Verify batching and GPU costs with profiling tools instead of relying on simplistic draw-call assumptions.

## Code organization and contracts

- Keep pure game rules and simulation logic independent from React and PixiJS wherever practical. They should be testable without a browser.
- Keep rendering adapters responsible for translating game state into PixiJS display objects; do not hide scoring or game rules inside visual components.
- Keep shared network contracts in the `shared/` workspace and update client/server consumers together when a message schema changes.
- Prefer typed, small modules with clear ownership over one giant component or one file containing networking, simulation, and rendering.
- Do not introduce new dependencies without a concrete reason. Reuse the existing PixiJS 8 dependency unless a documented decision justifies a change.
- Keep secrets server-side. Never put TikTok signing keys or other secrets into Vite `VITE_*` variables or browser bundles.

## Performance verification and definition of done

For each meaningful gameplay/rendering change:

1. Verify `npm run typecheck` and `npm run build` pass.
2. Test a normal stream of events and a burst/stress scenario (many events arriving together).
3. Check that the game remains responsive, the frame loop does not accumulate duplicate callbacks, and queues/particles remain bounded.
4. Profile frame time, long tasks, CPU/GPU usage, and memory on a representative desktop and, where possible, a weaker/mobile device. Optimize measured bottlenecks.
5. Check resize, reconnect, tab hide/show, and teardown behavior when relevant.
6. State clearly what was tested and what was not. Never claim a 60 FPS result without measurement on a named test setup.


## TikTok vertical layout and responsive composition

- Design the primary stream composition for a **9:16 portrait canvas** first, because most viewers watch TikTok LIVE on phones in portrait orientation. Keep the logical game viewport independent from the actual browser/OBS source dimensions.
- Preserve the entire game field at every viewport size. Use a centered **contain/letterbox** strategy: scale the 9:16 composition uniformly to fit the available width and height, never stretch it and never crop important gameplay. CSS `object-fit: contain` applies to replaced elements such as images/video; for a DOM/PixiJS game viewport, use an explicit aspect-ratio container and calculate a uniform scale or use an equivalent contain layout.
- Fill unused space with an intentional background, frame, or optional overlay panels such as recent gifts/top supporters. Decorative panels must not cover critical gameplay or become a performance burden.
- Test narrow and short viewports, desktop windows, OBS Browser Source sizes, and live resize. Keep the game centered and ensure the full playable field remains visible.

## Mobile readability and TikTok safe areas

- Treat phone-size readability as a core requirement, not a final polish step. Player names, scores, health/status indicators, timers, and round outcomes must remain legible at typical phone viewing sizes. Prefer a small number of clear, high-priority indicators over dense microtext.
- Establish responsive typography and UI sizing with tested minimums. Do not assume a desktop font size will remain readable after the whole scene is scaled down; scale or reflow interface elements deliberately while preserving the game world's aspect ratio.
- Maintain strong contrast between text and the scene. Use dark translucent backing panels (for example, `rgba(0, 0, 0, 0.6)`) and restrained bright accent colors where appropriate. Do not rely on color alone to communicate critical state.
- Respect TikTok's mobile player overlays: the right-side action rail and the bottom creator/comment/input area can obscure content. Keep critical gameplay and moment-to-moment action near the center and upper half of the portrait composition, with suitable safe-area margins on the right and bottom.
- Place secondary information such as chat history, recent events, and extended statistics in reserved side/bottom regions only when those regions are safe for the target player UI. Never put a critical control, player, score, or gameplay event beneath a known overlay area.
- Safe-area dimensions can vary by TikTok client, device, and stream layout. Treat margins as configurable layout constraints and validate using real preview/device checks rather than assuming one universal pixel offset.

## Animation and performance on mobile viewers

- Keep the 60 FPS target from the performance section, but measure frame time on representative hardware. Avoid large blur/glow filters, excessive alpha layers, oversized particle bursts, and long-running animations that cost more than they contribute.
- Prefer PixiJS-managed animation for dynamic game entities and effects. Keep CSS animation for DOM UI elements where appropriate; animate primarily `transform` and `opacity` instead of layout-triggering properties such as `top`, `left`, `width`, and `height`.
- Use `will-change: transform` (or `opacity`) selectively for elements that are about to animate and only while useful. Do not apply `will-change` to every element permanently: it can consume memory and create excessive compositor layers on mobile devices.
- Cap particle/effect counts and visual quality according to measured performance when needed. Under load, preserve gameplay clarity and important state updates before decorative effects.
- Verify smoothness with browser/OBS performance tools and, where possible, a real phone or low-powered device. Do not claim universal 60 FPS based only on a desktop development preview.

## Agreed game rules

The actual gameplay rules will be recorded here as they are supplied and confirmed. Do not invent missing scoring, win/lose, spawn, movement, collision, or round-reset rules. If a rule is ambiguous and would affect architecture or behavior, ask one focused question before implementing it.


## Confirmed AquaLife gameplay rules

These rules were confirmed by the project owner and should be treated as implementation requirements:

- AquaLife is the primary game in this TikTok LIVE overlay project. Preserve existing chat, gift, subscription, connection, and server-status functionality.
- A new fish starts with 5 HP. Every time a fish dies and respawns, its HP resets to exactly 5 before it swims back into the aquarium; do not carry leftover HP across deaths. Maximum HP is unlimited; do not introduce a gameplay cap on HP, because ongoing engagement and gifts should continue to matter. Avoid unsafe numeric overflow in implementation without imposing an arbitrary gameplay limit.
- Every full 5 accumulated likes grants +1 HP. Count likes cumulatively across events and preserve the remainder, preventing lost progress when likes arrive in separate events.
- A fish eaten by a larger fish disappears from the aquarium scene and respawns after 5 seconds. On respawn it keeps its fish species/appearance and swims in from beyond the left or right screen boundary at a shallow, varied angle, then wanders freely without any center-seeking target.
- Appearance persistence: default fish are gray; a subscription changes the fish to the Dory appearance; gifts can unlock one of 10 additional fish appearances. A fish retains its unlocked/current appearance through death and respawn. The precedence between subscription appearance and gift-unlocked species still needs to be clarified.
- The aquarium is continuous, with no automatic round end. One fish dying does not end the game.
- Base bite damage is 1 HP; jellyfish collision damage is 1 HP. Fish may attack opponents of equal or smaller size when their paths bring them within attack range, even when both fish have the same HP. Each successful hit must visibly display its damage number; keep floating damage numbers compact and readable.
- Fish enter the aquarium slowly from beyond the left or right edge at a random height and a shallow, varied angle; new fish must not spawn in the center. Entry speed is a calm, steady 28 px/s and is independent of likes so the entrance remains smooth. Once inside, fish wander freely with gradual turns and avoid only nearby walls. There is no attraction to the center and no intentional target selection for collisions; bites happen naturally when paths cross.
- After entering, fish swimming speed is driven by likes per second: 5 likes/s = 3 px/s, 10 likes/s = 6 px/s, and 15 likes/s = 9 px/s. The linear mapping is 0.6 px/s per like/s, based on a smoothed rolling activity window rather than individual event spikes. Idle fish cruise at 10 px/s (owner request: fish must never stand still, even when viewers are inactive). The like bonus is additive on top of the idle cruise speed: target speed = 10 + 0.6 x likes/s px/s (5 likes/s = 13 px/s). Tune the window and minimum speed during testing; do not claim the exact feel is validated until tested.
- If a viewer leaves, their fish remains in the aquarium under AI control. Active-viewer count and total living fish count must be tracked separately.
- Entry events may be delayed or unavailable for some viewers. Do not invent individual viewers from the total viewer count; create/associate a fish only when the connector provides a sufficiently identifiable event.
- For re-entry, the recommended behavior is to reclaim an existing living AI-controlled fish instead of creating a duplicate, but this specific rule still needs owner confirmation.
- The precise size threshold for eating, attack cooldown/target selection, maximum fish size, reset behavior for stats other than appearance, and exact fish-appearance precedence remain open decisions. Do not invent final rules for these.



## Fish locomotion model (confirmed by the project owner)

Fish must swim like real fish rather than glide at constant speed. The simulation (`shared/src/aqualife/ai.ts`) and renderer (`client/src/aqualife/pixi-adapter.ts`) implement these behaviors:

- **Burst-and-coast.** Speed jumps with each tail stroke and then decays exponentially until the next stroke. The stroke impulse is scaled so the *average* speed still equals the like-driven speed (0.6 px/s per like/s, idle 1.5 px/s). Faster (more liked) fish stroke more often. Near a waypoint the fish stops stroking and glides to a halt.
- **Smooth turning.** Heading follows the steering direction through a smoothed, rate-limited angular velocity; the limit depends on current speed (a turning radius) and never exceeds `maxTurnRateRadiansPerSecond`. Heading never snaps.
- **Minimum movement.** Fish always keep moving, even with no likes: about 35% of waypoints are random spots anywhere in the tank (up, down, left, right), the rest are nearby spots roughly ahead, so fish do not linger along the walls.
- **Waypoint wandering with smooth noise.** A fish swims toward a nearby waypoint roughly ahead of it, with a small smooth noise on the heading. Soft wall avoidance and neighbor separation remain; there is still no attraction to the center and no deliberate targeting for bites.
- **Hovering.** On arrival or when the wander timer ends, a fish may hover in place for about 1-3 s with a small balancing sway, then picks a new waypoint. Heavily liked (fast) fish rarely hover.
- **Rendering.** Tail beat frequency and amplitude follow the stroke pulse (about 5 Hz right after a stroke, nearly still while gliding); the body counter-sways against the tail; a turning fish bends its tail toward the inside of the turn. A fish heading left is mirrored instead of rotated, so it never swims upside down. Labels and comments are never mirrored. Animation advances by elapsed simulation time, not per frame.
- Side entry (calm, steady 28 px/s) and respawn behavior are unchanged.

## Validated TikTok event ingestion

- Validate connector payloads at the server boundary and convert them to the shared normalized event contract before broadcasting them to AquaLife.
- Keep the event queue bounded and flush it in batches on one managed timer. Prefer preserving gifts, subscriptions, joins, and other semantically important events over high-volume likes when capacity is exhausted.
- Deduplicate only when the connector supplies a stable provider event ID. Never use a synthetic timestamp/user key to suppress otherwise legitimate repeated likes.
- Guard every connector callback with connection identity so late callbacks from a disconnected connection cannot affect the active stream. Keep at most one reconnect timer and redact signing secrets from error messages.
- Keep diagnostics aggregate-only: do not expose signing keys or raw connector payloads through health endpoints. Participant and expected-fish estimates must not be presented as authoritative living-fish counts while simulation remains client-side.


## Mobile-first stream composition

- The entire viewport is the aquarium stage. Do not render a separate AquaLife title/header or reserve space outside the scene.
- Design for a vertical 9:16 TikTok LIVE / OBS Browser Source composition first.
- Place a compact, translucent HOW TO PLAY panel at the lower-left of the scene and a compact, translucent leaderboard at the lower-right. Keep both panels readable on phone screens and do not let either panel become a full page column.
- The HOW TO PLAY and leaderboard panels are positioned inside the 9:16 sea rectangle (a centered contain stage), at its lower-left and lower-right corners, not at the corners of the browser window. Their sizes scale with that rectangle.
- AquaLife starts with 7 jellyfish.
- The leaderboard shows only the top 4 players, with no streamer username caption, no online count and no "not following" badge (a follow badge is shown only for followers).
- The three information panels (gift power-ups, HOW TO PLAY, and leaderboard) must be translucent so the aquarium remains visible behind them. HOW TO PLAY should size to its content and stay compact.
- Gift guide uses these six English TikTok LIVE gift names and their matching TikTok CDN artwork: Rose, Finger Heart, Panther, Flame Heart, Pomegranate, and Squirrel. Show no coin prices.
- Fish labels show nickname and HP only (no ATK). When a fish bites another fish, a floating red damage number such as "-1" rises from the bitten fish and fades out (RPG style); the renderer uses a bounded pool of 24 numbers.
- **Gift boosts (confirmed by the owner).** Rose +100 HP; Finger Heart +500 HP; Panther +1000 HP; Flame Heart +5 ATK; Pomegranate +25 ATK; Squirrel +50 ATK. Boosts are multiplied by the gift repeat count. The table lives in `shared/src/aqualife/gifts.ts` (`GIFT_GUIDE`) and drives both the simulation and the top GIFT POWER-UPS panel. Matching is by gift name until real TikTok gift IDs are verified (add them to `GIFT_BOOSTS_BY_ID`). Gifts without a rule keep the original +1 HP / +1 ATK per gift.
- A fish that dies fades out smoothly over 1.2 s (same fade as a leaving viewer) and respawns after 5 s as before.
- HOW TO PLAY and LEADERBOARD panels are about 50% more transparent (background alpha 0.33) so fish stay visible behind them; the leaderboard is only as wide as its content. The GIFT POWER-UPS panel sits at the top center of the sea rectangle; keep it clear of TikTok's top overlay when adjusting.
- The leaderboard shows gifts and likes, never comment counts. Rank by gifts descending first, then likes descending as the tie-breaker.
