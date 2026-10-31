import Phaser from 'phaser';
import './style.css';
import {
  PeaceCommandSchema,
  PeaceWorldSnapshotSchema,
  ReadOnlyWorldPreviewSchema,
  type PeaceCommand,
  type PeaceResident,
  type PeaceWorldSnapshot,
  type ReadOnlyWorldPreview
} from '@avanpost/peace-v2-shared';
import g33StoneBalance from '../../../content/peace-v2/g3.3-stone.json';
import { SettlementScene, type PlacementAnchor, type SettlementSelection } from './settlement-scene.js';

type AssignmentTarget = Extract<PeaceCommand, { kind: 'assign-resident' }>['target'];

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`V2_UI_MISSING:${id}`);
  return element as T;
};

const status = byId<HTMLSpanElement>('health-status');
const actionStatus = byId<HTMLParagraphElement>('action-status');
const actionToast = byId<HTMLDivElement>('game-toast');
const retryCommandButton = byId<HTMLButtonElement>('retry-command');
const dragHint = byId<HTMLDivElement>('drag-hint');
const woodCount = byId<HTMLElement>('wood-count');
const stoneCount = byId<HTMLElement>('stone-count');
const residentCount = byId<HTMLElement>('resident-count');
const workerState = byId<HTMLElement>('worker-state');
const treeStatus = byId<HTMLElement>('tree-status');
const worldRevision = byId<HTMLElement>('world-revision');
const contextMenu = byId<HTMLDivElement>('world-context');
const contextKind = byId<HTMLElement>('context-kind');
const contextContent = byId<HTMLDivElement>('world-context-content');
const contextActions = byId<HTMLDivElement>('context-actions');
const contextOrderSection = byId<HTMLElement>('context-order-section');
const closeContext = byId<HTMLButtonElement>('close-context');
const inspectorTitle = byId<HTMLHeadingElement>('inspector-title');
const inspectorDetail = byId<HTMLParagraphElement>('inspector-detail');
const workRoleControl = byId<HTMLDivElement>('work-role-control');
const workRoleSelect = byId<HTMLSelectElement>('resident-work-role');
const workRoleHint = byId<HTMLElement>('work-role-hint');
const buildOrderList = byId<HTMLOListElement>('build-order-list');
const buildOrderCount = byId<HTMLElement>('build-order-count');
const pairingPanel = byId<HTMLDetailsElement>('pairing-panel');
const pairingSummary = byId<HTMLElement>('pairing-summary');
const pairingForm = byId<HTMLFormElement>('pairing-form');
const pairingInput = byId<HTMLInputElement>('pairing-input');
const pairingCode = byId<HTMLOutputElement>('pairing-code');
const revealCode = byId<HTMLButtonElement>('reveal-code');
const toggleCode = byId<HTMLButtonElement>('toggle-code');
const pairButton = byId<HTMLButtonElement>('pair-button');
const collectButton = byId<HTMLButtonElement>('collect-wood');
const cancelWoodcutButton = byId<HTMLButtonElement>('cancel-woodcutting');
const uprootStumpButton = byId<HTMLButtonElement>('uproot-stump');
const assignTargetButton = byId<HTMLButtonElement>('assign-target');
const cancelBuildButton = byId<HTMLButtonElement>('cancel-selected-build');
const demolishStructureButton = byId<HTMLButtonElement>('demolish-selected-structure');
const buildingCatalog = byId<HTMLDivElement>('building-catalog');
const cabinCatalogItem = byId<HTMLButtonElement>('cabin-catalog-item');
const workshopCatalogItem = byId<HTMLButtonElement>('workshop-catalog-item');
const cabinAvailability = byId<HTMLElement>('cabin-availability');
const workshopAvailability = byId<HTMLElement>('workshop-availability');
const placementPanel = byId<HTMLDivElement>('placement-panel');
const placementTitle = byId<HTMLElement>('placement-title');
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
let selectedResidentId: string | undefined;
let selectedEntity: SettlementSelection = null;
let selectedTreeId: string | undefined;
let selectedStoneDepositId: string | undefined;
let selectedBuildingKind: 'cabin' | 'workshop' = 'cabin';
let buildOrdersSignature = '';
let busy = false;
let placementMode = false;
let placementAnchor: PlacementAnchor = { x: 0, y: -1 };
let contextPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let contextMode: 'object' | 'catalog' | 'placement' | undefined;
let placementRequest = 0;
let placementTimer: ReturnType<typeof setTimeout> | undefined;
let syncInFlight = false;
let serverUnavailable = false;
let hasLoadedPairedWorld = false;
let hasShownUnpairedPairing = false;
let sessionPaired: boolean | undefined;
let sessionStatusCheckedAt = 0;
let retryableCommand: PeaceCommand | undefined;

scene.setCallbacks({
  onSelect: (selection, point) => {
    selectedEntity = selection;
    if (selection?.kind === 'resident') selectedResidentId = selection.id;
    if (selection?.kind === 'tree') selectedTreeId = selection.id;
    if (selection?.kind === 'stone-deposit') selectedStoneDepositId = selection.id;
    if (selection) {
      contextMode = 'object';
      contextPoint = point;
    } else {
      contextMode = undefined;
      contextMenu.hidden = true;
    }
    renderContextMenu();
  },
  onEmptyGroundClick: (anchor, point) => {
    if (!world || serverUnavailable || placementMode) return;
    selectedEntity = null;
    placementAnchor = anchor;
    contextMode = 'catalog';
    contextPoint = point;
    renderContextMenu();
  },
  onResidentDragStart: () => {
    contextMode = undefined;
    contextMenu.hidden = true;
    dragHint.hidden = true;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = undefined;
    actionToast.hidden = true;
    retryCommandButton.hidden = true;
  },
  onDropPreview: (residentId, target) => {
    const assignment = assignmentForTarget(target);
    return Boolean(assignment && canAssignResident(residentId, assignment));
  },
  onResidentDragHover: (residentId, target, valid, point) => {
    if (!target) {
      dragHint.textContent = 'Недопустимая цель. Выберите доступный подсвеченный объект.';
      dragHint.dataset.state = 'invalid';
      dragHint.hidden = false;
      positionDragHint(point);
      return;
    }
    dragHint.textContent = valid ? assignmentActionLabel(target) : dropFailureReason(residentId, assignmentForTarget(target));
    dragHint.dataset.state = valid ? 'valid' : 'invalid';
    dragHint.hidden = false;
    positionDragHint(point);
  },
  onResidentDragEnd: () => {
    dragHint.hidden = true;
  },
  onResidentDrop: (residentId, target, point) => {
    const assignment = target ? assignmentForTarget(target) : undefined;
    if (!assignment || !canAssignResident(residentId, assignment)) {
      scene.flashSelection(target, false);
      showActionStatus(dropFailureReason(residentId, assignment), 'error');
      return;
    }
    selectedResidentId = residentId;
    selectedEntity = target;
    contextMode = 'object';
    contextPoint = point;
    void runCommand('assign-resident', { residentId, target: assignment });
  },
  onPlacementAnchor: (anchor) => {
    placementAnchor = anchor;
    if (contextMode === 'placement') positionContextMenu();
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

function workRoleLabel(workRole: 'none' | 'woodcutter' | 'builder' | 'stone_miner' | 'hauler' | undefined): string {
  if (workRole === 'woodcutter') return 'Лесоруб';
  if (workRole === 'stone_miner') return 'Добытчик камня';
  if (workRole === 'builder') return 'Строитель';
  if (workRole === 'hauler') return 'Носильщик';
  return 'Без роли';
}

function logisticsPriorityLabel(priority: PeaceWorldSnapshot['logisticsTasks'][number]['kind']): string {
  switch (priority) {
    case 'active_construction': return 'стройка в работе';
    case 'ready_construction': return 'готовая стройка';
    case 'buffer_clearance': return 'освобождение буфера';
    case 'warehouse_restock': return 'поставка на склад';
    case 'rebalancing': return 'перераспределение';
  }
}

function logisticsQueueStatusLabel(status: PeaceWorldSnapshot['logisticsTasks'][number]['status']): string {
  switch (status) {
    case 'queued': return 'в очереди';
    case 'assigned': return 'назначена';
    case 'in_transit': return 'в пути';
    case 'waiting': return 'ожидает';
    case 'blocked': return 'заблокирована';
    case 'completed': return 'завершена';
    case 'cancelled': return 'отменена';
  }
}

function buildingStageLabel(state: PeaceWorldSnapshot['buildings'][number]['state']): string {
  switch (state) {
    case 'planned': return 'Подготовленная площадка';
    case 'waiting_materials': return 'Ожидает материалы';
    case 'waiting_builder': return 'Ожидает строителя';
    case 'in_progress': return 'Строитель идёт к рабочей точке';
    case 'foundation': return 'Фундамент';
    case 'scaffold': return 'Каркас';
    case 'cancelling': return 'Возврат материалов перед отменой';
    case 'complete': return 'Построено';
    case 'cancelled': return 'Отменено';
    case 'demolished': return 'Снесено';
    case 'blocked': return 'Заблокировано';
  }
}

function logisticsItemLabel(itemId: 'wood' | 'stone'): string {
  return itemId === 'wood' ? 'древесина' : 'камень';
}

function blockedReasonMessage(reason: string | null | undefined, context: 'general' | 'construction' = 'general'): string {
  if (!reason) return '';
  if (reason === 'NO_PATH_TO_STORAGE' && context === 'construction') {
    return 'Нет маршрута доставки от склада до стройплощадки. Освободите проход или выберите другое место.';
  }
  const messages: Record<string, string> = {
    NO_PATH_TO_WORKSITE: 'Нет маршрута доставки от склада до стройплощадки. Освободите проход или выберите другое место.',
    NO_PATH_TO_BUILD_SITE: 'Нет маршрута до стройплощадки. Освободите проход или выберите другое место.',
    NO_PATH_TO_STORAGE: 'Нет маршрута доставки между складом и площадкой. Освободите проход или выберите другое место.',
    NO_PATH_TO_DESTINATION: 'Нет пути до места доставки. Освободите проход.',
    NO_PATH_TO_SOURCE: 'Нет пути к источнику ресурсов. Освободите проход.',
    NO_PATH_TO_PREFERRED_STORAGE: 'Нет пути к выбранному складу; носильщику нужен другой доступный склад.',
    NO_PATH: 'Нет прохода к объекту. Освободите маршрут.',
    STORAGE_FULL: 'Склад заполнен. Освободите место для разгрузки.',
    PREFERRED_STORAGE_FULL: 'Выбранный склад заполнен. Освободите место или выберите другой склад.',
    INSUFFICIENT_WOOD: 'Недостаточно свободной древесины.',
    INSUFFICIENT_STONE: 'Недостаточно свободного камня.',
    WAITING_FOR_HAUL: 'Материалы ждут доставки носильщиком.',
    NO_BUILDER: 'Нет свободного жителя с ролью «Строитель».',
    WORK_POINT_OCCUPIED: 'Рабочая точка занята. Дождитесь её освобождения.',
    WORKER_BUSY: 'Житель занят другой работой.',
    SOURCE_RESERVED: 'Источник уже зарезервирован другим жителем.',
    STONE_SOURCE_RESERVED: 'Месторождение уже зарезервировано другим жителем.',
    NO_ITEM: 'Нужного ресурса больше нет в источнике.'
  };
  return messages[reason] ?? 'Работа остановлена из-за препятствия. Проверьте маршрут и доступность объекта.';
}

function routeBlockedReason(reason: string | null | undefined): boolean {
  return reason === 'NO_PATH_TO_WORKSITE' || reason === 'NO_PATH_TO_BUILD_SITE' ||
    reason === 'NO_PATH_TO_STORAGE' || reason === 'NO_PATH_TO_DESTINATION' || reason === 'NO_PATH_TO_SOURCE' ||
    reason === 'NO_PATH_TO_PREFERRED_STORAGE' || reason === 'NO_PATH';
}

function storageLogisticsSummary(storage: NonNullable<PeaceWorldSnapshot['storages']>[number]): string {
  if (!world) return '';
  const used = storage.contents.wood + storage.contents.stone;
  const inboundReserved = storage.reservedInbound.wood + storage.reservedInbound.stone;
  const outboundReserved = storage.reservedOutbound.wood + storage.reservedOutbound.stone;
  const incoming = world.logisticsTasks.filter((task) => task.destinationKind === 'storage' &&
    task.destinationId === storage.id && !['completed', 'cancelled'].includes(task.status));
  const outgoing = world.logisticsTasks.filter((task) => task.sourceKind === 'storage' &&
    task.sourceId === storage.id && !['completed', 'cancelled'].includes(task.status));
  const incomingAllocated = incoming.reduce((sum, task) => sum + task.allocatedQuantity, 0);
  const outgoingAllocated = outgoing.reduce((sum, task) => sum + task.allocatedQuantity, 0);
  const incomingQueued = incoming.reduce((sum, task) => sum + Math.max(0, task.requiredQuantity - task.deliveredQuantity - task.allocatedQuantity), 0);
  const outgoingQueued = outgoing.reduce((sum, task) => sum + Math.max(0, task.requiredQuantity - task.deliveredQuantity - task.allocatedQuantity), 0);
  const free = Math.max(0, storage.capacity - used - inboundReserved);
  return `${storage.contents.wood} дерева · ${storage.contents.stone} камня · занято ${used}/${storage.capacity} · ` +
    `свободно ${free} · резерв вход/выход ${inboundReserved}/${outboundReserved} · ` +
    `поставки в пути ${incomingAllocated}/${outgoingAllocated} · очередь ${incomingQueued}/${outgoingQueued}`;
}

function residentLogisticsSummary(resident: PeaceResident): string {
  if (!world) return '';
  const task = resident.task;
  const haul = task?.kind === 'haul' ? task : undefined;
  const queued = haul?.logisticsTaskId
    ? world.logisticsTasks.find((entry) => entry.id === haul.logisticsTaskId)
    : undefined;
  if (!haul || !queued) {
    if (resident.workRole !== 'hauler') return '';
    const pending = world.logisticsTasks.filter((entry) => entry.assignedResidentId === null &&
      ['queued', 'waiting', 'blocked'].includes(entry.status))
      .sort((a, b) => a.priorityRank - b.priorityRank || a.id.localeCompare(b.id))[0];
    return pending
      ? ` · очередь: ${logisticsItemLabel(pending.itemId)} ×${pending.requiredQuantity} · ${logisticsPriorityLabel(pending.kind)} · ${logisticsQueueStatusLabel(pending.status)}${pending.blockedReason ? ` · ${blockedReasonMessage(pending.blockedReason)}` : ''}`
      : resident.blockedReason ? ` · ожидание: ${blockedReasonMessage(resident.blockedReason)}` : ' · ждёт задачу логистики';
  }
  const source = haul.sourceKind === 'storage'
    ? world.storages?.find((storage) => storage.id === haul.sourceId)?.name ?? 'склад'
    : haul.sourceKind === 'tree-buffer'
      ? world.trees.find((tree) => tree.id === haul.sourceId)?.name ?? 'древесный буфер'
      : world.stoneDeposits.find((deposit) => deposit.id === haul.sourceId)?.name ?? 'каменный буфер';
  const destination = haul.destinationKind === 'storage'
    ? world.storages?.find((storage) => storage.id === haul.destinationId)?.name ?? 'склад'
    : world.buildings.find((building) => building.id === haul.destinationId)?.kind === 'workshop' ? 'мастерская' : 'стройка';
  return ` · ${logisticsItemLabel(haul.itemId)} ×${resident.cargo || queued.allocatedQuantity} · ${source} → ${destination}` +
    ` · приоритет: ${logisticsPriorityLabel(queued.kind)}${queued.queuePosition !== null ? ` #${queued.queuePosition + 1}` : ''}` +
    ` · ${logisticsQueueStatusLabel(queued.status)}` +
    (queued.blockedReason ? ` · ${blockedReasonMessage(queued.blockedReason)}` : '') +
    (queued.fallbackReason ? ` · ${blockedReasonMessage(queued.fallbackReason)}` : '');
}

function buildingLogisticsSummary(building: PeaceWorldSnapshot['buildings'][number]): string {
  const currentWorld = world;
  if (!currentWorld) return '';
  const required = building.kind === 'workshop' ? g33StoneBalance.workshop.constructionMaterials : { wood: 3, stone: 0 };
  const missingWood = Math.max(0, required.wood - building.reservedWood - building.inTransitWood);
  const missingStone = Math.max(0, required.stone - building.reservedStone - building.inTransitStone);
  const tasks = currentWorld.logisticsTasks.filter((task) => task.destinationKind === 'building' &&
    task.destinationId === building.id && !['completed', 'cancelled'].includes(task.status));
  const taskSummary = tasks.map((task) => {
    const carrier = task.assignedResidentId
      ? currentWorld.residents.find((resident) => resident.id === task.assignedResidentId)?.name : undefined;
    return `${logisticsItemLabel(task.itemId)} ${logisticsQueueStatusLabel(task.status)} · ${logisticsPriorityLabel(task.kind)}` +
      `${task.queuePosition === null ? '' : ` #${task.queuePosition + 1}`}` +
      `${carrier ? ` · ${carrier}` : ''}${task.blockedReason ? ` · ${blockedReasonMessage(task.blockedReason, 'construction')}` : ''}` +
      `${task.fallbackReason ? ` · ${blockedReasonMessage(task.fallbackReason)}` : ''}`;
  }).join('; ');
  const order = currentWorld.buildOrders.find((candidate) => candidate.buildingId === building.id);
  const orderBlock = order?.blockedReason ? blockedReasonMessage(order.blockedReason, 'construction') : '';
  const showOrderBlock = orderBlock && (!taskSummary || !routeBlockedReason(order?.blockedReason));
  return `Доставлено ${building.reservedWood} дерева/${building.reservedStone} камня · ` +
    `возврат ${building.reservedReturnWood} дерева/${building.reservedReturnStone} камня · ` +
    `в пути ${building.inTransitWood}/${building.inTransitStone} · не хватает ${missingWood}/${missingStone}` +
    (taskSummary ? ` · логистика: ${taskSummary}` : '') +
    (showOrderBlock ? ` · заказ: ${orderBlock}` : '');
}

function buildingDemolitionBlockReason(building: PeaceWorldSnapshot['buildings'][number]): string | null {
  if (building.state !== 'complete') return 'Снос доступен только для готовой постройки.';
  if (building.reservedWood + building.reservedStone + building.inTransitWood + building.inTransitStone > 0) {
    return 'Сначала безопасно верните материалы со стройплощадки.';
  }
  const task = world?.residents.some((resident) => {
    const current = resident.task;
    return (current?.kind === 'build-cabin' || current?.kind === 'build-workshop') && current.buildingId === building.id ||
      current?.kind === 'gather-stone' && current.buildingId === building.id ||
      current?.kind === 'haul' && (current.destinationKind === 'building' && current.destinationId === building.id ||
        current.sourceKind === 'building-site' && current.sourceId === building.id);
  });
  return task ? 'Постройка участвует в работе или перевозке.' : null;
}

function storageDemolitionBlockReason(storage: NonNullable<PeaceWorldSnapshot['storages']>[number]): string | null {
  if ((world?.storages?.length ?? 1) <= 1) return 'Нельзя снести последний склад поселения.';
  if (storage.contents.wood + storage.contents.stone > 0 || storage.reservedInbound.wood + storage.reservedInbound.stone > 0 ||
      storage.reservedOutbound.wood + storage.reservedOutbound.stone > 0) return 'Сначала вывезите все запасы и резервации.';
  const task = world?.residents.some((resident) => {
    const current = resident.task;
    return current?.kind === 'haul' && (current.sourceKind === 'storage' && current.sourceId === storage.id ||
      current.destinationKind === 'storage' && current.destinationId === storage.id) ||
      current?.kind === 'gather-wood' && current.destinationId === storage.id ||
      current?.kind === 'gather-stone' && current.destinationId === storage.id;
  });
  return task ? 'Склад сейчас нужен задаче или перевозке.' : null;
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;
function showActionStatus(message: string, state: 'pending' | 'success' | 'error' = 'pending', retry = false): void {
  actionStatus.textContent = message;
  actionToast.hidden = !message;
  actionToast.dataset.state = state;
  retryCommandButton.hidden = !retry;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = undefined;
}

function setStatusText(message: string): void {
  showActionStatus(message, 'success');
  if (message) statusTimer = setTimeout(() => { actionToast.hidden = true; }, 3600);
}

function dismissActionToast(): void {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = undefined;
  actionToast.hidden = true;
  retryCommandButton.hidden = true;
}

function assignmentForTarget(selection: SettlementSelection): AssignmentTarget | undefined {
  if (!selection) return undefined;
  if (selection.kind === 'tree') return { kind: 'tree', sourceId: selection.id };
  if (selection.kind === 'stone-deposit') return { kind: 'stone-deposit', sourceId: selection.id };
  if (selection.kind === 'storage') return { kind: 'storage', storageId: selection.id };
  if (selection.kind === 'building') {
    const building = world?.buildings.find((candidate) => candidate.id === selection.id);
    const order = world?.buildOrders.find((candidate) => candidate.buildingId === building?.id && !['completed', 'cancelled'].includes(candidate.status));
    if (order) return { kind: 'build-order', orderId: order.id };
  }
  return undefined;
}

function canAssignResident(residentId: string, target: AssignmentTarget): boolean {
  const resident = world?.residents.find((candidate) => candidate.id === residentId);
  if (!resident || serverUnavailable || busy || retryableCommand) return false;
  if (target.kind === 'tree') return !resident.task && resident.cargo === 0 && Boolean(world?.trees.some((tree) => tree.id === target.sourceId && tree.state === 'standing' && tree.remaining > 0));
  if (target.kind === 'stone-deposit') return (!resident.task || resident.task.kind === 'gather-wood' || resident.task.kind === 'gather-stone') && Boolean(world?.stoneDeposits.some((deposit) => deposit.id === target.sourceId && (deposit.remaining > 0 || deposit.bufferQuantity > 0)));
  if (target.kind === 'storage') return !resident.task && resident.cargo === 0 && Boolean(world?.storages?.some((storage) => storage.id === target.storageId));
  const order = world?.buildOrders.find((candidate) => candidate.id === target.orderId);
  return Boolean(order && !['completed', 'cancelled', 'blocked'].includes(order.status) &&
    (!order.assignedResidentId || order.assignedResidentId === residentId) && canResidentTakeBuildOrder(resident));
}

function canResidentTakeBuildOrder(resident: PeaceResident): boolean {
  const task = resident.task;
  if (task && task.kind !== 'gather-wood' && task.kind !== 'gather-stone') return false;
  if (resident.cargo === 0) return true;
  if (resident.cargoItemId === 'wood') return !task || task.kind === 'gather-wood';
  if (resident.cargoItemId === 'stone') return !task || task.kind === 'gather-stone';
  return false;
}

function assignmentActionLabel(target: SettlementSelection): string {
  const assignment = assignmentForTarget(target);
  if (!assignment) return 'Недоступная цель';
  if (assignment.kind === 'tree') return 'Добывать древесину';
  if (assignment.kind === 'stone-deposit') return 'Добывать камень';
  if (assignment.kind === 'storage') return 'Перевозить на склад';
  const order = world?.buildOrders.find((candidate) => candidate.id === assignment.orderId);
  const building = order && world?.buildings.find((candidate) => candidate.id === order.buildingId);
  return building?.kind === 'workshop' ? 'Строить мастерскую' : 'Строить дом';
}

function positionDragHint(point: { x: number; y: number }): void {
  const bounds = dragHint.getBoundingClientRect();
  const safe = safeAreaInsets();
  const minX = safe.left + 8;
  const minY = safe.top + 8;
  const left = point.x + bounds.width + 16 < window.innerWidth ? point.x + 14 : point.x - bounds.width - 14;
  const top = point.y + bounds.height + 16 < window.innerHeight ? point.y + 14 : point.y - bounds.height - 14;
  dragHint.style.left = `${Math.max(minX, Math.min(left, window.innerWidth - safe.right - bounds.width - 8))}px`;
  dragHint.style.top = `${Math.max(minY, Math.min(top, window.innerHeight - safe.bottom - bounds.height - 8))}px`;
}

function selectionForAssignment(target: AssignmentTarget | undefined): SettlementSelection {
  if (!target) return null;
  if (target.kind === 'tree') return { kind: 'tree', id: target.sourceId };
  if (target.kind === 'stone-deposit') return { kind: 'stone-deposit', id: target.sourceId };
  if (target.kind === 'storage') return null;
  const order = world?.buildOrders.find((candidate) => candidate.id === target.orderId);
  return order ? { kind: 'building', id: order.buildingId } : null;
}

function dropFailureReason(residentId: string, target: ReturnType<typeof assignmentForTarget>): string {
  const resident = world?.residents.find((candidate) => candidate.id === residentId);
  if (!target) return 'Цель недоступна. Отпустите жителя над подсвеченным объектом.';
  if (!resident) return 'Житель больше не найден.';
  if (target.kind === 'build-order') {
    const order = world?.buildOrders.find((candidate) => candidate.id === target.orderId);
    if (order?.assignedResidentId && order.assignedResidentId !== residentId) return 'У этой площадки уже есть назначенный строитель.';
    if (!canResidentTakeBuildOrder(resident)) {
      return resident.task?.kind === 'build-cabin' || resident.task?.kind === 'build-workshop'
        ? 'Житель уже строит другой объект.' : 'Житель должен завершить текущую работу или безопасно доставить груз.';
    }
  }
  if (target.kind === 'tree' && !world?.trees.some((tree) => tree.id === target.sourceId && tree.state === 'standing' && tree.remaining > 0)) {
    return 'На этом дереве больше нет доступной древесины.';
  }
  if (target.kind === 'stone-deposit' && !world?.stoneDeposits.some((deposit) =>
    deposit.id === target.sourceId && (deposit.remaining > 0 || deposit.bufferQuantity > 0))) {
    return 'В этом месторождении больше нет доступного камня.';
  }
  if (resident.task || resident.cargo > 0) return 'Житель занят. Выберите другую доступную цель.';
  return 'Цель больше недоступна. Выберите другой объект.';
}

function buildMaterialWaitDetails(order: PeaceWorldSnapshot['buildOrders'][number], building: PeaceWorldSnapshot['buildings'][number]): string {
  if (!world) return '';
  const required = building.kind === 'workshop' ? g33StoneBalance.workshop.constructionMaterials : { wood: 3, stone: 0 };
  const aggregateReserved = world.buildings.reduce((total, candidate) => ({
    wood: total.wood + candidate.reservedWood,
    stone: total.stone + candidate.reservedStone
  }), { wood: 0, stone: 0 });
  const transitFor = (itemId: 'wood' | 'stone'): number => world!.residents.reduce((total, resident) => {
    const task = resident.task;
    if (!task || !('orderId' in task) || task.orderId !== order.id || resident.cargoItemId !== itemId || resident.cargo < 1) {
      return total;
    }
    if (itemId === 'wood' && task.kind === 'build-workshop' && task.phase === 'carrying_materials_to_build') {
      return total + resident.cargo;
    }
    if (itemId === 'stone' && task.kind === 'gather-stone' && task.buildingId === building.id &&
        ['carrying_to_build', 'unloading_at_building'].includes(task.phase)) {
      return total + Math.min(task.deliveryQuantity ?? resident.cargo, resident.cargo);
    }
    return total;
  }, 0);
  const describe = (itemId: 'wood' | 'stone', label: string, needed: number): string | undefined => {
    if (needed < 1) return undefined;
    const free = world!.resources[itemId];
    const ownReserve = itemId === 'wood' ? building.reservedWood : building.reservedStone;
    const reservedTotal = aggregateReserved[itemId];
    const reservedByOthers = Math.max(0, reservedTotal - ownReserve);
    const inTransit = transitFor(itemId);
    const availableForOrder = free + ownReserve + inTransit;
    const deficit = Math.max(0, needed - availableForOrder);
    return `${label}: нужно ${needed}, свободно ${free}, всего ${free + reservedTotal}` +
      ` · резерв ${reservedTotal} (этот заказ ${ownReserve}, другие ${reservedByOthers})` +
      (inTransit ? ` · в пути ${inTransit}` : '') + (deficit ? ` · не хватает ${deficit}` : '');
  };
  return [describe('wood', 'Дерево', required.wood), describe('stone', 'Камень', required.stone)]
    .filter((line): line is string => Boolean(line)).join(' · ');
}

function placementMaterialAvailability(kind: 'cabin' | 'workshop'): { affordable: boolean; detail: string } {
  if (!world) return { affordable: false, detail: 'Подключите мир, чтобы проверить запасы.' };
  const required = kind === 'workshop' ? g33StoneBalance.workshop.constructionMaterials : { wood: 3, stone: 0 };
  const reserved = world.buildings.reduce((total, building) => ({
    wood: total.wood + building.reservedWood,
    stone: total.stone + building.reservedStone
  }), { wood: 0, stone: 0 });
  const missing = (['wood', 'stone'] as const).flatMap((itemId) => {
    const needed = required[itemId];
    if (needed < 1) return [];
    const free = world!.resources[itemId];
    const total = free + reserved[itemId];
    return free >= needed ? [] : [
      `${itemId === 'wood' ? 'дерева' : 'камня'} ${needed - free}` +
      ` (свободно ${free}, всего ${total}, в резервах ${reserved[itemId]})`
    ];
  });
  return missing.length
    ? { affordable: false, detail: `Заказ будет ждать: не хватает ${missing.join(' и ')}.` }
    : { affordable: true, detail: 'Материалы доступны из свободного запаса.' };
}

function renderCatalogAvailability(): void {
  if (!world) return;
  for (const [kind, button, label] of [
    ['cabin', cabinCatalogItem, cabinAvailability],
    ['workshop', workshopCatalogItem, workshopAvailability]
  ] as const) {
    const availability = placementMaterialAvailability(kind);
    button.classList.toggle('catalog-item--waiting', !availability.affordable);
    button.dataset.materialsAvailable = String(availability.affordable);
    label.textContent = availability.detail;
  }
}

function safeAreaInsets(): { top: number; right: number; bottom: number; left: number } {
  const styles = getComputedStyle(document.documentElement);
  const pixels = (name: string) => Number.parseFloat(styles.getPropertyValue(`--safe-area-${name}`)) || 0;
  return { top: pixels('top'), right: pixels('right'), bottom: pixels('bottom'), left: pixels('left') };
}

function positionContextMenu(): void {
  const safe = safeAreaInsets();
  const minX = safe.left + 8;
  const minY = safe.top + 8;
  const maxWidth = Math.max(200, window.innerWidth - safe.left - safe.right - 16);
  const initialWidth = Math.min(window.innerWidth <= 700 ? 330 : 340, maxWidth);
  contextMenu.style.width = `${initialWidth}px`;
  const residentObject = contextMode === 'object' && selectedEntity?.kind === 'resident';
  const gap = residentObject ? 48 : 14;
  const initialLeft = window.innerWidth <= 700 && residentObject
    ? contextPoint.x - initialWidth / 2
    : contextPoint.x + initialWidth + gap <= window.innerWidth ? contextPoint.x + gap : contextPoint.x - initialWidth - gap;
  contextMenu.style.left = `${Math.max(minX, Math.min(initialLeft, window.innerWidth - safe.right - initialWidth - 8))}px`;
  contextMenu.style.top = `${Math.max(minY, Math.min(contextPoint.y - (residentObject ? 120 : 36), window.innerHeight - safe.bottom - 160))}px`;
  requestAnimationFrame(() => {
    if (contextMenu.hidden) return;
    const bounds = contextMenu.getBoundingClientRect();
    if (contextMode === 'placement') {
      const minLeft = safe.left + 8;
      const maxLeft = Math.max(minLeft, window.innerWidth - safe.right - bounds.width - 8);
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
      const minTop = Math.max(safe.top + 8, (topbar?.bottom ?? 0) + 8);
      const maxTop = Math.max(minTop, window.innerHeight - safe.bottom - bounds.height - 8);
      const ghost = scene.getPlacementGhostViewportBounds();
      const obstacles = ['.camera-tools', '#pairing-panel', '#game-toast']
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .filter((element): element is HTMLElement => Boolean(element && !element.hidden))
        .map((element) => element.getBoundingClientRect());
      const overlap = (left: number, top: number, rect: { left: number; top: number; right: number; bottom: number }): number =>
        Math.max(0, Math.min(left + bounds.width, rect.right) - Math.max(left, rect.left)) *
        Math.max(0, Math.min(top + bounds.height, rect.bottom) - Math.max(top, rect.top));
      const candidates = [minLeft, maxLeft].flatMap((left) => [minTop, maxTop].map((top) => ({ left, top })));
      const best = candidates.sort((a, b) => {
        const score = (candidate: typeof a) =>
          (ghost ? overlap(candidate.left, candidate.top, ghost) * 10_000 : 0) +
          obstacles.reduce((total, obstacle) => total + overlap(candidate.left, candidate.top, obstacle) * 20, 0) +
          Math.abs(candidate.left - contextPoint.x) + Math.abs(candidate.top - contextPoint.y);
        return score(a) - score(b);
      })[0];
      if (best) {
        contextMenu.style.left = `${best.left}px`;
        contextMenu.style.top = `${best.top}px`;
      }
      return;
    }
    const isObject = contextMode === 'object';
    const isResident = isObject && selectedEntity?.kind === 'resident';
    const mobileResident = isResident && window.innerWidth <= 700;
    const menuGap = isResident ? 48 : 14;
    const rightFits = contextPoint.x + bounds.width + menuGap <= window.innerWidth;
    const left = mobileResident
      ? contextPoint.x - bounds.width / 2
      : rightFits ? contextPoint.x + menuGap : contextPoint.x - bounds.width - menuGap;
    const belowFits = contextPoint.y + bounds.height + 14 <= window.innerHeight - safe.bottom;
    const top = mobileResident
      ? contextPoint.y - bounds.height - 12 >= minY ? contextPoint.y - bounds.height - 12 : contextPoint.y + 12
      : isObject ? contextPoint.y - bounds.height / 2
        : belowFits ? contextPoint.y + 14 : contextPoint.y - bounds.height - 14;
    contextMenu.style.left = `${Math.max(minX, Math.min(left, window.innerWidth - safe.right - bounds.width - 8))}px`;
    contextMenu.style.top = `${Math.max(minY, Math.min(top, window.innerHeight - safe.bottom - bounds.height - 8))}px`;
  });
}

function renderContextMenu(): void {
  if (!contextMode) return;
  const wasHidden = contextMenu.hidden;
  contextMenu.hidden = false;
  positionContextMenu();
  if (wasHidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    contextMenu.animate([
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 140, easing: 'ease-out' });
  }
  const resident = world?.residents.find((candidate) => candidate.id === selectedResidentId);
  buildingCatalog.hidden = contextMode !== 'catalog';
  placementPanel.hidden = contextMode !== 'placement';
  inspectorTitle.hidden = false;
  inspectorDetail.hidden = false;
  contextOrderSection.hidden = true;
  workRoleControl.hidden = true;
  collectButton.hidden = true;
  cancelWoodcutButton.hidden = true;
  uprootStumpButton.hidden = true;
  assignTargetButton.hidden = true;
  cancelBuildButton.hidden = true;
  demolishStructureButton.hidden = true;
  if (contextMode === 'catalog') {
    contextKind.textContent = 'СТРОИТЕЛЬСТВО';
    inspectorTitle.textContent = 'Выберите постройку';
    inspectorDetail.textContent = 'Выберите дом или мастерскую для размещения.';
    renderCatalogAvailability();
    return;
  }
  if (contextMode === 'placement') {
    contextKind.textContent = 'СТРОЙКА';
    inspectorTitle.hidden = true;
    inspectorDetail.hidden = true;
    return;
  }
  if (!selectedEntity) return;
  const entity = selectedEntity;
  if (entity.kind === 'resident') {
    const actor = world?.residents.find((candidate) => candidate.id === entity.id);
    const previewActor = preview?.actors.find((candidate) => candidate.visualKey === entity.id);
    contextKind.textContent = 'ЖИТЕЛЬ';
    inspectorTitle.textContent = actor?.name ?? (previewActor ? 'Житель' : 'Житель');
    inspectorDetail.textContent = actor
      ? `${workerStatus(actor)} · ${workRoleLabel(actor.workRole)}${residentLogisticsSummary(actor)}`
      : 'Предварительный просмотр · только чтение.';
    if (actor) {
      workRoleControl.hidden = false;
      workRoleSelect.value = actor.workRole;
      workRoleSelect.disabled = busy || Boolean(retryableCommand);
      collectButton.hidden = false;
      collectButton.disabled = busy || Boolean(retryableCommand) || Boolean(actor.task) || actor.cargo > 0;
      cancelWoodcutButton.hidden = actor.task?.kind !== 'gather-wood' && actor.task?.kind !== 'gather-stone';
      cancelWoodcutButton.disabled = busy || Boolean(retryableCommand);
    }
    return;
  }
  const assignment = assignmentForTarget(entity);
  let title = 'Объект поселения';
  let detail = '';
  if (entity.kind === 'tree') {
    const tree = world?.trees.find((item) => item.id === entity.id);
    title = tree?.name ?? 'Лесной участок';
    detail = tree ? `${tree.remaining}/${tree.maxRemaining} брёвен · ${tree.state}` : 'Недоступно';
    uprootStumpButton.hidden = tree?.state !== 'stump';
  } else if (entity.kind === 'stone-deposit') {
    const deposit = world?.stoneDeposits.find((item) => item.id === entity.id);
    title = deposit?.name ?? 'Каменное месторождение';
    detail = deposit ? `${deposit.remaining}/${deposit.maxRemaining} камня · буфер ${deposit.bufferQuantity}/${deposit.bufferCapacity}` : 'Недоступно';
  } else if (entity.kind === 'storage') {
    const storage = world?.storages?.find((candidate) => candidate.id === entity.id) ??
      preview?.storages?.find((candidate) => candidate.id === entity.id);
    title = storage?.name ?? 'Склад поселения';
    detail = storage
      ? `${world ? storageLogisticsSummary(storage) : `${storage.contents.wood} дерева · ${storage.contents.stone} камня · ${storage.contents.wood + storage.contents.stone}/${storage.capacity}`} · ${storage.status}`
      : 'Только чтение';
    if (world && storage) {
      const demolitionBlock = storageDemolitionBlockReason(storage);
      if (!demolitionBlock) {
        demolishStructureButton.hidden = false;
        demolishStructureButton.textContent = 'Снести пустой склад';
        demolishStructureButton.disabled = busy || Boolean(retryableCommand);
        demolishStructureButton.onclick = () => {
          if (!window.confirm('Снести этот пустой склад? Он исчезнет, освободит клетки и изменит маршруты. Запасы не возвращаются.')) return;
          void runCommand('demolish-storage', { storageId: storage.id, confirmed: true });
        };
      } else {
        detail += ` · Снос недоступен: ${demolitionBlock}`;
      }
    }
    if (resident && assignment) {
      assignTargetButton.hidden = false;
      assignTargetButton.textContent = `Назначить ${resident.name} носильщиком`;
      assignTargetButton.disabled = !canAssignResident(resident.id, assignment);
      assignTargetButton.onclick = () => void runCommand('assign-resident', { residentId: resident.id, target: assignment });
    }
  } else {
    const building = world?.buildings.find((item) => item.id === entity.id);
    const order = building ? world?.buildOrders.find((item) => item.buildingId === building.id) : undefined;
    title = building?.kind === 'workshop' ? 'Мастерская' : 'Дом';
    if (building) {
      const progress = Math.floor(building.progressTicks / building.progressRequired * 100);
      const required = building.kind === 'workshop' ? g33StoneBalance.workshop.constructionMaterials : { wood: 3, stone: 0 };
      const missingWood = Math.max(0, required.wood - building.reservedWood - building.inTransitWood);
      const missingStone = Math.max(0, required.stone - building.reservedStone - building.inTransitStone);
      const access = building.accessibility === 'accessible' ? 'подход доступен'
        : `подход недоступен: ${blockedReasonMessage(building.accessibilityReason ?? 'NO_PATH', 'construction')}`;
      detail = `${buildingStageLabel(building.state)} · ${progress}% · осталось ${missingWood} дерева/${missingStone} камня · ${access}` +
        ` · вход и рабочая точка отмечены на сцене · ${buildingLogisticsSummary(building)}`;
    } else {
      detail = 'Строительная площадка';
    }
    if (order) {
      if (building && order.status === 'waiting_materials') {
        const shortage = order.blockedReason === 'INSUFFICIENT_STONE' ? 'Ждёт камень' : 'Ждёт древесину';
        const distributed = Boolean(world?.storages &&
          (world.storages.length > 1 || world?.residents.some((candidate) => candidate.workRole === 'hauler')));
        detail += distributed
          ? ` · ${shortage}`
          : ` · ${shortage} · ${buildMaterialWaitDetails(order, building)}`;
      }
      const assigned = order.assignedResidentId && world?.residents.find((item) => item.id === order.assignedResidentId);
      renderBuildOrders(world?.buildOrders ?? []);
      if (assigned) detail += ` · строитель: ${assigned.name}`;
      if (!assigned && resident && assignment) {
        assignTargetButton.hidden = false;
        assignTargetButton.textContent = `Назначить ${resident.name} строителем`;
        assignTargetButton.disabled = !canAssignResident(resident.id, assignment);
        assignTargetButton.onclick = () => void runCommand('assign-resident', { residentId: resident.id, target: assignment });
      }
      if (!['completed', 'cancelled', 'cancelling'].includes(order.status)) {
        cancelBuildButton.hidden = false;
        cancelBuildButton.textContent = order.status === 'in_progress' ? 'Отменить строительство' : 'Отменить заказ';
        cancelBuildButton.disabled = busy || Boolean(retryableCommand);
        cancelBuildButton.onclick = () => void runCommand('cancel-build-order', { orderId: order.id });
      }
    }
    if (building?.state === 'complete') {
      const demolitionBlock = buildingDemolitionBlockReason(building);
      if (!demolitionBlock) {
        demolishStructureButton.hidden = false;
        demolishStructureButton.textContent = `Снести ${building.kind === 'workshop' ? 'мастерскую' : 'дом'}`;
        demolishStructureButton.disabled = busy || Boolean(retryableCommand);
        demolishStructureButton.onclick = () => {
          const label = building.kind === 'workshop' ? 'мастерскую' : 'дом';
          if (!window.confirm(`Снести ${label}? Постройка исчезнет и освободит клетки; материалы не возвращаются, так как утверждённый коэффициент возврата не задан.`)) return;
          void runCommand('demolish-building', { buildingId: building.id, confirmed: true });
        };
      } else {
        detail += ` · Снос недоступен: ${demolitionBlock}`;
      }
    }
  }
  contextKind.textContent = entity.kind === 'tree' ? 'ЛЕСНОЙ УЧАСТОК' : entity.kind === 'stone-deposit' ? 'МЕСТОРОЖДЕНИЕ' : entity.kind === 'storage' ? 'СКЛАД' : 'ПОСТРОЙКА';
  inspectorTitle.textContent = title;
  inspectorDetail.textContent = detail || (resident ? `Назначить ${resident.name} на объект` : 'Выберите жителя, чтобы назначить его на объект.');
  if ((entity.kind === 'tree' || entity.kind === 'stone-deposit') && assignment && resident) {
    assignTargetButton.hidden = false;
    assignTargetButton.textContent = `Назначить ${resident.name}`;
    assignTargetButton.disabled = !canAssignResident(resident.id, assignment);
    assignTargetButton.onclick = () => void runCommand('assign-resident', { residentId: resident.id, target: assignment });
  }
  uprootStumpButton.disabled = busy || Boolean(retryableCommand) || !resident || Boolean(resident.task) || (resident?.cargo ?? 0) > 0;
}

function workerStatus(current: PeaceResident | ReadOnlyWorldPreview['actors'][number]): string {
  const cargo = current.cargo ?? 0;
  const task = 'task' in current ? current.task : null;
  const blockedReason = 'blockedReason' in current ? current.blockedReason : null;
  switch (current.visualState) {
    case 'walking_to_source': return 'Идёт к дереву';
    case 'gathering': return 'Рубит дерево';
    case 'loading': return 'Поднимает бревно';
    case 'carrying_to_storage': return `Несёт ${Math.max(1, cargo)} бревно · идёт на склад`;
    case 'unloading': return 'Разгружает';
    case 'waiting_storage': return `Склад заполнен · ждёт разгрузки${cargo > 0 ? ` · груз: ${cargo}` : ''}`;
    case 'walking_to_build': return 'Идёт к стройке';
    case 'carrying_materials_to_build': return `Несёт ${Math.max(1, cargo)} бревно · к стройке`;
    case 'walking_to_stone': return 'Идёт к каменному выходу';
    case 'mining_stone': return 'Добывает камень';
    case 'loading_stone': return 'Загружает камень';
    case 'carrying_stone_to_build': return `Несёт ${cargo} камня · к мастерской`;
    case 'unloading_stone_at_build': return 'Доставляет камень на стройку';
    case 'carrying_stone_to_storage': return `Несёт ${cargo} камня · на склад`;
    case 'unloading_stone': return 'Разгружает камень';
    case 'waiting_stone_source': return 'Ждёт доступное месторождение';
    case 'hauling_to_source': return 'Идёт за грузом';
    case 'hauling_loading': return 'Загружает груз';
    case 'hauling_to_storage': return `Несёт ${cargo} ${current.cargoItemId === 'stone' ? 'камня' : 'брёвен'} на склад`;
    case 'hauling_to_worksite': return `Несёт ${cargo} ${current.cargoItemId === 'stone' ? 'камня' : 'брёвен'} на стройку`;
    case 'hauling_unloading': return 'Разгружает доставку';
    case 'waiting_haul': return blockedReason === 'STORAGE_FULL' ? 'Ждёт свободное место на складе'
      : blockedReason === 'NO_PATH_TO_STORAGE' ? 'Нет маршрута к складу'
        : blockedReason === 'NO_WORKER' ? 'Задача ждёт назначения носильщика' : 'Ждёт доступный груз';
    case 'waiting_stone_storage': return `Склад заполнен · ждёт разгрузки камня${cargo > 0 ? ` · груз: ${cargo}` : ''}`;
    case 'building': {
      const building = task?.kind === 'build-cabin' || task?.kind === 'build-workshop'
        ? world?.buildings.find((item) => item.id === task.buildingId) : undefined;
      return building ? `Строит ${building.kind === 'workshop' ? 'мастерскую' : 'дом'} · ${Math.floor(building.progressTicks / building.progressRequired * 100)}%`
        : 'Ведёт строительство';
    }
    case 'waiting_path': return blockedReason === 'NO_PATH_TO_SOURCE' ? 'Ждёт маршрут к дереву'
      : blockedReason === 'NO_PATH_TO_STORAGE' || blockedReason === 'NO_PATH_TO_WORKSITE' ? 'Ждёт маршрут к месту доставки'
        : 'Ждёт доступный маршрут';
    case 'waiting_resource': return blockedReason === 'SOURCE_RESERVED'
      ? 'Ждёт, пока дерево освободится'
      : blockedReason === 'WORK_POINT_OCCUPIED' ? 'Ждёт свободную рабочую точку'
        : 'Ждёт, пока появится доступное дерево';
    case 'waiting_materials': return task?.kind === 'build-workshop' ? 'Ждёт материалы для мастерской'
      : 'Ждёт древесину для дома';
    case 'blocked': return `Работа остановлена${blockedReason ? ` · ${blockedReasonMessage(blockedReason)}` : ''}`;
    default: return current.workRole === 'builder' ? 'Строитель · ждёт заказ'
      : current.workRole === 'woodcutter' ? 'Лесоруб · готов к добыче'
        : current.workRole === 'stone_miner' ? 'Добытчик камня · ждёт источник'
          : current.workRole === 'hauler' ? 'Носильщик · ждёт задачу' : 'Свободен · без рабочей роли';
  }
}

function renderPreview(next: ReadOnlyWorldPreview): void {
  preview = next;
  scene.showPreview(next);
  woodCount.textContent = String(next.resourceTotals.find((item) => item.itemId === 'wood')?.quantity ?? 0);
  stoneCount.textContent = String(next.resourceTotals.find((item) => item.itemId === 'stone')?.quantity ?? 0);
  residentCount.textContent = String(next.actors.length);
  workerState.textContent = `${next.actors.length} жителей · предварительный просмотр`;
  const forestAvailable = next.resourceNodes.filter((node) => node.state === 'standing').length;
  const stoneRemaining = next.stoneDeposits.reduce((sum, deposit) => sum + deposit.remaining + deposit.bufferQuantity, 0);
  treeStatus.textContent = `Лес: ${forestAvailable} · Камень: ${stoneRemaining}`;
  worldRevision.textContent = `Тик ${next.revision.serverTick} · только чтение`;
  status.textContent = 'Только чтение';
  status.parentElement?.classList.remove('is-ready');
}

function renderWorld(next: PeaceWorldSnapshot, preserveActionStatus = true): void {
  world = next;
  if (!next.residents.some((resident) => resident.id === selectedResidentId)) selectedResidentId = undefined;
  if (selectedEntity?.kind === 'resident' && !next.residents.some((resident) => resident.id === selectedEntity?.id)) selectedEntity = null;
  if (selectedEntity?.kind === 'tree' && !next.trees.some((tree) => tree.id === selectedEntity?.id)) selectedEntity = null;
  if (selectedEntity?.kind === 'stone-deposit' && !next.stoneDeposits.some((deposit) => deposit.id === selectedEntity?.id)) selectedEntity = null;
    if (selectedEntity?.kind === 'building' && !next.buildings.some((building) => building.id === selectedEntity?.id)) selectedEntity = null;
    if (selectedEntity?.kind === 'storage' && !next.storages?.some((storage) => storage.id === selectedEntity?.id)) selectedEntity = null;
  preview = undefined;
  scene.showWorld(next);
  woodCount.textContent = String(next.resources.wood);
  stoneCount.textContent = String(next.resources.stone);
  residentCount.textContent = String(next.residents.length);
  const selectedResident = next.residents.find((resident) => resident.id === selectedResidentId);
  const workingResidents = next.residents.filter((resident) => resident.task).length;
  workerState.textContent = selectedResident
    ? `${selectedResident.name} · ${workerStatus(selectedResident)}`
    : `${next.residents.length} жителя · поручений: ${workingResidents}`;
  const forestAvailable = next.trees.filter((tree) => tree.state === 'standing' && tree.remaining > 0).length;
  const forestRemaining = next.trees.reduce((sum, tree) => sum + tree.remaining, 0);
  const stoneRemaining = next.stoneDeposits.reduce((sum, deposit) => sum + deposit.remaining + deposit.bufferQuantity, 0);
  treeStatus.textContent = `Лес: ${forestAvailable} участка · ${forestRemaining} брёвен · Камень: ${stoneRemaining}`;
  worldRevision.textContent = `Тик ${next.revision.serverTick}`;
  status.textContent = 'Мир сохранён';
  status.parentElement?.classList.add('is-ready');
  if (!hasLoadedPairedWorld) pairingPanel.open = false;
  hasLoadedPairedWorld = true;
  pairingSummary.textContent = 'Мир подключён к этому браузеру';
  if (!preserveActionStatus && next.residents.every((resident) => !resident.task)) {
    setStatusText('Мир восстановлен. Все поручения продолжаются по серверным тикам.');
  }
}

function renderBuildOrders(orders: PeaceWorldSnapshot['buildOrders'] | ReadOnlyWorldPreview['buildOrders']): void {
  const active = [...orders].filter((order) => order.status !== 'cancelled' && order.status !== 'completed')
    .sort((a, b) => a.queuePosition - b.queuePosition || a.id.localeCompare(b.id));
  contextOrderSection.hidden = active.length === 0;
  buildOrderList.replaceChildren();
  buildOrderCount.textContent = String(active.length);
  for (const [orderIndex, order] of active.entries()) {
    const item = document.createElement('li');
    item.className = `build-order build-order--${order.status}`;
    item.dataset.orderId = order.id;
    const building = world?.buildings.find((candidate) => candidate.id === order.buildingId);
    const summary = document.createElement('div');
    summary.className = 'build-order__summary';
    const title = document.createElement('strong');
    title.textContent = building?.kind === 'workshop' ? 'Мастерская' : 'Дом';
    const state = document.createElement('small');
    state.className = 'build-order__state';
    const stateText = order.status === 'waiting_materials'
      ? order.blockedReason === 'INSUFFICIENT_STONE' ? 'Ждёт камень'
        : order.blockedReason === 'INSUFFICIENT_WOOD' ? 'Ждёт древесину' : 'Ждёт материалы'
      : order.status === 'cancelling' ? order.blockedReason === 'STORAGE_FULL' ? 'Отмена ждёт свободное место на складе'
        : 'Возвращает материалы перед отменой'
      : order.status === 'waiting_builder' ? 'Ожидает свободного строителя'
        : order.status === 'waiting_path' ? 'Ждёт доступный путь'
          : order.status === 'in_progress' ? 'Выполняется' : order.status;
    const blockedDelivery = world?.logisticsTasks.find((task) => task.destinationKind === 'building' &&
      task.destinationId === order.buildingId && routeBlockedReason(task.blockedReason));
    const routeReason = routeBlockedReason(order.blockedReason) ? order.blockedReason : blockedDelivery?.blockedReason;
    state.textContent = routeReason
      ? `Ждёт маршрута доставки · ${blockedReasonMessage(routeReason, 'construction')}`
      : stateText;
    summary.append(title, state);
    if (building && (building.reservedWood || building.reservedStone)) {
      const materials = document.createElement('small');
      materials.textContent = `Резерв: ${building.reservedWood} дерева · ${building.reservedStone} камня`;
      summary.append(materials);
    }
    if (building && order.status === 'waiting_materials') {
      const breakdown = document.createElement('small');
      breakdown.className = 'build-order__materials';
      breakdown.textContent = buildMaterialWaitDetails(order, building);
      summary.append(breakdown);
    }
    item.append(summary);
    const controls = document.createElement('div');
    controls.className = 'build-order__controls';
    for (const [direction, text] of [['up', 'Приоритет ↑'], ['down', 'Приоритет ↓']] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-button build-order__priority';
      button.textContent = direction === 'up' ? '↑' : '↓';
      button.setAttribute('aria-label', direction === 'up' ? 'Повысить приоритет заказа' : 'Понизить приоритет заказа');
      button.disabled = busy || Boolean(retryableCommand) || !['waiting_materials', 'waiting_builder', 'waiting_path'].includes(order.status) ||
        (direction === 'up' ? orderIndex === 0 : orderIndex === active.length - 1);
      button.addEventListener('click', () => void runCommand('move-build-order', { orderId: order.id, direction }));
      controls.append(button);
    }
    if (['waiting_materials', 'waiting_builder', 'waiting_path', 'in_progress', 'blocked'].includes(order.status)) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'button button--quiet build-order__cancel';
      cancel.textContent = order.status === 'in_progress' ? 'Отменить стройку' : 'Отменить';
      cancel.setAttribute('aria-label', 'Безопасно отменить строительство');
      cancel.disabled = busy || Boolean(retryableCommand);
      cancel.addEventListener('click', () => void runCommand('cancel-build-order', { orderId: order.id }));
      controls.append(cancel);
    }
    item.append(controls);
    buildOrderList.append(item);
  }
}

function renderInspector(): void {
  const currentSelection = selectedEntity;
  workRoleControl.hidden = true;
  if (currentSelection?.kind === 'resident' && world) {
    const resident = world.residents.find((item) => item.id === currentSelection.id);
    if (!resident) return;
    workRoleControl.hidden = false;
    workRoleSelect.value = resident.workRole;
    workRoleHint.textContent = (resident.task?.kind === 'gather-wood' && resident.task.assignmentSource === 'manual') ||
      resident.task?.kind === 'gather-stone'
      ? 'Текущее поручение завершит безопасную доставку; рабочая роль остаётся отдельной от школьной профессии.'
      : (resident.task?.kind === 'build-cabin' || resident.task?.kind === 'build-workshop') && resident.workRole !== 'builder'
        ? 'Житель безопасно завершит уже начатый заказ, затем работает по новой роли.'
      : resident.workRole === 'builder'
          ? 'Строитель сам берёт доступные заказы по очереди; перетаскивание на площадку задаёт предпочтительную цель.'
          : resident.workRole === 'hauler'
            ? 'Носильщик физически переносит ресурсы из буферов и складов; перетаскивание на склад задаёт место назначения.'
        : 'Роль задаёт автоматическую работу, когда житель свободен.';
    const task = resident.task;
    const target = task?.kind === 'gather-wood'
      ? task.sourceId ? world.trees.find((tree) => tree.id === task.sourceId)?.name ?? `Источник ${task.sourceId}`
        : 'Ближайшее доступное дерево'
      : task?.kind === 'gather-stone'
        ? task.sourceId ? world.stoneDeposits.find((deposit) => deposit.id === task.sourceId)?.name ?? 'Каменное месторождение'
          : 'Ближайшее доступное месторождение'
        : task?.kind === 'build-cabin' || task?.kind === 'build-workshop'
          ? world.buildings.find((building) => building.id === task.buildingId)
            ? `${world.buildings.find((building) => building.id === task.buildingId)?.kind === 'workshop' ? 'Мастерская' : 'Дом'} · клетка ${world.buildings.find((building) => building.id === task.buildingId)?.anchor.x}`
            : 'Строительная площадка'
          : task?.kind === 'haul'
            ? `${task.itemId === 'wood' ? 'Древесина' : 'Камень'} · ${task.sourceKind === 'storage' ? 'склад' : 'буфер'} ${task.sourceId} → ${task.destinationId}`
            : 'Нет цели';
    const progress = task?.kind === 'build-cabin' || task?.kind === 'build-workshop'
      ? world.buildings.find((building) => building.id === task.buildingId)
      : undefined;
    inspectorTitle.textContent = resident.name;
    inspectorDetail.textContent = [
      `рабочая роль: ${workRoleLabel(resident.workRole)}`,
      workerStatus(resident),
      `цель: ${target}`,
      resident.cargo > 0 ? `груз: ${resident.cargo} ${resident.cargoItemId === 'stone' ? 'камня' : 'брёвна'}` : undefined,
      task && progress ? `прогресс: ${progress.progressTicks}/${progress.progressRequired}`
        : task ? `прогресс: ${task.progressTicks}/${task.requiredTicks}` : undefined
    ].filter(Boolean).join(' · ');
    byId<HTMLElement>('inspector').classList.add('is-open');
    return;
  }
  if (selectedEntity?.kind === 'building' && world) {
    const selectedBuildingId = selectedEntity.id;
    const building = world.buildings.find((item) => item.id === selectedBuildingId);
    const order = world.buildOrders.find((item) => item.buildingId === selectedBuildingId &&
      !['completed', 'cancelled'].includes(item.status));
    inspectorTitle.textContent = building?.kind === 'workshop' ? 'Мастерская' : 'Дом';
    if (!building) inspectorDetail.textContent = 'Здание больше не отображается в мире.';
    else if (building.state === 'complete') {
      inspectorDetail.textContent = `${building.kind === 'workshop' ? 'Мастерская' : 'Дом'} завершён(а) и сохранён(а) в поселении.`;
    } else if (building.state === 'waiting_materials') {
      const reason = order?.blockedReason === 'INSUFFICIENT_STONE' ? 'Ждёт камень'
        : order?.blockedReason === 'INSUFFICIENT_WOOD' ? 'Ждёт древесину' : 'Ждёт материалы';
      inspectorDetail.textContent = `${reason} · ${order ? buildMaterialWaitDetails(order, building) :
        `резерв: ${building.reservedWood} древесины, ${building.reservedStone} камня`} · ${building.progressTicks}/${building.progressRequired}`;
    } else {
      const state = building.state === 'waiting_builder' ? 'Ждёт жителя с ролью «Строитель»'
        : building.state === 'planned' ? 'Строитель пойдёт к площадке'
          : building.state === 'in_progress' ? 'Строитель идёт к площадке'
            : building.state === 'foundation' ? 'Заливается фундамент' : 'Возводится каркас';
      inspectorDetail.textContent = `${state} · ${building.progressTicks}/${building.progressRequired}`;
    }
    byId<HTMLElement>('inspector').classList.add('is-open');
    return;
  }
  if (selectedEntity?.kind === 'tree' && world) {
    const treeId = selectedEntity.id;
    const tree = world.trees.find((item) => item.id === treeId);
    inspectorTitle.textContent = tree?.name ?? 'Лесной участок';
    inspectorDetail.textContent = tree
      ? tree.state === 'uprooted'
        ? 'Пень выкорчеван · источник больше не восстановится.'
        : tree.state === 'stump'
          ? `Пень · до следующего бревна ${Math.max(0, tree.regrowthEveryTicks! - tree.regrowthProgressTicks)} серверных тиков.`
          : `${tree.remaining} из ${tree.maxRemaining} брёвен${tree.remaining < tree.maxRemaining ? ` · следующее бревно через ${Math.max(0, tree.regrowthEveryTicks! - tree.regrowthProgressTicks)} тиков` : ' · взрослое дерево'}`
      : 'Лесной участок больше не отображается в мире.';
    byId<HTMLElement>('inspector').classList.add('is-open');
    return;
  }
  if (selectedEntity?.kind === 'stone-deposit' && world) {
    const depositId = selectedEntity.id;
    const deposit = world.stoneDeposits.find((item) => item.id === depositId);
    inspectorTitle.textContent = deposit?.name ?? 'Каменное месторождение';
    inspectorDetail.textContent = deposit
      ? `${deposit.remaining}/${deposit.maxRemaining} камня · буфер ${deposit.bufferQuantity}/${deposit.bufferCapacity} · добыча ${deposit.yieldPerTick} за тик${deposit.state === 'depleted' ? ' · месторождение выработано' : ' · конечное месторождение'}`
      : 'Месторождение больше не отображается в мире.';
    byId<HTMLElement>('inspector').classList.add('is-open');
    return;
  }
  inspectorTitle.textContent = world ? 'Выберите объект' : 'Выберите жителя';
  inspectorDetail.textContent = world
    ? 'Выберите жителя, лесной участок или каменное месторождение в сцене, чтобы посмотреть состояние.'
    : 'Подключите этот браузер одноразовым кодом.';
  byId<HTMLElement>('inspector').classList.remove('is-open');
}

function setActions(): void {
  const locked = busy || Boolean(retryableCommand);
  confirmPlacement.disabled = locked || !world || !placementMode || placementReason.dataset.valid !== 'true';
  cabinCatalogItem.disabled = locked;
  workshopCatalogItem.disabled = locked;
  retryCommandButton.disabled = busy;
  if (contextMode) renderContextMenu();
}

function formatPlacementReason(code: string, detail: string): string {
  if (code === 'WAITING_MATERIALS') return `${detail} ${placementMaterialAvailability(selectedBuildingKind).detail}`;
  if (code === 'RESOURCE_MISSING') return detail;
  const labels: Record<string, string> = {
    READY: 'Место подходит. Заказ попадёт в очередь строительства.',
    WAITING_BUILDER: 'Заказ сохранится и дождётся свободного строителя.',
    WORKER_BUSY: 'Сначала дождитесь завершения текущей работы.',
    CARGO_NOT_EMPTY: 'Сначала дождитесь, пока рабочий разгрузит бревно.',
    RESOURCE_MISSING: 'На складе пока недостаточно древесины.',
    WAITING_MATERIALS: 'Заказ сохранится и дождётся древесины на складе.',
    WAITING_WORK_POINT: 'Строитель дождётся освобождения точки работы.',
    OUT_OF_WORLD: 'За пределами доступного участка.',
    INVALID_SURFACE: 'Неподходящая поверхность.',
    NO_SUPPORT: 'Неподходящая поверхность: нет опоры под всем участком.',
    NO_ENTRANCE: 'Нет прохода ко входу здания.',
    ROUTE_BLOCKED: 'Перекрывает действующий маршрут.',
    OCCUPIED: 'Занято другим зданием или ресурсным объектом.',
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
        body: JSON.stringify({ buildingKind: selectedBuildingKind, anchor })
      });
      if (request !== placementRequest) return;
      if (!response.ok) throw new Error(await responseProblem(response));
      const result = await response.json() as {
        valid: boolean;
        reason: string;
        reasons?: string[];
        detail: string;
        footprintCells?: Array<{ x: number; y: number }>;
        occupiedCells?: Array<{ x: number; y: number }>;
        supportCells?: Array<{ x: number; y: number }>;
        unsupportedCells?: Array<{ x: number; y: number }>;
        walkBlockedCells?: Array<{ x: number; y: number }>;
        overlapCells?: Array<{ x: number; y: number }>;
        entrance?: { x: number; y: number };
        workPoint?: { x: number; y: number };
        route?: Array<{ x: number; y: number }>;
        blockedRoute?: { from: { x: number; y: number }; to: { x: number; y: number } };
      };
      const reason = formatPlacementReason(result.reason, result.detail);
      const secondary = (result.reasons ?? []).filter((reasonCode) => reasonCode !== result.reason)
        .map((reasonCode) => formatPlacementReason(reasonCode, '')).filter(Boolean);
      const geometrySummary = result.valid && result.reason !== 'WAITING_MATERIALS'
        ? 'Опора и маршрут проверены; вход и рабочая точка отмечены.' : '';
      placementReason.textContent = [reason, ...secondary, geometrySummary].filter(Boolean).join(' · ');
      if (contextMode === 'placement') positionContextMenu();
      placementReason.dataset.valid = String(result.valid);
      placementReason.classList.toggle('is-valid', result.valid && result.reason !== 'WAITING_MATERIALS');
      placementReason.classList.toggle('is-waiting', result.reason === 'WAITING_MATERIALS');
      confirmPlacement.disabled = !result.valid || busy;
      scene.setPlacementFeedback({
        valid: result.valid, reason: result.reason,
        footprintCells: result.footprintCells ?? [], supportCells: result.supportCells ?? [],
        unsupportedCells: result.unsupportedCells ?? [],
        walkBlockedCells: result.walkBlockedCells ?? [], overlapCells: result.overlapCells ?? [],
        entrance: result.entrance, workPoint: result.workPoint, route: result.route ?? [], blockedRoute: result.blockedRoute
      });
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
      if (world !== undefined) {
        world = undefined;
        selectedResidentId = undefined;
        selectedEntity = null;
        scene.setResidentSelected(null);
      }
      if (!hasShownUnpairedPairing) {
        pairingPanel.open = true;
        hasShownUnpairedPairing = true;
      }
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
      selectedResidentId = undefined;
      selectedEntity = null;
      scene.setResidentSelected(null);
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
    if (error instanceof Error) showActionStatus(error.message, 'error');
    setActions();
  } finally {
    syncInFlight = false;
  }
}

type CommandOptions = {
  anchor?: PlacementAnchor;
  buildingKind?: 'cabin' | 'workshop';
  residentId?: string;
  target?: AssignmentTarget;
  workRole?: PeaceWorldSnapshot['residents'][number]['workRole'];
  orderId?: string;
  buildingId?: string;
  storageId?: string;
  confirmed?: true;
  direction?: 'up' | 'down';
};

function applyCommandSuccess(command: PeaceCommand, next: PeaceWorldSnapshot): void {
  retryableCommand = undefined;
  renderWorld(next);
  if (command.kind === 'assign-resident') {
    const assignedResident = next.residents.find((resident) => resident.id === command.residentId);
    scene.flashSelection(selectionForAssignment(command.target), true);
    scene.flashSelection({ kind: 'resident', id: command.residentId }, true);
    setStatusText(assignedResident ? `${assignedResident.name} назначен(а): ${workerStatus(assignedResident)}.` : 'Назначение сохранено.');
    contextMode = undefined;
    contextMenu.hidden = true;
  } else if (command.kind === 'collect-wood') {
    const resident = next.residents.find((candidate) => candidate.id === command.residentId);
    setStatusText(resident
      ? `${resident.name} выполняет ручное поручение; после отмены вернётся к своей роли.`
      : 'Поручение сохранено на сервере.');
  } else if (command.kind === 'cancel-woodcutting') {
    setStatusText('Текущее поручение отменено безопасно; уже поднятый груз будет доставлен.');
  } else if (command.kind === 'uproot-stump') {
    setStatusText('Пень выкорчеван. Это дерево больше не отрастёт.');
  } else if (command.kind === 'set-work-role') {
    setStatusText(`${workRoleLabel(command.workRole)} сохранён(а) как постоянная рабочая роль.`);
  } else if (command.kind === 'move-build-order') {
    setStatusText('Приоритет ожидающего заказа изменён.');
  } else if (command.kind === 'cancel-build-order') {
    const order = next.buildOrders.find((candidate) => candidate.id === command.orderId);
    setStatusText(order?.status === 'cancelling'
      ? 'Строитель остановлен; материалы и грузы физически возвращаются на склад.'
      : 'Строительство отменено; клетки освобождены, ресурсы сохранены.');
  } else if (command.kind === 'demolish-building' || command.kind === 'demolish-storage') {
    selectedEntity = null;
    selectedResidentId = undefined;
    contextMode = undefined;
    contextMenu.hidden = true;
    scene.clearSelection();
    setStatusText(command.kind === 'demolish-storage'
      ? 'Пустой склад снесён; маршруты поселения пересчитаны.'
      : 'Постройка снесена и освободила занимаемые клетки.');
  } else if (command.kind === 'build-cabin' || command.kind === 'build-workshop') {
    placementMode = false;
    placementPanel.hidden = true;
    contextMode = undefined;
    contextMenu.hidden = true;
    scene.setPlacementMode(false);
    setStatusText(command.kind === 'build-workshop'
      ? 'Заказ мастерской добавлен в очередь; строитель возьмёт его автоматически, когда будут доступны материалы.'
      : 'Заказ дома добавлен в очередь; строитель с соответствующей ролью возьмёт его автоматически.');
  } else {
    setStatusText('Действие подтверждено сервером.');
  }
}

async function retryLastCommand(): Promise<void> {
  const command = retryableCommand;
  if (!command || busy) return;
  busy = true;
  setActions();
  showActionStatus('Повторяем последнее действие…', 'pending');
  try {
    const response = await fetch(apiUrl('/api/commands'), {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include', body: JSON.stringify(command)
    });
    if (!response.ok) {
      const detail = await responseProblem(response);
      if (response.status >= 500) {
        showActionStatus(`${detail} Повторите действие, когда связь восстановится.`, 'error', true);
      } else {
        retryableCommand = undefined;
        if (command.kind === 'assign-resident') scene.flashSelection(selectionForAssignment(command.target), false);
        showActionStatus(detail, 'error');
        if (response.status === 409) await syncWorld();
      }
      return;
    }
    const next = PeaceWorldSnapshotSchema.parse(await response.json());
    applyCommandSuccess(command, next);
  } catch {
    retryableCommand = command;
    showActionStatus('Ответ сервера не получен. Нажмите «Повторить»: запрос безопасно повторится без дублирования.', 'error', true);
  } finally {
    busy = false;
    setActions();
  }
}

async function runCommand(kind: PeaceCommand['kind'], options: CommandOptions = {}): Promise<void> {
  const residentCommand = ['collect-wood', 'cancel-woodcutting', 'uproot-stump', 'set-work-role', 'assign-resident'].includes(kind);
  const actorId = options.residentId ?? (residentCommand ? selectedResidentId : undefined);
  if (!world || busy || serverUnavailable || retryableCommand || (residentCommand && !actorId)) return;
  busy = true;
  setActions();
  showActionStatus(kind === 'collect-wood' ? `Назначаем ${world.residents.find((resident) => resident.id === actorId)?.name ?? 'жителю'} ручное поручение…`
    : kind === 'cancel-woodcutting' ? 'Останавливаем текущее поручение…'
      : kind === 'uproot-stump' ? 'Подтверждаем выкорчёвывание пня…'
        : kind === 'set-work-role' ? 'Сохраняем рабочую роль…'
          : kind === 'move-build-order' ? 'Меняем приоритет заказа…'
            : kind === 'cancel-build-order' ? 'Отменяем ожидающий заказ…' : 'Отправляем команду на сервер…', 'pending');
  let commandForRetry: PeaceCommand | undefined;
  let sentCommand: PeaceCommand | undefined;
  try {
    let response: Response | undefined;
    let commandRevision: PeaceWorldSnapshot['revision'] | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        const snapshot = await fetch(apiUrl('/api/world'), {
          headers: { accept: 'application/json' }, credentials: 'include', cache: 'no-store'
        });
        if (!snapshot.ok) throw new Error(await responseProblem(snapshot));
        renderWorld(PeaceWorldSnapshotSchema.parse(await snapshot.json()));
        commandRevision = world?.revision;
        if (actorId) {
          const resident = world?.residents.find((candidate) => candidate.id === actorId);
          if (!resident) throw new Error('Житель больше не найден. Обновите мир.');
          if (kind === 'collect-wood' && (resident.task?.kind !== 'gather-wood' ||
              resident.task.assignmentSource !== 'profession') && (resident.task || resident.cargo > 0)) {
            showActionStatus('Житель уже занят; его текущее поручение и груз сохранены.', 'error');
            return;
          }
        }
        if (kind === 'build-cabin' || kind === 'build-workshop') {
          const validation = await fetch(apiUrl('/api/placement/validate'), {
            method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'include', cache: 'no-store',
            body: JSON.stringify({ buildingKind: kind === 'build-workshop' ? 'workshop' : 'cabin', anchor: options.anchor })
          });
          if (!validation.ok) throw new Error(await responseProblem(validation));
          const result = await validation.json() as {
            valid: boolean; reason: string; detail: string; revision: PeaceWorldSnapshot['revision']
          };
          commandRevision = result.revision;
          placementReason.textContent = formatPlacementReason(result.reason, result.detail);
          placementReason.dataset.valid = String(result.valid);
          placementReason.classList.toggle('is-valid', result.valid && result.reason !== 'WAITING_MATERIALS');
          placementReason.classList.toggle('is-waiting', result.reason === 'WAITING_MATERIALS');
          scene.setPlacementFeedback({ valid: result.valid, reason: result.reason });
          if (!result.valid) {
            showActionStatus('Участок изменился. Проверьте новую причину и подтвердите размещение ещё раз.', 'error');
            return;
          }
        }
      }
      const current = world;
      if (!current) throw new Error('Мир недоступен. Обновите страницу.');
      const command = PeaceCommandSchema.parse({
        requestId: createRequestId(),
        expectedWorldVersion: (commandRevision ?? current.revision).worldVersion,
        expectedGeometryVersion: (commandRevision ?? current.revision).geometryVersion,
        kind,
        ...(actorId ? { residentId: actorId } : {}),
        ...(kind === 'assign-resident' ? { target: options.target } : {}),
        ...(kind === 'uproot-stump' && selectedTreeId ? { treeId: selectedTreeId } : {}),
        ...(kind === 'set-work-role' ? { workRole: options.workRole } : {}),
        ...(kind === 'move-build-order' || kind === 'cancel-build-order' ? { orderId: options.orderId } : {}),
        ...(kind === 'move-build-order' ? { direction: options.direction } : {}),
        ...(kind === 'demolish-building' ? { buildingId: options.buildingId, confirmed: options.confirmed } : {}),
        ...(kind === 'demolish-storage' ? { storageId: options.storageId, confirmed: options.confirmed } : {}),
        ...(kind === 'build-cabin' || kind === 'build-workshop' ? { anchor: options.anchor } : {})
      });
      sentCommand = command;
      commandForRetry = command;
      response = await fetch(apiUrl('/api/commands'), {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'include', body: JSON.stringify(command)
      });
      commandRevision = undefined;
      if (response.ok) break;
      const problem = await response.clone().json().catch(() => ({})) as { code?: string };
      if (response.status === 409 && ['STALE_WORLD', 'STALE_GEOMETRY'].includes(problem.code ?? '') && attempt < 2) {
        commandForRetry = undefined;
        sentCommand = undefined;
        response = undefined;
        continue;
      }
      if (response.status >= 500) retryableCommand = command;
      commandForRetry = undefined;
      break;
    }
    if (!response) throw new Error('Команда не была отправлена.');
    if (!response.ok) {
      const detail = await responseProblem(response);
      if (kind === 'assign-resident' && response.status < 500) scene.flashSelection(selectionForAssignment(options.target), false);
      showActionStatus(retryableCommand ? `${detail} Нажмите «Повторить», когда связь восстановится.` : detail,
        'error', Boolean(retryableCommand));
      if (response.status === 409) await syncWorld();
      if (response.status === 503) serverUnavailable = true;
      return;
    }
    const next = PeaceWorldSnapshotSchema.parse(await response.json());
    commandForRetry = undefined;
    retryableCommand = undefined;
    if (!sentCommand) throw new Error('Команда подтверждена без исходного запроса. Обновите мир.');
    applyCommandSuccess(sentCommand, next);
  } catch (error) {
    if (commandForRetry) {
      retryableCommand = commandForRetry;
      showActionStatus('Сеть не подтвердила результат. Повторите действие: тот же запрос не создаст дубликат.', 'error', true);
    } else {
      showActionStatus(error instanceof Error ? error.message : 'Нет связи с игровым миром.', 'error');
    }
  } finally {
    busy = false;
    setActions();
  }
}

retryCommandButton.addEventListener('click', () => void retryLastCommand());

collectButton.addEventListener('click', () => void runCommand('collect-wood'));
cancelWoodcutButton.addEventListener('click', () => void runCommand('cancel-woodcutting'));
uprootStumpButton.addEventListener('click', () => void runCommand('uproot-stump'));
workRoleSelect.addEventListener('change', () => {
  const workRole = workRoleSelect.value as PeaceWorldSnapshot['residents'][number]['workRole'];
  void runCommand('set-work-role', { workRole });
});
closeContext.addEventListener('click', () => {
  if (placementMode) {
    placementMode = false;
    scene.setPlacementMode(false);
    placementReason.dataset.valid = 'false';
    setStatusText('Размещение отменено. Мир не изменён.');
  }
  contextMode = undefined;
  contextMenu.hidden = true;
});
document.addEventListener('pointerdown', (event) => {
  if (contextMenu.hidden || event.target instanceof Node && contextMenu.contains(event.target)) return;
  if (contextMode === 'placement' && event.target instanceof Element && event.target.closest('#world-scene')) return;
  if (contextMode === 'placement') {
    placementMode = false;
    scene.setPlacementMode(false);
    placementReason.dataset.valid = 'false';
    setStatusText('Размещение отменено. Мир не изменён.');
  }
  contextMode = undefined;
  contextMenu.hidden = true;
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (placementMode) {
    placementMode = false;
    scene.setPlacementMode(false);
    placementReason.dataset.valid = 'false';
    setStatusText('Размещение отменено. Мир не изменён.');
  }
  contextMode = undefined;
  contextMenu.hidden = true;
  dragHint.hidden = true;
});

cabinCatalogItem.addEventListener('click', () => {
  dismissActionToast();
  selectedBuildingKind = 'cabin';
  buildingCatalog.hidden = true;
  placementMode = true;
  placementPanel.hidden = false;
  placementReason.textContent = 'Проверяем участок…';
  placementReason.dataset.valid = 'false';
  confirmPlacement.disabled = true;
  placementTitle.textContent = 'Дом · 3 дерева';
  confirmPlacement.textContent = 'Заказать дом';
  scene.setPlacementBuildingKind('cabin');
  scene.setPlacementMode(true, placementAnchor);
  contextMode = 'placement';
  renderContextMenu();
  void validatePlacement(placementAnchor);
  setActions();
});

workshopCatalogItem.addEventListener('click', () => {
  dismissActionToast();
  selectedBuildingKind = 'workshop';
  buildingCatalog.hidden = true;
  placementMode = true;
  placementPanel.hidden = false;
  placementReason.textContent = 'Проверяем участок…';
  placementReason.dataset.valid = 'false';
  confirmPlacement.disabled = true;
  placementTitle.textContent = `Мастерская · ${g33StoneBalance.workshop.constructionMaterials.wood} дерева + ${g33StoneBalance.workshop.constructionMaterials.stone} камня`;
  confirmPlacement.textContent = 'Заказать мастерскую';
  scene.setPlacementBuildingKind('workshop');
  scene.setPlacementMode(true, placementAnchor);
  contextMode = 'placement';
  renderContextMenu();
  void validatePlacement(placementAnchor);
  setActions();
});

cancelPlacement.addEventListener('click', () => {
  placementMode = false;
  contextMode = undefined;
  contextMenu.hidden = true;
  placementReason.dataset.valid = 'false';
  scene.setPlacementMode(false);
  setStatusText('Размещение отменено. Мир не изменён.');
  setActions();
});

confirmPlacement.addEventListener('click', () => void runCommand(
  selectedBuildingKind === 'workshop' ? 'build-workshop' : 'build-cabin',
  { anchor: placementAnchor, buildingKind: selectedBuildingKind }
));
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
    showActionStatus('Одноразовый код показан только в этом локальном браузере.', 'success');
  } catch (error) {
    showActionStatus(error instanceof Error
      ? error.message
      : 'Покажите код на компьютере: handoff не открыт для LAN-устройств.', 'error');
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
  showActionStatus('Проверяем одноразовый код…', 'pending');
  try {
    const response = await fetch(apiUrl('/api/session'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code })
    });
    if (!response.ok) throw new Error(await responseProblem(response));
    sessionPaired = true;
    hasShownUnpairedPairing = true;
    sessionStatusCheckedAt = Date.now();
    pairingInput.value = '';
    pairingCode.textContent = '';
    pairingCode.hidden = true;
    pairingPanel.open = false;
    pairingSummary.textContent = 'Мир подключён к этому браузеру';
    setStatusText('Подключено. Нажмите на жителя в мире, чтобы выбрать его.');
    await syncWorld();
  } catch (error) {
    showActionStatus(error instanceof Error ? error.message : 'Не удалось подключиться к миру.', 'error');
  } finally {
    pairButton.disabled = false;
  }
});

void syncWorld(false);
window.setInterval(() => void syncWorld(), 250);
