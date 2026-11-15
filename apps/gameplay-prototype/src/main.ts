import Phaser from 'phaser';
import './style.css';
import { registerSW } from 'virtual:pwa-register';
import {
  createNewWorld, parseSavedWorld, PrototypeSimulation, STORAGE_KEY,
  modeLabel, roleLabel, type BuildingKind, type WorkRole
} from './simulation.js';
import { PrototypeScene } from './scene.js';

document.documentElement.dataset.build = __APP_BUILD_ID__;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Prototype UI is missing #${id}`);
  return element as T;
};

const worldSceneElement = $('world-scene');
worldSceneElement.style.setProperty('--world-panorama', `url("${import.meta.env.BASE_URL}assets/peace-v2/background-panorama.png")`);

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
let toastTimer: number | undefined;
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

function showToast(message: string): void {
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove('visible'), 2500);
}

function selectResident(id: string): void {
  selectedResidentId = id;
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
}

function openPanel(mode: Exclude<PanelMode, null>): void {
  panelMode = mode;
  controlPanel.hidden = false;
  residentActions.hidden = mode !== 'resident';
  residentListSection.hidden = mode !== 'residents';
  buildingListSection.hidden = mode !== 'details';
  menuActions.hidden = mode !== 'menu';
  $('build-actions').hidden = mode !== 'build';
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
    if (!result.ok) { showToast(result.reason); return; }
    placementKind = null;
    placementBanner.hidden = true;
    closePanel();
    updateUI();
  },
  onObject: (kind, id) => {
    selectedResidentId = null;
    currentInspection = kind === 'wood' ? 'wood' : kind === 'stone' ? 'stone' : `${kind}:${id ?? ''}`;
    openPanel('details');
    updateUI();
  },
  isSelected: (id) => selectedResidentId === id,
  isPlacing: () => placementKind !== null
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
    if (!person) { showToast('Сначала выбери жителя на карте или в списке.'); return; }
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
$('menu-button').addEventListener('click', () => openPanel('menu'));
$('close-panel').addEventListener('click', closePanel);
$('build-house').addEventListener('click', () => startPlacement('house'));
$('build-warehouse').addEventListener('click', () => startPlacement('warehouse'));
$('cancel-placement').addEventListener('click', () => startPlacement(placementKind ?? 'house'));

document.addEventListener('pointerdown', (event) => {
  if (panelMode && !controlPanel.contains(event.target as Node)) closePanel();
}, true);
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
  const houses = simulation.world.buildings.filter((building) => building.kind === 'house').length;
  const hasSecondStore = simulation.world.stores.length > 1;
  if (houses === 0) return 'Цель: построй первый дом';
  if (!hasSecondStore) return 'Следующая цель: построй второй склад';
  if (houses < 2) return 'Следующая цель: построй второй дом';
  return 'Поселение развивается';
}

function updateInspection(): void {
  const person = simulation.world.residents.find((candidate) => candidate.id === selectedResidentId);
  if (person) {
    selectionTitle.textContent = person.name;
    selectionDetail.textContent = `${roleLabel(person.role)} · ${modeLabel(person.mode)}${person.cargo ? ` · несёт ${person.cargo === 'wood' ? 'дерево' : 'камень'}` : ''}`;
    residentTask.textContent = person.blockedReason ? `Ожидание: ${person.blockedReason}` : person.task;
    residentActions.hidden = false;
    document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) =>
      button.classList.toggle('active', button.dataset.role === person.role));
    return;
  }
  residentActions.hidden = true;
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) => button.classList.remove('active'));
  if (currentInspection === 'wood') {
    selectionTitle.textContent = 'Лесной участок';
    selectionDetail.textContent = `${simulation.world.woodSource} единиц доступной древесины. Назначь жителя лесорубом: он сам добудет и доставит брёвна.`;
  } else if (currentInspection === 'stone') {
    selectionTitle.textContent = 'Каменный выход';
    selectionDetail.textContent = `${simulation.world.stoneSource} единиц доступного камня. Назначь каменщика для добычи и доставки.`;
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

function updateUI(): void {
  const totals = simulation.totals();
  const signature = JSON.stringify({
    totals, selectedResidentId, currentInspection, placementKind,
    residents: simulation.world.residents.map((person) => [
      person.id, person.role, person.mode, person.task, person.blockedReason, person.cargo
    ]),
    sites: simulation.world.sites.map((site) => [
      site.id, Math.floor(site.progress * 10), site.deliveredWood, site.deliveredStone
    ]),
    buildings: simulation.world.buildings.map((building) => [building.id, building.kind]),
    sources: [simulation.world.woodSource, simulation.world.stoneSource]
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
