# AVANPOST вЂ” Gameplay Prototype v0.1

## Scope

These rules apply to branch `feat/gameplay-prototype-v0.1` only.

The project owner explicitly authorized a separate playable prototype based on the existing AVANPOST implementation. This experimental prototype does not amend or replace the accepted GDD or the Peace V2 / Peace Lite V1 production plans.

The immediate goal is a playable 5вЂ“10 minute Phaser game, not the complete Peace V2 or Peace Lite V1 release.

## Source of truth

Primary task: `AVANPOST_GAMEPLAY_PROTOTYPE_V01_OPENCODE.md` in the repository root. Read and follow all of its requirements and acceptance criteria.

The existing `Avanpost_GDD_v0.9.md`, `docs/v2/*` and `docs/peace-lite-v1/*` are reference material for reusing existing gameplay, code, assets and architectural ideas. Their historic gate sequence, old branch names and old MVP-SLICE instructions do not block development in this experimental branch.

Do not edit those specifications to make the prototype appear finished.

## Implementation

- Work only in `feat/gameplay-prototype-v0.1`.
- Reuse existing Phaser implementation, sprites, visuals and functioning gameplay code where practical.
- Prefer a separate prototype application under `apps/gameplay-prototype` to protect existing Peace V2 code.
- Do not rewrite, replace or delete the original Peace V2 application and simulation.
- Use a simple local single-player simulation if this is faster and safer than adapting the full server.
- PostgreSQL, login, multiplayer, dedicated APIs, email, cloud services, research, academies, royal orders and production authentication are not required for this prototype.
- `localStorage` is sufficient for prototype saves.
- Implement actual visible gameplay before additional infrastructure or process documentation.
- First deliver a living scene with three visible residents, trees, stone and a warehouse.
- Add direct player control: assign residents to woodcutting, stone mining, hauling and construction.
- Show residents physically walking, extracting resources, carrying materials and constructing buildings over time.
- Build a house with visible progress; completion must visibly expand the settlement and allow a fourth resident.
- Allow a second warehouse and another house so the experience continues beyond its first success.
- Show legible controls, meaningful feedback, selectable objects, resource counts and reasons for blocked actions.
- The game must survive refresh/restart and restore the saved settlement without test fixtures or manual API calls.
- A first-time player should be able to understand and experience settlement growth in 5вЂ“10 minutes.

## Agent execution

- Use the built-in OpenCode `Build` agent in the current session.
- Do not start `Michael`, `Developer`, `QA`, `Artist` or any other subagent.
- Do not invoke `review-cycle`, parallel agent sessions, new offices or additional worktrees.
- The same Build agent performs coding, automated tests, browser playtesting and fixes sequentially.
- Never claim independent QA if no independent QA took place.
- Do not stop at planning, infrastructure or test output. Deliver a visibly playable game.

## Safety and version control

- Preserve all existing Peace V2 implementation, assets, migrations, databases and user data.
- Do not modify or reset dev, manual, test or production databases.
- Do not expose or commit credentials, secrets, ignored local environment files or test access tokens.
- Do not force-push, reset Git history, merge to main, deploy, delete Docker volumes or change branches without explicit permission.
- Commit only relevant prototype work to the prototype feature branch.
- Run relevant unit and build checks and verify actual gameplay through the browser.
- Record screenshots and honest PASS/FAIL/NOT VERIFIED results against the prototype acceptance criteria.

## Completion

Deliver a playable browser prototype, exact launch instructions, screenshots, final Git commit SHA and an honest acceptance report. Provide a simple player walkthrough for the owner's manual playtest.

The project owner alone approves the final gameplay experience after hands-on playtesting. Do not declare the prototype owner-accepted on the basis of tests alone.
