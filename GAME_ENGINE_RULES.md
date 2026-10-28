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

## Agreed game rules

The actual gameplay rules will be recorded here as they are supplied and confirmed. Do not invent missing scoring, win/lose, spawn, movement, collision, or round-reset rules. If a rule is ambiguous and would affect architecture or behavior, ask one focused question before implementing it.
