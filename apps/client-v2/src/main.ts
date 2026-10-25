import Phaser from 'phaser';
import './style.css';
import { PeaceCommandSchema, PeaceWorldSnapshotSchema, ReadOnlyWorldPreviewSchema, type PeaceCommand, type PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import { SettlementScene } from './settlement-scene.js';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`V2_UI_MISSING:${id}`);
  return element as T;
};

const status = byId<HTMLSpanElement>('health-status');
const actionStatus = byId<HTMLParagraphElement>('action-status');
const woodCount = byId<HTMLElement>('wood-count');
const workerState = byId<HTMLElement>('worker-state');
const workerSelect = byId<HTMLButtonElement>('worker-select');
const treeStatus = byId<HTMLElement>('tree-status');
const worldRevision = byId<HTMLElement>('world-revision');
const buildingCount = byId<HTMLElement>('building-count');
const pairingPanel = byId<HTMLDetailsElement>('pairing-panel');
const pairingSummary = byId<HTMLElement>('pairing-summary');
const pairingForm = byId<HTMLFormElement>('pairing-form');
const pairingInput = byId<HTMLInputElement>('pairing-input');
const pairingCode = byId<HTMLOutputElement>('pairing-code');
const revealCode = byId<HTMLButtonElement>('reveal-code');
const toggleCode = byId<HTMLButtonElement>('toggle-code');
const pairButton = byId<HTMLButtonElement>('pair-button');
const actionButtons = {
  collect: byId<HTMLButtonElement>('collect-wood'),
  deliver: byId<HTMLButtonElement>('deliver-wood'),
  build: byId<HTMLButtonElement>('build-cabin')
};

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
  scale: { mode: Phaser.Scale.RESIZE, width: 960, height: 380 },
  render: { antialias: true, roundPixels: true },
  scene: [scene]
});

let world: PeaceWorldSnapshot | undefined;
let busy = false;
let workerSelected = false;

async function responseProblem(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string') return body.detail;
  return 'Не удалось выполнить действие. Обновите страницу и попробуйте снова.';
}

async function loadPreview(): Promise<void> {
  const [healthResponse, previewResponse] = await Promise.all([
    fetch(apiUrl('/api/health'), { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'include' }),
    fetch(apiUrl('/api/world/preview'), { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'include' })
  ]);
  if (healthResponse.ok) {
    status.textContent = 'Предпросмотр мира · только чтение';
    status.parentElement?.classList.remove('is-ready');
  } else {
    status.textContent = 'Связь с миром потеряна';
    status.parentElement?.classList.remove('is-ready');
  }
  if (!previewResponse.ok) throw new Error(await responseProblem(previewResponse));
  const preview = ReadOnlyWorldPreviewSchema.parse(await previewResponse.json());
  scene.showPreview(preview);
  woodCount.textContent = String(preview.resourceTotals.find((item) => item.itemId === 'wood')?.quantity ?? 0);
  workerState.textContent = 'ждёт поручения';
  treeStatus.textContent = 'Лес: рядом';
  worldRevision.textContent = `Сохранено · ${preview.revision.worldVersion}`;
  const cabinCount = preview.buildings.filter((item) => item.buildingId === 'cabin').length;
  buildingCount.textContent = `Домиков: ${cabinCount}`;
  byId<HTMLElement>('action-heading').textContent = cabinCount > 0 ? 'Первый домик уже стоит' : 'Поселение только начинается';
}

async function loadWorld(preserveActionStatus = false): Promise<boolean> {
  const sessionResponse = await fetch(apiUrl('/api/session/status'), { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'include' });
  if (!sessionResponse.ok) throw new Error(await responseProblem(sessionResponse));
  const session = await sessionResponse.json() as { paired?: unknown };
  if (session.paired !== true) {
    world = undefined;
    workerSelected = false;
    pairingPanel.open = true;
    pairingSummary.textContent = 'Подключить этот браузер к миру';
    setActions();
    await loadPreview();
    return false;
  }
  const response = await fetch(apiUrl('/api/world'), { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'include' });
  if (response.status === 401) {
    world = undefined;
    workerSelected = false;
    pairingPanel.open = true;
    pairingSummary.textContent = 'Подключить этот браузер к миру';
    setActions();
    await loadPreview();
    return false;
  }
  if (!response.ok) throw new Error(await responseProblem(response));
  world = PeaceWorldSnapshotSchema.parse(await response.json());
  pairingPanel.open = false;
  pairingSummary.textContent = 'Мир подключён к этому браузеру';
  status.textContent = 'Мир подключён · прогресс сохранён';
  status.parentElement?.classList.add('is-ready');
  scene.showWorld(world);
  woodCount.textContent = String(world.resources.wood);
  workerState.textContent = world.worker.cargo > 0 ? 'несёт древесину' : world.worker.visualState === 'work' ? 'строит дом' : 'ждёт поручения';
  treeStatus.textContent = `Дерево: ${world.tree.remaining} осталось`;
  worldRevision.textContent = `Мир сохранён · ${world.revision.worldVersion}`;
  buildingCount.textContent = `Домиков: ${world.buildings.length}`;
  byId<HTMLElement>('action-heading').textContent = world.buildings.length > 0
    ? 'Первый домик уже стоит'
    : 'Поселение только начинается';
  if (!preserveActionStatus) {
    actionStatus.textContent = world.buildings.length > 0
      ? 'Сохранённый мир восстановлен. Прогресс пережил перезагрузку страницы.'
      : 'Мир подключён. Дайте рабочему поручение, чтобы начать развитие.';
  }
  setActions();
  return true;
}

function setActions(): void {
  const canIssueOrders = Boolean(world && workerSelected);
  workerSelect.disabled = !world || busy;
  workerSelect.setAttribute('aria-pressed', String(workerSelected));
  workerSelect.textContent = world
    ? workerSelected ? 'Илья · выбран' : 'Илья · выбрать рабочего'
    : 'Илья · только чтение';
  scene.setWorkerSelected(workerSelected);
  actionButtons.collect.disabled = busy || !canIssueOrders || world!.worker.cargo > 0 || world!.tree.remaining < 1;
  actionButtons.deliver.disabled = busy || !canIssueOrders || world!.worker.cargo < 1;
  actionButtons.build.disabled = busy || !canIssueOrders || world!.worker.cargo > 0 || world!.resources.wood < 3;
}

async function runCommand(kind: PeaceCommand['kind']): Promise<void> {
  if (!world || !workerSelected || busy) return;
  busy = true;
  setActions();
  actionStatus.textContent = 'Сохраняем поручение…';
  try {
    const command = PeaceCommandSchema.parse({
      requestId: createRequestId(),
      expectedWorldVersion: world.revision.worldVersion,
      expectedGeometryVersion: world.revision.geometryVersion,
      kind
    });
    const response = await fetch(apiUrl('/api/commands'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify(command)
    });
    if (!response.ok) {
      actionStatus.textContent = await responseProblem(response);
      if (response.status === 409) await loadWorld();
      return;
    }
    world = PeaceWorldSnapshotSchema.parse(await response.json());
    scene.showWorld(world);
    const messages: Record<PeaceCommand['kind'], string> = {
      'collect-wood': 'Илья срубил бревно и несёт его со стороны леса.',
      'deliver-wood': 'Бревно доставлено. Запас поселения сохранён.',
      'build-cabin': 'Домик построен. Прогресс сохранён в мире.'
    };
    actionStatus.textContent = messages[kind];
    await loadWorld(true);
  } catch (error) {
    actionStatus.textContent = error instanceof Error ? error.message : 'Нет связи с игровым миром.';
  } finally {
    busy = false;
    setActions();
  }
}

actionButtons.collect.addEventListener('click', () => void runCommand('collect-wood'));
actionButtons.deliver.addEventListener('click', () => void runCommand('deliver-wood'));
actionButtons.build.addEventListener('click', () => void runCommand('build-cabin'));
workerSelect.addEventListener('click', () => {
  if (!world || busy) return;
  workerSelected = !workerSelected;
  setActions();
  actionStatus.textContent = workerSelected ? 'Илья выбран. Теперь назначьте ему поручение.' : 'Выбор рабочего снят.';
});

revealCode.addEventListener('click', async () => {
  revealCode.disabled = true;
  pairingCode.hidden = true;
  try {
    const response = await fetch(`${handoffOrigin}/api/launcher/pairing-code`, { headers: { accept: 'application/json' }, cache: 'no-store', mode: 'cors' });
    if (!response.ok) throw new Error(await responseProblem(response));
    const body = await response.json() as { code?: unknown };
    if (typeof body.code !== 'string') throw new Error('Локальный код сейчас недоступен.');
    pairingCode.textContent = body.code;
    pairingCode.hidden = false;
    actionStatus.textContent = 'Одноразовый код показан только в этом локальном браузере.';
  } catch (error) {
    actionStatus.textContent = error instanceof Error ? error.message : 'Не удалось показать код.';
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
    pairingInput.value = '';
    pairingCode.textContent = '';
    pairingCode.hidden = true;
    pairingPanel.open = false;
    pairingSummary.textContent = 'Мир подключён к этому браузеру';
    actionStatus.textContent = 'Подключено. Выберите Илью, чтобы назначить поручение.';
    await loadWorld(true);
  } catch (error) {
    actionStatus.textContent = error instanceof Error ? error.message : 'Не удалось подключиться к миру.';
  } finally {
    pairButton.disabled = false;
  }
});

void loadWorld().catch(async (error: unknown) => {
  actionStatus.textContent = error instanceof Error ? error.message : 'Мир пока недоступен.';
  await loadPreview().catch(() => {
    status.textContent = 'Мир пока недоступен';
  });
});
