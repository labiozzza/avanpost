# Peace V2 screen and interaction contract

Status: G2.2 owner acceptance is PASS 7/7; G3.1/G3.1.1 owner acceptance is PASS 7/7; G3.2 owner acceptance is ACCEPTED 5/5. G3.3 stone mining has not started pending source/recipe approval. Work roles remain separate from formal school-trained professions. Art is placeholder art.

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

## G2.1 live settlement presentation

- Scene objects use one 48 px cell grid; X grows right and Y grows down from the surface. Phaser camera scroll/zoom transforms world coordinates; viewport resize never rewrites entity positions.
- The scene shows sky, surface, soil and stone as one cutaway. Its labeled cave/geology area is decorative and has no extraction controls.
- Each stable resident has a separately selectable sprite and list chip. The resident inspector reports continuous task phase, current tree, cargo, progress and localized wait reason; scene routes are server-saved per resident. Server phases select atlas animations; client interpolation only smooths display between authoritative snapshots.
- Selecting a resident makes that resident the command actor. The `Добывать древесину` action automatically assigns the nearest reachable available tree; `Остановить добычу` completes safe delivery before ending the order. Selecting a tree can leave the command actor selected while the inspector focuses on the tree. A stump exposes the server-backed `Выкорчевать пень` action. Entering construction recenters the camera on the placement ghost.
- All forest sources render in the scene and remain selectable from the map/list. Adult trees, young regrowth and stumps have distinct silhouettes/stages; uprooted stumps remain identified in the list but no longer display a tree or regrowth timer. The inspector shows logs remaining and the next configured growth interval.
- The G2.2 view remains a true side-on section: the generated distant panorama and two low-contrast ridge layers use slower camera scroll factors; they contain no interactive trees, harvest nodes or foreground blockers. Grass, shrubs, strata and decorative stones are noninteractive graphics. Only server-backed source sprites, residents and buildings are selectable.
- Forest trees use stable source-specific visual scales; young regrowth uses a smaller tinted tree sprite and zero-stock plots show a stump. A full storehouse leaves the resident visibly waiting with its cargo retained. The paired cabin image is also used as a tinted, noninteractive ghost over the server-validated 2×1 footprint. The browser layout keeps the world at least 60% of portrait viewport height and the compact top HUD at or below 8%.
- Building catalog mode anchors a semi-transparent 2×1 cabin ghost to the surface grid. Read-only server validation supplies the exact reason and route result. Confirm submits the selected anchor verbatim; cancel drops only the local ghost.
- Accepted building sites render as planned, foundation, scaffold and complete from persisted server state. Portrait camera controls use touch pan/pinch and 44 px controls; the inspector remains collapsible.
- The resident inspector exposes the persistent `Без роли`/`Лесоруб`/`Строитель` work-role selector and explains when a manual task overrides role automation. Scene labels distinguish woodcutters and builders.
- The construction queue lists every durable order and its waiting/in-progress/completed/cancelled state; waiting orders expose priority up/down and safe cancel controls. Queue position and assignment are server-authoritative and persist across reload/API restart.
