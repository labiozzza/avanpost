import Phaser from 'phaser';
import './style.css';
import { registerSW } from 'virtual:pwa-register';
import {
  createNewWorld, parseSavedWorld, PrototypeSimulation, STORAGE_KEY,
  modeLabel, roleLabel, PROTOTYPE_CONFIG,
  type BuildingKind, type WoodSourceId, type WorkRole
} from './simulation.js';
import { PrototypeScene } from './scene.js';
import { NotificationQueue, type NotificationPriority } from './notifications.js';

document.documentElement.dataset.build = __APP_BUILD_ID__;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Prototype UI is missing #${id}`);
  return element as T;
};

const woodTotal = $('wood-total');
const stoneTotal = $('stone-total');
const peopleTotal = $('people-total');
const capacityTotal = $('capacity-total');
const goalChip = $('goal-chip');
const selectionTitle = $('selection-title');
const selectionDetail = $('selection-detail');
const residentActions = $('resident-actions');
const residentTask = $('resident-task');
const residentList = $('resident-list');
const buildingList = $('building-list');
const workersLabel = $('workers-label');
const sitesLabel = $('sites-label');
const placementHelp = $('placement-help');
const placementBanner = $('placement-banner');
const placementLabel = $('placement-label');
const saveStatus = $('save-status');
const toastElement = $('toast');
const panelNotice = $('panel-notice');
const hudTop = document.querySelector<HTMLElement>('.hud-top')!;
const actionDock = document.querySelector<HTMLElement>('.action-dock')!;
const newGameDialog = $('new-game-dialog') as HTMLDialogElement;
const installButton = $('install-app') as HTMLButtonElement;
const updateBanner = $('pwa-update');
const iosInstall = $('ios-install');
const controlPanel = $('control-panel');
const residentListSection = $('resident-list-section');
const buildingListSection = $('building-list-section');
const menuActions = $('menu-actions');
const sheetEyebrow = $('sheet-eyebrow');
const roleOptions = $('role-options');
const toggleRoles = $('toggle-roles') as HTMLButtonElement;
const worldActions = $('world-actions');
const worldActionButtons = $('world-action-buttons');
const woodSourceControls = $('wood-source-controls');
const forestWayfinder = $('forest-wayfinder');
const forestDirection = $('forest-direction');
let forestWayfinderDismissed = false;

const saved = parseSavedWorld(localStorage.getItem(STORAGE_KEY));
const simulation = new PrototypeSimulation(saved ?? createNewWorld(), (message) => {
  if (message) showToast(message);
  dirty = true;
});
let selectedResidentId: string | null = null;
let placementKind: BuildingKind | null = null;
type PanelMode = 'resident' | 'residents' | 'build' | 'details' | 'menu' | null;
let panelMode: PanelMode = null;
let dirty = true;
let lastSaveAt = 0;
let currentInspection = '';
let lastUiSignature = '';
let game!: Phaser.Game;
let focusResidentCamera: (id: string) => void = () => {};
let setResidentCameraPresentation: (expanded: boolean) => void = () => {};

let installPrompt: BeforeInstallPromptEvent | undefined;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as BeforeInstallPromptEvent;
  installButton.hidden = false;
});
window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
  iosInstall.hidden = true;
  installPrompt = undefined;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  if (choice.outcome === 'accepted') installButton.hidden = true;
  installPrompt = undefined;
});
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
if (isIos && !isStandalone && !sessionStorage.getItem('avanpost:ios-install-dismissed')) {
  iosInstall.hidden = false;
}
$('ios-install-dismiss').addEventListener('click', () => {
  iosInstall.hidden = true;
  sessionStorage.setItem('avanpost:ios-install-dismissed', '1');
});

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { updateBanner.hidden = false; },
  onOfflineReady() { showToast('Игра готова к запуску без интернета.'); }
});
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.ready.then((registration) => {
    const showWaitingUpdate = () => {
      if (registration.waiting && navigator.serviceWorker.controller) updateBanner.hidden = false;
    };
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', () => {
        if (registration.installing?.state === 'installed') showWaitingUpdate();
      });
    });
    showWaitingUpdate();
  });
}
$('pwa-update-now').addEventListener('click', () => {
  persistWorld();
  void updateSW(true);
});
$('pwa-update-later').addEventListener('click', () => { updateBanner.hidden = true; });

let toastLayoutScheduled = false;
function scheduleToastLayout(): void {
  if (toastLayoutScheduled) return;
  toastLayoutScheduled = true;
  requestAnimationFrame(() => {
    toastLayoutScheduled = false;
    positionFloatingToast();
  });
}

function positionFloatingToast(): void {
  const current = notificationQueue.active;
  if (!current || panelMode) return;

  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const box = toastElement.getBoundingClientRect();
  const toastHeight = Math.max(box.height, 42);
  const toastWidth = Math.min(box.width || Math.min(viewportWidth * 0.9, 520), viewportWidth - 16);
  const toastLeft = (viewportWidth - toastWidth) / 2;
  const intervals: Array<{ top: number; bottom: number }> = [];
  const candidates = [
    hudTop,
    actionDock,
    $('placement-banner'),
    $('forest-wayfinder'),
    updateBanner,
    iosInstall
  ];
  for (const element of candidates) {
    if (element.hidden || getComputedStyle(element).display === 'none') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const spansDockLane = element === actionDock;
    if (!spansDockLane && (rect.right <= toastLeft || rect.left >= toastLeft + toastWidth)) continue;
    intervals.push({ top: Math.max(0, rect.top - 9), bottom: Math.min(viewportHeight, rect.bottom + 9) });
  }

  intervals.sort((a, b) => a.top - b.top);
  const merged: Array<{ top: number; bottom: number }> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.top <= previous.bottom) previous.bottom = Math.max(previous.bottom, interval.bottom);
    else merged.push({ ...interval });
  }

  const gaps: Array<{ top: number; bottom: number }> = [];
  let cursor = 8;
  for (const interval of merged) {
    if (interval.top > cursor) gaps.push({ top: cursor, bottom: interval.top });
    cursor = Math.max(cursor, interval.bottom);
  }
  if (cursor < viewportHeight - 8) gaps.push({ top: cursor, bottom: viewportHeight - 8 });

  const gap = gaps
    .filter((candidate) => candidate.bottom - candidate.top >= toastHeight)
    .sort((a, b) => b.bottom - a.bottom)[0];
  const top = gap ? gap.bottom - toastHeight : Math.max(8, Math.min(viewportHeight - toastHeight - 8, viewportHeight * 0.55));
  toastElement.style.top = `${Math.round(top)}px`;
}

function renderToast(message: { message: string; priority: NotificationPriority } | null): void {
  const inline = Boolean(message && panelMode);
  for (const element of [toastElement, panelNotice]) {
    element.textContent = message?.message ?? '';
    element.dataset.priority = message?.priority ?? 'info';
    const visible = Boolean(message) && (element === panelNotice ? inline : !inline);
    element.classList.toggle('visible', visible);
    element.setAttribute('aria-hidden', String(!visible));
  }
  if (message) scheduleToastLayout();
}
const notificationQueue = new NotificationQueue(renderToast);

function showToast(message: string, priority: NotificationPriority = 'info'): void {
  notificationQueue.push(message, priority);
}

const toastResizeObserver = new ResizeObserver(scheduleToastLayout);
for (const element of [hudTop, actionDock, controlPanel, updateBanner, iosInstall]) {
  toastResizeObserver.observe(element);
}
const toastMutationObserver = new MutationObserver(scheduleToastLayout);
toastMutationObserver.observe(hudTop, {
  attributes: true,
  attributeFilter: ['hidden', 'class'],
  subtree: true
});
for (const element of [updateBanner, iosInstall]) {
  toastMutationObserver.observe(element, { attributes: true, attributeFilter: ['hidden'] });
}
function reflowToastForViewportChange(): void {
  // Update immediately so a shorter viewport cannot keep portrait coordinates
  // for a frame; keep the scheduled pass for mobile visualViewport settling.
  positionFloatingToast();
  scheduleToastLayout();
}

window.addEventListener('resize', reflowToastForViewportChange);
window.addEventListener('orientationchange', reflowToastForViewportChange);
window.visualViewport?.addEventListener('resize', reflowToastForViewportChange);

function selectResident(id: string): void {
  selectedResidentId = id;
  currentInspection = '';
  focusResidentCamera(id);
  placementKind = null;
  placementBanner.hidden = true;
  openPanel('resident');
  updateUI();
}

function closePanel(): void {
  if (panelMode === 'resident') setResidentCameraPresentation(false);
  panelMode = null;
  controlPanel.hidden = true;
  renderToast(notificationQueue.active);
}

function openPanel(mode: Exclude<PanelMode, null>): void {
  panelMode = mode;
  controlPanel.hidden = false;
  residentActions.hidden = mode !== 'resident';
  residentListSection.hidden = mode !== 'residents';
  buildingListSection.hidden = mode !== 'details';
  menuActions.hidden = mode !== 'menu';
  $('build-actions').hidden = mode !== 'build';
  worldActions.hidden = true;
  woodSourceControls.hidden = true;
  sheetEyebrow.textContent = mode === 'resident' ? 'ЖИТЕЛЬ' :
    mode === 'residents' ? 'ПОСЕЛЕНИЕ' : mode === 'build' ? 'СТРОИТЕЛЬСТВО' :
      mode === 'menu' ? 'МЕНЮ' : 'ОБЪЕКТ';
  if (mode === 'residents') {
    selectionTitle.textContent = 'Жители поселения';
    selectionDetail.textContent = 'Выбери жителя, чтобы назначить ему работу.';
  } else if (mode === 'build') {
    selectionTitle.textContent = 'Строительство';
    selectionDetail.textContent = 'Выбери здание — площадки появятся прямо на карте.';
  } else if (mode === 'menu') {
    selectionTitle.textContent = 'Поселение';
    selectionDetail.textContent = 'Прогресс сохраняется на этом устройстве.';
  }
  controlPanel.dataset.mode = mode;
  renderToast(notificationQueue.active);
  if (mode === 'resident') {
    roleOptions.hidden = true;
    toggleRoles.textContent = 'Профессии';
    setResidentCameraPresentation(false);
  }
}

const scene = new PrototypeScene(simulation, {
  onResident: selectResident,
  onPlot: (plotId) => {
    if (!placementKind) return;
    const result = simulation.place(placementKind, plotId);
    if (!result.ok) { showToast(result.reason, 'error'); return; }
    placementKind = null;
    placementBanner.hidden = true;
    closePanel();
    updateUI();
  },
  onObject: (kind, id) => {
    selectedResidentId = null;
    currentInspection = kind === 'wood' ? 'wood' : kind === 'stone' ? 'stone' :
      kind === 'eastern-forest' ? 'forest:eastern' : kind === 'sector' ? `sector:${id ?? ''}` :
        `${kind}:${id ?? ''}`;
    openPanel('details');
    updateUI();
  },
  isSelected: (id) => selectedResidentId === id,
  isPlacing: () => placementKind !== null,
  onForestNavigationState: ({ prepared, visible, direction }) => {
    forestDirection.textContent = direction === 'right' ? '→' : '←';
    forestWayfinder.hidden = !prepared || visible || forestWayfinderDismissed;
  }
});
focusResidentCamera = (id) => scene.focusResident(id);
setResidentCameraPresentation = (expanded) => scene.setResidentSheetExpanded(expanded);

game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'world-scene',
  transparent: true,
  scale: { mode: Phaser.Scale.RESIZE, width: 1120, height: 510 },
  input: { activePointers: 2 },
  render: { antialias: true, roundPixels: true },
  scene: [scene]
});

document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) => {
  button.addEventListener('click', () => {
    const person = simulation.world.residents.find((candidate) => candidate.id === selectedResidentId);
    if (!person) { showToast('Сначала выбери жителя на карте или в списке.', 'error'); return; }
    simulation.assign(person.id, button.dataset.role as WorkRole);
    currentInspection = '';
    roleOptions.hidden = true;
    toggleRoles.textContent = 'Профессии';
    setResidentCameraPresentation(false);
    updateUI();
  });
});
toggleRoles.addEventListener('click', () => {
  roleOptions.hidden = !roleOptions.hidden;
  toggleRoles.textContent = roleOptions.hidden ? 'Профессии' : 'Свернуть';
  setResidentCameraPresentation(!roleOptions.hidden);
});

function setSelectedWoodSource(source: WoodSourceId): void {
  const person = simulation.world.residents.find((candidate) => candidate.id === selectedResidentId);
  if (!person) { showToast('Сначала выбери лесоруба.', 'error'); return; }
  const result = simulation.setWoodSource(person.id, source);
  if (!result.ok) showToast(result.reason, 'error');
  updateUI();
}
$('wood-source-home').addEventListener('click', () => setSelectedWoodSource('home'));
$('wood-source-eastern').addEventListener('click', () => setSelectedWoodSource('eastern'));

function startPlacement(kind: BuildingKind): void {
  placementKind = placementKind === kind ? null : kind;
  selectedResidentId = null;
  currentInspection = '';
  $('build-house').classList.toggle('active', placementKind === 'house');
  $('build-warehouse').classList.toggle('active', placementKind === 'warehouse');
  placementBanner.hidden = placementKind === null;
  if (placementKind) {
    placementLabel.textContent = `Коснись площадки · ${placementKind === 'house' ? 'дом' : 'склад'}`;
    closePanel();
  }
  placementHelp.textContent = placementKind
    ? `Коснись свободной отмеченной площадки. Свайп перемещает карту.`
    : 'Выбери здание, затем подходящее место на карте.';
  if (!placementKind) placementBanner.hidden = true;
  if (placementKind) showToast('Выбери свободную отмеченную площадку на карте.');
  updateUI();
}
$('dock-build').addEventListener('click', () => openPanel('build'));
$('dock-residents').addEventListener('click', () => {
  selectedResidentId = null;
  currentInspection = '';
  openPanel('residents');
  updateUI();
});
$('dock-focus').addEventListener('click', () => scene.focusSettlement());
$('show-eastern-forest').addEventListener('click', () => {
  forestWayfinderDismissed = true;
  forestWayfinder.hidden = true;
  scene.focusEasternForest();
});
$('menu-button').addEventListener('click', () => openPanel('menu'));
$('close-panel').addEventListener('click', closePanel);
$('build-house').addEventListener('click', () => startPlacement('house'));
$('build-warehouse').addEventListener('click', () => startPlacement('warehouse'));
$('cancel-placement').addEventListener('click', () => startPlacement(placementKind ?? 'house'));

let outsidePanelStart: { pointerId: number; x: number; y: number } | null = null;
document.addEventListener('pointerdown', (event) => {
  outsidePanelStart = panelMode && !controlPanel.contains(event.target as Node)
    ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    : null;
}, true);
document.addEventListener('pointerup', (event) => {
  const start = outsidePanelStart;
  outsidePanelStart = null;
  if (start && panelMode && start.pointerId === event.pointerId &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) closePanel();
}, true);
document.addEventListener('pointercancel', () => { outsidePanelStart = null; }, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !newGameDialog.open) closePanel();
});

$('new-game').addEventListener('click', () => newGameDialog.showModal());
$('confirm-new-game').addEventListener('click', () => {
  const fresh = createNewWorld();
  simulation.world = fresh;
  selectedResidentId = null;
  currentInspection = '';
  placementKind = null;
  forestWayfinderDismissed = false;
  placementBanner.hidden = true;
  dirty = true;
  localStorage.removeItem(STORAGE_KEY);
  game.scene.stop('GameplayPrototype');
  game.scene.start('GameplayPrototype');
  closePanel();
  showToast('Новое поселение готово. Прогресс предыдущей игры заменён.');
  updateUI();
});

function goalText(): string {
  switch (simulation.world.currentGoal) {
    case 'build-first-house': return 'Цель: построй первый дом';
    case 'increase-storage': return 'Следующая цель: увеличь вместимость склада';
    case 'unlock-eastern-sector': return 'Следующая цель: открой Восточную опушку';
    case 'prepare-eastern-sector': return 'Следующая цель: подготовь новую территорию';
    case 'build-in-eastern-sector': return 'Следующая цель: построй здание на опушке';
    case 'settlement-growth': return 'Поселение развивается';
  }
}

function updateInspection(): void {
  const person = simulation.world.residents.find((candidate) => candidate.id === selectedResidentId);
  if (person) {
    selectionTitle.textContent = person.name;
    selectionDetail.textContent = `${roleLabel(person.role)} · ${modeLabel(person.mode)}${person.cargo ? ` · несёт ${person.cargo === 'wood' ? 'дерево' : 'камень'}` : ''}`;
    residentTask.textContent = person.blockedReason ? `Ожидание: ${person.blockedReason}` : person.task;
    residentActions.hidden = false;
    worldActions.hidden = true;
    woodSourceControls.hidden = person.role !== 'woodcutter';
    $('wood-source-home').classList.toggle('active', person.woodSource === 'home');
    $('wood-source-eastern').classList.toggle('active', person.woodSource === 'eastern');
    ($('wood-source-eastern') as HTMLButtonElement).disabled =
      simulation.world.easternSector.state !== 'prepared';
    $('wood-source-eastern').title = simulation.world.easternSector.state === 'prepared'
      ? 'Назначить добычу на Восточной опушке'
      : 'Сначала открой и подготовь Восточную опушку';
    document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) =>
      button.classList.toggle('active', button.dataset.role === person.role));
    return;
  }
  residentActions.hidden = true;
  woodSourceControls.hidden = true;
  worldActions.hidden = true;
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) => button.classList.remove('active'));
  if (currentInspection === 'wood') {
    selectionTitle.textContent = 'Лесной участок';
    selectionDetail.textContent = `${simulation.world.woodSource} / ${PROTOTYPE_CONFIG.sourceRecovery.homeWoodCapacity} единиц дерева. Базовый запас медленно восстанавливается. Назначь лесоруба: он сам добудет и доставит брёвна.`;
  } else if (currentInspection === 'stone') {
    selectionTitle.textContent = 'Каменный выход';
    selectionDetail.textContent = `${simulation.world.stoneSource} / ${PROTOTYPE_CONFIG.sourceRecovery.stoneCapacity} единиц камня. Базовый запас медленно восстанавливается. Назначь каменщика для добычи и доставки.`;
  } else if (currentInspection === 'sector:eastern') {
    const sector = simulation.world.easternSector;
    const worker = simulation.world.residents.find((candidate) => candidate.id === sector.clearerId);
    const progress = Math.round(sector.clearingProgress * 100);
    selectionTitle.textContent = 'Восточная опушка';
    if (sector.state === 'closed') {
      const cost = PROTOTYPE_CONFIG.easternSector.unlockCost;
      const totals = simulation.totals();
      const hasHouse = simulation.world.buildings.some((building) => building.kind === 'house');
      const missing: string[] = [];
      if (totals.wood < cost.wood) missing.push(`дерево ${totals.wood}/${cost.wood}`);
      if (totals.stone < cost.stone) missing.push(`камень ${totals.stone}/${cost.stone}`);
      selectionDetail.textContent = `Соседняя земля видна за оградой. Открытие стоит ${cost.wood} дерева и ${cost.stone} камня` +
        `${hasHouse ? '' : '. Сначала построй первый дом'}` +
        `${missing.length ? `. На складах не хватает: ${missing.join(', ')}` : '. После открытия её ещё нужно расчистить'}.`;
    } else if (sector.state === 'unlocked') {
      selectionDetail.textContent = 'Земля уже принадлежит поселению, но строить и добывать здесь нельзя до физической расчистки.';
    } else if (sector.state === 'clearing') {
      const pauseText = sector.clearingPaused ? 'Работа приостановлена; частичный прогресс сохранён.' :
        worker?.mode === 'moving' ? `${worker.name} идёт к рабочему месту.` : `${worker?.name ?? 'Житель'} расчищает участок.`;
      selectionDetail.textContent = `${pauseText} Подготовлено ${progress}%. Для расчистки нужно около ${PROTOTYPE_CONFIG.easternSector.clearingWorkSeconds} секунд работы после прибытия.`;
    } else {
      selectionDetail.textContent = 'Земля подготовлена. Открыты две строительные площадки и новый лесной участок.';
    }
  } else if (currentInspection === 'forest:eastern') {
    const sector = simulation.world.easternSector;
    selectionTitle.textContent = 'Лес Восточной опушки';
    selectionDetail.textContent = sector.state === 'prepared'
      ? `Запас ${sector.woodStock}/${PROTOTYPE_CONFIG.easternSector.forestCapacity} брёвен. Лес медленно восстанавливается; лесоруб физически донесёт добычу до склада.`
      : 'Лес виден за границей, но рабочие не могут добывать его до завершения расчистки сектора.';
  } else if (currentInspection.startsWith('store:')) {
    const storeId = currentInspection.slice(6);
    const store = simulation.world.stores.find((candidate) => candidate.id === storeId);
    selectionTitle.textContent = 'Склад поселения';
    selectionDetail.textContent = store ? `Дерево ${store.wood} · камень ${store.stone} · вместимость ${store.wood + store.stone}/${store.capacity}. Грузы приходят сюда физически.` : 'Склад увеличивает общую вместимость хранения.';
  } else if (currentInspection.startsWith('building:')) {
    selectionTitle.textContent = 'Постройка';
    selectionDetail.textContent = simulation.world.buildings.some((building) => building.id === currentInspection.slice(9) && building.kind === 'house')
      ? 'Дом увеличивает вместимость жилья и приглашает нового жителя.' : 'Склад увеличивает общую вместимость ресурсов.';
  } else {
    selectionTitle.textContent = 'Три первых жителя';
    selectionDetail.textContent = 'Выбери жителя, назначь работу и наблюдай, как растёт поселение.';
  }
}

function renderWorldActions(): void {
  worldActionButtons.replaceChildren();
  if (panelMode !== 'details') {
    worldActions.hidden = true;
    return;
  }
  const buttonList = document.createElement('div');
  buttonList.className = 'world-action-list';
  const addNote = (text: string) => {
    const note = document.createElement('p');
    note.className = 'world-action-note';
    note.textContent = text;
    buttonList.append(note);
  };
  const addButton = (text: string, action: () => void, disabled = false, testId?: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inline-action-button world-action-button';
    button.textContent = text;
    button.disabled = disabled;
    if (testId) button.dataset.testid = testId;
    button.addEventListener('click', action);
    buttonList.append(button);
  };

  if (currentInspection === 'sector:eastern') {
    worldActions.hidden = false;
    const sector = simulation.world.easternSector;
    if (sector.state === 'closed') {
      const cost = PROTOTYPE_CONFIG.easternSector.unlockCost;
      const totals = simulation.totals();
      const hasHouse = simulation.world.buildings.some((building) => building.kind === 'house');
      const canAfford = totals.wood >= cost.wood && totals.stone >= cost.stone;
      addButton(
        `Открыть · ${cost.wood} дерева · ${cost.stone} камня`,
        () => {
          const result = simulation.unlockEasternSector();
          if (!result.ok) showToast(result.reason, 'error');
          updateUI();
        },
        !hasHouse || !canAfford,
        'unlock-eastern-sector'
      );
      if (!hasHouse) addNote('Доступно после первого дома.');
      else if (!canAfford) addNote('Материалы проверяются на действующих складах и не списываются частично.');
    } else if (sector.state === 'unlocked' || sector.state === 'clearing' && sector.clearingPaused) {
      const availableWorker = simulation.world.residents.some((person) =>
        (person.role === 'builder' || person.role === 'idle') && !person.cargo &&
        (person.mode === 'idle' || person.mode === 'blocked'));
      addButton(
        sector.state === 'unlocked' ? 'Назначить жителя на расчистку' : 'Возобновить расчистку',
        () => {
          const result = simulation.startEasternClearing();
          if (!result.ok) showToast(result.reason, 'error');
          updateUI();
        },
        !availableWorker,
        'start-eastern-clearing'
      );
      addNote(availableWorker
        ? 'Пойдёт существующий свободный строитель или житель без работы.'
        : 'Освободи строителя или назначь жителя без работы; прогресс не потеряется.');
    } else if (sector.state === 'clearing') {
      addButton(`Расчистка идёт · ${Math.round(sector.clearingProgress * 100)}%`, () => {}, true);
      addNote('Житель сначала физически дойдёт до участка; до прибытия прогресс не растёт.');
    } else {
      addButton('Перейти к строительству', () => {
        openPanel('build');
        updateUI();
      }, false, 'build-on-eastern-sector');
      addNote('Выбери дом или склад, затем одну из двух площадок на опушке.');
    }
  } else if (currentInspection === 'forest:eastern') {
    worldActions.hidden = false;
    if (simulation.world.easternSector.state !== 'prepared') {
      addButton('Лес закрыт до подготовки территории', () => {}, true, 'eastern-forest-unavailable');
      addNote('Рабочие не могут добывать этот лес раньше времени.');
    } else {
      addNote('Выбери жителя: он станет лесорубом этого участка и понесёт брёвна на склад.');
      for (const person of simulation.world.residents) {
        const assigned = person.role === 'woodcutter' && person.woodSource === 'eastern';
        addButton(
          assigned ? `${person.name} · уже назначен` : `${person.name} · ${roleLabel(person.role)}`,
          () => {
            simulation.assign(person.id, 'woodcutter');
            const result = simulation.setWoodSource(person.id, 'eastern');
            if (!result.ok) showToast(result.reason, 'error');
            updateUI();
          },
          assigned,
          `eastern-woodcutter-${person.id}`
        );
      }
    }
  }
  if (!worldActions.hidden) worldActionButtons.append(buttonList);
}

function updateUI(): void {
  const totals = simulation.totals();
  const signature = JSON.stringify({
    totals, selectedResidentId, currentInspection, placementKind, currentGoal: simulation.world.currentGoal,
    residents: simulation.world.residents.map((person) => [
      person.id, person.role, person.mode, person.task, person.blockedReason, person.cargo, person.woodSource
    ]),
    sites: simulation.world.sites.map((site) => [
      site.id, Math.floor(site.progress * 10), site.deliveredWood, site.deliveredStone
    ]),
    buildings: simulation.world.buildings.map((building) => [building.id, building.kind]),
    sources: [
      simulation.world.woodSource, simulation.world.stoneSource,
      simulation.world.easternSector.woodStock
    ],
    easternSector: [
      simulation.world.easternSector.state,
      Math.floor(simulation.world.easternSector.clearingProgress * 20),
      simulation.world.easternSector.clearingPaused,
      simulation.world.easternSector.clearerId
    ]
  });
  if (signature === lastUiSignature) return;
  lastUiSignature = signature;
  woodTotal.textContent = String(totals.wood);
  stoneTotal.textContent = String(totals.stone);
  peopleTotal.textContent = `${totals.population} / ${totals.housing}`;
  capacityTotal.textContent = `${totals.stored} / ${totals.capacity}`;
  goalChip.innerHTML = `<i></i> ${goalText()}`;
  workersLabel.textContent = `${totals.population} ${totals.population === 1 ? 'человек' : 'человека'}`;
  sitesLabel.textContent = `${simulation.world.sites.length} ${simulation.world.sites.length === 1 ? 'площадка' : 'площадки'}`;
  updateInspection();
  renderWorldActions();

  residentList.replaceChildren(...simulation.world.residents.map((person) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `resident-row${person.id === selectedResidentId ? ' selected' : ''}`;
    row.setAttribute('aria-label', `${person.name}: ${roleLabel(person.role)}, ${modeLabel(person.mode)}`);
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    const image = document.createElement('img');
    image.src = `${import.meta.env.BASE_URL}assets/peace-v2/worker_idle.png`;
    image.alt = '';
    avatar.append(image);
    const meta = document.createElement('span');
    meta.className = 'resident-meta';
    const name = document.createElement('strong');
    name.textContent = person.name;
    const role = document.createElement('small');
    role.textContent = roleLabel(person.role);
    meta.append(name, role);
    const state = document.createElement('span');
    state.className = 'resident-state';
    state.textContent = person.mode === 'blocked' ? 'ждёт' : person.mode === 'building' ? 'строит' :
      person.cargo ? 'несёт груз' : person.mode === 'moving' ? 'в пути' : '';
    row.append(avatar, meta, state);
    row.addEventListener('click', () => selectResident(person.id));
    return row;
  }));

  const siteRows = simulation.world.sites.map((site) => {
    const row = document.createElement('div');
    row.className = 'building-row';
    const title = document.createElement('span');
    const kind = site.kind === 'house' ? 'Дом' : 'Склад';
    title.textContent = `${kind} · фундамент ${Math.round(site.progress * 100)}%`;
    const status = document.createElement('small');
    const builders = simulation.world.residents.filter((person) => person.role === 'builder').length;
    status.textContent = builders === 0 ? 'нужен строитель' : `${site.deliveredWood}🪵 · ${site.deliveredStone}◈`;
    row.append(title, status);
    return row;
  });
  const completeRows = simulation.world.buildings.map((building) => {
    const row = document.createElement('div');
    row.className = 'building-row';
    const label = document.createElement('span');
    label.textContent = building.kind === 'house' ? 'Готовый дом' : 'Дополнительный склад';
    const detail = document.createElement('small');
    detail.textContent = building.kind === 'house' ? '+1 место жилья' : '+12 к складу';
    row.append(label, detail);
    return row;
  });
  buildingList.replaceChildren(...siteRows, ...completeRows);
  if (siteRows.length + completeRows.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = 'Пока нет строек. Выбери здание и поставь площадку.';
    buildingList.append(note);
  }
}

function persistWorld(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(simulation.world));
    saveStatus.textContent = 'Прогресс сохранён';
  } catch {
    saveStatus.textContent = 'Не удалось сохранить';
  }
}

let lastFrame = performance.now();
let lastUiUpdate = 0;
function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (document.visibilityState !== 'visible') {
    requestAnimationFrame(frame);
    return;
  }
  simulation.step(dt);
  dirty = true;
  if (now - lastUiUpdate > 350) {
    updateUI();
    lastUiUpdate = now;
  }
  if (dirty && now - lastSaveAt > 900) {
    persistWorld();
    lastSaveAt = now;
    dirty = false;
  }
  requestAnimationFrame(frame);
}
updateUI();
if (saved) showToast('Поселение восстановлено из сохранения.');
else showToast('Назначь Илью лесорубом, затем выбери каменщика и строителя.');
requestAnimationFrame(frame);

window.addEventListener('beforeunload', persistWorld);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistWorld();
});
