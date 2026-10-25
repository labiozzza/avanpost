# Peace V2 simulation contract

Status: contract in progress; deterministic gameplay simulation is not implemented.

## Geometry and traversal

- The world is one continuous strict 2D side-view. X grows right, Y grows down; both global coordinates are signed integers. No hidden depth axis or top-down navigation.
- Screen pixels are renderer-only. Sector/local conversion is explicit and round-trips negative, zero, and positive coordinates.
- Cells independently represent air/solid, material, durability, geology, discovery/preparation, occupancy, infrastructure and topology revision. Water has no liquid/flood/pathing simulation.
- Walking requires body clearance and support; cart movement uses a distinct transport mask. Route graph edges carry transition kind, integer cost, transport mask and topology revision. Stable tie-breaking makes path decisions repeatable.

## Time and determinism

- Pure simulation receives an explicit clock and seeded random source; no `Date.now()` or client clock inside the deterministic core.
- Each world has a canonical server tick/order. The persisted last-simulated instant and one active catch-up lease prevent duplicate progress after restart or concurrent reconnect.
- Catch-up is bounded per request. Remaining work persists, the response reports `syncing` and remaining ticks, and mutations stay gated until catch-up completes.
- With equal seed and ordered commands, online/offline simulation yields the same canonical state and item-ledger hash. Client FPS, reloads and local time cannot change economics.

## Movement and work

Residents, carts, buildings and work points use typed collision/transport rules. A worker moves only along reachable edges to a concrete work point. Blocking a route leaves the worker and cargo at their actual locations, sets `waiting_path`, and preserves reservations. Reopening the route resumes from persisted state without duplicated work or items.

Sector generation is deterministic from seed, generator version and global coordinates; opening order cannot create seams or duplicate resource nodes. Unlock, discovery, preparation and dig progress are separate durable states.
