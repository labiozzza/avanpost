# Peace V2 simulation contract

Status: G3.1.1 implements persistent repeated woodcutting, independent resident assignments, configured tree regrowth, permanent stump uprooting and capacity-safe delivery. G3.3 is accepted PASS 6/6 with finite stone extraction, typed hauling, shared capacity, order-linked worksite cargo delivery and one workshop recipe. G3.4 changes interaction controls without changing simulation economics. General path graphs, broad geology, transport modes, catch-up budgeting and remaining GDD domains remain future gates.

## Geometry and traversal

- The world is one continuous strict 2D side-view. X grows right, Y grows down; both global coordinates are signed integers. No hidden depth axis or top-down navigation.
- Screen pixels are renderer-only. Sector/local conversion is explicit and round-trips negative, zero, and positive coordinates.
- Cells independently represent air/solid, material, durability, geology, discovery/preparation, occupancy, infrastructure and topology revision. Water has no liquid/flood/pathing simulation.
- Walking requires body clearance and support; cart movement uses a distinct transport mask. Route graph edges carry transition kind, integer cost, transport mask and topology revision. Stable tie-breaking makes path decisions repeatable.

## Time and determinism

- Pure simulation receives an explicit clock and seeded random source; no `Date.now()` or client clock inside the deterministic core.
- Each world has a canonical server tick/order. G3.1.1 persists `last_simulated_at`, each resident's continuous order/cargo/current target, tree growth progress and uprooted state; restart resumes them without repeating harvests, unloads or reservations.
- Current catch-up advances active resident tasks in stable ID order. If continuous work is waiting on a regrowing source, it advances the woodland until that source becomes available, then resumes work; with no runnable or recoverable work it advances idle ticks arithmetically. A general bounded-budget lease for large worlds remains future work.
- With equal seed and ordered commands, online/offline simulation yields the same canonical state and item-ledger hash. Client FPS, reloads and local time cannot change economics.

## Movement and work

`collect-wood` creates a continuous server-owned order. The resident selects the nearest reachable, available tree, reserving its source/work point in deterministic resident order. After each load it carries one log to the storehouse; if capacity 100 is exhausted it keeps cargo at the warehouse in `waiting_storage` and resumes after capacity is freed. On delivery it selects the next source automatically; when none is available it waits and retries after source/route changes. `cancel-woodcutting` ends the order immediately when empty-handed or after the current cargo is safely delivered. One accepted gather removes exactly one log at loading and adds it to storage only at unloading.

For the owner-approved G3.3 slice only, `stone_miner` continuously mines the finite surface node into its bounded source buffer, then carries typed stone to shared-capacity storage. Mining stops at zero remaining stock; buffered stone, resident cargo and stored stone remain conserved through waiting/reload. Workshop construction queues against the approved preliminary 12-wood/6-stone recipe, reserves available material incrementally without double allocation, and consumes the reservation once on completion. The deposit is not underground and this does not implement formal mining professions, full G4 logistics, or G6 geology.

Every ordinary forest tree retains its maximum of three logs and regrows one log per 100 server ticks (50 seconds) until full. A depleted tree shows a stump; a partially grown tree renders as a young tree. The existing coppice retains its 1,200-tick interval. `uproot-stump` is a resident-bound server command with no item cost or yield; `uprooted` sources never regrow. A cabin task persists `walking_to_build → building` and its planned/foundation/scaffold/complete stages; insufficient wood leaves an unreserved `waiting_materials` build. Same-source/work-point conflicts wait without duplicate harvest or cargo loss. This remains a simple horizontal route model, not a general path graph: carts, bridges, ladders, topology changes and broad collision handling remain future work.

Sector generation is deterministic from seed, generator version and global coordinates; opening order cannot create seams or duplicate resource nodes. Unlock, discovery, preparation and dig progress are separate durable states.
