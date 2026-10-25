# Peace V2 economy and logistics contract

Status: contract in progress; no gameplay economy is implemented.

## Physical item ledger

An item stack has stable ID, catalog item, integer quantity and exactly one current location: resource node, storage, building/worksite buffer, or resident/cart cargo. Split/merge, gather, load, move and unload update the ledger atomically. For each item and checkpoint:

`total = nodes + storage + buffers + delivered-to-worksite + loaded-cargo - explicitly consumed/sunk`

No client state, animation, retry or reload can create or remove stock.

## Economic object types and proposed catalog families

The five GDD §3.1 object types are: extraction point, processing building, compatible volume-limited storage, physical carrier (resident/carry/cart), and consumer (construction, school, research or Stage I royal order). A balance/count in the HUD is a read-only aggregate of these concrete locations.

GDD §3.2 example families are `[proposed]` until content values are reviewed: food (grain/flour/bread/vegetables/water/meat), timber (logs/boards/charcoal), stone (rock/cut stone/clay/brick), metal (ore/ingot/steel/fittings), crafts (cloth/leather/rope/oil/tools), herbs/reagents, research points, and wallet-only currency. Currency, research points and premium crystals are not physical storage items; Stage I does not implement crystals/payments or a player market.

## Resources and storage

- Catalogued sources are `FINITE_NODE`, `RENEWABLE_PLOT`, or low-rate `BASELINE_RENEWABLE`; provenance and balance values distinguish approved GDD numbers from proposed tuning.
- Finite extraction stops at exactly zero. A depleted node cannot go negative or produce more. Baseline renewal prevents a permanent deadlock without becoming an unlimited high-rate source.
- Storage is category-compatible and volume bounded: `used + reserved <= capacity`. If a destination is full, cargo stays at its real location and the task waits with a visible reason.
- Resource names, volumes, recipes and rates live in validated, versioned content data, not client constants.

## Haul task

`queued → reserved → worker_to_source → loading → moving → unloading → complete`, with explicit `waiting_path`, `blocked`, and retryable failure states. Reserve source quantity and destination capacity in one transaction. Loading atomically decreases source and increases cargo; unloading atomically decreases cargo and increases destination. Restart/replay reconstructs the actual phase and never teleports cargo back to the source.

## Crafting and royal orders

Recipes declare item/fuel inputs, outputs, work time, specialist, building/level, technology and buffers. Missing input, fuel, specialist, route or output space pauses production with a reason. Royal orders reserve existing eligible stock and consume/reward exactly once by `requestId`; no player market, trade-post or payment path is implemented in Stage I.

GDD chain examples to cover in the complete content graph are grain→flour→bread, timber→boards, clay→formed/bricks, iron ore→ingot→blade/tool, multi-input armor, and herbs→reagents→medicine. These are recipe-path coverage targets; exact quantities, durations and prices remain proposed until provenance/acceptance is recorded.
