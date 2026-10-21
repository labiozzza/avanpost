import type {
  FrontierSector,
  TerrainType,
  Transport,
  WorldSnapshot
} from '@avanpost/shared';

export interface OverlayState {
  snapshot: WorldSnapshot | null;
  online: boolean;
  busy: boolean;
  error: string | null;
  cachedAt: string | null;
  transport: Transport;
  buildType: string | null;
  running: boolean;
}

export interface OverlayHandlers {
  onAdvance: (ticks: number) => void;
  onToggleRun: () => void;
  onDemo: () => void;
  onRecenter: () => void;
  onClearCell: (sectorId: string, x: number, y: number) => void;
  onGather: (nodeId: string) => void;
  onStopGather: (nodeId: string) => void;
  onUnlockSector: (x: number, y: number) => void;
  onTransport: (transport: Transport) => void;
  onSelectBuilding: (type: string) => void;
  onCancelBuild: () => void;
  onDemolish: (buildingId: string) => void;
  onRetry: () => void;
}

export interface Overlay {
  update: (state: OverlayState) => void;
}

function make(tag: string, className?: string, testId?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (testId) element.dataset.testid = testId;
  return element;
}

function button(label: string, testId: string): HTMLButtonElement {
  const element = make('button', 'ghost', testId) as HTMLButtonElement;
  element.type = 'button';
  element.textContent = label;
  return element;
}

export function createOverlay(handlers: OverlayHandlers): Overlay {
  const root = document.querySelector<HTMLElement>('#ui');
  if (!root) throw new Error('#ui not found');

  const topbar = make('header', 'topbar panel');
  const brand = make('div', 'brand');
  const title = make('h1');
  title.textContent = 'Аванпост';
  const subtitle = make('span', 'subtitle');
  subtitle.textContent = 'вид сбоку · этап I.3';
  brand.append(title, subtitle);

  const badges = make('div', 'badges');
  const sync = make('span', 'badge', 'sync-status');
  const build = make('span', 'badge mono', 'build-version');
  badges.append(sync, build);
  topbar.append(brand, badges);

  const side = make('aside', 'side');
  const stats = make('section', 'stats panel');
  const addRow = (label: string, testId: string): HTMLElement => {
    const row = make('div', 'stat');
    const key = make('span', 'stat-key');
    key.textContent = label;
    const value = make('span', 'stat-value mono', testId);
    value.textContent = '—';
    row.append(key, value);
    stats.append(row);
    return value;
  };

  const playerValue = addRow('Поселение', 'player-id');
  const biomeValue = addRow('Биом', 'biome');
  const tickValue = addRow('Тик', 'tick');
  const versionValue = addRow('Версия', 'state-version');
  const sectorsValue = addRow('Сектора', 'sector-count');
  const reachableValue = addRow('Доступно', 'reachable-count');
  const blockedValue = addRow('Препятствий', 'blocked-count');
  const clearingsValue = addRow('Расчисток', 'clearing-count');
  const storageValue = addRow('Склады', 'storage-volume');
  const haulsValue = addRow('Перевозки', 'haul-count');
  const extractionValue = addRow('Добыча', 'node-count');

  const frontierPanel = make('section', 'region panel');
  const frontierTitle = make('h2');
  frontierTitle.textContent = 'Фронтир';
  const frontierList = make('div', 'list', 'frontier-list');
  frontierPanel.append(frontierTitle, frontierList);

  const tasksPanel = make('section', 'region panel');
  const tasksTitle = make('h2');
  tasksTitle.textContent = 'Расчистка';
  const tasksList = make('div', 'list', 'tasks-list');
  tasksPanel.append(tasksTitle, tasksList);

  const economyPanel = make('section', 'region panel');
  const economyTitle = make('h2');
  economyTitle.textContent = 'Экономика';
  const nodesList = make('div', 'list', 'economy-nodes');
  const storageList = make('div', 'list', 'economy-storages');
  economyPanel.append(economyTitle, nodesList, storageList);

  const constructionPanel = make('section', 'region panel');
  const constructionTitle = make('h2');
  constructionTitle.textContent = 'Строительство';
  const buildHint = make('p', 'empty', 'build-hint');
  buildHint.textContent = 'Выберите здание, затем клетку на карте';
  const buildList = make('div', 'list', 'build-catalog');
  const buildingList = make('div', 'list', 'building-list');
  constructionPanel.append(constructionTitle, buildHint, buildList, buildingList);

  side.append(stats, constructionPanel, economyPanel, frontierPanel, tasksPanel);

  const actions = make('footer', 'actions panel');
  const moveButton = button('Прожить 1 тик', 'advance');
  moveButton.classList.add('primary');
  const moveTenButton = button('×10', 'advance-10');
  const moveThirtyButton = button('×30', 'advance-30');
  const runButton = button('▶ Авто', 'toggle-run');
  const demoButton = button('▶ Демо', 'demo');
  demoButton.classList.add('primary');
  const centerButton = button('Центр', 'recenter');

  const modes = make('div', 'modes');
  const personButton = button('Пешком', 'mode-person');
  const cartButton = button('Повозка', 'mode-cart');
  modes.append(personButton, cartButton);

  const retryButton = button('Повторить', 'retry');
  const message = make('span', 'status', 'message');
  const cacheNote = make('span', 'cache', 'cache-age');

  actions.append(
    moveButton,
    moveTenButton,
    moveThirtyButton,
    runButton,
    demoButton,
    centerButton,
    modes,
    retryButton,
    message,
    cacheNote
  );
  root.append(topbar, side, actions);

  const terrainLabel = (snapshot: WorldSnapshot, type: TerrainType): string =>
    snapshot.catalog.terrains.find((terrain) => terrain.id === type)?.label ?? type;

  const costLabel = (sector: FrontierSector): string =>
    `${sector.cost.wood}д / ${sector.cost.stone}к`;

  const renderFrontier = (snapshot: WorldSnapshot, state: OverlayState): void => {
    frontierList.replaceChildren();
    if (snapshot.frontier.length === 0) {
      const empty = make('p', 'empty', 'frontier-empty');
      empty.textContent = 'Граница не найдена';
      frontierList.append(empty);
      return;
    }

    for (const sector of snapshot.frontier) {
      const row = make('div', 'list-row');
      const info = make('div', 'list-info');
      const label = make('span', 'list-title');
      const biome = snapshot.catalog.biomes.find((item) => item.id === sector.biome);
      label.textContent = `${biome?.label ?? sector.biome} (${sector.x}, ${sector.y})`;
      const detail = make('span', 'list-detail');
      detail.textContent = costLabel(sector);
      info.append(label, detail);

      const unlock = button('Открыть', `unlock-${sector.x}-${sector.y}`);
      unlock.disabled = state.busy || !state.online;
      unlock.addEventListener('click', () =>
        handlers.onUnlockSector(sector.x, sector.y)
      );
      row.append(info, unlock);
      frontierList.append(row);
    }
  };

  const renderTasks = (snapshot: WorldSnapshot, state: OverlayState): void => {
    tasksList.replaceChildren();
    if (snapshot.clearingTasks.length === 0) {
      const empty = make('p', 'empty', 'tasks-empty');
      empty.textContent = 'Нет доступных участков';
      tasksList.append(empty);
      return;
    }

    for (const task of snapshot.clearingTasks) {
      const row = make('div', 'list-row');
      const info = make('div', 'list-info');
      const label = make('span', 'list-title');
      label.textContent = `${terrainLabel(snapshot, task.terrain)} (${task.x}, ${task.y})`;
      const detail = make('span', 'list-detail mono');
      detail.textContent = task.active
        ? `в работе ${task.workDone}/${task.workRequired}`
        : `работа ${task.workRequired}`;
      if (task.active) {
        const bar = make('span', 'progress');
        const fill = make('span', 'progress-fill');
        fill.style.width = `${Math.round(
          (task.workDone / Math.max(1, task.workRequired)) * 100
        )}%`;
        bar.append(fill);
        info.append(label, detail, bar);
      } else {
        info.append(label, detail);
      }

      const clear = button(
        task.active ? 'В работе' : 'Расчистить',
        `clear-task-${task.x}-${task.y}`
      );
      clear.disabled = task.active || state.busy || !state.online;
      clear.addEventListener('click', () =>
        handlers.onClearCell(task.sectorId, task.x, task.y)
      );
      row.append(info, clear);
      tasksList.append(row);
    }
  };

  const itemLabel = (snapshot: WorldSnapshot, itemId: string): string =>
    snapshot.catalog.items.find((item) => item.id === itemId)?.label ?? itemId;

  const renderEconomy = (snapshot: WorldSnapshot, state: OverlayState): void => {
    nodesList.replaceChildren();
    if (snapshot.nodes.length === 0) {
      const empty = make('p', 'empty', 'nodes-empty');
      empty.textContent = 'Нет ресурсных точек';
      nodesList.append(empty);
    }
    for (const node of snapshot.nodes) {
      const row = make('div', 'list-row', `node-${node.kind}`);
      const info = make('div', 'list-info');
      const label = make('span', 'list-title');
      label.textContent = `${node.label} (${node.x}, ${node.y})`;
      const detail = make('span', 'list-detail mono');
      detail.textContent = `${itemLabel(snapshot, node.item)}: ${node.amount}/${node.maxAmount} · буфер ${node.buffer}/${node.bufferCapacity}`;
      info.append(label, detail);
      if (node.bufferCapacity > 0) {
        const bar = make('span', 'progress');
        const fill = make('span', 'progress-fill');
        fill.style.width = `${Math.round(
          (node.buffer / Math.max(1, node.bufferCapacity)) * 100
        )}%`;
        bar.append(fill);
        info.append(bar);
      }

      const gather = button(
        node.active ? 'Остановить' : node.amount > 0 ? 'Добывать' : 'Истощено',
        `gather-node-${node.kind}`
      );
      gather.disabled =
        state.busy || !state.online || (!node.active && node.amount <= 0);
      gather.addEventListener('click', () => {
        if (node.active) handlers.onStopGather(node.id);
        else handlers.onGather(node.id);
      });
      row.append(info, gather);
      nodesList.append(row);
    }

    storageList.replaceChildren();
    for (const storage of snapshot.storages) {
      const row = make('div', 'list-row', `storage-${storage.type}`);
      const info = make('div', 'list-info');
      const label = make('span', 'list-title');
      label.textContent = `${storage.label} (${storage.x}, ${storage.y})`;
      const detail = make('span', 'list-detail mono');
      const contents =
        storage.contents.length === 0
          ? 'пусто'
          : storage.contents
              .map((item) => `${itemLabel(snapshot, item.item)} ${item.qty}`)
              .join(', ');
      detail.textContent = `${storage.volume}/${storage.capacity} · ${contents}`;
      info.append(label, detail);
      const bar = make('span', 'progress');
      const fill = make('span', 'progress-fill');
      fill.style.width = `${Math.round(
        (storage.volume / Math.max(1, storage.capacity)) * 100
      )}%`;
      bar.append(fill);
      info.append(bar);
      row.append(info);
      storageList.append(row);
    }

    if (snapshot.haulTasks.length > 0) {
      const active = make('div', 'list-row');
      const info = make('div', 'list-info');
      const label = make('span', 'list-title');
      label.textContent = `Перевозки: ${snapshot.haulTasks.length}`;
      const detail = make('span', 'list-detail mono');
      detail.textContent = snapshot.haulTasks
        .map(
          (task) =>
            `${itemLabel(snapshot, task.item)} ×${task.qty} (${task.status})`
        )
        .join(' · ');
      info.append(label, detail);
      active.append(info);
      storageList.append(active);
    }
  };

  const statusLabel: Record<string, string> = {
    awaiting_materials: 'ждёт материалы',
    building: 'строится',
    complete: 'готово',
    demolition: 'сносится',
    demolished: 'снесено'
  };

  const renderConstruction = (
    snapshot: WorldSnapshot,
    state: OverlayState
  ): void => {
    buildList.replaceChildren();
    buildHint.textContent = state.buildType
      ? 'Кликните по свободной клетке в стартовом секторе'
      : 'Выберите здание, затем клетку на карте';
    buildHint.dataset.active = String(Boolean(state.buildType));

    for (const building of snapshot.catalog.buildings) {
      const row = make('div', 'list-row', `build-row-${building.id}`);
      const info = make('div', 'list-info');
      const label = make('span', 'list-title');
      label.textContent = `${building.label} · ${building.buildWork} работы`;
      const detail = make('span', 'list-detail mono');
      const cost = Object.entries(building.materials)
        .map(([item, qty]) => `${itemLabel(snapshot, item)} ${qty}`)
        .join(' · ');
      detail.textContent = `${cost}${building.workersLimit > 0 ? ` · ${building.workersLimit} мест` : ''}`;
      const description = make('span', 'list-detail');
      description.textContent = building.description;
      info.append(label, detail, description);

      const selected = state.buildType === building.id;
      const choose = button(selected ? 'Отмена' : 'Выбрать', `build-${building.id}`);
      choose.disabled = state.busy || !state.online;
      choose.dataset.active = String(selected);
      choose.addEventListener('click', () => {
        if (selected) handlers.onCancelBuild();
        else handlers.onSelectBuilding(building.id);
      });
      row.append(info, choose);
      buildList.append(row);
    }

    buildingList.replaceChildren();
    if (snapshot.buildings.length === 0) {
      const empty = make('p', 'empty', 'buildings-empty');
      empty.textContent = 'Пока ничего не построено';
      buildingList.append(empty);
      return;
    }

    for (const building of snapshot.buildings) {
      const testId = `building-${building.type}-${building.x}-${building.y}`;
      const row = make('div', 'list-row', testId);
      const info = make('div', 'list-info');
      const label = make('span', 'list-title');
      label.textContent = `${building.label} (${building.x}, ${building.y})`;
      const detail = make('span', 'list-detail mono');
      const delivered = building.materials
        .map(
          (material) =>
            `${itemLabel(snapshot, material.item)} ${material.delivered}/${material.required}`
        )
        .join(' · ');
      const progress =
        building.status === 'awaiting_materials'
          ? delivered
          : `${Math.min(100, Math.round((building.workDone / Math.max(1, building.workRequired)) * 100))}%`;
      detail.textContent = `${statusLabel[building.status] ?? building.status} · ${progress}`;
      info.append(label, detail);

      if (building.status === 'awaiting_materials' || building.status === 'building') {
        const bar = make('span', 'progress');
        const fill = make('span', 'progress-fill');
        const totalRequired = building.materials.reduce(
          (sum, material) => sum + material.required,
          0
        );
        const totalDelivered = building.materials.reduce(
          (sum, material) => sum + material.delivered,
          0
        );
        const ratio =
          building.status === 'awaiting_materials'
            ? totalDelivered / Math.max(1, totalRequired)
            : building.workDone / Math.max(1, building.workRequired);
        fill.style.width = `${Math.round(Math.min(1, ratio) * 100)}%`;
        bar.append(fill);
        info.append(bar);
      }

      if (building.status === 'complete') {
        const demolish = button('Снести', `demolish-${building.type}-${building.x}-${building.y}`);
        demolish.disabled = state.busy || !state.online;
        demolish.addEventListener('click', () => handlers.onDemolish(building.id));
        row.append(info, demolish);
      } else {
        row.append(info);
      }
      buildingList.append(row);
    }
  };

  const update = (state: OverlayState): void => {
    const { snapshot } = state;
    sync.textContent = state.online ? 'онлайн' : 'офлайн';
    sync.dataset.mode = state.online ? 'online' : 'offline';
    build.textContent = `v${snapshot?.buildVersion ?? __APP_VERSION__}`;

    playerValue.textContent = snapshot ? snapshot.player.id.slice(0, 8) : '—';
    const biome = snapshot?.catalog.biomes.find(
      (item) => item.id === snapshot.sectors[0]?.biome
    );
    biomeValue.textContent = biome?.label ?? snapshot?.sectors[0]?.biome ?? '—';
    tickValue.textContent = snapshot ? String(snapshot.tick) : '—';
    versionValue.textContent = snapshot ? String(snapshot.version) : '—';
    sectorsValue.textContent = snapshot ? String(snapshot.stats.sectors) : '—';
    reachableValue.textContent = snapshot ? String(snapshot.stats.reachable) : '—';
    blockedValue.textContent = snapshot ? String(snapshot.stats.blocked) : '—';
    clearingsValue.textContent = snapshot
      ? `${snapshot.stats.activeClearings} / ${snapshot.stats.clearedCells}`
      : '—';
    storageValue.textContent = snapshot
      ? `${snapshot.stats.storageVolume} / ${snapshot.stats.storageCapacity}`
      : '—';
    haulsValue.textContent = snapshot
      ? `${snapshot.stats.activeHauls} · свободно ${snapshot.stats.idleCarriers}`
      : '—';
    extractionValue.textContent = snapshot
      ? `${snapshot.stats.activeNodes} точек`
      : '—';

    moveButton.disabled = !snapshot || !state.online || state.busy;
    moveTenButton.disabled = !snapshot || !state.online || state.busy;
    moveThirtyButton.disabled = !snapshot || !state.online || state.busy;
    runButton.disabled = !snapshot || !state.online;
    runButton.textContent = state.running ? '⏸ Пауза' : '▶ Авто';
    runButton.dataset.active = String(state.running);
    demoButton.disabled = !snapshot || !state.online || state.busy;
    centerButton.disabled = !snapshot;
    personButton.dataset.active = String(state.transport === 'person');
    cartButton.dataset.active = String(state.transport === 'cart');
    retryButton.hidden = state.online && !state.error;

    if (snapshot) {
      renderConstruction(snapshot, state);
      renderEconomy(snapshot, state);
      renderFrontier(snapshot, state);
      renderTasks(snapshot, state);
    } else {
      frontierList.replaceChildren();
      tasksList.replaceChildren();
      nodesList.replaceChildren();
      storageList.replaceChildren();
      buildList.replaceChildren();
      buildingList.replaceChildren();
    }

    message.textContent = state.error ?? (state.busy ? 'Синхронизация…' : '');
    message.dataset.tone = state.error ? 'error' : 'info';
    cacheNote.textContent = state.cachedAt
      ? `Локальный кеш: ${new Date(state.cachedAt).toLocaleTimeString('ru-RU')}`
      : snapshot
        ? `Снимок сервера: ${new Date(snapshot.serverTime).toLocaleTimeString('ru-RU')}`
        : '';
  };

  moveButton.addEventListener('click', () => handlers.onAdvance(1));
  moveTenButton.addEventListener('click', () => handlers.onAdvance(10));
  moveThirtyButton.addEventListener('click', () => handlers.onAdvance(30));
  runButton.addEventListener('click', handlers.onToggleRun);
  demoButton.addEventListener('click', handlers.onDemo);
  centerButton.addEventListener('click', handlers.onRecenter);
  personButton.addEventListener('click', () => handlers.onTransport('person'));
  cartButton.addEventListener('click', () => handlers.onTransport('cart'));
  retryButton.addEventListener('click', handlers.onRetry);

  return { update };
}
