import type { TerrainType, Transport } from '@avanpost/shared';
import type {
  GraphCell,
  GraphEdge,
  GraphModifier,
  TerrainRule,
  WorldGraph
} from './types';

export function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

function canUse(rule: TerrainRule, transport: Transport): boolean {
  return transport === 'person' ? rule.passable : rule.passable && rule.cartPassable;
}

function cartEdgeOpen(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  passable: Set<string>
): boolean {
  const sides: ReadonlyArray<readonly [number, number]> =
    fromX === toX
      ? [
          [1, 0],
          [-1, 0]
        ]
      : [
          [0, 1],
          [0, -1]
        ];
  return sides.some(
    ([dx, dy]) =>
      passable.has(cellKey(fromX + dx, fromY + dy)) &&
      passable.has(cellKey(toX + dx, toY + dy))
  );
}

export function buildGraph(
  cells: GraphCell[],
  terrains: Record<TerrainType, TerrainRule>,
  transport: Transport,
  modifiers: GraphModifier[] = []
): WorldGraph {
  const passable = new Set<string>();
  const types = new Map<string, TerrainType>();
  for (const cell of cells) {
    const rule = terrains[cell.type];
    if (!rule || !canUse(rule, transport)) continue;
    const key = cellKey(cell.x, cell.y);
    passable.add(key);
    types.set(key, cell.type);
  }

  const costByKey = new Map<string, number>();
  for (const modifier of modifiers) {
    const key = cellKey(modifier.x, modifier.y);
    if (!types.has(key)) continue;
    const usable =
      transport === 'person'
        ? modifier.passable
        : modifier.passable && (modifier.cartPassable ?? true);
    if (!usable) {
      passable.delete(key);
      continue;
    }
    if (modifier.moveCost !== undefined) costByKey.set(key, modifier.moveCost);
  }

  const graph: WorldGraph = new Map();
  for (const cell of cells) {
    const key = cellKey(cell.x, cell.y);
    if (!passable.has(key)) continue;

    const edges: GraphEdge[] = [];
    for (const [dx, dy] of DIRECTIONS) {
      const nextX = cell.x + dx;
      const nextY = cell.y + dy;
      const nextKey = cellKey(nextX, nextY);
      if (!passable.has(nextKey)) continue;
      if (transport === 'cart' && !cartEdgeOpen(cell.x, cell.y, nextX, nextY, passable)) {
        continue;
      }
      const nextType = types.get(nextKey);
      if (!nextType) continue;
      edges.push({
        key: nextKey,
        x: nextX,
        y: nextY,
        cost: Math.max(
          0.1,
          costByKey.get(nextKey) ?? terrains[nextType]?.moveCost ?? 1
        )
      });
    }
    graph.set(key, edges);
  }

  return graph;
}

export function reachableFrom(graph: WorldGraph, startKey: string): Set<string> {
  const seen = new Set<string>();
  if (!graph.has(startKey)) return seen;

  seen.add(startKey);
  const queue = [startKey];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of graph.get(current) ?? []) {
      if (seen.has(edge.key)) continue;
      seen.add(edge.key);
      queue.push(edge.key);
    }
  }
  return seen;
}

interface QueueEntry {
  key: string;
  cost: number;
}

class MinHeap {
  private items: QueueEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: QueueEntry): void {
    this.items.push(entry);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentEntry = this.items[parent] as QueueEntry;
      if (parentEntry.cost <= entry.cost) break;
      this.items[index] = parentEntry;
      index = parent;
    }
    this.items[index] = entry;
  }

  pop(): QueueEntry | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last || this.items.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      let child = left;
      if (
        right < this.items.length &&
        (this.items[right] as QueueEntry).cost < (this.items[left] as QueueEntry).cost
      ) {
        child = right;
      }
      const childEntry = this.items[child] as QueueEntry;
      if (childEntry.cost >= last.cost) break;
      this.items[index] = childEntry;
      index = child;
    }
    this.items[index] = last;
    return first;
  }
}

export function findPath(
  graph: WorldGraph,
  startKey: string,
  goalKey: string
): string[] | null {
  if (!graph.has(startKey) || !graph.has(goalKey)) return null;
  if (startKey === goalKey) return [startKey];

  const distances = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, string>();
  const heap = new MinHeap();
  heap.push({ key: startKey, cost: 0 });

  while (heap.size > 0) {
    const current = heap.pop();
    if (!current) break;
    if (current.key === goalKey) break;
    const known = distances.get(current.key);
    if (known !== undefined && current.cost > known) continue;

    for (const edge of graph.get(current.key) ?? []) {
      const nextCost = current.cost + edge.cost;
      const existing = distances.get(edge.key);
      if (existing !== undefined && existing <= nextCost) continue;
      distances.set(edge.key, nextCost);
      previous.set(edge.key, current.key);
      heap.push({ key: edge.key, cost: nextCost });
    }
  }

  if (!distances.has(goalKey)) return null;
  const path: string[] = [goalKey];
  let cursor = goalKey;
  while (cursor !== startKey) {
    const parent = previous.get(cursor);
    if (!parent) return null;
    path.push(parent);
    cursor = parent;
  }
  return path.reverse();
}
