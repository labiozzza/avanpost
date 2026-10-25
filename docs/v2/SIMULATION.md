# Peace V2 simulation contract

Status: G2.1 implements deterministic surface routing, a persisted single-worker gather/load/carry/unload task, and staged cabin construction. Multi-resident routing, geology, transport modes, catch-up budgeting and the remaining GDD simulation domains are future gates.

## Geometry and traversal

- The world is one continuous strict 2D side-view. X grows right, Y grows down; both global coordinates are signed integers. No hidden depth axis or top-down navigation.
- Screen pixels are renderer-only. Sector/local conversion is explicit and round-trips negative, zero, and positive coordinates.
- Cells independently represent air/solid, material, durability, geology, discovery/preparation, occupancy, infrastructure and topology revision. Water has no liquid/flood/pathing simulation.
- Walking requires body clearance and support; cart movement uses a distinct transport mask. Route graph edges carry transition kind, integer cost, transport mask and topology revision. Stable tie-breaking makes path decisions repeatable.

## Time and determinism

- Pure simulation receives an explicit clock and seeded random source; no `Date.now()` or client clock inside the deterministic core.
- Each world has a canonical server tick/order. G2.1 persists `last_simulated_at` and applies elapsed 500 ms ticks under a world-row transaction lock; a restarted process resumes the saved task and does not repeat tree depletion, unloading or material reservation.
- Current slice catch-up loops only while its bounded single worker task is active, then advances idle ticks arithmetically. A general bounded-budget lease for large multi-entity worlds remains future work.
- With equal seed and ordered commands, online/offline simulation yields the same canonical state and item-ledger hash. Client FPS, reloads and local time cannot change economics.

## Movement and work

G2.1 uses stable integer surface coordinates and a deterministic horizontal route to tree, storage and cabin work points. A gather task persists `walking_to_source → gathering → loading → carrying_to_storage → unloading`; tree stock changes only at completed loading and storage stock only at completed unloading. A cabin task persists `walking_to_build → building` and records planned/foundation/scaffold/complete stages; material reservation and exact anchor validation commit with the command. Missing route preserves the worker, cargo and task in `waiting_path`. The general typed graph, carts, bridges, ladders, multi-resident collisions and route topology changes remain future work.

Sector generation is deterministic from seed, generator version and global coordinates; opening order cannot create seams or duplicate resource nodes. Unlock, discovery, preparation and dig progress are separate durable states.
