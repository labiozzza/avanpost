export interface ExtractionNode {
  amount: number;
  maxAmount: number;
  renewable: boolean;
  regenPerTick: number;
  yieldPerTick: number;
  buffer: number;
  bufferCapacity: number;
}

export interface ExtractionResult {
  amount: number;
  buffer: number;
  gained: number;
  depleted: boolean;
}

export function advanceExtraction(
  node: ExtractionNode,
  ticks: number
): ExtractionResult {
  if (!Number.isInteger(ticks) || ticks < 1) {
    throw new Error('ticks must be a positive integer');
  }

  let amount = node.amount;
  let buffer = node.buffer;
  let gained = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    if (node.renewable) {
      amount = Math.min(node.maxAmount, amount + Math.max(0, node.regenPerTick));
    }
    const space = Math.max(0, node.bufferCapacity - buffer);
    const take = Math.min(Math.max(0, node.yieldPerTick), Math.max(0, amount), space);
    if (take <= 0) break;
    amount -= take;
    buffer += take;
    gained += take;
  }

  return {
    amount,
    buffer,
    gained,
    depleted: amount <= 0
  };
}

export function stepPath(
  path: Array<[number, number]>,
  index: number,
  steps: number
): { index: number; x: number; y: number } {
  if (path.length === 0) throw new Error('path must not be empty');
  let cursor = Math.max(0, Math.min(index, path.length - 1));
  for (let step = 0; step < steps && cursor < path.length - 1; step += 1) {
    cursor += 1;
  }
  const [x, y] = path[cursor] as [number, number];
  return { index: cursor, x, y };
}
