import Phaser from 'phaser';
import type { Transport, WorldSnapshot } from '@avanpost/shared';
import { WorldScene } from './game/scene';
import {
  ApiError,
  advanceWorld,
  buildBuilding,
  clearCell,
  createSession,
  demolishBuilding,
  fetchState,
  gatherNode,
  heartbeat,
  stopGather,
  unlockSector
} from './net/api';
import { loadSnapshot, saveSnapshot } from './state/cache';
import { createOverlay, type OverlayState } from './ui/overlay';
import './styles.css';

const state: OverlayState = {
  snapshot: null,
  online: false,
  busy: false,
  error: null,
  cachedAt: null,
  transport: 'person',
  buildType: null,
  running: new URLSearchParams(location.search).get('autoplay') !== '0'
};

let game: Phaser.Game | null = null;
let scene: WorldScene | null = null;

const overlay = createOverlay({
  onAdvance: (ticks) => void advance(ticks),
  onToggleRun: () => setRunning(!state.running),
  onDemo: () => void runDemo(),
  onRecenter: () => scene?.recenter(),
  onClearCell: (sectorId, x, y) => void clear(sectorId, x, y),
  onGather: (nodeId) => void gather(nodeId),
  onStopGather: (nodeId) => void stop(nodeId),
  onUnlockSector: (x, y) => void unlock(x, y),
  onTransport: (transport) => setTransport(transport),
  onSelectBuilding: (type) => setBuildType(type),
  onCancelBuild: () => setBuildType(null),
  onDemolish: (buildingId) => void demolish(buildingId),
  onRetry: () => void init()
});

function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return 'неизвестная ошибка';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU');
}

function mount(snapshot: WorldSnapshot): void {
  state.snapshot = snapshot;
  if (!game) {
    scene = new WorldScene(snapshot, {
      onCellClick: (sectorId, x, y) => void clear(sectorId, x, y),
      onBuildClick: (sectorId, x, y) => void build(sectorId, x, y),
      onFrontierClick: (x, y) => void unlock(x, y),
      onNodeClick: (nodeId) => {
        const node = state.snapshot?.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        if (node.active) void stop(nodeId);
        else void gather(nodeId);
      }
    });
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#0b1118',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [scene]
    });
  } else {
    scene?.updateSnapshot(snapshot);
  }
  scene?.setTransport(state.transport);
  scene?.setBuildType(state.buildType);
  overlay.update(state);
}

async function handleStale(): Promise<void> {
  state.error = 'Состояние устарело, обновляю снимок';
  try {
    const fresh = await fetchState();
    if (fresh) {
      saveSnapshot(fresh);
      mount(fresh);
    }
  } catch {
    // keep the stale-state message
  }
}

async function execute(
  action: () => Promise<{ snapshot: WorldSnapshot; replayed: boolean }>
): Promise<void> {
  if (!state.snapshot || state.busy || !state.online) return;
  state.busy = true;
  state.error = null;
  overlay.update(state);

  try {
    const result = await action();
    saveSnapshot(result.snapshot);
    mount(result.snapshot);
    if (result.replayed) state.error = 'Команда уже была применена';
  } catch (error) {
    if (error instanceof ApiError && error.code === 'STALE_VERSION') {
      await handleStale();
    } else {
      state.error = describeError(error);
    }
  } finally {
    state.busy = false;
    overlay.update(state);
  }
}

let autoTimer: ReturnType<typeof setInterval> | null = null;

function setRunning(running: boolean): void {
  state.running = running;
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  if (running) {
    autoTimer = setInterval(() => {
      if (
        state.running &&
        state.online &&
        !state.busy &&
        state.snapshot &&
        document.visibilityState === 'visible'
      ) {
        void advance(1);
      }
    }, 1200);
  }
  overlay.update(state);
}

async function submitBuild(
  type: string,
  sectorId: string,
  x: number,
  y: number
): Promise<boolean> {
  const snapshot = state.snapshot;
  if (!snapshot) return false;
  await execute(() =>
    buildBuilding({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      building_type: type,
      sector_id: sectorId,
      x,
      y
    })
  );
  return !state.error;
}

function demoCell(type: string): { sectorId: string; x: number; y: number } | null {
  const snapshot = state.snapshot;
  const sector = snapshot?.sectors[0];
  if (!snapshot || !sector) return null;
  const occupied = new Set<string>([
    ...snapshot.buildings.map((item) => `${item.x}:${item.y}`),
    ...snapshot.nodes.map((item) => `${item.x}:${item.y}`),
    ...snapshot.storages.map((item) => `${item.x}:${item.y}`)
  ]);
  const anchorX = sector.width / 2;
  const anchorY = sector.height / 2;
  const candidates = sector.terrain
    .filter(
      (cell) =>
        cell.reachable &&
        !occupied.has(`${cell.x}:${cell.y}`) &&
        cell.x > 0 &&
        cell.y > 0 &&
        cell.x < sector.width - 1 &&
        cell.y < sector.height - 1
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - anchorX, a.y - anchorY) -
        Math.hypot(b.x - anchorX, b.y - anchorY)
    );
  const cell = candidates[type === 'road' ? Math.min(3, candidates.length - 1) : 0];
  return cell ? { sectorId: sector.id, x: cell.x, y: cell.y } : null;
}

async function runDemo(): Promise<void> {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  setRunning(true);
  const forest = snapshot.nodes.find((node) => node.kind === 'forest');
  if (forest && !forest.active) await gather(forest.id);
  if (!state.snapshot?.buildings.some((item) => item.type === 'house')) {
    const cell = demoCell('house');
    if (cell) await submitBuild('house', cell.sectorId, cell.x, cell.y);
  }
  if (!state.snapshot?.buildings.some((item) => item.type === 'road')) {
    const cell = demoCell('road');
    if (cell) await submitBuild('road', cell.sectorId, cell.x, cell.y);
  }
}

async function init(): Promise<void> {
  state.busy = true;
  state.error = null;
  overlay.update(state);

  const cached = loadSnapshot();
  try {
    let snapshot = await fetchState();
    if (!snapshot) snapshot = await createSession();
    state.online = true;
    state.cachedAt = null;
    saveSnapshot(snapshot);
    mount(snapshot);
  } catch (error) {
    state.online = false;
    if (cached) {
      state.cachedAt = cached.savedAt;
      mount(cached.snapshot);
      state.error = `Сервер недоступен, показан кеш от ${formatTime(cached.savedAt)}`;
    } else {
      state.error = describeError(error);
    }
  } finally {
    state.busy = false;
    overlay.update(state);
  }
}

async function advance(ticks: number): Promise<void> {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  await execute(() =>
    advanceWorld({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      ticks
    })
  );
}

async function clear(sectorId: string, x: number, y: number): Promise<void> {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  await execute(() =>
    clearCell({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      sector_id: sectorId,
      x,
      y
    })
  );
}

async function unlock(x: number, y: number): Promise<void> {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const frontier = snapshot.frontier.find(
    (sector) => sector.x === x && sector.y === y
  );
  if (!frontier) {
    state.error = 'Сектор не найден на фронтире';
    overlay.update(state);
    return;
  }
  await execute(() =>
    unlockSector({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      sector_x: x,
      sector_y: y
    })
  );
}


async function gather(nodeId: string): Promise<void> {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  await execute(() =>
    gatherNode({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      node_id: nodeId
    })
  );
}

async function build(sectorId: string, x: number, y: number): Promise<void> {
  const snapshot = state.snapshot;
  if (!snapshot || !state.buildType) return;
  await execute(() =>
    buildBuilding({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      building_type: state.buildType as string,
      sector_id: sectorId,
      x,
      y
    })
  );
  if (!state.error) setBuildType(null);
}

async function demolish(buildingId: string): Promise<void> {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  await execute(() =>
    demolishBuilding({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      building_id: buildingId
    })
  );
}

async function stop(nodeId: string): Promise<void> {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  await execute(() =>
    stopGather({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      node_id: nodeId
    })
  );
}

function setTransport(transport: Transport): void {
  state.transport = transport;
  scene?.setTransport(transport);
  overlay.update(state);
}

function setBuildType(type: string | null): void {
  state.buildType = type;
  scene?.setBuildType(type);
  overlay.update(state);
}

setInterval(() => {
  if (!state.online) return;
  heartbeat().catch(() => {
    state.online = false;
    overlay.update(state);
  });
}, 30_000);

void init().then(() => {
  setRunning(state.running);
  if (new URLSearchParams(location.search).get('demo') === '1') {
    setTimeout(() => void runDemo(), 900);
  }
});
