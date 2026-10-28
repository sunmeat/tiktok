# Repository instructions for coding agents

Before changing code, read [GAME_ENGINE_RULES.md](./GAME_ENGINE_RULES.md). It is the source of truth for game-engine architecture, rendering performance, event processing, resource lifecycle, and testing.

## Non-negotiable project rules

- Work on the existing default branch unless the user explicitly asks otherwise. Do not create branches or pull requests for routine requested changes.
- Preserve existing behavior and working features unless the user explicitly asks to change them.
- Use PixiJS 8 for the dynamic game scene. React is for low-frequency UI and controls, not one DOM node per moving entity.
- Keep simulation/game rules separate from rendering and network transport where practical.
- Keep event handling bounded and burst-tolerant. Do not trigger a React render or allocate a new visual object for every raw like/event.
- Reuse resources and clean up all tickers, listeners, timers, sockets, workers, and PixiJS resources.
- Keep secrets on the server. Never expose signing keys through client-side environment variables or browser bundles.
- Do not invent gameplay rules. Record confirmed rules in GAME_ENGINE_RULES.md; ask a focused question when an ambiguity changes game behavior or architecture.
- Prefer small, testable changes. Do not claim tests or performance targets passed unless they were actually run and measured.
- Before finishing, run or clearly state the status of relevant checks, especially npm run typecheck and npm run build. Explain any checks that could not be run.

## Required workflow

1. Read GAME_ENGINE_RULES.md and inspect the current implementation before choosing an architecture.
2. Identify the smallest change that satisfies the request without breaking existing functionality.
3. Keep shared TypeScript contracts consistent between shared/, server/, and client/.
4. Verify behavior and build/type checks where the environment permits.
5. Update GAME_ENGINE_RULES.md whenever the user confirms new game rules or makes an architectural decision that should persist.
