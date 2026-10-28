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
const buildingCatalog = byId<HTMLDivElement>('building-catalog');
const cabinCatalogItem = byId<HTMLButtonElement>('cabin-catalog-item');
const workshopCatalogItem = byId<HTMLButtonElement>('workshop-catalog-item');
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
  onDropPreview: (residentId, target) => {
    const assignment = assignmentForTarget(target);
    return Boolean(assignment && canAssignResident(residentId, assignment));
  },
  onResidentDrop: (residentId, target, point) => {
    const assignment = target ? assignmentForTarget(target) : undefined;
    if (!assignment || !canAssignResident(residentId, assignment)) {
      setStatusText(dropFailureReason(residentId, assignment));
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

function workRoleLabel(workRole: 'none' | 'woodcutter' | 'builder' | 'stone_miner' | undefined): string {
  if (workRole === 'woodcutter') return 'Лесоруб';
  if (workRole === 'stone_miner') return 'Добытчик камня';
  if (workRole === 'builder') return 'Строитель';
  return 'Без роли';
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;
function setStatusText(message: string): void {
  actionStatus.textContent = message;
  actionStatus.hidden = !message;
  if (statusTimer) clearTimeout(statusTimer);
  if (message) statusTimer = setTimeout(() => { actionStatus.hidden = true; }, 4200);
}

function assignmentForTarget(selection: SettlementSelection): AssignmentTarget | undefined {
  if (!selection) return undefined;
  if (selection.kind === 'tree') return { kind: 'tree', sourceId: selection.id };
  if (selection.kind === 'stone-deposit') return { kind: 'stone-deposit', sourceId: selection.id };
  if (selection.kind === 'building') {
    const building = world?.buildings.find((candidate) => candidate.id === selection.id);
    const order = world?.buildOrders.find((candidate) => candidate.buildingId === building?.id && !['completed', 'cancelled'].includes(candidate.status));
    if (order) return { kind: 'build-order', orderId: order.id };
  }
  return undefined;
}

function canAssignResident(residentId: string, target: AssignmentTarget): boolean {
  const resident = world?.residents.find((candidate) => candidate.id === residentId);
  if (!resident || serverUnavailable || busy) return false;
  if (target.kind === 'tree') return !resident.task && resident.cargo === 0 && Boolean(world?.trees.some((tree) => tree.id === target.sourceId && tree.state === 'standing' && tree.remaining > 0));
  if (target.kind === 'stone-deposit') return (!resident.task || resident.task.kind === 'gather-wood' || resident.task.kind === 'gather-stone') && Boolean(world?.stoneDeposits.some((deposit) => deposit.id === target.sourceId && (deposit.remaining > 0 || deposit.bufferQuantity > 0)));
  const order = world?.buildOrders.find((candidate) => candidate.id === target.orderId);
  return Boolean(order && !['completed', 'cancelled', 'blocked'].includes(order.status) && (!order.assignedResidentId || order.assignedResidentId === residentId));
}

function dropFailureReason(residentId: string, target: ReturnType<typeof assignmentForTarget>): string {
  const resident = world?.residents.find((candidate) => candidate.id === residentId);
  if (!target) return 'Этого объекта нельзя назначить целью.';
  if (!resident) return 'Житель больше не найден.';
  if (resident.task || resident.cargo > 0) return 'Житель занят или несёт груз. Он завершит работу безопасно.';
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

function renderContextMenu(): void {
  if (!contextMode) return;
  contextMenu.hidden = false;
  contextMenu.style.left = `${Math.max(8, Math.min(contextPoint.x, window.innerWidth - 350))}px`;
  contextMenu.style.top = `${Math.max(8, Math.min(contextPoint.y, window.innerHeight - 260))}px`;
  requestAnimationFrame(() => {
    if (contextMenu.hidden) return;
    const bounds = contextMenu.getBoundingClientRect();
    const gap = contextMode === 'object' && selectedEntity?.kind === 'resident' ? 48 : 14;
    const adjacentLeft = contextMode === 'object' && contextPoint.x >= window.innerWidth / 2
      ? contextPoint.x - bounds.width - gap : contextPoint.x + gap;
    const left = contextMode === 'object' ? adjacentLeft : window.innerWidth - bounds.width - 12;
    const top = contextMode === 'object'
      ? window.innerWidth <= 700 ? contextPoint.y - bounds.height - 12 : contextPoint.y - 48
      : contextMode === 'placement' && window.innerWidth <= 700 ? 64 : 124;
    contextMenu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8))}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8))}px`;
  });
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
  if (contextMode === 'catalog') {
    contextKind.textContent = 'СТРОИТЕЛЬСТВО';
    inspectorTitle.textContent = 'Выберите постройку';
    inspectorDetail.textContent = 'Выберите дом или мастерскую для размещения.';
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
    inspectorDetail.textContent = actor ? `${workerStatus(actor)} · ${workRoleLabel(actor.workRole)}` : 'Предварительный просмотр · только чтение.';
    if (actor) {
      workRoleControl.hidden = false;
      workRoleSelect.value = actor.workRole;
      workRoleSelect.disabled = busy;
      collectButton.hidden = false;
      collectButton.disabled = busy || Boolean(actor.task) || actor.cargo > 0;
      cancelWoodcutButton.hidden = actor.task?.kind !== 'gather-wood' && actor.task?.kind !== 'gather-stone';
      cancelWoodcutButton.disabled = busy;
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
    title = 'Склад поселения';
    detail = world ? `${world.resources.wood} дерева · ${world.resources.stone} камня` : 'Только чтение';
  } else {
    const building = world?.buildings.find((item) => item.id === entity.id);
    const order = assignment?.kind === 'build-order' ? world?.buildOrders.find((item) => item.id === assignment.orderId) : undefined;
    title = building?.kind === 'workshop' ? 'Мастерская' : 'Дом';
    detail = building ? `${building.state} · резерв ${building.reservedWood} дерева, ${building.reservedStone} камня` : 'Строительная площадка';
    if (order) {
      if (building && order.status === 'waiting_materials') {
        const shortage = order.blockedReason === 'INSUFFICIENT_STONE' ? 'Ждёт камень' : 'Ждёт древесину';
        detail += ` · ${shortage} · ${buildMaterialWaitDetails(order, building)}`;
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
  uprootStumpButton.disabled = busy || !resident || Boolean(resident.task) || (resident?.cargo ?? 0) > 0;
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
    case 'waiting_stone_storage': return `Склад заполнен · ждёт разгрузки камня${cargo > 0 ? ` · груз: ${cargo}` : ''}`;
    case 'building': {
      const building = task?.kind === 'build-cabin' || task?.kind === 'build-workshop'
        ? world?.buildings.find((item) => item.id === task.buildingId) : undefined;
      return building ? `Строит ${building.kind === 'workshop' ? 'мастерскую' : 'дом'} · ${Math.floor(building.progressTicks / building.progressRequired * 100)}%`
        : 'Ведёт строительство';
    }
    case 'waiting_path': return blockedReason === 'NO_PATH_TO_SOURCE' ? 'Ждёт маршрут к дереву'
      : blockedReason === 'NO_PATH_TO_STORAGE' ? 'Ждёт маршрут на склад' : 'Ждёт доступный маршрут';
    case 'waiting_resource': return blockedReason === 'SOURCE_RESERVED'
      ? 'Ждёт, пока дерево освободится'
      : blockedReason === 'WORK_POINT_OCCUPIED' ? 'Ждёт свободную рабочую точку'
        : 'Ждёт, пока появится доступное дерево';
    case 'waiting_materials': return task?.kind === 'build-workshop' ? 'Ждёт материалы для мастерской'
      : 'Ждёт древесину для дома';
    case 'blocked': return `Работа остановлена${blockedReason ? ` · ${blockedReason}` : ''}`;
    default: return current.workRole === 'builder' ? 'Строитель · ждёт заказ'
      : current.workRole === 'woodcutter' ? 'Лесоруб · готов к добыче'
        : current.workRole === 'stone_miner' ? 'Добытчик камня · ждёт источник' : 'Свободен · без рабочей роли';
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
    state.textContent = order.status === 'waiting_materials'
      ? order.blockedReason === 'INSUFFICIENT_STONE' ? 'Ждёт камень'
        : order.blockedReason === 'INSUFFICIENT_WOOD' ? 'Ждёт древесину' : 'Ждёт материалы'
      : order.status === 'waiting_builder' ? 'Назначьте строителя'
        : order.status === 'waiting_path' ? 'Ждёт доступный путь'
          : order.status === 'in_progress' ? 'Выполняется' : order.status;
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
      button.disabled = busy || !['waiting_materials', 'waiting_builder', 'waiting_path'].includes(order.status) ||
        (direction === 'up' ? orderIndex === 0 : orderIndex === active.length - 1);
      button.addEventListener('click', () => void runCommand('move-build-order', { orderId: order.id, direction }));
      controls.append(button);
    }
    if (['waiting_materials', 'waiting_builder', 'waiting_path', 'blocked'].includes(order.status)) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'button button--quiet build-order__cancel';
      cancel.textContent = 'Отменить';
      cancel.setAttribute('aria-label', 'Отменить заказ');
      cancel.disabled = busy;
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
      const state = building.state === 'waiting_builder' ? 'Ждёт строителя'
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
  confirmPlacement.disabled = busy || !world || !placementMode || placementReason.dataset.valid !== 'true';
  if (contextMode) renderContextMenu();
}

function formatPlacementReason(code: string, detail: string): string {
  if (code === 'WAITING_MATERIALS' || code === 'RESOURCE_MISSING') return detail;
  const labels: Record<string, string> = {
    READY: 'Место подходит. Заказ попадёт в очередь строительства.',
    WAITING_BUILDER: 'Заказ сохранится и дождётся свободного строителя.',
    WORKER_BUSY: 'Сначала дождитесь завершения текущей работы.',
    CARGO_NOT_EMPTY: 'Сначала дождитесь, пока рабочий разгрузит бревно.',
    RESOURCE_MISSING: 'На складе пока недостаточно древесины.',
    WAITING_MATERIALS: 'Заказ сохранится и дождётся древесины на складе.',
    WAITING_WORK_POINT: 'Строитель дождётся освобождения точки работы.',
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
        body: JSON.stringify({ buildingKind: selectedBuildingKind, anchor })
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
      selectedResidentId = undefined;
      selectedEntity = null;
      scene.setResidentSelected(null);
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
    if (error instanceof Error) actionStatus.textContent = error.message;
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
  direction?: 'up' | 'down';
};

async function runCommand(kind: PeaceCommand['kind'], options: CommandOptions = {}): Promise<void> {
  const residentCommand = ['collect-wood', 'cancel-woodcutting', 'uproot-stump', 'set-work-role', 'assign-resident'].includes(kind);
  const actorId = options.residentId ?? (residentCommand ? selectedResidentId : undefined);
  if (!world || busy || serverUnavailable || (residentCommand && !actorId)) return;
  busy = true;
  setActions();
  actionStatus.textContent = kind === 'collect-wood' ? `Назначаем ${world.residents.find((resident) => resident.id === actorId)?.name ?? 'жителю'} ручное поручение…`
    : kind === 'cancel-woodcutting' ? 'Останавливаем текущее поручение…'
      : kind === 'uproot-stump' ? 'Подтверждаем выкорчёвывание пня…'
        : kind === 'set-work-role' ? 'Сохраняем рабочую роль…'
          : kind === 'move-build-order' ? 'Меняем приоритет заказа…'
            : kind === 'cancel-build-order' ? 'Отменяем ожидающий заказ…' : 'Проверяем участок для очереди…';
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
            actionStatus.textContent = 'Житель уже занят; его текущее поручение и груз сохранены.';
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
          placementReason.classList.toggle('is-valid', result.valid);
          scene.setPlacementFeedback({ valid: result.valid, reason: result.reason });
          if (!result.valid) {
            actionStatus.textContent = 'Участок изменился. Проверьте новую причину и подтвердите размещение ещё раз.';
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
        ...(kind === 'build-cabin' || kind === 'build-workshop' ? { anchor: options.anchor } : {})
      });
      response = await fetch(apiUrl('/api/commands'), {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'include', body: JSON.stringify(command)
      });
      commandRevision = undefined;
      if (response.ok) break;
      const problem = await response.clone().json().catch(() => ({})) as { code?: string };
      if (response.status === 409 && ['STALE_WORLD', 'STALE_GEOMETRY'].includes(problem.code ?? '') && attempt < 2) continue;
      break;
    }
    if (!response) throw new Error('Команда не была отправлена.');
    if (!response.ok) {
      actionStatus.textContent = await responseProblem(response);
      if (response.status === 409) await syncWorld();
      if (response.status === 503) serverUnavailable = true;
      return;
    }
    const next = PeaceWorldSnapshotSchema.parse(await response.json());
    renderWorld(next);
    if (kind === 'assign-resident') {
      const assignedResident = next.residents.find((resident) => resident.id === actorId);
      setStatusText(assignedResident ? `${assignedResident.name} назначен(а): ${workerStatus(assignedResident)}.` : 'Назначение сохранено.');
      contextMode = undefined;
      contextMenu.hidden = true;
    } else if (kind === 'collect-wood') {
      const resident = next.residents.find((candidate) => candidate.id === actorId);
      actionStatus.textContent = resident
        ? `${resident.name} выполняет ручное поручение; после отмены вернётся к своей роли.`
        : 'Поручение сохранено на сервере.';
    } else if (kind === 'cancel-woodcutting') {
      actionStatus.textContent = 'Текущее поручение отменено безопасно; уже поднятый груз будет доставлен.';
    } else if (kind === 'uproot-stump') {
      actionStatus.textContent = 'Пень выкорчеван. Это дерево больше не отрастёт.';
    } else if (kind === 'set-work-role') {
      actionStatus.textContent = `${workRoleLabel(options.workRole)} сохранён(а) как постоянная рабочая роль.`;
    } else if (kind === 'move-build-order') {
      actionStatus.textContent = 'Приоритет ожидающего заказа изменён.';
    } else if (kind === 'cancel-build-order') {
      actionStatus.textContent = 'Ожидающий заказ отменён; зарезервированные до начала работы материалы возвращены в запас.';
    } else if (kind === 'build-cabin' || kind === 'build-workshop') {
      placementMode = false;
      placementPanel.hidden = true;
      contextMode = undefined;
      contextMenu.hidden = true;
      scene.setPlacementMode(false);
      actionStatus.textContent = kind === 'build-workshop'
        ? 'Заказ мастерской добавлен; строитель возьмёт его после доставки обоих материалов.'
        : 'Заказ дома добавлен в очередь; свободный строитель возьмёт его сам.';
    }
  } catch (error) {
    actionStatus.textContent = error instanceof Error ? error.message : 'Нет связи с игровым миром.';
  } finally {
    busy = false;
    setActions();
  }
}

collectButton.addEventListener('click', () => void runCommand('collect-wood'));
cancelWoodcutButton.addEventListener('click', () => void runCommand('cancel-woodcutting'));
uprootStumpButton.addEventListener('click', () => void runCommand('uproot-stump'));
workRoleSelect.addEventListener('change', () => {
  const workRole = workRoleSelect.value as PeaceWorldSnapshot['residents'][number]['workRole'];
  void runCommand('set-work-role', { workRole });
});
closeContext.addEventListener('click', () => {
  contextMode = undefined;
  contextMenu.hidden = true;
});

cabinCatalogItem.addEventListener('click', () => {
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
  scene.setPlacementMode(true);
  contextMode = 'placement';
  renderContextMenu();
  void validatePlacement(placementAnchor);
  actionStatus.textContent = 'Перетащите полупрозрачный дом на свободное место. Подтверждение не перемещает его автоматически.';
  setActions();
});

workshopCatalogItem.addEventListener('click', () => {
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
  scene.setPlacementMode(true);
  contextMode = 'placement';
  renderContextMenu();
  void validatePlacement(placementAnchor);
  actionStatus.textContent = 'Мастерская попадёт в очередь и дождётся древесины и камня на складе.';
  setActions();
});

cancelPlacement.addEventListener('click', () => {
  placementMode = false;
  contextMode = undefined;
  contextMenu.hidden = true;
  placementReason.dataset.valid = 'false';
  scene.setPlacementMode(false);
  actionStatus.textContent = 'Размещение отменено. Мир не изменён.';
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
    hasShownUnpairedPairing = true;
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
