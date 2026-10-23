import Phaser from "phaser";
import "../simple/simple.css";
import type {
  BuildingInfo,
  BuildingSnapshot,
  ResidentSnapshot,
  SchoolId,
  WorldSnapshot,
} from "@avanpost/shared";
import { WorldScene, type PlacementInfo } from "../game/scene";
import {
  PROFESSION_COLORS,
  PROFESSION_DESCRIPTIONS,
  SCHOOLS,
} from "../simple/professions";
import {
  advanceWorld,
  ApiError,
  cancelCraft,
  cancelResearch,
  fetchState,
  gatherNode,
  sendBuild,
  sendSchool,
  startCraft,
  startResearch,
  startSession,
  stopGather,
  type CommandResult,
} from "../simple/net";

const SERVER_POLL_MS = 400;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

const canvas = required<HTMLCanvasElement>("#world");
const woodElement = required<HTMLElement>('[data-testid="wood"]');
const stoneElement = required<HTMLElement>('[data-testid="stone"]');
const serverStatus = required<HTMLElement>('[data-testid="server-status"]');
const statusElement = required<HTMLElement>('[data-testid="status"]');
const residentsToggle = required<HTMLButtonElement>("#residents-toggle");
const residentsPanel = required<HTMLElement>("#residents-panel");
const residentsClose = required<HTMLButtonElement>("#residents-close");
const residentsList = required<HTMLUListElement>("#residents-list");
const populationStatus = required<HTMLElement>("#population-status");
const residentDetail = required<HTMLElement>("#resident-detail");
const craftToggle = required<HTMLButtonElement>("#craft-toggle");
const craftPanel = required<HTMLElement>("#craft-panel");
const craftClose = required<HTMLButtonElement>("#craft-close");
const craftList = required<HTMLUListElement>("#craft-list");
const craftStatus = required<HTMLElement>("#craft-status");
const researchToggle = required<HTMLButtonElement>("#research-toggle");
const researchPanel = required<HTMLElement>("#research-panel");
const researchClose = required<HTMLButtonElement>("#research-close");
const researchList = required<HTMLUListElement>("#research-list");
const researchStatus = required<HTMLElement>("#research-status");
const researchScholar = required<HTMLSelectElement>("#research-scholar");
const placementBar = required<HTMLElement>("#placement-bar");
const placementTitle = required<HTMLElement>("#placement-title");
const placementHint = required<HTMLElement>("#placement-hint");
const placementConfirm = required<HTMLButtonElement>("#placement-confirm");
const placementCancel = required<HTMLButtonElement>("#placement-cancel");
const treeHotspot = required<HTMLButtonElement>("#tree-hotspot");
const treeMenu = required<HTMLElement>("#tree-menu");
const chopButton = required<HTMLButtonElement>("#chop");

let snapshot: WorldSnapshot | null = null;
let scene: WorldScene | null = null;
let game: Phaser.Game | null = null;
let busy = false;
let selectedResidentId: string | null = null;
let placementType: string | null = null;
let commandQueue: Promise<unknown> = Promise.resolve();

function setStatus(message: string): void {
  statusElement.textContent = message;
}

function sumItem(item: string): number {
  return (
    snapshot?.storages.reduce(
      (total, storage) =>
        total +
        (storage.contents.find((entry) => entry.item === item)?.qty ?? 0),
      0,
    ) ?? 0
  );
}

function buildingOfType(type: string): BuildingSnapshot | undefined {
  return snapshot?.buildings.find(
    (building) => building.type === type && building.status !== "demolished",
  );
}

function buildingInfo(type: string): BuildingInfo | undefined {
  return snapshot?.catalog.buildings.find((building) => building.id === type);
}

function residentById(id: string | null): ResidentSnapshot | undefined {
  if (!id) return undefined;
  return snapshot?.residents.find((resident) => resident.id === id);
}

function residentStateLabel(resident: ResidentSnapshot): string {
  if (resident.state === "school") return "Учится";
  const laborer = snapshot?.laborers.find(
    (candidate) => candidate.residentId === resident.id,
  );
  if (laborer && laborer.status !== "idle") return "Работает";
  return "Свободен";
}

function resourceTitle(item: string): string {
  return (
    snapshot?.catalog.items.find((entry) => entry.id === item)?.label ?? item
  );
}

function enqueueCommand(
  task: (current: WorldSnapshot) => Promise<WorldSnapshot | CommandResult>,
): Promise<WorldSnapshot | CommandResult> {
  const run = commandQueue.then(() => {
    if (!snapshot) {
      throw new Error("no active session");
    }
    return task(snapshot);
  });
  commandQueue = run.catch(() => undefined);
  return run;
}

function resultSnapshot(result: WorldSnapshot | CommandResult): WorldSnapshot {
  return "snapshot" in result ? result.snapshot : result;
}

function resultCatchingUp(result: WorldSnapshot | CommandResult): boolean {
  return "catchingUp" in result && result.catchingUp === true;
}

function sync(next: WorldSnapshot): void {
  snapshot = next;
  if (
    selectedResidentId &&
    !next.residents.some((resident) => resident.id === selectedResidentId)
  ) {
    selectedResidentId = null;
  }
  if (!selectedResidentId) {
    selectedResidentId = next.residents[0]?.id ?? null;
  }

  woodElement.textContent = String(sumItem("logs"));
  stoneElement.textContent = String(sumItem("stone"));
  serverStatus.textContent = `Сервер: тик ${next.tick} · v${next.version}`;
  document.body.dataset.house = houseStatus(next);

  scene?.updateSnapshot(next);
  renderBuildbar();
  renderResidents();
  if (!craftPanel.hidden) renderCraft();
  if (!researchPanel.hidden) renderResearch();
  positionTreeHotspot();
}

function houseStatus(next: WorldSnapshot): string {
  const house = next.buildings.find(
    (building) => building.type === "house" && building.status !== "demolished",
  );
  if (!house) return "not-built";
  return house.status === "complete" ? "built" : "building";
}

function renderBuildbar(): void {
  if (!snapshot) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-building]",
  )) {
    const type = button.dataset.building ?? "";
    const info = buildingInfo(type);
    const existing = buildingOfType(type);
    const cost = info
      ? Object.entries(info.materials)
          .map(([item, qty]) => `${qty} ${resourceTitle(item).toLowerCase()}`)
          .join(", ")
      : "";
    const small = button.querySelector<HTMLElement>(".build-copy small");
    if (type === "storehouse" && existing) {
      button.disabled = true;
      if (small) small.textContent = "Построен";
      continue;
    }
    if (existing) {
      button.disabled = true;
      if (small) {
        small.textContent =
          existing.status === "complete" ? "Готово" : "Строится";
      }
      continue;
    }
    button.disabled = busy || placementType !== null;
    if (small) small.textContent = cost || "Строится сервером";
  }
}

function renderPopulationStatus(): void {
  const population = snapshot?.population;
  if (!population) {
    populationStatus.textContent = "Поселение: —";
    return;
  }
  populationStatus.replaceChildren();
  const count = document.createElement("span");
  count.setAttribute("data-testid", "population-count");
  count.textContent = `Жителей ${population.residents} / ${population.capacity}`;
  const slots = document.createElement("span");
  slots.setAttribute("data-testid", "population-slots");
  slots.className = "population-slots";
  slots.textContent =
    population.freeSlots > 0
      ? `свободно мест: ${population.freeSlots}`
      : "свободных мест нет";
  populationStatus.append(count, slots);
}

function renderResidents(): void {
  if (!snapshot) return;
  renderPopulationStatus();
  const selected =
    residentById(selectedResidentId) ?? snapshot.residents[0] ?? undefined;

  residentsList.replaceChildren();
  for (const resident of snapshot.residents) {
    const item = document.createElement("li");
    item.className =
      "resident-row" +
      (resident.id === selected?.id ? " is-selected" : "") +
      (resident.state === "school" ? " is-studying" : "");
    item.setAttribute("data-testid", "resident-row");
    item.dataset.id = resident.id;

    const name = document.createElement("span");
    name.className = "resident-name";
    name.textContent = resident.name;

    const badge = document.createElement("span");
    badge.className = "resident-badge";
    badge.style.setProperty(
      "--prof-color",
      PROFESSION_COLORS[resident.profession],
    );
    badge.textContent = resident.profession;

    const state = document.createElement("span");
    state.className = "resident-state";
    state.textContent = residentStateLabel(resident);

    item.append(name, badge, state);
    residentsList.append(item);
  }

  residentDetail.replaceChildren();
  if (!selected) return;

  const isStudent = selected.state === "school";
  const knows = (school: SchoolId): boolean =>
    selected.schools.includes(school);

  const title = document.createElement("div");
  title.className = "resident-title";
  const name = document.createElement("b");
  name.textContent = selected.name;
  const profession = document.createElement("span");
  profession.setAttribute("data-testid", "resident-profession");
  profession.className = "resident-profession";
  profession.style.setProperty(
    "--prof-color",
    PROFESSION_COLORS[selected.profession],
  );
  profession.textContent = selected.profession;
  title.append(name, profession);

  const description = document.createElement("p");
  description.className = "resident-desc";
  description.textContent = PROFESSION_DESCRIPTIONS[selected.profession];

  const traits = document.createElement("p");
  traits.className = "resident-traits";
  traits.textContent = `Таланты: ${selected.traits.join(", ")}`;

  const schoolsLine = document.createElement("p");
  schoolsLine.className = "resident-schools";
  const learned = (["gather", "craft"] as SchoolId[])
    .filter(knows)
    .map((school) => SCHOOLS[school].short);
  schoolsLine.textContent =
    learned.length > 0 ? `Школы: ${learned.join(" + ")}` : "Школы: нет";

  const xpLine = document.createElement("div");
  xpLine.className = "resident-xp";
  const xpLabel = document.createElement("span");
  xpLabel.setAttribute("data-testid", "resident-level");
  xpLabel.className = "resident-level";
  xpLabel.textContent =
    selected.xpToNext > 0
      ? `Ур. ${selected.level} · опыт ${selected.xp} · до след. ${selected.xpToNext}`
      : `Ур. ${selected.level} · опыт ${selected.xp} · максимум`;
  const xpBar = document.createElement("span");
  xpBar.className = "resident-xp-bar";
  const fill = document.createElement("span");
  fill.className = "resident-xp-fill";
  fill.style.width = `${Math.round(
    (selected.xpInto / Math.max(1, selected.xpSpan)) * 100,
  )}%`;
  xpBar.append(fill);
  xpLine.append(xpLabel, xpBar);

  const assignButton = document.createElement("button");
  assignButton.type = "button";
  assignButton.setAttribute("data-testid", "assign-worker");
  assignButton.setAttribute("data-action", "assign");
  assignButton.textContent =
    selectedResidentId === selected.id
      ? "Выбран для добычи"
      : "Выбрать для добычи";
  assignButton.disabled = isStudent;

  const gatherButton = document.createElement("button");
  gatherButton.type = "button";
  gatherButton.setAttribute("data-testid", "send-school-gather");
  gatherButton.setAttribute("data-action", "school-gather");
  gatherButton.textContent = `Учиться: ${SCHOOLS.gather.label}`;
  gatherButton.disabled = isStudent || knows("gather");

  const craftButton = document.createElement("button");
  craftButton.type = "button";
  craftButton.setAttribute("data-testid", "send-school-craft");
  craftButton.setAttribute("data-action", "school-craft");
  craftButton.textContent = `Учиться: ${SCHOOLS.craft.label}`;
  craftButton.disabled = isStudent || knows("craft");

  residentDetail.append(
    title,
    description,
    traits,
    schoolsLine,
    xpLine,
    assignButton,
    gatherButton,
    craftButton,
  );

  if (selected.training) {
    const training = document.createElement("p");
    training.className = "resident-schools";
    training.setAttribute("data-testid", "resident-training");
    const left = selected.training.leftTicks;
    const total = Math.max(1, selected.training.totalTicks);
    training.textContent = `${SCHOOLS[selected.training.schoolId].label}: осталось ${left} тиков (${Math.round(
      (1 - left / total) * 100,
    )}%)`;
    residentDetail.append(training);
  }
}

function selectedResidentForGather(): string | null {
  const resident = residentById(selectedResidentId);
  if (!resident || resident.state === "school") return null;
  const laborer = snapshot?.laborers.find(
    (candidate) => candidate.residentId === resident.id,
  );
  if (!laborer || laborer.role !== "gatherer") return null;
  return resident.id;
}

function woodNode() {
  return (
    snapshot?.nodes.find((node) => node.item === "logs" && node.amount > 0) ??
    null
  );
}

function positionTreeHotspot(): void {
  const node = woodNode();
  if (!scene || !node) {
    treeHotspot.hidden = true;
    return;
  }
  const point = scene.screenPointFor(node.sectorId, node.x, node.y);
  if (!point) {
    treeHotspot.hidden = true;
    return;
  }
  treeHotspot.hidden = false;
  treeHotspot.style.left = `${point.x - 48}px`;
  treeHotspot.style.top = `${point.y - 86}px`;
  treeHotspot.style.width = "96px";
  treeHotspot.style.height = "120px";
  treeHotspot.setAttribute(
    "aria-label",
    `${node.label}: ${node.amount} ${resourceTitle(node.item)}`,
  );
}

function openTreeMenu(): void {
  const node = woodNode();
  if (!node) {
    setStatus("Нет доступного лесного участка");
    return;
  }
  if (placementType) scene?.cancelPlacement();
  chopButton.textContent = node.active ? "Остановить добычу" : "Добывать лес";
  treeMenu.hidden = false;
  const hotspot = treeHotspot.getBoundingClientRect();
  const menuWidth = treeMenu.offsetWidth;
  const menuHeight = treeMenu.offsetHeight;
  let left = hotspot.left + hotspot.width / 2 - menuWidth / 2;
  left = Math.max(10, Math.min(window.innerWidth - menuWidth - 10, left));
  let top = hotspot.top - menuHeight - 10;
  if (top < 80) top = hotspot.bottom + 10;
  treeMenu.style.left = `${left}px`;
  treeMenu.style.top = `${Math.max(8, top)}px`;
}

function closeTreeMenu(): void {
  treeMenu.hidden = true;
}

async function toggleGather(): Promise<void> {
  closeTreeMenu();
  const node = woodNode();
  if (!node) {
    setStatus("Нет доступного лесного участка");
    return;
  }
  if (busy) {
    setStatus("Дождитесь окончания текущей команды");
    return;
  }
  busy = true;
  renderBuildbar();
  setStatus(node.active ? "Останавливаю добычу…" : "Отправляю добытчика…");
  try {
    const result = await enqueueCommand((current) =>
      node.active
        ? stopGather(current, node.id)
        : gatherNode(current, node.id, selectedResidentForGather()),
    );
    sync(resultSnapshot(result));
    if (resultCatchingUp(result)) {
      setStatus("Мир синхронизируется, подождите…");
    } else {
      setStatus(
        node.active
          ? "Добыча остановлена"
          : "Добытчик идёт к лесному участку",
      );
    }
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Не удалось начать добычу",
    );
  } finally {
    busy = false;
    renderBuildbar();
  }
}

function renderCraft(): void {
  if (!snapshot) return;
  const workshop = buildingOfType("workshop");
  const storedPlanks = sumItem("planks");
  craftStatus.textContent = `${
    workshop
      ? workshop.status === "complete"
        ? "Мастерская готова к работе"
        : "Мастерская строится…"
      : "Мастерская не построена"
  } · Доски на складе: ${storedPlanks}`;
  craftList.replaceChildren();

  const order = snapshot.craftOrders.find(
    (candidate) => candidate.buildingId === workshop?.id,
  );
  const craftsmen = snapshot.residents.filter(
    (resident) => resident.profession === "Ремесленник",
  );

  for (const recipe of snapshot.catalog.recipes) {
    const item = document.createElement("li");
    item.className = "craft-row";
    item.setAttribute("data-testid", "craft-row");
    item.dataset.recipe = recipe.id;

    const title = document.createElement("span");
    title.className = "craft-title";
    const inputLine = Object.entries(recipe.inputs)
      .map(([name, qty]) => `${qty} ${name}`)
      .join(" + ");
    const outputLine = Object.entries(recipe.outputs)
      .map(([name, qty]) => `${qty} ${name}`)
      .join(" + ");
    title.textContent = `${recipe.label}: ${inputLine} → ${outputLine}`;

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-testid", "craft-start");
    button.dataset.action = "craft-start";
    button.dataset.recipe = recipe.id;

    const researched = snapshot.research.researched.includes(
      recipe.unlockTechnology,
    );
    const isActive = order?.recipeId === recipe.id;
    if (isActive) {
      button.textContent = "Идёт…";
      button.disabled = true;
    } else if (!workshop || workshop.status !== "complete") {
      button.textContent = "Нужна мастерская";
      button.disabled = true;
    } else if (!researched) {
      button.textContent = "Нужна технология";
      button.disabled = true;
    } else if (order) {
      button.textContent = "Мастерская занята";
      button.disabled = true;
    } else if (craftsmen.length === 0) {
      button.textContent = "Нужен ремесленник";
      button.disabled = true;
    } else {
      button.textContent = "Ремесло";
      button.disabled = false;
    }
    item.append(title, button);
    craftList.append(item);
  }

  if (order) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "craft-cancel";
    cancel.setAttribute("data-testid", "craft-cancel");
    cancel.dataset.action = "craft-cancel";
    cancel.dataset.building = order.buildingId;
    cancel.textContent = "Отменить ремесло";
    craftList.append(cancel);
  }

  if (craftsmen.length === 0) {
    const hint = document.createElement("li");
    hint.className = "craft-hint";
    hint.setAttribute("data-testid", "craft-hint");
    hint.textContent = "Нет ремесленника — отправь жителя в школу ремёсел.";
    craftList.append(hint);
  }
}

function renderResearch(): void {
  if (!snapshot) return;
  const research = snapshot.research;
  const academyComplete = buildingOfType("academy")?.status === "complete";
  researchStatus.textContent = `Очки исследования: ${research.points} · +${research.pointsPerTick}/тик`;

  const selectedScholar = researchScholar.value;
  researchScholar.replaceChildren();
  const noScholar = document.createElement("option");
  noScholar.value = "";
  noScholar.textContent = "Без учёного";
  researchScholar.append(noScholar);
  for (const resident of snapshot.residents.filter(
    (candidate) => candidate.state !== "school",
  )) {
    const option = document.createElement("option");
    option.value = resident.id;
    option.textContent = `${resident.name} · ${resident.profession}`;
    researchScholar.append(option);
  }
  researchScholar.value = snapshot.residents.some(
    (resident) => resident.id === selectedScholar,
  )
    ? selectedScholar
    : "";
  researchScholar.disabled = Boolean(research.active);

  researchList.replaceChildren();
  for (const node of snapshot.techTree) {
    const item = document.createElement("li");
    item.className = "research-row";
    item.setAttribute("data-testid", "research-row");
    item.dataset.tech = node.id;

    const title = document.createElement("span");
    title.className = "research-title";
    title.textContent = `${node.label} · ${node.cost} RP`;

    const state = document.createElement("span");
    state.className = "research-state";
    state.setAttribute("data-testid", "research-state");
    if (node.researched) {
      state.textContent = "Изучено";
    } else if (research.active?.technologyId === node.id) {
      state.textContent =
        research.active.status === "active"
          ? `В работе ${research.active.progress}/${research.active.cost}`
          : "Ждёт учёного";
    } else if (!node.available) {
      state.textContent = "Недоступно";
    } else {
      state.textContent = "Доступно";
    }
    item.append(title, state);

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-testid", "research-start");
    button.dataset.action = "research-start";
    button.dataset.tech = node.id;
    if (node.researched) {
      button.textContent = "Изучено";
      button.disabled = true;
    } else if (research.active?.technologyId === node.id) {
      button.textContent = "Идёт…";
      button.disabled = true;
    } else if (researchScholar.value && !academyComplete) {
      button.textContent = "Нужна академия";
      button.disabled = true;
    } else if (!node.available) {
      button.textContent = "Недоступно";
      button.disabled = true;
    } else if (research.active) {
      button.textContent = "Слот занят";
      button.disabled = true;
    } else {
      button.textContent = "Изучать";
      button.disabled = false;
    }
    item.append(button);
    researchList.append(item);
  }

  if (research.active) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "research-cancel";
    cancel.setAttribute("data-testid", "research-cancel");
    cancel.dataset.action = "research-cancel";
    cancel.textContent = "Отменить исследование";
    researchList.append(cancel);
  }
}

function beginPlacement(type: string): void {
  if (!snapshot || busy) return;
  const existing = buildingOfType(type);
  if (existing && type !== "storehouse") {
    setStatus(
      existing.status === "complete"
        ? "Здание уже готово"
        : "Здание уже строится",
    );
    return;
  }
  if (type === "storehouse" && existing) {
    setStatus("Склад уже построен");
    return;
  }
  const info = buildingInfo(type);
  if (!info) {
    setStatus("Неизвестный тип здания");
    return;
  }
  closeTreeMenu();
  placementType = type;
  const placement: PlacementInfo = {
    type,
    label: info.label,
    materials: info.materials,
    footprint: info.footprint ?? { width: 1, height: 1 },
  };
  scene?.setPlacement(placement);
  placementBar.hidden = false;
  placementTitle.textContent = `Разместить: ${info.label}`;
  placementHint.textContent =
    "Зелёная клетка — можно, жёлтая — ждёт материалы";
  setStatus(
    "Выберите клетку на карте. Escape или правый клик отменяют размещение.",
  );
  renderBuildbar();
}

function clearPlacement(): void {
  placementType = null;
  scene?.setPlacement(null);
  placementBar.hidden = true;
  renderBuildbar();
}

function refreshPlacementHint(message: string): void {
  placementHint.textContent = message;
}

async function placeBuilding(
  sectorId: string,
  x: number,
  y: number,
): Promise<void> {
  if (!snapshot || !placementType || busy) return;
  const type = placementType;
  busy = true;
  renderBuildbar();
  setStatus("Отправляю заказ на строительство…");
  try {
    const result = await enqueueCommand((current) =>
      sendBuild(current, {
        building_type: type,
        sector_id: sectorId,
        x,
        y,
      }),
    );
    sync(resultSnapshot(result));
    clearPlacement();
    setStatus(
      resultCatchingUp(result)
        ? "Мир синхронизируется, подождите…"
        : "Заказ на строительство принят",
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось начать стройку";
    setStatus(message);
    refreshPlacementHint(message);
    const fresh = await fetchState().catch(() => null);
    if (fresh) sync(fresh);
  } finally {
    busy = false;
    renderBuildbar();
  }
}

async function dispatchSchool(
  residentId: string,
  school: SchoolId,
): Promise<void> {
  if (busy) {
    setStatus("Дождитесь окончания текущей команды");
    return;
  }
  busy = true;
  setStatus("Отправляю жителя в школу…");
  try {
    const result = await enqueueCommand((current) =>
      sendSchool(current, residentId, school),
    );
    sync(resultSnapshot(result));
    setStatus(
      resultCatchingUp(result)
        ? "Мир синхронизируется, подождите…"
        : `Житель отправлен в «${SCHOOLS[school].label}»`,
    );
  } catch (error) {
    setStatus(
      error instanceof ApiError
        ? `Сервер отклонил обучение: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Не удалось отправить в школу",
    );
  } finally {
    busy = false;
    renderBuildbar();
  }
}

async function startCraftFor(recipeId: string): Promise<void> {
  const workshop = buildingOfType("workshop");
  if (!workshop) {
    setStatus("Сначала постройте мастерскую");
    return;
  }
  const worker = snapshot?.residents.find(
    (resident) => resident.profession === "Ремесленник",
  );
  if (!worker) {
    setStatus("Сначала обучите ремесленника");
    return;
  }
  setStatus("Запускаю ремесло…");
  try {
    const result = await enqueueCommand((current) =>
      startCraft(current, workshop.id, recipeId, worker.id),
    );
    sync(resultSnapshot(result));
    renderCraft();
    setStatus("Ремесло запущено");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Не удалось запустить ремесло",
    );
  }
}

async function startResearchFor(technologyId: string): Promise<void> {
  setStatus("Запускаю исследование…");
  try {
    const result = await enqueueCommand((current) =>
      startResearch(current, technologyId, researchScholar.value || null),
    );
    sync(resultSnapshot(result));
    renderResearch();
    setStatus("Исследование запущено");
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : "Не удалось запустить исследование",
    );
  }
}

async function tickServer(): Promise<void> {
  if (!snapshot) return;
  try {
    let result = await enqueueCommand((current) => advanceWorld(current));
    sync(resultSnapshot(result));
    while (resultCatchingUp(result)) {
      setStatus("Синхронизация мира…");
      result = await enqueueCommand((current) => advanceWorld(current));
      sync(resultSnapshot(result));
    }
  } catch {
    // Keep the last known state; the next poll retries.
  }
}

function mount(next: WorldSnapshot): void {
  const handlers = {
    onCellClick: (sectorId: string, x: number, y: number) => {
      if (placementType) {
        void placeBuilding(sectorId, x, y);
        return;
      }
      const node = snapshot?.nodes.find(
        (candidate) =>
          candidate.sectorId === sectorId &&
          candidate.x === x &&
          candidate.y === y,
      );
      if (node && node.item === "logs") {
        void toggleGather();
      }
    },
    onBuildClick: (sectorId: string, x: number, y: number) => {
      if (placementType) void placeBuilding(sectorId, x, y);
    },
    onFrontierClick: () => {
      setStatus("Расширение сектора пока недоступно в этом клиенте");
    },
    onNodeClick: (nodeId: string) => {
      const node = snapshot?.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      void toggleGather();
    },
    onPlacementConfirm: (sectorId: string, x: number, y: number) => {
      void placeBuilding(sectorId, x, y);
    },
    onPlacementRejected: (reason: string) => {
      setStatus(reason);
      refreshPlacementHint(reason);
    },
    onPlacementCancel: () => {
      placementType = null;
      placementBar.hidden = true;
      renderBuildbar();
      setStatus("Размещение отменено");
    },
  };

  scene = new WorldScene(next, handlers);
  game = new Phaser.Game({
    type: Phaser.CANVAS,
    canvas: canvas as HTMLCanvasElement,
    backgroundColor: "#0b1118",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    scene: [scene],
  });
  sync(next);
}

async function bootstrap(): Promise<void> {
  try {
    const initial = await startSession();
    mount(initial);
  } catch (error) {
    setStatus(
      `Не удалось связаться с сервером: ${
        error instanceof Error ? error.message : "ошибка"
      }`,
    );
    return;
  }
  window.setInterval(() => {
    void tickServer();
  }, SERVER_POLL_MS);
  window.setInterval(positionTreeHotspot, 200);
}

residentsToggle.addEventListener("click", () => {
  const willOpen = residentsPanel.hidden;
  residentsPanel.hidden = !willOpen;
  residentsToggle.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) {
    craftPanel.hidden = true;
    researchPanel.hidden = true;
    craftToggle.setAttribute("aria-expanded", "false");
    researchToggle.setAttribute("aria-expanded", "false");
    renderResidents();
  }
});
residentsClose.addEventListener("click", () => {
  residentsPanel.hidden = true;
  residentsToggle.setAttribute("aria-expanded", "false");
});
residentsList.addEventListener("click", (event) => {
  const row = (event.target as Element).closest<HTMLElement>("[data-id]");
  if (!row?.dataset.id) return;
  selectedResidentId = row.dataset.id;
  renderResidents();
});
residentDetail.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!button?.dataset.action || !selectedResidentId) return;
  if (button.dataset.action === "assign") {
    const resident = residentById(selectedResidentId);
    setStatus(
      resident
        ? `${resident.name} выбран(а) для добычи`
        : "Житель не найден",
    );
    renderResidents();
  } else if (button.dataset.action === "school-gather") {
    void dispatchSchool(selectedResidentId, "gather");
  } else if (button.dataset.action === "school-craft") {
    void dispatchSchool(selectedResidentId, "craft");
  }
});

craftToggle.addEventListener("click", () => {
  const willOpen = craftPanel.hidden;
  craftPanel.hidden = !willOpen;
  craftToggle.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) {
    residentsPanel.hidden = true;
    researchPanel.hidden = true;
    residentsToggle.setAttribute("aria-expanded", "false");
    researchToggle.setAttribute("aria-expanded", "false");
    renderCraft();
  }
});
craftClose.addEventListener("click", () => {
  craftPanel.hidden = true;
  craftToggle.setAttribute("aria-expanded", "false");
});
craftList.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!button) return;
  if (button.dataset.action === "craft-start" && button.dataset.recipe) {
    void startCraftFor(button.dataset.recipe);
  } else if (
    button.dataset.action === "craft-cancel" &&
    button.dataset.building
  ) {
    const buildingId = button.dataset.building;
    void enqueueCommand((current) => cancelCraft(current, buildingId))
      .then((result) => {
        sync(resultSnapshot(result));
        renderCraft();
        setStatus("Ремесло отменено");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Ошибка отмены");
      });
  }
});

researchToggle.addEventListener("click", () => {
  const willOpen = researchPanel.hidden;
  researchPanel.hidden = !willOpen;
  researchToggle.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) {
    residentsPanel.hidden = true;
    craftPanel.hidden = true;
    residentsToggle.setAttribute("aria-expanded", "false");
    craftToggle.setAttribute("aria-expanded", "false");
    renderResearch();
  }
});
researchClose.addEventListener("click", () => {
  researchPanel.hidden = true;
  researchToggle.setAttribute("aria-expanded", "false");
});
researchScholar.addEventListener("change", renderResearch);
researchList.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!button) return;
  if (button.dataset.action === "research-start" && button.dataset.tech) {
    void startResearchFor(button.dataset.tech);
  } else if (button.dataset.action === "research-cancel") {
    void enqueueCommand((current) => cancelResearch(current))
      .then((result) => {
        sync(resultSnapshot(result));
        renderResearch();
        setStatus("Исследование отменено");
      })
      .catch((error: unknown) => {
        setStatus(
          error instanceof Error ? error.message : "Ошибка отмены исследования",
        );
      });
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-building]",
)) {
  button.addEventListener("click", () => {
    const type = button.dataset.building;
    if (type) beginPlacement(type);
  });
}

treeHotspot.addEventListener("click", () => {
  if (treeMenu.hidden) openTreeMenu();
  else closeTreeMenu();
});
chopButton.addEventListener("click", () => {
  void toggleGather();
});
placementCancel.addEventListener("click", () => {
  scene?.cancelPlacement();
});
placementConfirm.addEventListener("click", () => {
  scene?.confirmPendingPlacement();
});
document.addEventListener("pointerdown", (event) => {
  if (treeMenu.hidden) return;
  const target = event.target;
  if (
    target instanceof Node &&
    (treeMenu.contains(target) || treeHotspot.contains(target))
  ) {
    return;
  }
  closeTreeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTreeMenu();
    if (placementType) scene?.cancelPlacement();
  }
});

declare global {
  interface Window {
    __avanpost?: {
      placementPoint: () => ReturnType<WorldScene["findPlacementPoint"]>;
      snapshot: () => WorldSnapshot | null;
      tick: () => Promise<void>;
    };
  }
}

window.__avanpost = {
  placementPoint: () => scene?.findPlacementPoint() ?? null,
  snapshot: () => snapshot,
  tick: tickServer,
};

void bootstrap();
