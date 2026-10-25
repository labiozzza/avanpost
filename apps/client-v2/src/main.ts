import Phaser from 'phaser';
import './style.css';
import {
  PeaceCommandSchema,
  PeaceWorldSnapshotSchema,
  ReadOnlyWorldPreviewSchema,
  type PeaceCommand,
  type PeaceWorldSnapshot,
  type ReadOnlyWorldPreview
} from '@avanpost/peace-v2-shared';
import { SettlementScene, type PlacementAnchor, type SettlementSelection } from './settlement-scene.js';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`V2_UI_MISSING:${id}`);
  return element as T;
};

const status = byId<HTMLSpanElement>('health-status');
const actionStatus = byId<HTMLParagraphElement>('action-status');
const woodCount = byId<HTMLElement>('wood-count');
const residentCount = byId<HTMLElement>('resident-count');
const workerState = byId<HTMLElement>('worker-state');
const workerSelect = byId<HTMLButtonElement>('worker-select');
const treeStatus = byId<HTMLElement>('tree-status');
const worldRevision = byId<HTMLElement>('world-revision');
const buildingCount = byId<HTMLElement>('building-count');
const inspectorTitle = byId<HTMLHeadingElement>('inspector-title');
const inspectorDetail = byId<HTMLParagraphElement>('inspector-detail');
const forestSources = byId<HTMLDivElement>('forest-sources');
const pairingPanel = byId<HTMLDetailsElement>('pairing-panel');
const pairingSummary = byId<HTMLElement>('pairing-summary');
const pairingForm = byId<HTMLFormElement>('pairing-form');
const pairingInput = byId<HTMLInputElement>('pairing-input');
const pairingCode = byId<HTMLOutputElement>('pairing-code');
const revealCode = byId<HTMLButtonElement>('reveal-code');
const toggleCode = byId<HTMLButtonElement>('toggle-code');
const pairButton = byId<HTMLButtonElement>('pair-button');
const collectButton = byId<HTMLButtonElement>('collect-wood');
const buildModeButton = byId<HTMLButtonElement>('build-mode');
const buildingCatalog = byId<HTMLDivElement>('building-catalog');
const cabinCatalogItem = byId<HTMLButtonElement>('cabin-catalog-item');
const closeCatalog = byId<HTMLButtonElement>('close-catalog');
const placementPanel = byId<HTMLDivElement>('placement-panel');
const placementReason = byId<HTMLParagraphElement>('placement-reason');
const confirmPlacement = byId<HTMLButtonElement>('confirm-placement');
const cancelPlacement = byId<HTMLButtonElement>('cancel-placement');
const zoomOut = byId<HTMLButtonElement>('zoom-out');
const zoomIn = byId<HTMLButtonElement>('zoom-in');
const cameraHome = byId<HTMLButtonElement>('camera-home');
const cameraScale = byId<HTMLElement>('camera-scale');

const apiHost = import.meta.env.VITE_AVANPOST_V2_API_HOST ?? window.location.hostname;
const apiOrigin = apiHost === 'same-origin'
  ? ''
  : `${window.location.protocol}//${apiHost}:${import.meta.env.VITE_AVANPOST_V2_PORT ?? '8788'}`;
const handoffOrigin = `http://127.0.0.1:${import.meta.env.VITE_AVANPOST_V2_HANDOFF_PORT ?? '8789'}`;
const apiUrl = (pathname: string) => `${apiOrigin}${pathname}`;

function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const scene = new SettlementScene();
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'world-scene',
  backgroundColor: '#b7c99c',
  scale: { mode: Phaser.Scale.RESIZE, width: 1040, height: 540 },
  input: { activePointers: 2 },
  render: { antialias: true, roundPixels: true },
  scene: [scene]
});

let world: PeaceWorldSnapshot | undefined;
let preview: ReadOnlyWorldPreview | undefined;
let selectedWorker = false;
let selectedEntity: SettlementSelection = null;
let selectedTreeId: string | undefined;
let forestSourcesSignature = '';
let busy = false;
let placementMode = false;
let placementAnchor: PlacementAnchor = { x: 0, y: -1 };
let placementRequest = 0;
let placementTimer: ReturnType<typeof setTimeout> | undefined;
let syncInFlight = false;
let serverUnavailable = false;
let hasLoadedPairedWorld = false;
let sessionPaired: boolean | undefined;
let sessionStatusCheckedAt = 0;

scene.setCallbacks({
  onSelect: (selection) => {
    selectedEntity = selection;
    if (selection?.kind === 'worker') selectedWorker = true;
    else if (selection?.kind === 'building' || selection === null) selectedWorker = false;
    if (selection?.kind === 'tree') selectedTreeId = selection.id;
    renderForestSources();
    renderInspector();
    setActions();
  },
  onPlacementAnchor: (anchor) => {
    placementAnchor = anchor;
    void validatePlacement(anchor);
  },
  onCameraChange: ({ zoom }) => {
    cameraScale.textContent = `${Math.round(zoom * 100)}%`;
  }
});

async function responseProblem(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string') return body.detail;
  return 'Не удалось выполнить действие. Проверьте соединение и повторите попытку.';
}

function workerStatus(current: PeaceWorldSnapshot['worker'] | ReadOnlyWorldPreview['actors'][number]): string {
  const cargo = 'cargo' in current ? current.cargo ?? 0 : world?.worker.cargo ?? 0;
  switch (current.visualState) {
    case 'walking_to_source': return 'Идёт к дереву';
    case 'gathering': return 'Рубит дерево';
    case 'loading': return 'Поднимает бревно';
    case 'carrying_to_storage': return `Несёт ${Math.max(1, cargo)} бревно · идёт на склад`;
    case 'unloading': return 'Разгружает';
    case 'walking_to_build': return 'Идёт к стройке';
    case 'building': {
      const task = world?.worker.task;
      const building = task?.kind === 'build-cabin' ? world?.buildings.find((item) => item.id === task.buildingId) : undefined;
      return building ? `Строит дом · ${Math.floor(building.progressTicks / building.progressRequired * 100)}%` : 'Строит дом';
    }
    case 'waiting_path': return 'Нет доступного маршрута';
    case 'blocked': return 'Работа остановлена';
    default: return 'Ждёт поручения';
  }
}

function renderPreview(next: ReadOnlyWorldPreview): void {
  preview = next;
  scene.showPreview(next);
  woodCount.textContent = String(next.resourceTotals.find((item) => item.itemId === 'wood')?.quantity ?? 0);
  residentCount.textContent = '1';
  workerState.textContent = workerStatus(next.actors[0] ?? { visualKey: 'worker', position: { x: -3, y: 0 }, visualState: 'idle' });
  const forestAvailable = next.resourceNodes.filter((node) => node.state === 'standing').length;
  treeStatus.textContent = `Лес: ${forestAvailable} участков доступно`;
  worldRevision.textContent = `Серверный тик · ${next.revision.serverTick}`;
  const cabins = next.buildings.filter((building) => building.buildingId === 'cabin').length;
  buildingCount.textContent = `Домов: ${cabins}`;
  status.textContent = 'Только чтение';
  status.parentElement?.classList.remove('is-ready');
}

function renderWorld(next: PeaceWorldSnapshot, preserveActionStatus = true): void {
  world = next;
  if (!next.trees.some((tree) => tree.id === selectedTreeId)) selectedTreeId = next.trees[0]?.id;
  preview = undefined;
  scene.showWorld(next);
  woodCount.textContent = String(next.resources.wood);
  residentCount.textContent = '1';
  workerState.textContent = workerStatus(next.worker);
  const forestAvailable = next.trees.filter((tree) => tree.state === 'standing' && tree.remaining > 0).length;
  const forestRemaining = next.trees.reduce((sum, tree) => sum + tree.remaining, 0);
  treeStatus.textContent = `Лес: ${forestAvailable} участка · ${forestRemaining} брёвен`;
  renderForestSources();
  worldRevision.textContent = `Серверный тик · ${next.revision.serverTick}`;
  buildingCount.textContent = `Домов: ${next.buildings.length}`;
  status.textContent = 'Мир сохранён';
  status.parentElement?.classList.add('is-ready');
  if (!hasLoadedPairedWorld) pairingPanel.open = false;
  hasLoadedPairedWorld = true;
  pairingSummary.textContent = 'Мир подключён к этому браузеру';
  if (!preserveActionStatus && !next.worker.task) {
    actionStatus.textContent = 'Мир восстановлен. Все поручения продолжаются по серверным тикам.';
  }
  renderInspector();
  setActions();
}

function renderForestSources(): void {
  if (!world) {
    if (forestSourcesSignature !== 'unavailable') {
      forestSources.replaceChildren();
      forestSourcesSignature = 'unavailable';
    }
    return;
  }
  const signature = JSON.stringify({ selectedTreeId, trees: world.trees.map(({ id, name, remaining, maxRemaining, state }) =>
    [id, name, remaining, maxRemaining, state]) });
  if (signature === forestSourcesSignature) return;
  forestSourcesSignature = signature;
  forestSources.replaceChildren();
  for (const tree of world.trees) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'forest-source';
    button.setAttribute('aria-label', `Выбрать ${tree.name}`);
    button.setAttribute('aria-pressed', String(tree.id === selectedTreeId));
    button.textContent = `${tree.name} · ${tree.remaining}/${tree.maxRemaining}${tree.state === 'stump' ? ' · пень' : ''}`;
    button.addEventListener('click', () => {
      selectedTreeId = tree.id;
      scene.selectTree(tree.id);
      renderForestSources();
      renderInspector();
      setActions();
    });
    forestSources.append(button);
  }
}

function renderInspector(): void {
  if (selectedEntity?.kind === 'worker' && world) {
    inspectorTitle.textContent = world.worker.name;
    inspectorDetail.textContent = world.worker.task?.blockedReason
      ? `${workerStatus(world.worker)} · причина: ${world.worker.task.blockedReason}`
      : `${workerStatus(world.worker)}${world.worker.cargo > 0 ? ` · груз: ${world.worker.cargo} бревно` : ''}`;
    workerSelect.textContent = 'Снять выбор';
    workerSelect.setAttribute('aria-pressed', 'true');
    byId<HTMLElement>('inspector').classList.add('is-open');
    return;
  }
  if (selectedEntity?.kind === 'building' && world) {
    const selectedBuildingId = selectedEntity.id;
    const building = world.buildings.find((item) => item.id === selectedBuildingId);
    inspectorTitle.textContent = 'Дом';
    inspectorDetail.textContent = building
      ? building.state === 'complete'
        ? 'Дом завершён и сохранён в поселении.'
        : `${building.state === 'planned' ? 'Материалы зарезервированы' : building.state === 'foundation' ? 'Заливается фундамент' : 'Возводится каркас'} · ${building.progressTicks}/${building.progressRequired}`
      : 'Здание больше не отображается в мире.';
    workerSelect.textContent = 'Выбрать Илью';
    workerSelect.setAttribute('aria-pressed', 'false');
    byId<HTMLElement>('inspector').classList.add('is-open');
    return;
  }
  if (selectedEntity?.kind === 'tree' && world) {
    const treeId = selectedEntity.id;
    const tree = world.trees.find((item) => item.id === treeId);
    inspectorTitle.textContent = tree?.name ?? 'Лесной участок';
    inspectorDetail.textContent = tree
      ? tree.state === 'standing'
        ? `${tree.remaining} из ${tree.maxRemaining} брёвен · ${tree.sourceKind === 'renewable_plot' ? 'поросль восстанавливается после вырубки' : 'конечный запас'}`
        : tree.sourceKind === 'renewable_plot'
          ? `Пень · поросль восстановится через ${Math.max(0, tree.regrowthEveryTicks! - tree.regrowthProgressTicks)} серверных тиков.`
          : 'Пень · этот участок исчерпан. Выберите другой лесной участок.'
      : 'Лесной участок больше не отображается в мире.';
    workerSelect.textContent = selectedWorker ? 'Снять выбор' : 'Выбрать Илью';
    workerSelect.setAttribute('aria-pressed', String(selectedWorker));
    byId<HTMLElement>('inspector').classList.add('is-open');
    return;
  }
  inspectorTitle.textContent = world ? 'Выберите объект' : 'Выберите жителя';
  inspectorDetail.textContent = world
    ? 'Нажмите на Илью или дом в игровом мире, чтобы открыть инспектор.'
    : 'Подключите этот браузер одноразовым кодом.';
  workerSelect.textContent = 'Выбрать Илью';
  workerSelect.setAttribute('aria-pressed', 'false');
  byId<HTMLElement>('inspector').classList.remove('is-open');
}

function setActions(): void {
  const hasWorld = Boolean(world) && !serverUnavailable;
  const workerReady = Boolean(world && selectedWorker && !world.worker.task && world.worker.cargo === 0);
  const selectedTree = world?.trees.find((tree) => tree.id === selectedTreeId);
  collectButton.disabled = busy || placementMode || !workerReady || !selectedTree || selectedTree.remaining < 1 || selectedTree.state !== 'standing';
  buildModeButton.disabled = busy || !hasWorld || !selectedWorker;
  workerSelect.disabled = !world || busy;
  if (!placementMode) return;
  confirmPlacement.disabled = busy || !world || !selectedWorker || !placementMode || placementReason.dataset.valid !== 'true';
}

function formatPlacementReason(code: string, detail: string): string {
  const labels: Record<string, string> = {
    READY: 'Место подходит. Рабочий пойдёт строить после подтверждения.',
    WORKER_BUSY: 'Сначала дождитесь завершения текущей работы.',
    CARGO_NOT_EMPTY: 'Сначала дождитесь, пока рабочий разгрузит бревно.',
    RESOURCE_MISSING: 'На складе пока недостаточно древесины.',
    OUT_OF_WORLD: 'За пределами доступного участка.',
    INVALID_SURFACE: 'Выберите клетку на поверхности.',
    OCCUPIED: 'Участок занят деревом, складом или другой постройкой.',
    NO_PATH: 'Нет доступного маршрута к строительной точке.'
  };
  return labels[code] ?? detail;
}

async function validatePlacement(anchor: PlacementAnchor): Promise<void> {
  placementAnchor = anchor;
  const request = ++placementRequest;
  if (placementTimer) clearTimeout(placementTimer);
  placementTimer = setTimeout(async () => {
    try {
      const response = await fetch(apiUrl('/api/placement/validate'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ anchor })
      });
      if (request !== placementRequest) return;
      if (!response.ok) throw new Error(await responseProblem(response));
      const result = await response.json() as { valid: boolean; reason: string; detail: string };
      placementReason.textContent = formatPlacementReason(result.reason, result.detail);
      placementReason.dataset.valid = String(result.valid);
      placementReason.classList.toggle('is-valid', result.valid);
      confirmPlacement.disabled = !result.valid || busy;
      scene.setPlacementFeedback({ valid: result.valid, reason: result.reason });
    } catch (error) {
      if (request !== placementRequest) return;
      placementReason.textContent = error instanceof Error ? error.message : 'Не удалось проверить участок.';
      placementReason.dataset.valid = 'false';
      confirmPlacement.disabled = true;
      scene.setPlacementFeedback({ valid: false, reason: 'UNAVAILABLE' });
    }
  }, 90);
}

async function syncWorld(preserveActionStatus = true): Promise<void> {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    if (sessionPaired === undefined || !sessionPaired && Date.now() - sessionStatusCheckedAt >= 1_500) {
      const sessionResponse = await fetch(apiUrl('/api/session/status'), {
        headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'include'
      });
      if (!sessionResponse.ok) throw new Error(await responseProblem(sessionResponse));
      sessionPaired = (await sessionResponse.json() as { paired?: unknown }).paired === true;
      sessionStatusCheckedAt = Date.now();
    }
    if (sessionPaired !== true) {
      serverUnavailable = false;
      world = undefined;
      selectedWorker = false;
      selectedEntity = null;
      scene.setWorkerSelected(false);
      pairingPanel.open = true;
      pairingSummary.textContent = 'Подключить этот браузер к миру';
      setActions();
      const previewResponse = await fetch(apiUrl('/api/world/preview'), { cache: 'no-store', credentials: 'include' });
      if (!previewResponse.ok) throw new Error(await responseProblem(previewResponse));
      renderPreview(ReadOnlyWorldPreviewSchema.parse(await previewResponse.json()));
      return;
    }
    const response = await fetch(apiUrl('/api/world'), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'include'
    });
    if (response.status === 401) {
      serverUnavailable = false;
      sessionPaired = false;
      sessionStatusCheckedAt = Date.now();
      world = undefined;
      selectedWorker = false;
      selectedEntity = null;
      scene.setWorkerSelected(false);
      pairingPanel.open = true;
      pairingSummary.textContent = 'Подключить этот браузер к миру';
      setActions();
      const previewResponse = await fetch(apiUrl('/api/world/preview'), { cache: 'no-store', credentials: 'include' });
      if (!previewResponse.ok) throw new Error(await responseProblem(previewResponse));
      renderPreview(ReadOnlyWorldPreviewSchema.parse(await previewResponse.json()));
      return;
    }
    if (!response.ok) throw new Error(await responseProblem(response));
    serverUnavailable = false;
    renderWorld(PeaceWorldSnapshotSchema.parse(await response.json()), preserveActionStatus);
  } catch (error) {
    serverUnavailable = true;
    status.textContent = 'Сервер недоступен · мир не изменяется';
    status.parentElement?.classList.remove('is-ready');
    if (error instanceof Error) actionStatus.textContent = error.message;
    setActions();
  } finally {
    syncInFlight = false;
  }
}

async function runCommand(kind: PeaceCommand['kind'], anchor?: PlacementAnchor): Promise<void> {
  if (!world || !selectedWorker || busy || serverUnavailable) return;
  busy = true;
  setActions();
  actionStatus.textContent = kind === 'collect-wood' ? 'Назначаем добычу. Илья пойдёт к дереву…' : 'Проверяем выбранный участок…';
  try {
    const command = PeaceCommandSchema.parse({
      requestId: createRequestId(),
      expectedWorldVersion: world.revision.worldVersion,
      expectedGeometryVersion: world.revision.geometryVersion,
      kind,
      ...(kind === 'collect-wood' && selectedTreeId ? { sourceId: selectedTreeId } : {}),
      ...(kind === 'build-cabin' ? { anchor } : {})
    });
    const response = await fetch(apiUrl('/api/commands'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify(command)
    });
    if (!response.ok) {
      actionStatus.textContent = await responseProblem(response);
      if (response.status === 409) await syncWorld();
      if (response.status === 503) serverUnavailable = true;
      return;
    }
    const next = PeaceWorldSnapshotSchema.parse(await response.json());
    renderWorld(next);
    if (kind === 'collect-wood') {
      actionStatus.textContent = 'Поручение принято. Добыча, перевозка и разгрузка выполняются по серверным тикам.';
    } else {
      placementMode = false;
      placementPanel.hidden = true;
      scene.setPlacementMode(false);
      actionStatus.textContent = 'План дома сохранён. Илья пойдёт к выбранному месту и начнёт строительство.';
    }
  } catch (error) {
    actionStatus.textContent = error instanceof Error ? error.message : 'Нет связи с игровым миром.';
  } finally {
    busy = false;
    setActions();
  }
}

collectButton.addEventListener('click', () => void runCommand('collect-wood'));
buildModeButton.addEventListener('click', () => {
  if (!world || !selectedWorker || busy) return;
  buildingCatalog.hidden = false;
  placementPanel.hidden = true;
  actionStatus.textContent = 'Выберите здание в каталоге. Его можно будет разместить только на серверно разрешённом участке.';
});

closeCatalog.addEventListener('click', () => {
  buildingCatalog.hidden = true;
});

cabinCatalogItem.addEventListener('click', () => {
  buildingCatalog.hidden = true;
  placementMode = true;
  placementPanel.hidden = false;
  placementReason.textContent = 'Проверяем участок…';
  placementReason.dataset.valid = 'false';
  confirmPlacement.disabled = true;
  scene.setPlacementMode(true);
  void validatePlacement(placementAnchor);
  actionStatus.textContent = 'Перетащите полупрозрачный дом на свободное место. Подтверждение не перемещает его автоматически.';
  setActions();
});

cancelPlacement.addEventListener('click', () => {
  placementMode = false;
  placementPanel.hidden = true;
  placementReason.dataset.valid = 'false';
  scene.setPlacementMode(false);
  actionStatus.textContent = 'Размещение отменено. Мир не изменён.';
  setActions();
});

confirmPlacement.addEventListener('click', () => void runCommand('build-cabin', placementAnchor));
workerSelect.addEventListener('click', () => {
  if (!world || busy) return;
  scene.setWorkerSelected(!selectedWorker);
});

zoomIn.addEventListener('click', () => scene.zoomBy(1.2));
zoomOut.addEventListener('click', () => scene.zoomBy(1 / 1.2));
cameraHome.addEventListener('click', () => scene.centerOnSelection());

revealCode.addEventListener('click', async () => {
  revealCode.disabled = true;
  pairingCode.hidden = true;
  try {
    const response = await fetch(`${handoffOrigin}/api/launcher/pairing-code`, {
      headers: { accept: 'application/json' }, cache: 'no-store', mode: 'cors'
    });
    if (!response.ok) throw new Error(await responseProblem(response));
    const body = await response.json() as { code?: unknown };
    if (typeof body.code !== 'string') throw new Error('Локальный код сейчас недоступен.');
    pairingCode.textContent = body.code;
    pairingCode.hidden = false;
    actionStatus.textContent = 'Одноразовый код показан только в этом локальном браузере.';
  } catch (error) {
    actionStatus.textContent = error instanceof Error
      ? error.message
      : 'Покажите код на компьютере: handoff не открыт для LAN-устройств.';
  } finally {
    revealCode.disabled = false;
  }
});

toggleCode.addEventListener('click', () => {
  const reveal = pairingInput.type === 'password';
  pairingInput.type = reveal ? 'text' : 'password';
  toggleCode.textContent = reveal ? 'Скрыть' : 'Показать';
  toggleCode.setAttribute('aria-pressed', String(reveal));
});

pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = pairingInput.value;
  pairButton.disabled = true;
  actionStatus.textContent = 'Проверяем одноразовый код…';
  try {
    const response = await fetch(apiUrl('/api/session'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code })
    });
    if (!response.ok) throw new Error(await responseProblem(response));
    sessionPaired = true;
    sessionStatusCheckedAt = Date.now();
    pairingInput.value = '';
    pairingCode.textContent = '';
    pairingCode.hidden = true;
    pairingPanel.open = false;
    pairingSummary.textContent = 'Мир подключён к этому браузеру';
    actionStatus.textContent = 'Подключено. Нажмите на жителя в мире, чтобы выбрать его.';
    await syncWorld();
  } catch (error) {
    actionStatus.textContent = error instanceof Error ? error.message : 'Не удалось подключиться к миру.';
  } finally {
    pairButton.disabled = false;
  }
});

void syncWorld(false);
window.setInterval(() => void syncWorld(), 250);
