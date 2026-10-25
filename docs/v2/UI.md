# Peace V2 screen and interaction contract

Status: UI contract in progress; only the G0 health endpoint exists. No player-facing V2 game screen is implemented.

- One strict side-view world scene anchors the interface; surface and underground are in the same continuous coordinate space.
- Compact top HUD shows actual server resources and connection/sync status. Mode controls remain available without covering the selected plot. Worker/route details appear only when requested.
- Stage I screen map covers the main side-view scene, building catalog, building inspector, resident registry, schools, research, storage/logistics, sector map, royal orders, task/event log and profile/PWA settings. Each panel must expose real data and a visible recovery action; no Stage II panel is implemented.
- Approved G2 viewport budget: top HUD ≤8% of usable height, persistent mode bar ≤12%, normal/placement world ≥60%; expanded inspector replaces the mode bar, is ≤35%, leaves ≥55% world, and collapses during placement to restore ≥60%. At 375×667, sheets scroll without covering confirm/cancel.
- Before pairing, phone shows the world read-only and a focused pairing sheet; all mutation controls stay disabled. Safe invalid/expired/reused/rate-limited recovery has no code echo or attempt count.
- The unpaired preview is launcher-scoped, contains no owner/session identifiers, and exposes no mutating API action; switching to paired state requires a successful one-time pairing POST.
- Pairing accepts one visibly labelled full-code field, paste/manual entry, show/hide and explicit `Подключить`; no auto-submit and no persistent storage.
- Building selection is separate from placement. Ghost previews the exact footprint and reason; confirm and cancel are separate. Pan/zoom/pinch/resize/pointercancel cannot confirm a placement.
- Portrait targets include 390×844 and 375×667; landscape 844×390 and desktop 1440×900. Safe areas and 44×44 CSS px hit targets are required. Device emulation is not physical-device evidence.
- UI text is Russian. `PLAY_NOW.md` stays terminal-free and is not permission to claim gameplay until a live browser-verified G2 build exists.
