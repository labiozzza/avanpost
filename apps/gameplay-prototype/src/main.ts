import Phaser from 'phaser';
import './style.css';
import { absenceText, catchUpSettlement } from './offline-progress.js';
import { registerSW } from 'virtual:pwa-register';
import {
  createNewWorld, demolitionRefund, parseSavedWorld, PrototypeSimulation, STORAGE_KEY, ECONOMY_VERSION, costOf,
  modeLabel, roleLabel, PROTOTYPE_CONFIG, landCellNumber, productionPriorityLabel, BUILDING_FOOTPRINTS,
  resourceLabel, resourceLabelGenitive, type BuildingKind, type WoodSourceId, type WorkRole, type LogisticsMode,
  type Resource, type PrototypeWorld
} from './simulation.js';
import { cellStateLabel, type GridMode } from './land-grid.js';
import { FEATURES } from './features.js';
import { PrototypeScene } from './scene.js';
import { NotificationQueue, type NotificationPriority } from './notifications.js';
import { MAX_SAVE_EXPORT_BYTES, parseSaveExport, serializeSaveExport, type SaveExport } from './save-transfer.js';
import { RuntimeDiagnostics, safeErrorFrames, safeErrorType } from './runtime-diagnostics.js';

document.documentElement.dataset.build = __APP_BUILD_ID__;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Prototype UI is missing #${id}`);
  return element as T;
};

const woodTotal = $('wood-total');
const oreTotal = $('ore-total');
const peopleTotal = $('people-total');
const capacityTotal = $('capacity-total');
const goalChip = $('goal-chip');
const selectionTitle = $('selection-title');
const selectionDetail = $('selection-detail');
const residentActions = $('resident-actions');
const residentTask = $('resident-task');
const logisticsControls = $('logistics-controls');
const logisticsUseHauler = $('logistics-use-hauler') as HTMLButtonElement;
const logisticsIndependent = $('logistics-independent') as HTMLButtonElement;
const haulerQueue = $('hauler-queue');
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
const importSaveDialog = $('import-save-dialog') as HTMLDialogElement;
const saveRecoveryDialog = $('save-recovery-dialog') as HTMLDialogElement;
const importSaveFile = $('import-save-file') as HTMLInputElement;
const demolitionDialog = $('demolition-dialog') as HTMLDialogElement;
const roadRemovalDialog = $('road-removal-dialog') as HTMLDialogElement;
const buildRoadButton = $('build-road') as HTMLButtonElement;
buildRoadButton.hidden = !FEATURES.roadsEnabled;
roadRemovalDialog.hidden = !FEATURES.roadsEnabled;
const cancelSiteDialog = $('cancel-site-dialog') as HTMLDialogElement;
const demolitionConfirmDetails = $('demolition-confirm-details');
const cancelSiteDetails = $('cancel-site-details');
const confirmDemolitionButton = $('confirm-demolition') as HTMLButtonElement;
const confirmCancelSiteButton = $('confirm-cancel-site') as HTMLButtonElement;
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

let rawSave: string | null = null;
let localStorageReadFailed = false;
try { rawSave = localStorage.getItem(STORAGE_KEY); }
catch { localStorageReadFailed = true; }
const saved = parseSavedWorld(rawSave);
let saveNeedsRecovery = localStorageReadFailed || Boolean(rawSave && !saved);
if (saved && rawSave && JSON.parse(rawSave).economyVersion !== ECONOMY_VERSION) {
  // Keep the owner's exact pre-migration save as an additional recovery copy.
  const backupKey = `${STORAGE_KEY}:before-economy-v${ECONOMY_VERSION}`;
  try { if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, rawSave); }
  catch { /* A full storage quota must not prevent loading the original save. */ }
}
const runtimeDiagnostics = new RuntimeDiagnostics();
const simulation = new PrototypeSimulation(saved ?? createNewWorld(), (message) => {
  if (message) showToast(message);
  dirty = true;
});
let selectedResidentId: string | null = null;
let placementKind: BuildingKind | null = null;
let selectedPlotId: number | null = null;
let roadPlacementMode = false;
let selectedRoadX: number | null = null;
type PanelMode = 'resident' | 'residents' | 'build' | 'details' | 'menu' | null;
let panelMode: PanelMode = null;
let dirty = true;
let lastSaveAt = 0;
let currentInspection = '';
let pendingDemolitionBuildingId: string | null = null;
let pendingRoadId: string | null = null;
let pendingSiteId: string | null = null;
let pendingSaveImport: SaveExport | null = null;
let recoveryImportPicker = false;
let lastUiSignature = '';
let game!: Phaser.Game;
let focusResidentCamera: (id: string) => void = () => {};
let setResidentCameraPresentation: (expanded: boolean) => void = () => {};
let fatalRuntime = false;
let frameScheduled = false;
let lastRoleSwitch: { residentId: string; role: WorkRole; at: number } | null = null;
let runtimeRecoveryDialog: HTMLDialogElement | null = null;
let runtimeRecoveryStatus: HTMLElement | null = null;

window.addEventListener('error', (event) => {
  runtimeDiagnostics.record({ type: 'uncaught-error', errorType: safeErrorType(event.error),
    frames: safeErrorFrames(event.error), loopScheduled: frameScheduled, operation: 'global-handler' });
});
window.addEventListener('unhandledrejection', (event) => {
  runtimeDiagnostics.record({ type: 'unhandled-rejection', errorType: safeErrorType(event.reason),
    frames: safeErrorFrames(event.reason), loopScheduled: frameScheduled, operation: 'promise-rejection' });
});
window.addEventListener('avanpost:phaser-error', (event) => {
  const errorType = (event as CustomEvent<{ errorType?: unknown }>).detail?.errorType;
  runtimeDiagnostics.record({ type: 'phaser-error', errorType: typeof errorType === 'string' ? errorType : 'Error',
    loopScheduled: frameScheduled, operation: 'phaser-scene' });
  showRuntimeRecovery('scene-error');
});

if (typeof PerformanceObserver !== 'undefined') {
  try {
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (entry.duration >= 50) runtimeDiagnostics.record({ type: 'slow-operation', durationMs: entry.duration,
          loopScheduled: frameScheduled, operation: 'browser-main-thread' });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch { /* The Long Tasks API is not implemented by every browser. */ }
}

function showRuntimeRecovery(reason: 'simulation-error' | 'ui-error' | 'scene-error'): void {
  if (fatalRuntime) return;
  fatalRuntime = true;
  const dialog = runtimeRecoveryDialog ?? document.createElement('dialog');
  runtimeRecoveryDialog = dialog;
  dialog.oncancel = (event) => event.preventDefault();
  dialog.setAttribute('aria-labelledby', 'runtime-recovery-title');
  Object.assign(dialog.style, {
    width: 'min(92vw, 480px)', border: '1px solid #9e8060', borderRadius: '14px',
    padding: '24px', color: '#20352c', background: '#f4f0e6', boxShadow: '0 20px 80px #0008', zIndex: '10000'
  });
  if (!dialog.isConnected) document.body.append(dialog);
  dialog.replaceChildren();
  const title = document.createElement('h2');
  title.id = 'runtime-recovery-title';
  title.textContent = 'Игра приостановлена для сохранения данных';
  const detail = document.createElement('p');
  detail.textContent = reason === 'scene-error'
    ? 'Сцена не смогла обновиться. Сохранение осталось нетронутым.'
    : reason === 'ui-error'
      ? 'Интерфейс остановил текущий кадр. Сохранение осталось нетронутым.'
      : 'Симуляция остановила текущий кадр. Сохранение осталось нетронутым.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  runtimeRecoveryStatus = status;
  const saveCopy = document.createElement('button');
  saveCopy.type = 'button';
  saveCopy.textContent = 'Скачать текущую копию';
  saveCopy.addEventListener('click', () => {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(simulation.world)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `avanpost-recovery-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status.textContent = 'Копия текущего поселения подготовлена.';
    } catch {
      status.textContent = 'Не удалось подготовить копию текущего состояния.';
    }
  });
  const exportLog = document.createElement('button');
  exportLog.type = 'button';
  exportLog.textContent = 'Скачать журнал диагностики';
  exportLog.addEventListener('click', () => {
    void exportRuntimeDiagnostics().then((ok) => {
      if (runtimeRecoveryStatus) runtimeRecoveryStatus.textContent = ok
        ? 'Обезличенный журнал диагностики подготовлен.' : 'Не удалось подготовить журнал диагностики.';
    });
  });
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Повторить запуск из последнего сохранения';
  retry.addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const restored = parseSavedWorld(raw);
      if (!restored) throw new Error('No recoverable saved world');
      simulation.replaceWorld(restored);
      selectedResidentId = null;
      currentInspection = '';
      fatalRuntime = false;
      game.scene.stop('GameplayPrototype');
      game.scene.start('GameplayPrototype');
      lastFrame = performance.now();
      lastUiUpdate = 0;
      updateUI();
      dialog.close();
      scheduleFrame();
      void resumeSettlement();
    } catch {
      status.textContent = 'Последнее сохранение не изменено, но его не удалось открыть. Скачайте текущую копию.';
      fatalRuntime = true;
    }
  });
  dialog.append(title, detail, saveCopy, exportLog, retry, status);
  if (!dialog.open) {
    try { dialog.showModal(); }
    catch { dialog.setAttribute('open', ''); }
  }
}

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
  roadPlacementMode = false;
  selectedPlotId = null;
  selectedRoadX = null;
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
  // Reopening the same inspection must restore its contextual actions even
  // when the simulation itself has not changed since the panel was closed.
  lastUiSignature = '';
  panelMode = mode;
  controlPanel.hidden = false;
  residentActions.hidden = mode !== 'resident';
  residentListSection.hidden = mode !== 'residents';
  buildingListSection.hidden = mode !== 'details' && mode !== 'build';
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
    selectionDetail.textContent = 'Выбери дом или склад.';
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

const legacyGridPreference = localStorage.getItem(`${STORAGE_KEY}:grid`) === 'true';
const savedGridMode = localStorage.getItem(`${STORAGE_KEY}:grid-mode`);
let gridMode: GridMode = savedGridMode === 'borders' || savedGridMode === 'planning'
  ? savedGridMode : legacyGridPreference ? 'planning' : 'off';
const gridButton = $('grid-button') as HTMLButtonElement;
const gridModeText: Record<GridMode, string> = {
  off: 'Сетка: выкл.', borders: 'Сетка: границы', planning: 'Сетка: планирование'
};
function renderGridButton(): void {
  gridButton.textContent = gridModeText[gridMode];
  gridButton.dataset.mode = gridMode;
  gridButton.setAttribute('aria-pressed', String(gridMode !== 'off'));
  gridButton.setAttribute('aria-label', `Режим сетки: ${gridModeText[gridMode].replace('Сетка: ', '')}`);
  gridButton.title = 'Нажмите, чтобы переключить: выключена → границы → планирование';
}
renderGridButton();
gridButton.addEventListener('click', () => {
  gridMode = gridMode === 'off' ? 'borders' : gridMode === 'borders' ? 'planning' : 'off';
  localStorage.setItem(`${STORAGE_KEY}:grid-mode`, gridMode);
  renderGridButton();
});

const scene = new PrototypeScene(simulation, {
  onResident: selectResident,
  onPlot: (plotId) => {
    if (!placementKind) return;
    selectedPlotId = plotId;
    selectedRoadX = null;
    openPanel('build');
    updateUI();
  },
  onRoadPosition: (worldX) => {
    if (!FEATURES.roadsEnabled || !roadPlacementMode) return;
    selectedPlotId = null;
    selectedRoadX = worldX;
    openPanel('build');
    updateUI();
  },
  onObject: (kind, id) => {
    selectedResidentId = null;
    currentInspection = kind === 'wood' ? id ? `tree:${id}` : 'wood' : kind === 'ore' ? 'ore' : kind === 'cell' ? `cell:${id ?? ''}` :
      kind === 'stockpile' ? `pile:${id ?? ''}` :
      kind === 'eastern-forest' ? 'forest:eastern' : kind === 'sector' ? `sector:${id ?? ''}` :
        `${kind}:${id ?? ''}`;
    openPanel('details');
    updateUI();
  },
  isSelected: (id) => selectedResidentId === id,
  isPlacing: () => placementKind !== null || FEATURES.roadsEnabled && roadPlacementMode,
  getGridMode: () => gridMode,
  getPreviewPlotId: () => selectedPlotId,
  getPlacementKind: () => placementKind ?? (FEATURES.roadsEnabled && roadPlacementMode ? 'road' : null),
  getPreviewFootprint: () => BUILDING_FOOTPRINTS[placementKind ?? 'house'],
  getRoadPreviewX: () => selectedRoadX === null ? null : simulation.roadPositionAt(selectedRoadX) ?? selectedRoadX,
  getRoadPreviewError: () => selectedRoadX === null ? null : simulation.roadPlacementError(selectedRoadX),
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

let gameResizeFrame = 0;
const resizeGameToViewport = () => {
  cancelAnimationFrame(gameResizeFrame);
  gameResizeFrame = requestAnimationFrame(() => {
    const bounds = $('world-scene').getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (game.scale.width !== width || game.scale.height !== height) game.scale.resize(width, height);
  });
};
const gameResizeObserver = new ResizeObserver(resizeGameToViewport);
gameResizeObserver.observe($('world-scene'));
window.addEventListener('resize', resizeGameToViewport, { passive: true });
window.addEventListener('orientationchange', () => window.setTimeout(resizeGameToViewport, 80), { passive: true });
window.visualViewport?.addEventListener('resize', resizeGameToViewport, { passive: true });
resizeGameToViewport();

document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) => {
  button.addEventListener('click', () => {
    const person = simulation.world.residents.find((candidate) => candidate.id === selectedResidentId);
    if (!person) { showToast('Сначала выбери жителя на карте или в списке.', 'error'); return; }
    const role = button.dataset.role as WorkRole;
    const roleBefore = person.role;
    const modeBefore = person.mode;
    const requestBefore = simulation.world.logisticsRequests.find((request) =>
      request.id === person.logisticsRequestId);
    const startedAt = performance.now();
    let assigned = false;
    try { assigned = simulation.assign(person.id, role); }
    catch (error) {
      runtimeDiagnostics.record({ type: 'role-switch-error', roleBefore, roleAfter: role, modeBefore,
        requestStatusBefore: requestBefore?.status, errorType: safeErrorType(error), frames: safeErrorFrames(error),
        loopScheduled: frameScheduled,
        operation: 'role-switch' });
      showRuntimeRecovery('simulation-error');
      return;
    }
    if (!assigned) return;
    const durationMs = performance.now() - startedAt;
    const now = performance.now();
    const repeated = lastRoleSwitch?.residentId === person.id && lastRoleSwitch.role === role && now - lastRoleSwitch.at < 300;
    const rapidSwitch = lastRoleSwitch !== null && now - lastRoleSwitch.at < 180;
    lastRoleSwitch = { residentId: person.id, role, at: now };
    const requestAfter = simulation.world.logisticsRequests.find((request) =>
      request.id === person.logisticsRequestId);
    runtimeDiagnostics.record({ type: repeated ? 'repeated-handler' : 'role-switch', roleBefore, roleAfter: role,
      mode: person.mode, modeBefore, requestStatus: requestAfter?.status,
      requestStatusBefore: requestBefore?.status, durationMs, loopScheduled: frameScheduled, rapid: rapidSwitch,
      operation: repeated ? 'role-switch-handler' : 'role-switch' });
    if (durationMs >= 50) runtimeDiagnostics.record({ type: 'slow-operation', durationMs,
      loopScheduled: frameScheduled, operation: 'role-switch' });
    inspectRuntimeInvariants('role-switch');
    const savedImmediately = persistWorld();
    lastSaveAt = performance.now();
    dirty = !savedImmediately;
    if (!savedImmediately) showToast('Профессия изменена, но сохранение не записалось. Проверьте место в хранилище браузера.', 'error');
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
$('logistics-use-hauler').addEventListener('click', () => setSelectedLogisticsMode('hauler'));
$('logistics-independent').addEventListener('click', () => setSelectedLogisticsMode('independent'));

function setSelectedLogisticsMode(mode: LogisticsMode): void {
  const person = simulation.world.residents.find((candidate) => candidate.id === selectedResidentId);
  if (!person) return;
  if (!simulation.setLogisticsMode(person.id, mode)) return;
  updateUI();
}
$('wood-source-home').addEventListener('click', () => setSelectedWoodSource('home'));
$('wood-source-eastern').addEventListener('click', () => setSelectedWoodSource('eastern'));

function startPlacement(kind: BuildingKind): void {
  roadPlacementMode = false;
  selectedRoadX = null;
  placementKind = placementKind === kind ? null : kind;
  selectedPlotId = null;
  selectedResidentId = null;
  currentInspection = '';
  $('build-house').classList.toggle('active', placementKind === 'house');
  $('build-warehouse').classList.toggle('active', placementKind === 'warehouse');
  $('build-sawmill').classList.toggle('active', placementKind === 'sawmill');
  $('build-mine').classList.toggle('active', placementKind === 'mine');
  $('build-road').classList.remove('active');
  placementBanner.hidden = placementKind === null;
  if (placementKind) {
    placementLabel.textContent = `Коснись площадки · ${placementKind === 'house' ? 'дом' : placementKind === 'sawmill' ? 'лесопилка 2×1' : placementKind === 'mine' ? 'шахта' : 'склад'}`;
    closePanel();
  }
  placementHelp.textContent = placementKind
    ? `Коснись свободной отмеченной площадки. Свайп перемещает карту.`
    : 'Выбери здание, затем подходящее место на карте.';
  if (!placementKind) placementBanner.hidden = true;
  if (placementKind) showToast('Выбери свободную отмеченную площадку на карте.');
  updateUI();
}

function startRoadPlacement(): void {
  if (!FEATURES.roadsEnabled) return;
  const enabling = !roadPlacementMode;
  placementKind = null;
  selectedPlotId = null;
  selectedRoadX = null;
  roadPlacementMode = enabling;
  selectedResidentId = null;
  currentInspection = '';
  $('build-house').classList.remove('active');
  $('build-warehouse').classList.remove('active');
  $('build-sawmill').classList.remove('active');
  $('build-mine').classList.remove('active');
  $('build-road').classList.toggle('active', roadPlacementMode);
  placementBanner.hidden = !roadPlacementMode;
  if (roadPlacementMode) {
    placementLabel.textContent = 'Коснись освоенной поверхности · дорога';
    placementHelp.textContent = 'Материалы доставляются жителями. Дорога проходит перед зданиями и не занимает строительную клетку.';
    closePanel();
    showToast('Выбери освоенный участок поверхности для дорожного сегмента.');
  }
  updateUI();
}

function cancelPlacement(): void {
  placementKind = null;
  roadPlacementMode = false;
  selectedPlotId = null;
  selectedRoadX = null;
  placementBanner.hidden = true;
  $('build-house').classList.remove('active');
  $('build-warehouse').classList.remove('active');
  $('build-sawmill').classList.remove('active');
  $('build-mine').classList.remove('active');
  $('build-road').classList.remove('active');
  updateUI();
}

function confirmPlacement(): void {
  if (roadPlacementMode && !FEATURES.roadsEnabled) {
    roadPlacementMode = false;
    selectedRoadX = null;
    updateUI();
    return;
  }
  if (roadPlacementMode) {
    if (selectedRoadX === null) return;
    const result = simulation.placeRoad(selectedRoadX);
    if (!result.ok) { showToast(result.reason, 'error'); updateUI(); return; }
    selectedRoadX = null;
    closePanel();
    updateUI();
    persistWorld();
    return;
  }
  if (!placementKind || selectedPlotId === null) return;
  const kind = placementKind;
  const plotId = selectedPlotId;
  const result = simulation.place(kind, plotId);
  if (!result.ok) { showToast(result.reason, 'error'); return; }
  placementKind = null;
  selectedPlotId = null;
  $('build-house').classList.remove('active');
  $('build-warehouse').classList.remove('active');
  $('build-sawmill').classList.remove('active');
  $('build-mine').classList.remove('active');
  placementBanner.hidden = true;
  closePanel();
  updateUI();
  // Building placement is a committed player action. Persist it immediately
  // so a background/clock transition cannot leave the canvas ahead of the save.
  persistWorld();
}
$('confirm-placement').addEventListener('click', confirmPlacement);
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
$('build-sawmill').addEventListener('click', () => startPlacement('sawmill'));
$('build-mine').addEventListener('click', () => startPlacement('mine'));
$('build-road').addEventListener('click', startRoadPlacement);
$('cancel-placement').addEventListener('click', cancelPlacement);

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

async function shareOrDownloadJson(contents: string, fileName: string, title: string): Promise<void> {
  const file = new File([contents], fileName, { type: 'application/json' });
  const canShareFile = typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (canShareFile) {
    try { await navigator.share({ title, files: [file] }); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function exportRuntimeDiagnostics(): Promise<boolean> {
  try {
    await shareOrDownloadJson(JSON.stringify(runtimeDiagnostics.snapshot(), null, 2),
      'avanpost-runtime-diagnostics.json', 'Диагностика AVANPOST');
    showToast('Обезличенный журнал диагностики подготовлен.');
    return true;
  } catch {
    showToast('Не удалось подготовить журнал диагностики.', 'error');
    return false;
  }
}

async function exportCurrentSave(): Promise<void> {
  if (saveNeedsRecovery) {
    showToast('Сначала восстановите или явно замените нераспознанное сохранение.', 'error');
    return;
  }
  try {
    persistWorld();
    const contents = serializeSaveExport(simulation.world, gridMode);
    const date = new Date().toISOString().slice(0, 10);
    await shareOrDownloadJson(contents, `avanpost-save-${date}.json`, 'Резервная копия AVANPOST');
    showToast('Экспорт сохранения подготовлен.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Не удалось экспортировать сохранение.', 'error');
  }
}

function showSaveRecovery(): void {
  if (localStorageReadFailed) {
    $('save-recovery-title').textContent = 'Сохранение недоступно';
    saveRecoveryDialog.querySelector('p')!.textContent =
      'Браузер не разрешил прочитать хранилище. Игра не заменит данные автоматически; проверьте настройки хранения и импортируйте резервную копию.';
    ($('export-raw-save') as HTMLButtonElement).disabled = true;
  }
  if (!saveRecoveryDialog.open) saveRecoveryDialog.showModal();
}

function replaceSettlement(world: PrototypeWorld, importedGridMode: GridMode, message: string): boolean {
  if (catchingUp) {
    showToast('Дождитесь завершения восстановления поселения.', 'error');
    return false;
  }
  try {
    const validated = parseSavedWorld(JSON.stringify(world));
    if (!validated) throw new Error('Сохранение не прошло проверку структуры.');
    const preparedWorld = new PrototypeSimulation(validated).world;
    const serialized = JSON.stringify(preparedWorld);
    // One atomic replacement keeps the existing origin key present throughout the action.
    localStorage.setItem(STORAGE_KEY, serialized);
    simulation.replaceWorld(preparedWorld);
    rawSave = serialized;
    saveNeedsRecovery = false;
    localStorageReadFailed = false;
    gridMode = importedGridMode;
    try { localStorage.setItem(`${STORAGE_KEY}:grid-mode`, gridMode); }
    catch { /* The settlement save takes priority over its optional display preference. */ }
    renderGridButton();
    selectedResidentId = null;
    currentInspection = '';
    placementKind = null;
    roadPlacementMode = false;
    selectedPlotId = null;
    selectedRoadX = null;
    forestWayfinderDismissed = false;
    placementBanner.hidden = true;
    $('absence-report').hidden = true;
    dirty = false;
    lastSaveAt = performance.now();
    if (saveRecoveryDialog.open) saveRecoveryDialog.close();
    if (newGameDialog.open) newGameDialog.close();
    game.scene.stop('GameplayPrototype');
    game.scene.start('GameplayPrototype');
    closePanel();
    updateUI();
    persistWorld();
    lastFrame = performance.now();
    showToast(message);
    void resumeSettlement();
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Сохранение не заменено.', 'error');
    return false;
  }
}

async function readImportFile(file: File): Promise<void> {
  try {
    if (file.size > MAX_SAVE_EXPORT_BYTES) throw new Error('Файл сохранения слишком большой.');
    pendingSaveImport = parseSaveExport(await file.text());
    const exportedAt = new Date(pendingSaveImport.exportedAt).toLocaleString();
    $('import-save-details').textContent =
      `${file.name} · создан ${exportedAt} · жителей: ${pendingSaveImport.world.residents.length}.`;
    importSaveDialog.showModal();
  } catch (error) {
    pendingSaveImport = null;
    showToast(error instanceof Error ? error.message : 'Файл сохранения не прошёл проверку.', 'error');
    if (saveNeedsRecovery && recoveryImportPicker && !saveRecoveryDialog.open) showSaveRecovery();
  }
}

function openImportPicker(fromRecovery: boolean): void {
  recoveryImportPicker = fromRecovery;
  importSaveFile.value = '';
  if (fromRecovery && saveRecoveryDialog.open) saveRecoveryDialog.close();
  importSaveFile.click();
}

$('export-save').addEventListener('click', () => { void exportCurrentSave(); });
$('export-runtime-diagnostics').addEventListener('click', () => { void exportRuntimeDiagnostics(); });
$('import-save').addEventListener('click', () => openImportPicker(false));
$('import-recovery-save').addEventListener('click', () => openImportPicker(true));
importSaveFile.addEventListener('change', () => {
  const file = importSaveFile.files?.[0];
  const fromRecovery = recoveryImportPicker;
  recoveryImportPicker = false;
  if (file) void readImportFile(file);
  else if (fromRecovery && saveNeedsRecovery) showSaveRecovery();
});
importSaveFile.addEventListener('cancel', () => {
  if (recoveryImportPicker && saveNeedsRecovery) showSaveRecovery();
  recoveryImportPicker = false;
});
$('confirm-import-save').addEventListener('click', () => {
  const imported = pendingSaveImport;
  if (!imported) return;
  if (replaceSettlement(imported.world, imported.gridMode, 'Сохранение восстановлено из JSON-файла.')) {
    pendingSaveImport = null;
    importSaveDialog.close();
  }
});
importSaveDialog.addEventListener('close', () => {
  pendingSaveImport = null;
  if (saveNeedsRecovery) window.setTimeout(showSaveRecovery, 0);
});
$('export-raw-save').addEventListener('click', () => {
  if (!rawSave) {
    showToast('Исходное сохранение нельзя прочитать и экспортировать.', 'error');
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  void shareOrDownloadJson(rawSave, `avanpost-unreadable-save-${date}.json`, 'Исходные данные AVANPOST')
    .catch((error) => showToast(error instanceof Error ? error.message : 'Не удалось экспортировать данные.', 'error'));
});
$('replace-invalid-save').addEventListener('click', () => {
  if (saveRecoveryDialog.open) saveRecoveryDialog.close();
  newGameDialog.showModal();
});
window.addEventListener('avanpost:gameplay-ready', () => {
  if (saveNeedsRecovery) showSaveRecovery();
}, { once: true });

$('new-game').addEventListener('click', () => newGameDialog.showModal());
$('confirm-new-game').addEventListener('click', () => {
  const fresh = createNewWorld();
  replaceSettlement(fresh, 'off', 'Новое поселение создано после подтверждения.');
});
$('cancel-import-save').addEventListener('click', () => {
  pendingSaveImport = null;
});

function goalText(): string {
  switch (simulation.world.currentGoal) {
    case 'build-first-house': return 'Цель: построй первый дом';
    case 'increase-storage': return 'Следующая цель: увеличь вместимость склада';
    case 'unlock-eastern-sector': return 'Следующая цель: открой соседнюю клетку';
    case 'prepare-eastern-sector': return 'Следующая цель: расчисти одну клетку';
    case 'build-in-eastern-sector': return 'Следующая цель: построй здание на новой земле';
    case 'settlement-growth': return 'Поселение развивается';
  }
}

function updateInspection(): void {
  if (panelMode === 'build') {
    selectionTitle.textContent = 'Строительство';
    const confirmButton = $('confirm-placement') as HTMLButtonElement;
    confirmButton.hidden = roadPlacementMode ? selectedRoadX === null : placementKind === null || selectedPlotId === null;
    if (roadPlacementMode) {
      confirmButton.textContent = 'Поставить дорожный сегмент';
      if (selectedRoadX !== null) {
        const roadError = simulation.roadPlacementError(selectedRoadX);
        const roadCost = PROTOTYPE_CONFIG.roads.cost;
        selectionTitle.textContent = 'Предпросмотр: дорога';
        selectionDetail.textContent = `Участок ${Math.round(selectedRoadX)} · ${roadCost.wood} дерева · ` +
          `${roadCost.ore} породы · ${PROTOTYPE_CONFIG.roads.constructionSeconds} секунд работы. ` +
          (roadError ?? 'Подтверди сегмент; строитель принесёт материалы к месту работ.');
        $('placement-help').textContent = roadError ?? 'Путь ускорит только ту часть маршрута, которая проходит по построенному сегменту.';
        confirmButton.disabled = Boolean(roadError);
      } else {
        selectionDetail.textContent = 'Выбери освоенный участок поверхности. Дорога не занимает строительную клетку.';
        $('placement-help').textContent = 'Закрытый лес покажет причину блокировки до подтверждения; фундаменты не занимают дорожный слой.';
        confirmButton.disabled = true;
      }
    } else if (placementKind && selectedPlotId !== null) {
      confirmButton.textContent = 'Подтвердить размещение';
      const state = simulation.landCellState(selectedPlotId);
      const number = landCellNumber(selectedPlotId);
      const cost = costOf(placementKind);
      const footprint = BUILDING_FOOTPRINTS[placementKind];
      const plot = simulation.world.landCells.find((candidate) => candidate.id === selectedPlotId);
      const placement = plot
        ? simulation.canPlaceFootprint({ column: plot.column!, row: plot.row! }, footprint, placementKind)
        : { ok: false as const, reason: 'Выбери опорную клетку на поверхности.' };
      selectionTitle.textContent = `Предпросмотр: ${placementKind === 'house' ? 'дом' : placementKind === 'sawmill' ? 'лесопилка' : placementKind === 'mine' ? 'шахта' : 'склад'}`;
      selectionDetail.textContent = `Клетка ${number} · footprint ${footprint.widthCells}×${footprint.heightCells} · ${cellStateLabel(state ?? 'closed')} · ` +
        `стоимость ${cost.wood} древесины и ${cost.ore} породы` +
        (placement.ok ? '. Подтверди размещение, чтобы начать доставку.' : `. ${placement.reason}`);
      $('placement-help').textContent = placement.ok
        ? `Подсвечены все ${footprint.widthCells * footprint.heightCells} клетки footprint. Строительство начнётся только после подтверждения.`
        : placement.reason;
      confirmButton.disabled = !placement.ok;
      confirmButton.dataset.testid = 'confirm-placement';
    } else {
      confirmButton.textContent = 'Подтвердить размещение';
      selectionDetail.textContent = 'Выбери здание — одна клетка соответствует одной постройке.';
      $('placement-help').textContent = 'Выбери здание, затем коснись клетки для предпросмотра и подтверждения.';
      confirmButton.disabled = true;
    }
    return;
  }
  const confirmButton = $('confirm-placement') as HTMLButtonElement;
  confirmButton.hidden = true;
  confirmButton.textContent = 'Подтвердить размещение';
  if (panelMode === 'menu') {
    selectionTitle.textContent = 'Поселение';
    selectionDetail.textContent = 'Прогресс сохраняется на этом устройстве.';
    return;
  }
  if (panelMode === 'residents') {
    selectionTitle.textContent = 'Жители поселения';
    selectionDetail.textContent = 'Выбери жителя, чтобы назначить ему работу.';
    return;
  }
  const person = simulation.world.residents.find((candidate) => candidate.id === selectedResidentId);
  if (person) {
    selectionTitle.textContent = person.name;
    selectionDetail.textContent = `${roleLabel(person.role)} · ${modeLabel(person.mode)}${person.cargo ? ` · несёт ${person.cargoAmount} ед. ${resourceLabelGenitive(person.cargo)}` : ''}`;
    const diagnosis = simulation.residentDiagnosis(person);
    residentTask.textContent = [diagnosis.reason, diagnosis.resume].filter(Boolean).join('. ');
    residentTask.dataset.diagnosis = diagnosis.code;
    residentActions.hidden = false;
    worldActions.hidden = true;
    woodSourceControls.hidden = person.role !== 'woodcutter';
    logisticsControls.hidden = !['woodcutter', 'miner', 'builder'].includes(person.role);
    haulerQueue.hidden = person.role !== 'hauler';
    logisticsUseHauler.classList.toggle('active', person.logisticsMode === 'hauler');
    logisticsIndependent.classList.toggle('active', person.logisticsMode === 'independent');
    if (person.role === 'hauler') {
      const current = person.logisticsRequestId
        ? simulation.world.logisticsRequests.find((request) => request.id === person.logisticsRequestId)
        : undefined;
      const waiting = simulation.world.logisticsRequests.filter((request) =>
        request.status === 'queued' || request.status === 'blocked').length;
      const initiator = current ? simulation.world.residents.find((candidate) => candidate.id === current.initiatorId) : undefined;
      const destination = current?.destinationSiteId
        ? simulation.world.sites.find((site) => site.id === current.destinationSiteId)
        : current?.destinationStoreId
          ? simulation.world.stores.find((store) => store.id === current.destinationStoreId)
          : undefined;
      haulerQueue.textContent = current
        ? `В очереди: ${waiting}. Сейчас: ${initiator?.name ?? 'житель'} · ${current.amount} ед. ${resourceLabelGenitive(current.resource)} → ${destination ? current.destinationSiteId ? 'стройка' : 'склад' : 'назначение'}.`
        : `В очереди: ${waiting}. ${waiting ? 'Свободный грузчик возьмёт следующую заявку.' : 'Ожидает заявки от жителей.'}`;
    }
    $('wood-source-home').classList.toggle('active', person.woodSource === 'home');
    $('wood-source-eastern').classList.toggle('active', person.woodSource === 'eastern');
    ($('wood-source-eastern') as HTMLButtonElement).disabled =
      !simulation.hasEasternForest();
    $('wood-source-eastern').title = simulation.hasEasternForest()
      ? 'Назначить добычу на Восточной опушке'
      : 'Сначала открой и подготовь Восточную опушку';
    document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) =>
      button.classList.toggle('active', button.dataset.role === person.role));
    return;
  }
  residentActions.hidden = true;
  woodSourceControls.hidden = true;
  logisticsControls.hidden = true;
  haulerQueue.hidden = true;
  worldActions.hidden = true;
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) => button.classList.remove('active'));
  if (currentInspection.startsWith('tree:')) {
    const tree = simulation.world.trees.find((candidate) => candidate.id === currentInspection.slice(5));
    selectionTitle.textContent = tree?.planted ? 'Посаженное дерево' : 'Дерево';
    if (!tree) selectionDetail.textContent = 'Источник дерева уже удалён.';
    else {
      const progress = tree.state === 'growing'
        ? Math.round(tree.growthSeconds / (tree.planted ? PROTOTYPE_CONFIG.trees.initialGrowthSeconds : PROTOTYPE_CONFIG.trees.regrowthSeconds) * 100)
        : tree.state === 'mature' ? Math.round(tree.cutProgress / PROTOTYPE_CONFIG.trees.cuttingSeconds * 100) : 0;
      selectionDetail.textContent = tree.state === 'growing' ? `Растёт · ${progress}%. ${tree.planted ? 'Первый рост займёт около двух минут игрового времени.' : 'После рубки дерево быстро восстановится.'}`
        : tree.state === 'mature' ? `Взрослое дерево${tree.cutProgress ? ` · рубка ${progress}%` : ''}. Один цикл лесоруба даёт до 10 древесины.`
          : tree.state === 'falling' ? 'Падает после завершения цикла рубки.' : 'Пень быстро восстанавливается.';
    }
  } else if (currentInspection === 'wood') {
    selectionTitle.textContent = 'Лесной участок';
    const pile = simulation.world.stockpiles.find((candidate) => candidate.sourceId === 'home');
    const settings = simulation.world.productionSettings!;
    const tree = simulation.world.trees.find((candidate) => candidate.id === 'tree-home');
    selectionDetail.textContent = `Лесной источник · дерево ${tree?.state ?? 'недоступно'} · древесина у источника: ${pile?.amount ?? 0}/${pile?.capacity ?? PROTOTYPE_CONFIG.stockpile.capacity} · лимит ${settings.quota.wood} · приоритет перевозки ${productionPriorityLabel(settings.priority.wood)}.`;
  } else if (currentInspection === 'ore') {
    selectionTitle.textContent = 'Залежь породы';
    const pile = simulation.world.stockpiles.find((candidate) => candidate.sourceId === 'ore');
    const settings = simulation.world.productionSettings!;
    const mine = simulation.world.buildings.some((building) => building.kind === 'mine' && !building.demolition);
    selectionDetail.textContent = `${mine ? 'Бесконечный источник в шахте' : `Конечный запас ${simulation.world.oreSource}`} · местная куча: ${pile?.amount ?? 0}/${pile?.capacity ?? PROTOTYPE_CONFIG.stockpile.capacity} · лимит ${settings.quota.ore} · приоритет перевозки ${productionPriorityLabel(settings.priority.ore)}.`;
  } else if (currentInspection === 'sector:eastern') {
    const sector = simulation.world.easternSector;
    const worker = simulation.world.residents.find((candidate) => candidate.id === sector.clearerId);
    const progress = Math.round(sector.clearingProgress * 100);
    selectionTitle.textContent = 'Новая земля';
    if (sector.state === 'closed') {
      const cost = PROTOTYPE_CONFIG.expansion.unlockCost;
      const totals = { wood: simulation.availableInStores('wood'), ore: simulation.availableInStores('ore') };
      const hasHouse = simulation.world.buildings.some((building) => building.kind === 'house');
      const missing: string[] = [];
      if (totals.wood < cost.wood) missing.push(`древесина ${totals.wood}/${cost.wood}`);
      if (totals.ore < cost.ore) missing.push(`порода ${totals.ore}/${cost.ore}`);
      selectionDetail.textContent = `Одна соседняя земельная клетка стоит ${cost.wood} древесины и ${cost.ore} породы` +
        `${hasHouse ? '' : '. Сначала построй первый дом'}` +
        `${missing.length ? `. На складах не хватает: ${missing.join(', ')}` : '. После открытия её ещё нужно расчистить'}.`;
    } else if (sector.state === 'unlocked') {
      selectionDetail.textContent = 'Клетка открыта, но строить здесь нельзя до физической расчистки.';
    } else if (sector.state === 'clearing') {
      const pauseText = sector.clearingPaused ? 'Работа приостановлена; частичный прогресс сохранён.' :
        worker?.mode === 'moving' ? `${worker.name} идёт к рабочему месту.` : `${worker?.name ?? 'Житель'} расчищает участок.`;
      selectionDetail.textContent = `${pauseText} Подготовлено ${progress}%. Нужно около ${PROTOTYPE_CONFIG.expansion.clearingWorkSeconds} секунд работы после прибытия.`;
    } else {
      selectionDetail.textContent = 'Клетка подготовлена и даёт одну строительную площадку. Соседнюю клетку нужно открыть отдельно.';
    }
  } else if (currentInspection.startsWith('cell:')) {
    const id = Number(currentInspection.slice(5));
    const cell = simulation.world.landCells.find((candidate) => candidate.id === id);
    const worker = cell?.clearerId ? simulation.world.residents.find((candidate) => candidate.id === cell.clearerId) : undefined;
    const state = simulation.landCellState(id);
    const site = simulation.world.sites.find((candidate) => Math.abs(candidate.x - (cell?.x ?? Infinity)) < 1);
    const building = simulation.world.buildings.find((candidate) => Math.abs(candidate.x - (cell?.x ?? Infinity)) < 1);
    const tree = simulation.world.trees.find((candidate) => candidate.cellId === id);
    selectionTitle.textContent = cell ? `Земельная клетка ${landCellNumber(cell.id)}` : 'Земельная клетка';
    if (!cell) selectionDetail.textContent = 'Эта территория не входит в карту.';
    else if (state === 'closed') selectionDetail.textContent = `${cellStateLabel(state)}. Сначала открой и расчисти соседнюю клетку.`;
    else if (state === 'unlockable') {
      const cost = PROTOTYPE_CONFIG.expansion.unlockCost;
      const hasHouse = simulation.world.buildings.some((candidate) => candidate.kind === 'house');
      const missing = [
        simulation.availableInStores('wood') < cost.wood ? `древесина ${simulation.availableInStores('wood')}/${cost.wood}` : '',
        simulation.availableInStores('ore') < cost.ore ? `порода ${simulation.availableInStores('ore')}/${cost.ore}` : ''
      ].filter(Boolean);
      selectionDetail.textContent = `${cellStateLabel(state)} · открытие стоит ${cost.wood} древесины и ${cost.ore} породы. ` +
        `${hasHouse ? '' : 'Сначала построй первый дом. '}${missing.length ? `Не хватает: ${missing.join(', ')}.` : 'После открытия потребуется физическая расчистка.'}`;
    } else if (state === 'unlocked') selectionDetail.textContent = `${cellStateLabel(state)}. Назначь жителя, чтобы он физически расчистил землю.`;
    else if (state === 'clearing') selectionDetail.textContent = `${cell.clearingPaused ? 'Расчистка приостановлена.' : worker?.mode === 'moving' ? `${worker.name} идёт к участку.` : 'Житель расчищает участок.'} Прогресс ${Math.round(cell.clearingProgress * 100)}%.`;
    else if (state === 'construction' && site) selectionDetail.textContent = `Идёт строительство ${site.kind === 'house' ? 'дома' : site.kind === 'sawmill' ? 'лесопилки' : site.kind === 'mine' ? 'шахты' : site.kind === 'house-upgrade' ? 'улучшения дома' : 'склада'} · материалы ${site.deliveredWood}/${costOf(site.kind).wood} древесины, ${site.deliveredOre}/${costOf(site.kind).ore} породы · прогресс ${Math.round(site.progress * 100)}%.`;
    else if (state === 'occupied' && building) selectionDetail.textContent = `Занята: ${building.kind === 'house' ? 'дом' : building.kind === 'sawmill' ? 'лесопилка' : building.kind === 'mine' ? 'шахта' : 'склад'} · эта клетка уже содержит здание.`;
    else if (state === 'occupied' && tree) selectionDetail.textContent = `${tree.planted ? 'Посаженное дерево' : 'Природный источник древесины'} · ${tree.state === 'mature' ? 'взрослое' : tree.state === 'growing' ? 'растёт' : tree.state === 'falling' ? 'падает' : 'пень'}.`;
    else if (state === 'occupied') selectionDetail.textContent = 'Здесь находится природный участок; выбери свободную клетку.';
    else selectionDetail.textContent = `${cellStateLabel(state ?? 'closed')}. Здесь можно разместить одно здание или посадить дерево.`;
  } else if (currentInspection === 'forest:eastern') {
    const sector = simulation.world.easternSector;
    selectionTitle.textContent = 'Лес Восточной опушки';
    const trees = simulation.world.trees.filter((tree) => tree.sourceId === 'eastern');
    selectionDetail.textContent = sector.state === 'prepared'
      ? `Деревья: ${trees.filter((tree) => tree.state === 'mature').length} взрослых, ${trees.filter((tree) => tree.state !== 'mature').length} растут или восстанавливаются. Лесоруб добывает древесину циклами.`
      : 'Лес виден за границей, но рабочие не могут добывать его до завершения расчистки сектора.';
  } else if (currentInspection.startsWith('store:')) {
    const storeId = currentInspection.slice(6);
    const store = simulation.world.stores.find((candidate) => candidate.id === storeId);
    selectionTitle.textContent = 'Склад поселения';
    selectionDetail.textContent = store ? `Древесина ${store.wood} · порода ${store.ore} · вместимость ${store.wood + store.ore}/${store.capacity} · зарезервировано места для прибывающих грузов: ${simulation.reservedInboundStorage()}. Грузы приходят сюда физически.` : 'Склад увеличивает общую вместимость хранения.';
  } else if (currentInspection.startsWith('pile:')) {
    const pile = simulation.world.stockpiles.find((candidate) => candidate.id === currentInspection.slice(5));
    selectionTitle.textContent = pile?.sourceId === 'demolition' ? 'Материалы после сноса' : 'Материалы на земле';
    selectionDetail.textContent = pile
      ? `${resourceLabel(pile.resource)} · партия ${pile.amount} ед. на земле. Материал нужно физически забрать и доставить на склад.`
      : 'Эта куча уже вывезена.';
  } else if (currentInspection.startsWith('site:')) {
    const site = simulation.world.sites.find((candidate) => candidate.id === currentInspection.slice(5));
    selectionTitle.textContent = site?.kind === 'road' ? 'Строительство дороги' :
      site?.kind === 'house' ? 'Строительство дома' : site?.kind === 'sawmill' ? 'Строительство лесопилки' :
        site?.kind === 'house-upgrade' ? 'Улучшение дома до уровня 2' : 'Строительство склада';
    if (site) {
      const cost = costOf(site.kind);
      const priority = productionPriorityLabel(site.priority ?? 2);
      selectionDetail.textContent = `Материалы: ${site.deliveredWood + site.deliveredOre} / ${cost.wood + cost.ore}` +
        ` · древесина ${site.deliveredWood}/${cost.wood} · порода ${site.deliveredOre}/${cost.ore}. ` +
        `В резерве: ${simulation.reservedSiteMaterials(site.id, 'wood')} древесины и ${simulation.reservedSiteMaterials(site.id, 'ore')} породы. ` +
        `Строительство: ${Math.round(site.progress * 100)}% · приоритет ${priority}${site.paused ? ' · пауза' : ''}.`;
    } else selectionDetail.textContent = 'Строительство завершено.';
  } else if (FEATURES.roadsEnabled && currentInspection.startsWith('road:')) {
    const road = simulation.world.roads.find((candidate) => candidate.id === currentInspection.slice(5));
    selectionTitle.textContent = 'Дорожный сегмент';
    selectionDetail.textContent = road
      ? `Грунтовый участок · скорость по дороге ×${PROTOTYPE_CONFIG.roads.speedMultiplier}. ` +
        'Ускорение применяется только на отрезке маршрута, который проходит по этой дороге.'
      : 'Этот сегмент уже удалён.';
  } else if (currentInspection.startsWith('building:')) {
    const building = simulation.world.buildings.find((candidate) => candidate.id === currentInspection.slice(9));
    const store = building?.kind === 'warehouse'
      ? simulation.world.stores.find((candidate) => candidate.buildingId === building.id)
      : undefined;
    const demolition = building?.demolition;
    selectionTitle.textContent = 'Постройка';
    if (!building) selectionDetail.textContent = 'Здание больше не существует.';
    else if (demolition) {
      const worker = demolition.workerId
        ? simulation.world.residents.find((candidate) => candidate.id === demolition.workerId)
        : undefined;
      selectionTitle.textContent = building.kind === 'house' ? 'Дом' : building.kind === 'sawmill' ? 'Лесопилка' : building.kind === 'mine' ? 'Шахта' : 'Склад';
      selectionDetail.textContent = demolition.paused
        ? `Снос приостановлен · ${Math.round(demolition.progress * 100)}%. ${demolition.blockedReason ?? 'Прогресс сохранён.'}`
        : `${worker?.name ?? 'Строитель'} ${worker?.mode === 'moving' ? 'идёт к зданию' : 'разбирает здание'} · ${Math.round(demolition.progress * 100)}%.`;
    } else if (building.kind === 'house') {
      selectionTitle.textContent = 'Дом';
      const upgrade = simulation.world.sites.find((site) => site.upgradeBuildingId === building.id);
      selectionDetail.textContent = (building.level ?? 1) >= 2
        ? `Дом второго уровня даёт два места жилья. В поселении всего ${simulation.totals().housing} мест.`
        : upgrade
          ? `Улучшение дома: ${upgrade.deliveredWood}/40 древесины · ${upgrade.deliveredOre}/30 породы · ${Math.round(upgrade.progress * 100)}%${upgrade.paused ? ' · пауза' : ''}.`
          : 'Дом первого уровня даёт одно место жилья. Улучшение до уровня 2 стоит 40 древесины и 30 породы.';
    } else if (building.kind === 'sawmill') {
      const output = simulation.world.stockpiles.find((pile) => pile.treeId === building.sourceTreeId);
      selectionTitle.textContent = 'Лесопилка';
      selectionDetail.textContent = `Улучшение лесного источника · местная куча древесины ${output?.amount ?? 0}/${output?.capacity ?? PROTOTYPE_CONFIG.stockpile.capacity}. Лесоруб добывает древесину; лесопилка не производит её сама.`;
    } else if (building.kind === 'mine') {
      const output = simulation.world.stockpiles.find((pile) => pile.sourceId === 'ore');
      selectionTitle.textContent = 'Шахта';
      selectionDetail.textContent = `Бесконечный источник породы · местная куча ${output?.amount ?? 0}/${output?.capacity ?? PROTOTYPE_CONFIG.stockpile.capacity}. Каменщик добывает породу циклами.`;
    } else {
      selectionTitle.textContent = 'Склад';
      selectionDetail.textContent = store
        ? `Древесина ${store.wood} · порода ${store.ore} · вместимость ${store.wood + store.ore}/${store.capacity}. Грузы приходят сюда физически.`
        : 'Склад увеличивает общую вместимость ресурсов.';
    }
  } else {
    selectionTitle.textContent = 'Три первых жителя';
    selectionDetail.textContent = 'Выбери жителя, назначь работу и наблюдай, как растёт поселение.';
  }
}

function showDemolitionConfirmation(buildingId: string): void {
  const building = simulation.world.buildings.find((candidate) => candidate.id === buildingId);
  if (!building) return;
  const refund = demolitionRefund(building.kind);
  const restriction = simulation.demolitionRestriction(building.id);
  const name = building.kind === 'house' ? 'Дом' : building.kind === 'sawmill' ? 'Лесопилка' : building.kind === 'mine' ? 'Шахта' : 'Склад';
  const limitation = building.kind === 'house'
    ? 'Ограничение: вместимость жилья после сноса не должна стать меньше населения.'
    : building.kind === 'sawmill'
      ? 'Местная древесина останется на лесном источнике.'
      : building.kind === 'mine'
        ? 'Добытая порода останется в куче у источника.'
      : 'Ограничения: нельзя сносить последний склад, склад с запасами или склад с активными перевозками.';
  demolitionConfirmDetails.textContent = [
    `Здание: ${name}`,
    `Работа: ${PROTOTYPE_CONFIG.demolition.workSeconds} секунд после прибытия свободного строителя.`,
    `Вернётся на месте: ${refund.wood} древесины · ${refund.ore} породы. Материалы нужно перевезти физически.`,
    limitation,
    restriction ? `Сейчас недоступно: ${restriction}` : 'Сейчас действие доступно.'
  ].join('\n');
  pendingDemolitionBuildingId = building.id;
  confirmDemolitionButton.disabled = Boolean(restriction);
  demolitionDialog.showModal();
}

confirmDemolitionButton.addEventListener('click', () => {
  const buildingId = pendingDemolitionBuildingId;
  if (!buildingId) return;
  const result = simulation.startDemolition(buildingId);
  if (!result.ok) showToast(result.reason, 'error');
  else showToast('Снос подтверждён. Строитель идёт к зданию.');
  demolitionDialog.close();
  pendingDemolitionBuildingId = null;
  dirty = true;
  updateUI();
});
$('cancel-demolition-confirm').addEventListener('click', () => { pendingDemolitionBuildingId = null; });
demolitionDialog.addEventListener('close', () => { pendingDemolitionBuildingId = null; });

function showRoadRemovalConfirmation(roadId: string): void {
  if (!FEATURES.roadsEnabled) return;
  if (!simulation.world.roads.some((road) => road.id === roadId)) return;
  pendingRoadId = roadId;
  roadRemovalDialog.showModal();
}

$('confirm-road-removal').addEventListener('click', () => {
  if (!FEATURES.roadsEnabled) return;
  const roadId = pendingRoadId;
  if (!roadId) return;
  const result = simulation.removeRoad(roadId);
  if (!result.ok) showToast(result.reason, 'error');
  pendingRoadId = null;
  roadRemovalDialog.close();
  updateUI();
  persistWorld();
});
$('cancel-road-removal').addEventListener('click', () => { pendingRoadId = null; });
roadRemovalDialog.addEventListener('close', () => { pendingRoadId = null; });

function showSiteCancellation(siteId: string): void {
  const site = simulation.world.sites.find((candidate) => candidate.id === siteId);
  if (!site) return;
  const name = site.kind === 'house' ? 'Дом' : site.kind === 'sawmill' ? 'Лесопилка'
    : site.kind === 'mine' ? 'Шахта' : site.kind === 'house-upgrade' ? 'Улучшение дома' : site.kind === 'warehouse' ? 'Склад' : 'Дорога';
  cancelSiteDetails.textContent = [
    `Площадка: ${name}`,
    `Доставлено: ${site.deliveredWood} древесины · ${site.deliveredOre} породы.`,
    `Прогресс строительства ${Math.round(site.progress * 100)}% будет потерян.`,
    'Доставленные материалы останутся на земле рядом. Их можно будет вывезти физически.'
  ].join('\n');
  pendingSiteId = site.id;
  cancelSiteDialog.showModal();
}

confirmCancelSiteButton.addEventListener('click', () => {
  const siteId = pendingSiteId;
  if (!siteId) return;
  if (!simulation.cancelSite(siteId)) showToast('Строительная площадка уже закрыта.', 'error');
  pendingSiteId = null;
  cancelSiteDialog.close();
  dirty = true;
  updateUI();
  persistWorld();
});
$('keep-site').addEventListener('click', () => { pendingSiteId = null; });
cancelSiteDialog.addEventListener('close', () => { pendingSiteId = null; });

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

  if (currentInspection === 'wood' || currentInspection === 'ore') {
    worldActions.hidden = false;
    const resource: Resource = currentInspection === 'wood' ? 'wood' : 'ore';
    const settings = simulation.world.productionSettings!;
    const quota = settings.quota[resource];
    const label = resourceLabelGenitive(resource);
    addButton(`Лимит ${quota} ед. · уменьшить на ${PROTOTYPE_CONFIG.production.quotaStep}`, () => {
      simulation.setProductionQuota(resource, quota - PROTOTYPE_CONFIG.production.quotaStep);
      updateUI(); persistWorld();
    }, quota <= 0, `decrease-quota-${resource}`);
    addButton(`Лимит ${quota} ед. · увеличить на ${PROTOTYPE_CONFIG.production.quotaStep}`, () => {
      simulation.setProductionQuota(resource, quota + PROTOTYPE_CONFIG.production.quotaStep);
      updateUI(); persistWorld();
    }, quota >= PROTOTYPE_CONFIG.production.maxQuota, `increase-quota-${resource}`);
    addButton(`Приоритет перевозки: ${productionPriorityLabel(settings.priority[resource])} · изменить`, () => {
      const next = settings.priority[resource] === 3 ? 1 : settings.priority[resource] + 1;
      simulation.setProductionPriority(resource, next);
      updateUI(); persistWorld();
    }, false, `cycle-priority-${resource}`);
    addNote(`Лимит хранит до ${quota} ед. ${label} в запасах, кучах, грузах и материалах на стройках. Приоритет влияет на выбор грузчика после срочных строительных поставок.`);
  } else if (currentInspection.startsWith('tree:')) {
    worldActions.hidden = false;
    const tree = simulation.world.trees.find((candidate) => candidate.id === currentInspection.slice(5));
    if (!tree) addNote('Дерево уже удалено. Его клетка свободна.');
    else if (tree.planted) {
      addButton('Удалить посаженное дерево', () => {
        const result = simulation.removeTree(tree.id);
        if (!result.ok) showToast(result.reason, 'error');
        else { showToast('Клетка освобождена, остаток древесины сохранён.'); persistWorld(); }
        updateUI();
      }, false, 'remove-tree');
      addNote('Удаление не возвращает стоимость посадки. Если в куче есть древесина, она остаётся доступной для перевозки.');
    } else addNote('Природные деревья сохраняются как источники древесины.');
  } else if (currentInspection.startsWith('site:')) {
    worldActions.hidden = false;
    const siteId = currentInspection.slice(5);
    const site = simulation.world.sites.find((candidate) => candidate.id === siteId);
    if (site) {
      const priority = site.priority ?? 2;
      addButton(`Приоритет стройки: ${productionPriorityLabel(priority)} · изменить`, () => {
        simulation.setSitePriority(site.id, priority === 3 ? 1 : priority + 1);
        updateUI(); persistWorld();
      }, false, 'cycle-site-priority');
      addButton(site.paused ? 'Возобновить стройку' : 'Приостановить стройку', () => {
        simulation.toggleSitePaused(site.id);
        updateUI(); persistWorld();
      }, false, 'toggle-site-pause');
      addButton('Отменить стройку', () => showSiteCancellation(site.id), false, 'cancel-site');
      addNote(`Доставлено: ${site.deliveredWood} древесины и ${site.deliveredOre} породы. Уже взятый груз продолжит путь; отмена оставит доставленное рядом на земле.`);
    } else addNote('Строительная площадка уже закрыта.');
  } else if (FEATURES.roadsEnabled && currentInspection.startsWith('road:')) {
    worldActions.hidden = false;
    const roadId = currentInspection.slice(5);
    const road = simulation.world.roads.find((candidate) => candidate.id === roadId);
    if (road) {
      addButton('Удалить дорожный сегмент', () => showRoadRemovalConfirmation(roadId), false, 'remove-road');
      addNote(`Сегмент ускоряет только ${PROTOTYPE_CONFIG.roads.segmentLength} единиц маршрута. При удалении часть материалов останется на земле.`);
    } else addNote('Этот сегмент уже удалён.');
  } else if (currentInspection.startsWith('cell:')) {
    worldActions.hidden = false;
    const id = Number(currentInspection.slice(5));
    const cell = simulation.world.landCells.find((candidate) => candidate.id === id);
    const state = simulation.landCellState(id);
    const tree = simulation.world.trees.find((candidate) => candidate.cellId === id);
    if (cell && state === 'unlockable') {
      const cost = PROTOTYPE_CONFIG.expansion.unlockCost;
      const hasHouse = simulation.world.buildings.some((building) => building.kind === 'house');
      const canAfford = simulation.availableInStores('wood') >= cost.wood &&
        simulation.availableInStores('ore') >= cost.ore;
      addButton(`Открыть клетку · ${cost.wood} древесины · ${cost.ore} породы`, () => {
        const result = simulation.unlockEasternSector();
        if (!result.ok) showToast(result.reason, 'error');
        updateUI();
      }, !hasHouse || !canAfford, 'unlock-land-cell');
      const missing = [
        simulation.availableInStores('wood') < cost.wood ? `древесина ${simulation.availableInStores('wood')}/${cost.wood}` : '',
        simulation.availableInStores('ore') < cost.ore ? `порода ${simulation.availableInStores('ore')}/${cost.ore}` : ''
      ].filter(Boolean);
      addNote(!hasHouse ? 'Сначала построй первый дом.' : missing.length
        ? `На складах не хватает: ${missing.join(', ')}.`
        : `После открытия потребуется около ${PROTOTYPE_CONFIG.expansion.clearingWorkSeconds} секунд физической расчистки.`);
    } else if (cell && (state === 'unlocked' || state === 'clearing' && cell.clearingPaused)) {
      const availableWorker = simulation.world.residents.some((person) =>
        (person.role === 'builder' || person.role === 'idle') && !person.cargo &&
        (person.mode === 'idle' || person.mode === 'blocked'));
      addButton(state === 'unlocked' ? 'Назначить жителя на расчистку' : 'Возобновить расчистку', () => {
        const result = simulation.startEasternClearing();
        if (!result.ok) showToast(result.reason, 'error');
        updateUI();
      }, !availableWorker, 'clear-land-cell');
      addNote(availableWorker ? 'Прогресс касается только этой клетки.' : 'Нужен свободный строитель или житель без работы.');
    } else if (cell && state === 'clearing') {
      addButton(`Расчистка · ${Math.round(cell.clearingProgress * 100)}%`, () => {}, true);
      addNote('Соседние клетки остаются закрытым лесом.');
    } else if (cell && tree) {
      if (tree.planted) {
        addButton('Удалить посаженное дерево', () => {
          const result = simulation.removeTree(tree.id);
          if (!result.ok) showToast(result.reason, 'error');
          else { showToast('Клетка освобождена, остаток древесины сохранён.'); persistWorld(); }
          updateUI();
        }, false, 'remove-tree');
        addNote(tree.state === 'mature' ? 'Взрослое дерево можно рубить. Удаление освободит клетку и сохранит древесину в куче.'
          : 'Дерево ещё растёт или восстанавливается. Его можно удалить, чтобы освободить клетку.');
      } else addNote(`Природный источник древесины · ${tree.state === 'mature' ? 'взрослое дерево' : tree.state === 'growing' ? 'растёт' : tree.state === 'falling' ? 'падает' : 'пень'}.`);
    } else if (cell && state === 'prepared') {
      addButton(`Посадить дерево · ${PROTOTYPE_CONFIG.trees.plantingCost} древесины`, () => {
        const result = simulation.plantTree(cell.id);
        if (!result.ok) showToast(result.reason, 'error');
        else { showToast('Посажен саженец. Первый рост займёт около двух минут игрового времени.'); persistWorld(); }
        updateUI();
      }, simulation.availableInStores('wood') < PROTOTYPE_CONFIG.trees.plantingCost, 'plant-tree');
      addButton('Перейти к строительству', () => { openPanel('build'); updateUI(); }, false, 'build-on-land-cell');
      addNote('На клетке можно посадить дерево или разместить одно здание. Дерево займёт её до удаления.');
    } else if (state === 'construction') {
      addNote('Клетка занята строительной площадкой; материалы доставляются физически.');
    } else if (state === 'occupied') {
      addNote('Клетка занята зданием или зарезервирована под природный участок.');
    } else {
      addNote('Клетка закрыта лесом. Сначала освой предыдущую соседнюю клетку.');
    }
  } else if (currentInspection === 'sector:eastern') {
    worldActions.hidden = false;
    const sector = simulation.world.easternSector;
    if (sector.state === 'closed') {
      const cost = PROTOTYPE_CONFIG.expansion.unlockCost;
      const hasHouse = simulation.world.buildings.some((building) => building.kind === 'house');
      const canAfford = simulation.availableInStores('wood') >= cost.wood &&
        simulation.availableInStores('ore') >= cost.ore;
      addButton(
        `Открыть клетку · ${cost.wood} древесины · ${cost.ore} породы`,
        () => {
          const result = simulation.unlockEasternSector();
          if (!result.ok) showToast(result.reason, 'error');
          updateUI();
        },
        !hasHouse || !canAfford,
        'unlock-eastern-sector'
      );
      if (!hasHouse) addNote('Доступно после первого дома.');
      else if (!canAfford) addNote('Материалы для открытия должны находиться на складах.');
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
      addNote('На подготовленной клетке доступна ровно одна площадка. Следующая территория открывается отдельно.');
    }
  } else if (currentInspection === 'forest:eastern') {
    worldActions.hidden = false;
    if (!simulation.hasEasternForest()) {
      addButton('Лес закрыт до подготовки территории', () => {}, true, 'eastern-forest-unavailable');
      addNote('Рабочие не могут добывать этот лес раньше времени.');
    } else {
      addNote('Выбери жителя: он станет лесорубом источника. По выбранному режиму партия пойдёт в очередь грузчика или будет доставлена самостоятельно.');
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
  } else if (currentInspection.startsWith('building:')) {
    worldActions.hidden = false;
    const buildingId = currentInspection.slice(9);
    const building = simulation.world.buildings.find((candidate) => candidate.id === buildingId);
    if (!building) {
      addNote('Постройка уже разобрана или не найдена.');
    } else if (building.demolition) {
      const demolition = building.demolition;
      if (demolition.paused) {
        const restriction = simulation.resumeDemolitionRestriction(building.id);
        addButton('Продолжить снос', () => {
          const result = simulation.resumeDemolition(building.id);
          if (!result.ok) showToast(result.reason, 'error');
          updateUI();
        }, Boolean(restriction), 'resume-demolition');
        addNote(restriction ?? `Прогресс ${Math.round(demolition.progress * 100)}% сохранён; строитель продолжит с того же места.`);
      } else {
        const worker = demolition.workerId
          ? simulation.world.residents.find((person) => person.id === demolition.workerId)
          : undefined;
        addButton(`Идёт снос · ${Math.round(demolition.progress * 100)}%`, () => {}, true, 'demolition-progress');
        addNote(worker?.mode === 'moving'
          ? `${worker.name} физически идёт к зданию; рабочее время начнётся после прибытия.`
          : `${worker?.name ?? 'Строитель'} работает. Осталось около ${Math.ceil((1 - demolition.progress) * PROTOTYPE_CONFIG.demolition.workSeconds)} секунд.`);
      }
      addButton('Отменить снос', () => {
        simulation.cancelDemolition(building.id);
        updateUI();
      }, false, 'cancel-demolition');
    } else {
      if (building.kind === 'house') {
        const cost = costOf('house-upgrade');
        const active = simulation.world.sites.find((site) => site.upgradeBuildingId === building.id);
        if ((building.level ?? 1) >= 2) {
          addButton('Дом улучшен', () => {}, true, 'upgrade-house-complete');
          addNote(`Дом второго уровня даёт два места жилья. Сейчас доступно ${simulation.totals().housing} мест.`);
        } else if (active) {
          addButton(`Улучшение идёт · ${Math.round(active.progress * 100)}%`, () => {}, true, 'upgrade-house-progress');
          addNote(`Доставлено: ${active.deliveredWood}/40 древесины · ${active.deliveredOre}/30 породы. ${active.paused ? 'Стройка приостановлена.' : 'Строитель продолжит работу после доставки материалов.'}`);
        } else {
          const wood = simulation.availableInStores('wood');
          const ore = simulation.availableInStores('ore');
          const missing = [wood < cost.wood ? `древесина ${wood}/${cost.wood}` : '',
            ore < cost.ore ? `порода ${ore}/${cost.ore}` : ''].filter(Boolean);
          addButton('Улучшить до уровня 2 · 40 древесины · 30 породы', () => {
            const result = simulation.startHouseUpgrade(building.id);
            if (!result.ok) showToast(result.reason, 'error');
            else { showToast('Улучшение началось: материалы доставляются к дому.'); persistWorld(); }
            updateUI();
          }, missing.length > 0, 'upgrade-house');
          addNote(missing.length
            ? `Не хватает на складах: ${missing.join(', ')}. Кнопка станет доступна после доставки ресурсов.`
            : 'После доставки 40 древесины и 30 породы строитель доведёт улучшение до 100%; дом даст ещё одно место жителя.');
        }
      }
      if (building.kind === 'sawmill') {
        const pile = simulation.world.stockpiles.find((candidate) => candidate.treeId === building.sourceTreeId);
        addNote(`Лесной источник сохранён. Местная куча вмещает ${pile?.capacity ?? PROTOTYPE_CONFIG.stockpile.capacity} древесины; добыча идёт только при назначенном лесорубе.`);
      }
      if (building.kind === 'mine') {
        const pile = simulation.world.stockpiles.find((candidate) => candidate.sourceId === 'ore');
        addNote(`Шахта даёт бесконечный источник породы. Местная куча вмещает ${pile?.capacity ?? PROTOTYPE_CONFIG.stockpile.capacity} единиц.`);
      }
      const restriction = simulation.demolitionRestriction(building.id);
      addButton('Снести здание', () => showDemolitionConfirmation(building.id), false, 'start-demolition');
      addNote(restriction
        ? `Сейчас нельзя: ${restriction}`
        : `Снос займёт ${PROTOTYPE_CONFIG.demolition.workSeconds} секунд работы после прибытия. Вернётся ${demolitionRefund(building.kind).wood} древесины и ${demolitionRefund(building.kind).ore} породы.`);
    }
  } else if (currentInspection.startsWith('pile:')) {
    worldActions.hidden = false;
    const pile = simulation.world.stockpiles.find((candidate) => candidate.id === currentInspection.slice(5));
    addNote(pile
      ? `${pile.amount} ед. ${resourceLabelGenitive(pile.resource)} остаются здесь, пока их физически не заберут. Перевозка дождётся свободного места на складе.`
      : 'Куча уже вывезена.');
  }
  if (!worldActions.hidden) worldActionButtons.append(buttonList);
}

function updateUI(): void {
  const totals = simulation.totals();
  const signature = JSON.stringify({
    diagnostics: simulation.diagnostics.issues,
    totals, selectedResidentId, currentInspection, placementKind, roadPlacementMode, selectedRoadX,
    roads: simulation.world.roads.map((road) => [road.id, road.x]), currentGoal: simulation.world.currentGoal,
    residents: simulation.world.residents.map((person) => [
      person.id, person.role, person.mode, person.task, person.blockedReason, person.cargo, person.cargoAmount,
      person.woodSource, person.logisticsMode, person.logisticsRequestId
    ]),
    sites: simulation.world.sites.map((site) => [
      site.id, Math.floor(site.progress * 100), site.deliveredWood, site.deliveredOre, site.priority, site.paused
    ]),
    productionSettings: simulation.world.productionSettings,
    buildings: simulation.world.buildings.map((building) => [
      building.id, building.kind, Math.floor((building.demolition?.progress ?? 0) * 100),
      building.demolition?.paused, building.demolition?.workerId, building.level, building.sourceTreeId
    ]),
    stores: simulation.world.stores.map((store) => [
      store.id, store.wood, store.ore, store.capacity, store.closedForDemolition
    ]),
    sources: [
      simulation.world.oreSource,
      simulation.world.trees.map((tree) => [tree.id, tree.state, tree.growthSeconds, tree.cutProgress])
    ],
    stockpiles: simulation.world.stockpiles.map((pile) => [pile.id, pile.amount]),
    requests: simulation.world.logisticsRequests.map((request) => [
      request.id, request.status, request.assignedHaulerId, request.amount
    ]),
    landCells: simulation.world.landCells.map((cell) => [
      cell.id, cell.state, Math.floor(cell.clearingProgress * 20), cell.clearingPaused, cell.clearerId
    ]),
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
  oreTotal.textContent = String(totals.ore);
  peopleTotal.textContent = `${totals.population} / ${totals.housing}`;
  capacityTotal.textContent = `${totals.stored} / ${totals.capacity}`;
  const resourceElements: Record<Resource, HTMLElement> = { wood: woodTotal, ore: oreTotal };
  for (const resource of ['wood', 'ore'] as const) {
    const element = resourceElements[resource];
    const stored = simulation.world.stores.reduce((sum, store) => sum + (store[resource] ?? 0), 0);
    const piles = simulation.world.stockpiles.filter((pile) => pile.resource === resource)
      .reduce((sum, pile) => sum + pile.amount, 0);
    const transit = simulation.world.residents.filter((person) => person.cargo === resource)
      .reduce((sum, person) => sum + person.cargoAmount, 0);
    element.title = `На складах: ${stored} · в кучах: ${piles} · в перевозке: ${transit}`;
    element.dataset.stored = String(stored);
    element.dataset.piles = String(piles);
    element.dataset.transit = String(transit);
    $(`stored-${resource}`).textContent = String(stored);
    $(`reserved-${resource}`).textContent = String(simulation.reservedInWarehouses(resource));
    $(`piles-${resource}`).textContent = String(piles);
    $(`transit-${resource}`).textContent = String(transit);
    $(`construction-reserved-${resource}`).textContent = String(simulation.reservedForConstruction(resource));
    $(`sites-${resource}`).textContent = String(simulation.world.sites.filter((site) => site.kind !== 'road').reduce((sum, site) =>
      sum + (resource === 'wood' ? site.deliveredWood : site.deliveredOre), 0));
  }
  document.documentElement.dataset.diagnostics = JSON.stringify(simulation.diagnostics);
  goalChip.innerHTML = `<i></i> ${goalText()}`;
  workersLabel.textContent = `${totals.population} ${totals.population === 1 ? 'человек' : 'человека'}`;
  const visibleSites = simulation.world.sites.filter((site) => site.kind !== 'road');
  sitesLabel.textContent = `${visibleSites.length} ${visibleSites.length === 1 ? 'площадка' : 'площадки'}`;
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
    role.textContent = person.role === 'hauler'
      ? `${roleLabel(person.role)} · очередь`
      : ['woodcutter', 'miner', 'builder'].includes(person.role)
        ? `${roleLabel(person.role)} · ${person.logisticsMode === 'hauler' ? 'грузчик' : 'самостоятельно'}`
        : roleLabel(person.role);
    meta.append(name, role);
    const state = document.createElement('span');
    state.className = 'resident-state';
    state.textContent = person.cargo ? `несёт ${person.cargoAmount}` :
      person.mode === 'blocked' ? person.task.toLowerCase().includes('грузчик') ? 'ждёт грузчика' : 'ждёт' :
        person.mode === 'building' ? 'строит' : person.mode === 'moving' ? 'в пути' : '';
    row.append(avatar, meta, state);
    row.addEventListener('click', () => selectResident(person.id));
    return row;
  }));

  const siteRows = simulation.world.sites.filter((site) => site.kind !== 'road').map((site) => {
    const row = document.createElement('div');
    row.className = 'building-row';
    const title = document.createElement('span');
    const kind = site.kind === 'house' ? 'Дом' : site.kind === 'sawmill' ? 'Лесопилка' :
      site.kind === 'mine' ? 'Шахта' : site.kind === 'house-upgrade' ? 'Улучшение дома' : 'Склад';
    title.textContent = `${kind} · Строительство: ${Math.round(site.progress * 100)}%`;
    const status = document.createElement('small');
    const builders = simulation.world.residents.filter((person) => person.role === 'builder').length;
    const cost = costOf(site.kind);
    status.textContent = `Материалы: ${site.deliveredWood + site.deliveredOre} / ${cost.wood + cost.ore} · ` +
      `${site.deliveredWood}/${cost.wood} древесины · ${site.deliveredOre}/${cost.ore} породы${builders === 0 ? ' · нужен строитель' : ''}`;
    row.append(title, status);
    return row;
  });
  const completeRows = simulation.world.buildings.map((building) => {
    const row = document.createElement('div');
    row.className = 'building-row';
    const label = document.createElement('span');
    label.textContent = building.kind === 'house' ? `Дом · уровень ${building.level ?? 1}`
      : building.kind === 'sawmill' ? 'Готовая лесопилка' : building.kind === 'mine' ? 'Готовая шахта' : 'Готовый склад';
    const detail = document.createElement('small');
    detail.textContent = building.kind === 'house'
      ? `+${building.level ?? 1} место жилья`
      : building.kind === 'sawmill' ? `Куча древесины ${simulation.world.stockpiles.find((pile) => pile.treeId === building.sourceTreeId)?.capacity ?? 10}/50`
        : building.kind === 'mine' ? `Куча породы ${simulation.world.stockpiles.find((pile) => pile.sourceId === 'ore')?.capacity ?? 10}/50`
          : `+${PROTOTYPE_CONFIG.warehouseCapacity} к складу`;
    row.append(label, detail);
    if (building.kind === 'house') {
      const upgrade = simulation.world.sites.find((site) => site.upgradeBuildingId === building.id);
      if ((building.level ?? 1) >= 2) {
        const complete = document.createElement('small');
        complete.className = 'house-upgrade-status';
        complete.textContent = 'Дом улучшен';
        row.append(complete);
      } else if (upgrade) {
        const progress = document.createElement('small');
        progress.className = 'house-upgrade-status';
        progress.textContent = `Улучшение · ${upgrade.deliveredWood}/40 древесины · ${upgrade.deliveredOre}/30 породы · ${Math.round(upgrade.progress * 100)}%`;
        row.append(progress);
      } else {
        const upgradeButton = document.createElement('button');
        upgradeButton.type = 'button';
        upgradeButton.className = 'inline-action-button building-upgrade-button';
        upgradeButton.dataset.testid = `upgrade-house-list-${building.id}`;
        upgradeButton.textContent = 'Улучшить до уровня 2 · 40 древесины · 30 породы';
        const wood = simulation.availableInStores('wood');
        const ore = simulation.availableInStores('ore');
        upgradeButton.disabled = wood < 40 || ore < 30;
        upgradeButton.title = upgradeButton.disabled
          ? `Нужно на складах 40 древесины и 30 породы; доступно ${wood} и ${ore}.`
          : 'Доставить материалы к дому и увеличить вместимость жилья.';
        upgradeButton.addEventListener('click', () => {
          const result = simulation.startHouseUpgrade(building.id);
          if (!result.ok) showToast(result.reason, 'error');
          else { showToast('Улучшение началось: материалы доставляются к дому.'); persistWorld(); }
          updateUI();
        });
        row.append(upgradeButton);
      }
    }
    row.dataset.buildingId = building.id;
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

function persistWorld(): boolean {
  if (saveNeedsRecovery) {
    saveStatus.textContent = 'Исходное сохранение не заменено';
    return false;
  }
  try {
    const serialized = JSON.stringify(simulation.world);
    localStorage.setItem(STORAGE_KEY, serialized);
    rawSave = serialized;
    saveStatus.textContent = 'Прогресс сохранён';
    return true;
  } catch {
    saveStatus.textContent = 'Не удалось сохранить';
    return false;
  }
}

let lastFrame = performance.now();
let lastUiUpdate = 0;
let lastSimulationHeartbeatAt = 0;
let uiUpdateFailures = 0;
let catchingUp = true;
let resumePromise: Promise<void> | null = null;
async function resumeSettlement(): Promise<void> {
  if (saveNeedsRecovery) {
    catchingUp = false;
    $('catchup-status').hidden = true;
    return;
  }
  if (resumePromise) return resumePromise;
  catchingUp = true;
  const status = $('catchup-status');
  status.hidden = false;
  resumePromise = (async () => {
    try {
      const report = await catchUpSettlement(simulation, Date.now(), { checkpoint: (fraction) => {
        status.textContent = `Поселение продолжает работу… ${Math.round(fraction * 100)}%`;
        persistWorld();
      } });
      persistWorld();
      if (report.seconds >= 2) {
        const text = absenceText(report);
        $('absence-report').textContent = text;
        $('absence-report').hidden = false;
        showToast(text);
      }
      updateUI();
    } catch (error) {
      runtimeDiagnostics.record({ type: 'simulation-step-error', errorType: safeErrorType(error),
        loopScheduled: frameScheduled, operation: 'offline-catch-up' });
      showToast('Не удалось досчитать время отсутствия. Сохранение оставлено без сброса; повторите запуск.', 'error');
      showRuntimeRecovery('simulation-error');
    }
  })().finally(() => {
    catchingUp = false;
    status.hidden = true;
    lastFrame = performance.now();
    resumePromise = null;
  });
  return resumePromise;
}

const reportedRuntimeInvariants = new Set<string>();
function inspectRuntimeInvariants(operation: 'simulation-step' | 'role-switch' = 'simulation-step'): void {
  const world = simulation.world;
  const report = (code: string) => {
    if (reportedRuntimeInvariants.has(code)) return;
    reportedRuntimeInvariants.add(code);
    runtimeDiagnostics.record({ type: 'state-invariant', issue: code, loopScheduled: frameScheduled, operation });
  };
  const requestIds = new Set<string>();
  const assignedHaulers = new Set<string>();
  for (const request of world.logisticsRequests) {
    if (requestIds.has(request.id)) report('duplicate-request');
    requestIds.add(request.id);
    if (request.status === 'completed' || request.status === 'cancelled' || !request.assignedHaulerId) continue;
    if (assignedHaulers.has(request.assignedHaulerId)) report('multiple-hauler-requests');
    assignedHaulers.add(request.assignedHaulerId);
    const assigned = world.residents.find((person) => person.id === request.assignedHaulerId);
    if (!assigned || assigned.logisticsRequestId !== request.id || (assigned.role !== 'hauler' && !assigned.cargo)) {
      report('invalid-request-owner');
    }
  }
  for (const person of world.residents) {
    if (!Number.isFinite(person.cargoAmount) || person.cargoAmount < 0 ||
        (person.cargo === null && person.cargoAmount > 0) ||
        (person.cargo !== null && person.cargoAmount <= 0) ||
        (person.mode === 'carrying' && person.cargo === null) ||
        (person.mode === 'building' && person.role !== 'builder')) {
      report('invalid-cargo-state');
    }
  }
  for (const store of world.stores) {
    const amount = store.wood + store.ore;
    if (![store.wood, store.ore, store.capacity].every(Number.isFinite) ||
        amount < 0 || amount > store.capacity + 1e-6) report('invalid-store-capacity');
  }
  const totalFreeCapacity = world.stores.reduce((sum, store) =>
    sum + Math.max(0, store.capacity - store.wood - store.ore), 0);
  if (simulation.reservedInboundStorage() > totalFreeCapacity + 1e-6) report('orphaned-inbound-reservation');
}

function scheduleFrame(): void {
  if (frameScheduled || fatalRuntime) return;
  frameScheduled = true;
  requestAnimationFrame((now) => {
    frameScheduled = false;
    frame(now);
  });
}

function frame(now: number): void {
  if (fatalRuntime) return;
  let stage: 'simulation-step' | 'ui-update' | 'frame-save' = 'simulation-step';
  try {
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    if (saveNeedsRecovery || document.visibilityState !== 'visible' || catchingUp) return;
    const stepStartedAt = performance.now();
    simulation.step(dt);
    const stepDuration = performance.now() - stepStartedAt;
    if (stepDuration >= 50) runtimeDiagnostics.record({ type: 'slow-operation', durationMs: stepDuration,
      loopScheduled: false, operation: 'simulation-step' });
    simulation.world.lastSimulatedAtMs = Date.now();
    if (now - lastSimulationHeartbeatAt >= 1000) {
      document.documentElement.dataset.simulationHeartbeat = String(Math.floor(now));
      lastSimulationHeartbeatAt = now;
    }
    dirty = true;
    if (Math.floor(now / 2000) !== Math.floor((now - dt * 1000) / 2000)) inspectRuntimeInvariants();
    if (now - lastUiUpdate > 350) {
      stage = 'ui-update';
      updateUI();
      uiUpdateFailures = 0;
      lastUiUpdate = now;
    }
    if (dirty && now - lastSaveAt > 900) {
      stage = 'frame-save';
      persistWorld();
      lastSaveAt = now;
      dirty = false;
    }
  } catch (error) {
    if (stage === 'ui-update') {
      uiUpdateFailures++;
      runtimeDiagnostics.record({ type: 'ui-update-error', errorType: safeErrorType(error), frames: safeErrorFrames(error),
        loopScheduled: false, operation: 'ui-update' });
      if (uiUpdateFailures < 3) {
        // Retry a transient renderer failure after a short pause while the simulation and save continue.
        lastUiUpdate = now;
        if (dirty && now - lastSaveAt > 900) {
          persistWorld();
          lastSaveAt = now;
          dirty = false;
        }
      } else {
        showRuntimeRecovery('ui-error');
      }
    } else {
      runtimeDiagnostics.record({ type: stage === 'frame-save' ? 'uncaught-error' : 'simulation-step-error',
        errorType: safeErrorType(error), frames: safeErrorFrames(error), loopScheduled: false,
        operation: stage === 'frame-save' ? 'frame-save' : 'simulation-step' });
      showRuntimeRecovery('simulation-error');
    }
  } finally {
    // An exception must never silently leave the application without its next frame.
    if (!fatalRuntime) scheduleFrame();
  }
}
try { updateUI(); }
catch (error) {
  runtimeDiagnostics.record({ type: 'ui-update-error', errorType: safeErrorType(error), loopScheduled: false,
    operation: 'ui-update' });
  showRuntimeRecovery('ui-error');
}
if (saved) showToast('Поселение восстановлено из сохранения.');
else showToast('Назначь Илью лесорубом, затем выбери каменщика и строителя.');
scheduleFrame();
void resumeSettlement();

window.addEventListener('beforeunload', persistWorld);
window.addEventListener('pagehide', persistWorld);
window.addEventListener('pageshow', (event) => { if (event.persisted) void resumeSettlement(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistWorld();
  else void resumeSettlement();
});
