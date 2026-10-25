# Peace V2 building contract

Status: G2.2 browser E2E builds two 2×1 cabins at distinct player-selected anchors, rejects overlap and insufficient materials without debit, and preserves both locations/stages across reload. The broader catalog and footprint/support/entrance systems remain future gates.

Every catalog entry defines a stable ID, category, proposed/approved provenance, level costs/times, integer footprint, support and walk-through masks, entrances, work points/slots, allowed operations, technology gates, storage/buffers, visual states and partial-demolition return. A visual roof may extend beyond a footprint only with an explicit pivot; authoritative occupancy remains the declared cell set.

## Peace Stage I catalog coverage

This is the GDD §4.2 proposed catalog inventory. Names/footprints/prices remain data with provenance, not all-approved balance values.

| Group | Required catalog entries | Primary contract |
|---|---|---|
| Control/housing | Town hall, house | order/reveal controls; real housing capacity |
| Water/agriculture | well, field, barn, mill, bakery | water source; multi-stage food and volume buffers |
| Forestry/geology | forester, sawmill, quarry, mine | renewable plots, finite deposits and reachable work points |
| Materials/craft | stonemason, brick kiln, smelter, forge, carpentry, weaving, leatherworking | recipes, fuel, specialist, input/output buffers |
| Storage/transport | food storage, timber yard, stone store, metal store, cart yard | compatible capacity and actual item location |
| Infrastructure | road, ladder, bridge, mine tunnel | support, entrance and typed human/cart route transitions |
| Education/science | mining school, craft school, logistics school, science school, academy | real worker, school progress and technology unlocks |
| Late peaceful economy | herb house, reagent workshop | Stage I ingredient chain; no Stage II treatment/market routes |

Resolve overlapping barn/food-store roles in catalog data. No catalog entry may silently duplicate another building's identity or storage semantics.

Placement flow: select catalog entry → visible ghost snapped to world grid → validate all occupied cells/support/entrance/routes → show a text-and-icon denial reason → explicit confirm or cancel → server command with expected world/geometry revision. Touch gestures and `pointercancel` never submit a build. The server revalidates every condition and reserves the entire footprint and materials atomically.

Construction is physical work: materials are hauled to the worksite, a resident reaches a valid work point, and server progress changes the building from planned/foundation/scaffold to complete. Missing materials or access never advances local progress. Reload restores the same footprint and phase.

Ready buildings cannot be dragged. Demolition returns only the catalogued partial amount through a real item transfer, frees occupancy atomically, and recalculates topology. Reject a placement that blocks a sole route or overlaps any cell, without partial debit.
