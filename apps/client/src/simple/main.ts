import "./simple.css";
import {
  PROFESSION_COLORS,
  PROFESSION_DESCRIPTIONS,
  SCHOOLS,
  type Profession,
  type SchoolId,
} from "./professions";
import {
  advanceWorld,
  cancelCraft,
  cancelResearch,
  fetchState,
  sendBuild,
  sendSchool,
  startCraft,
  startResearch,
  startSession,
  type ResidentSnapshot,
} from "./net";
import type { BuildingSnapshot, WorldSnapshot } from "@avanpost/shared";

type BuildableId = "house" | "sawmill";
type BuildingId = BuildableId | "storehouse";
type PlacementBuildingId = "workshop" | "academy";
type Job = { type: "chop" } | { type: "build"; building: BuildableId };
type Phase = "idle" | "walk" | "work" | "carry" | "unload" | "returning";

interface Plot {
  label: string;
  cost: number;
  built: boolean;
  scheduled: boolean;
  progress: number;
  x: number;
}

interface GrassTuft {
  x: number;
  y: number;
  height: number;
  lean: number;
}

const params = new URLSearchParams(window.location.search);
const FAST = params.get("fast") === "1";
const SPEED = FAST ? 4 : 1;
const CHOP_SECONDS = 1.25 / SPEED;
const BUILD_SECONDS = 2.6 / SPEED;
const UNLOAD_SECONDS = 0.3 / SPEED;
const REGROW_SECONDS = 3.2 / SPEED;
const SCHOOL_SECONDS = 6 / SPEED;
const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

const canvas = required<HTMLCanvasElement>("#world");
const context = canvas.getContext("2d");
if (!context) {
  throw new Error("Canvas 2D is unavailable");
}
const ctx = context;

const buildbar = required<HTMLElement>("#buildbar");
const woodElement = required<HTMLElement>('[data-testid="wood"]');
const stoneElement = required<HTMLElement>('[data-testid="stone"]');
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
const placementPicker = required<HTMLElement>("#placement-picker");
const placementTitle = required<HTMLElement>("#placement-title");
const placementCells = required<HTMLElement>("#placement-cells");
const placementCancel = required<HTMLButtonElement>("#placement-cancel");
const serverStatus = required<HTMLElement>('[data-testid="server-status"]');
const statusElement = required<HTMLElement>('[data-testid="status"]');
const treeHotspot = required<HTMLButtonElement>("#tree-hotspot");
const treeMenu = required<HTMLElement>("#tree-menu");
const chopButton = required<HTMLButtonElement>("#chop");

// --- Sprites ----------------------------------------------------------------
const SPRITE_FILES = [
  "tree_full",
  "tree_stump",
  "storehouse",
  "house",
  "sawmill",
  "school",
  "stockpile_logs",
  "worker_idle",
  "worker_walk",
  "worker_chop",
  "worker_carry",
  "worker_hammer",
] as const;
type SpriteName = (typeof SPRITE_FILES)[number];
const SPRITE_CELL = 256;
const spriteImages = new Map<SpriteName, HTMLImageElement>();
for (const name of SPRITE_FILES) {
  const image = new Image();
  image.src = `/assets/avanpost/${name}.png`;
  spriteImages.set(name, image);
}

function spriteReady(name: SpriteName): boolean {
  const image = spriteImages.get(name);
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

/**
 * Draws a 256px sprite cell (content bottom-center anchored at y=248 in cell)
 * so that the sprite's visual bottom lands exactly on yGround.
 */
function drawSprite(
  name: SpriteName,
  x: number,
  yGround: number,
  cellTarget: number,
  options?: { alpha?: number; flip?: boolean; tilt?: number; grow?: number },
): boolean {
  const image = spriteImages.get(name);
  if (!image || !image.complete || image.naturalWidth === 0) {
    return false;
  }
  const k = cellTarget / SPRITE_CELL;
  const grow = options?.grow ?? 1;
  ctx.save();
  ctx.globalAlpha = options?.alpha ?? 1;
  ctx.translate(x, yGround + 8 * k);
  if (options?.tilt) {
    ctx.rotate(options.tilt);
  }
  if (options?.flip) {
    ctx.scale(-1, 1);
  }
  ctx.scale(grow, grow);
  ctx.drawImage(
    image,
    -SPRITE_CELL / 2 * k,
    -SPRITE_CELL * k,
    SPRITE_CELL * k,
    SPRITE_CELL * k,
  );
  ctx.restore();
  return true;
}

// --- Sounds (Web Audio synth, no external files) ----------------------------
let audioContext: AudioContext | null = null;
function ensureAudio(): AudioContext {
  if (!audioContext) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioContext = new Ctor();
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}
document.addEventListener("pointerdown", () => ensureAudio(), { once: true });

function tone(
  frequency: number,
  startOffset: number,
  duration: number,
  volume: number,
  type: OscillatorType = "triangle",
): void {
  const audio = ensureAudio();
  const start = audio.currentTime + startOffset;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playChopHit(): void {
  const audio = ensureAudio();
  const start = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(180, start);
  oscillator.frequency.exponentialRampToValueAtTime(70, start + 0.09);
  gain.gain.setValueAtTime(0.16, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.13);

  const noise = audio.createBufferSource();
  const buffer = audio.createBuffer(1, 2048, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  noise.buffer = buffer;
  const noiseGain = audio.createGain();
  noiseGain.gain.setValueAtTime(0.1, start);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2200;
  noise.connect(filter).connect(noiseGain).connect(audio.destination);
  noise.start(start);
}

function playBuildDone(): void {
  tone(523.25, 0, 0.16, 0.12);
  tone(659.25, 0.1, 0.16, 0.12);
  tone(783.99, 0.2, 0.3, 0.13);
}

function playUnloadDing(): void {
  tone(880, 0, 0.1, 0.09, "sine");
  tone(1174.66, 0.06, 0.16, 0.08, "sine");
}

// --- Particles & floating text ---------------------------------------------
interface Chip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}
interface FloatText {
  x: number;
  y: number;
  life: number;
  text: string;
  color: string;
}
const chips: Chip[] = [];
const floatTexts: FloatText[] = [];

function spawnWoodChips(x: number, y: number): void {
  for (let i = 0; i < 6; i += 1) {
    chips.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y - Math.random() * 30,
      vx: (Math.random() - 0.5) * 130,
      vy: -60 - Math.random() * 90,
      life: 0,
      maxLife: 0.45 + Math.random() * 0.3,
      size: 2.5 + Math.random() * 3,
      color: Math.random() > 0.5 ? "#c9975a" : "#8d5b35",
    });
  }
}

function spawnFloatText(x: number, y: number, text: string, color: string): void {
  floatTexts.push({ x, y, life: 0, text, color });
}

function updateEffects(delta: number): void {
  for (let i = chips.length - 1; i >= 0; i -= 1) {
    const chip = chips[i]!;
    chip.life += delta;
    chip.vy += 420 * delta;
    chip.x += chip.vx * delta;
    chip.y += chip.vy * delta;
    if (chip.life >= chip.maxLife) {
      chips.splice(i, 1);
    }
  }
  for (let i = floatTexts.length - 1; i >= 0; i -= 1) {
    const item = floatTexts[i]!;
    item.life += delta;
    item.y -= 34 * delta;
    if (item.life > 1.4) {
      floatTexts.splice(i, 1);
    }
  }
}

function drawEffects(): void {
  for (const chip of chips) {
    const alpha = 1 - chip.life / chip.maxLife;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = chip.color;
    ctx.fillRect(chip.x, chip.y, chip.size, chip.size * 0.7);
  }
  ctx.globalAlpha = 1;
  ctx.font = `800 14px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const item of floatTexts) {
    const alpha = item.life > 1 ? 1 - (item.life - 1) / 0.4 : 1;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.strokeStyle = "rgba(24, 34, 18, 0.85)";
    ctx.lineWidth = 4;
    ctx.strokeText(item.text, item.x, item.y);
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, item.x, item.y);
  }
  ctx.globalAlpha = 1;
}

const plots: Record<BuildingId, Plot> = {
  house: {
    label: "Дом",
    cost: 0,
    built: false,
    scheduled: false,
    progress: 0,
    x: 0,
  },
  sawmill: {
    label: "Лесопилка",
    cost: 2,
    built: false,
    scheduled: false,
    progress: 0,
    x: 0,
  },
  storehouse: {
    label: "Склад",
    cost: 0,
    built: true,
    scheduled: false,
    progress: 1,
    x: 0,
  },
};

const tree = {
  x: 0,
  alive: true,
  regrowLeft: 0,
  size: 1,
};

const worker = {
  x: 0,
  targetX: 0,
  homeX: 0,
  phase: "idle" as Phase,
  facing: 1,
  carrying: false,
  job: null as Job | null,
  workLeft: 0,
  workTotal: 1,
  hitTimer: 0,
  hammerTimer: 0,
};

// --- Residents & schools (stage I.4) ----------------------------------------
// The server is the source of truth for residents, schools and professions
// (GDD 9.6). The client keeps a local visual mirror that reconciles with the
// authoritative snapshot after every command.
let residents: ResidentSnapshot[] = [];
let activeResidentId: string | null = null;
let selectedResidentId: string | null = null;
let snapshot: WorldSnapshot | null = null;
const schools: Record<SchoolId, { x: number }> = {
  gather: { x: 0 },
  craft: { x: 0 },
};

interface Student {
  residentId: string;
  school: SchoolId;
  phase: "walk" | "study";
  x: number;
  targetX: number;
  left: number;
  total: number;
  facing: 1 | -1;
}
const students: Student[] = [];

function residentById(id: string): ResidentSnapshot | undefined {
  return residents.find((resident) => resident.id === id);
}

function activeResident(): ResidentSnapshot | undefined {
  return activeResidentId ? residentById(activeResidentId) : undefined;
}

function studentOf(residentId: string): Student | undefined {
  return students.find((student) => student.residentId === residentId);
}

function residentStateLabel(resident: ResidentSnapshot): string {
  if (resident.state === "school") {
    return "Учится";
  }
  if (resident.id === activeResidentId) {
    return "Работает";
  }
  return "Свободен";
}

function residentHomeX(resident: ResidentSnapshot): number {
  const slot = residents.indexOf(resident);
  return plots.house.x + 40 * scale + slot * 24 * scale;
}

// --- Server-authoritative house (stage I.4 hotfix, GDD Stolp 4) ------------
// The house is not a client-side object: the server owns its lifecycle
// (awaiting_materials -> complete) and the housing capacity follows from it.
// The client only mirrors `snapshot.buildings` for rendering; it never decides
// that a house exists.
function serverHouse(): BuildingSnapshot | undefined {
  return snapshot?.buildings.find((building) => building.type === "house");
}

function houseStatus(): "not-built" | "building" | "built" {
  const house = serverHouse();
  if (!house) {
    return "not-built";
  }
  return house.status === "complete" ? "built" : "building";
}

/** Build progress 0..1 from delivered materials and builder work. */
function houseProgress(house: BuildingSnapshot): number {
  if (house.status === "complete") {
    return 1;
  }
  const materials = house.materials ?? [];
  const materialRatio = materials.length
    ? materials.reduce(
        (sum, material) =>
          sum + Math.min(1, material.delivered / Math.max(1, material.required)),
        0,
      ) / materials.length
    : 0;
  const workRatio = house.workRequired > 0 ? house.workDone / house.workRequired : 0;
  return Math.max(materialRatio * 0.6, workRatio);
}

function firstFreeHouseCell(): { sector_id: string; x: number; y: number } | null {
  if (!snapshot) {
    return null;
  }
  const occupied = new Set<string>();
  for (const node of snapshot.nodes) {
    occupied.add(`${node.sectorId}:${node.x}:${node.y}`);
  }
  for (const storage of snapshot.storages) {
    occupied.add(`${storage.sectorId}:${storage.x}:${storage.y}`);
  }
  for (const building of snapshot.buildings) {
    if (building.status !== "demolished") {
      occupied.add(`${building.sectorId}:${building.x}:${building.y}`);
    }
  }
  for (const sector of snapshot.sectors) {
    for (const cell of sector.terrain) {
      if (!cell.passable || !cell.reachable) {
        continue;
      }
      const key = `${sector.id}:${cell.x}:${cell.y}`;
      if (!occupied.has(key)) {
        return { sector_id: sector.id, x: cell.x, y: cell.y };
      }
    }
  }
  return null;
}

/** Replaces the local mirror with the authoritative server snapshot. */
function syncFromSnapshot(next: WorldSnapshot): void {
  snapshot = next;
  residents = next.residents;
  if (!residents.some((resident) => resident.id === activeResidentId)) {
    activeResidentId = residents[0]?.id ?? null;
  }
  if (
    selectedResidentId &&
    !residents.some((resident) => resident.id === selectedResidentId)
  ) {
    selectedResidentId = residents[0]?.id ?? null;
  }
  if (!selectedResidentId) {
    selectedResidentId = residents[0]?.id ?? null;
  }
  renderPopulationStatus();
  serverStatus.textContent = `Сервер: тик ${next.tick} · v${next.version}`;
  if (!craftPanel.hidden) {
    renderCraft();
  }
  if (!researchPanel.hidden) {
    renderResearch();
  }
  syncUI();
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

// --- Craft & research panels (stage I.5) -----------------------------------
// The server owns production and research. The client lists what the snapshot
// exposes and sends commands; it never grants itself planks or technologies.
function serverBuildingOfType(type: string): BuildingSnapshot | undefined {
  return snapshot?.buildings.find((building) => building.type === type);
}

interface PlacementCell {
  sector_id: string;
  x: number;
  y: number;
  distance: number;
}

function placementCandidates(): PlacementCell[] {
  if (!snapshot) {
    return [];
  }
  const occupied = new Set<string>();
  for (const node of snapshot.nodes) {
    occupied.add(`${node.sectorId}:${node.x}:${node.y}`);
  }
  for (const storage of snapshot.storages) {
    occupied.add(`${storage.sectorId}:${storage.x}:${storage.y}`);
  }
  for (const building of snapshot.buildings) {
    if (building.status !== "demolished") {
      occupied.add(`${building.sectorId}:${building.x}:${building.y}`);
    }
  }
  const candidates: PlacementCell[] = [];
  for (const sector of snapshot.sectors) {
    const storages = snapshot.storages.filter((storage) => storage.sectorId === sector.id);
    for (const cell of sector.terrain) {
      if (!cell.passable || !cell.reachable) {
        continue;
      }
      const key = `${sector.id}:${cell.x}:${cell.y}`;
      if (occupied.has(key)) {
        continue;
      }
      const distance = storages.reduce(
        (closest, storage) =>
          Math.min(closest, Math.max(Math.abs(cell.x - storage.x), Math.abs(cell.y - storage.y))),
        Number.POSITIVE_INFINITY,
      );
      if (distance > 0 && distance <= 5) {
        candidates.push({ sector_id: sector.id, x: cell.x, y: cell.y, distance });
      }
    }
  }
  return candidates
    .sort((left, right) =>
      left.distance - right.distance || left.y - right.y || left.x - right.x,
    )
    .slice(0, 12);
}

let placementType: PlacementBuildingId | null = null;

function closePlacement(): void {
  placementType = null;
  placementPicker.hidden = true;
}

function openPlacement(type: PlacementBuildingId): void {
  const cells = placementCandidates();
  if (cells.length === 0) {
    setStatus("Нет свободной клетки рядом со складом");
    return;
  }
  placementType = type;
  placementTitle.textContent = type === "workshop" ? "Место для мастерской" : "Место для академии";
  placementCells.replaceChildren();
  for (const cell of cells) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-testid", "placement-cell");
    button.dataset.sector = cell.sector_id;
    button.dataset.x = String(cell.x);
    button.dataset.y = String(cell.y);
    button.textContent = `${cell.x}:${cell.y}`;
    button.setAttribute("aria-label", `Клетка ${cell.x}, ${cell.y}`);
    placementCells.append(button);
  }
  placementPicker.hidden = false;
}

function workshopStatusLabel(building: BuildingSnapshot | undefined): string {
  if (!building) {
    return "Мастерская не построена";
  }
  if (building.status === "complete") {
    return "Мастерская готова к работе";
  }
  return "Мастерская строится…";
}

function renderCraft(): void {
  const workshop = serverBuildingOfType("workshop");
  const storedPlanks =
    snapshot?.storages.reduce(
      (total, storage) =>
        total + (storage.contents.find((entry) => entry.item === "planks")?.qty ?? 0),
      0,
    ) ?? 0;
  craftStatus.textContent = `${workshopStatusLabel(workshop)} · Доски на складе: ${storedPlanks}`;
  craftList.replaceChildren();

  const order = snapshot?.craftOrders.find(
    (candidate) => candidate.buildingId === workshop?.id,
  );
  const craftsmen = residents.filter(
    (resident) => resident.profession === "Ремесленник",
  );

  for (const recipe of snapshot?.catalog.recipes ?? []) {
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

    const researched = snapshot?.research.researched.includes(
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
    hint.textContent = "Нет ремесленника — отправь жителя в школу ремесла.";
    craftList.append(hint);
  }
}

function renderResearch(): void {
  const research = snapshot?.research;
  const academyComplete = serverBuildingOfType("academy")?.status === "complete";
  researchStatus.textContent = research
    ? `Очки исследования: ${research.points} · +${research.pointsPerTick}/тик`
    : "Очки исследования: 0";

  const selectedScholar = researchScholar.value;
  researchScholar.replaceChildren();
  const noScholar = document.createElement("option");
  noScholar.value = "";
  noScholar.textContent = "Без учёного";
  researchScholar.append(noScholar);
  for (const resident of residents.filter((candidate) => candidate.state !== "school")) {
    const option = document.createElement("option");
    option.value = resident.id;
    option.textContent = `${resident.name} · ${resident.profession}`;
    researchScholar.append(option);
  }
  researchScholar.value = residents.some((resident) => resident.id === selectedScholar)
    ? selectedScholar
    : "";
  researchScholar.disabled = Boolean(research?.active);

  researchList.replaceChildren();

  for (const node of snapshot?.techTree ?? []) {
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
    } else if (research?.active?.technologyId === node.id) {
      state.textContent = research.active.status === "active"
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
    const active = research?.active ?? null;
    if (node.researched) {
      button.textContent = "Изучено";
      button.disabled = true;
    } else if (active?.technologyId === node.id) {
      button.textContent = "Идёт…";
      button.disabled = true;
    } else if (researchScholar.value && !academyComplete) {
      button.textContent = "Нужна академия";
      button.disabled = true;
    } else if (!node.available) {
      button.textContent = "Недоступно";
      button.disabled = true;
    } else if (active) {
      button.textContent = "Слот занят";
      button.disabled = true;
    } else {
      button.textContent = "Изучать";
      button.disabled = false;
    }
    item.append(button);
    researchList.append(item);
  }

  if (research?.active) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "research-cancel";
    cancel.setAttribute("data-testid", "research-cancel");
    cancel.dataset.action = "research-cancel";
    cancel.textContent = "Отменить исследование";
    researchList.append(cancel);
  }

  const scholars = residents.filter(
    (resident) => resident.state !== "school",
  );
  if (scholars.length === 0) {
    const hint = document.createElement("li");
    hint.className = "research-hint";
    hint.setAttribute("data-testid", "research-hint");
    hint.textContent = "Нет свободного жителя — исследование будет ждать учёного.";
    researchList.append(hint);
  }
}

function startCraftFor(recipeId: string): void {
  const workshop = serverBuildingOfType("workshop");
  if (!workshop) {
    setStatus("Сначала постройте мастерскую");
    return;
  }
  const worker =
    residents.find((resident) => resident.profession === "Ремесленник") ?? null;
  if (!worker) {
    setStatus("Сначала обучите ремесленника");
    return;
  }
  setStatus("Отправляю ремесло на сервер…");
  void enqueueCommand((current) =>
    startCraft(current, workshop.id, recipeId, worker.id),
  )
    .then((next) => {
      syncFromSnapshot(next);
      renderCraft();
      setStatus("Ремесло запущено");
    })
    .catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "Не удалось запустить ремесло");
    });
}

function startResearchFor(technologyId: string): void {
  const scholarId = researchScholar.value || null;
  setStatus("Отправляю исследование на сервер…");
  void enqueueCommand((current) =>
    startResearch(current, technologyId, scholarId),
  )
    .then((next) => {
      syncFromSnapshot(next);
      renderResearch();
      setStatus("Исследование запущено");
    })
    .catch((error: unknown) => {
      setStatus(
        error instanceof Error ? error.message : "Не удалось запустить исследование",
      );
    });
}

function assignWorker(residentId: string): void {
  const resident = residentById(residentId);
  if (!resident) {
    return;
  }
  selectedResidentId = residentId;
  if (studentOf(residentId)) {
    setStatus(`${resident.name} учится в школе`);
    renderResidents();
    return;
  }
  if (residentId === activeResidentId) {
    setStatus(`${resident.name} уже работает`);
    renderResidents();
    return;
  }
  if (worker.job !== null || worker.phase !== "idle") {
    setStatus("Рабочий занят — дождись окончания работы");
    renderResidents();
    return;
  }
  activeResidentId = residentId;
  worker.x = residentHomeX(resident);
  worker.targetX = worker.x;
  playUnloadDing();
  spawnFloatText(
    worker.x,
    groundY - 108 * scale,
    `${resident.name} — на работе!`,
    "#e2b85f",
  );
  setStatus(`${resident.name} назначен рабочим`);
  renderResidents();
}

function sendToSchool(residentId: string, school: SchoolId): void {
  const resident = residentById(residentId);
  if (!resident) {
    return;
  }
  selectedResidentId = residentId;
  if (resident.state === "school") {
    setStatus(`${resident.name} уже учится`);
    renderResidents();
    return;
  }
  if (resident.schools.includes(school)) {
    setStatus(`${resident.name} уже окончил(а) «${SCHOOLS[school].label}»`);
    renderResidents();
    return;
  }

  if (residentId === activeResidentId) {
    if (worker.job !== null || worker.phase !== "idle") {
      setStatus("Рабочий занят — сначала дождись окончания работы");
      renderResidents();
      return;
    }
    const replacement = residents.find(
      (candidate) =>
        candidate.id !== residentId && candidate.state === "idle",
    );
    if (!replacement) {
      setStatus("Нельзя оставить поселение без свободного работника");
      renderResidents();
      return;
    }
    activeResidentId = replacement.id;
    worker.x = residentHomeX(replacement);
    worker.targetX = worker.x;
  }

  // Spawn the visual walk immediately so the action is playable, then send the
  // authoritative command. State is reconciled once the server responds.
  const startX =
    resident.id === activeResidentId ? worker.x : residentHomeX(resident);
  const compact = width < 640;
  students.push({
    residentId,
    school,
    phase: "walk",
    x: startX,
    targetX: schools[school].x + (compact ? 30 : 44) * scale,
    left: SCHOOL_SECONDS,
    total: SCHOOL_SECONDS,
    facing: startX > schools[school].x ? -1 : 1,
  });
  setStatus(`${resident.name} отправлен(а) в «${SCHOOLS[school].label}»`);
  renderResidents();

  void dispatchSchool(residentId, school);
}

async function dispatchSchool(
  residentId: string,
  school: SchoolId,
): Promise<void> {
  if (!snapshot) {
    return;
  }
  try {
    const next = await enqueueCommand((current) =>
      sendSchool(current, residentId, school),
    );
    syncFromSnapshot(next);
    renderResidents();
  } catch (error) {
    students.splice(
      students.findIndex(
        (student) => student.residentId === residentId && student.school === school,
      ),
      1,
    );
    const resident = residentById(residentId);
    setStatus(
      `Сервер отклонил обучение: ${error instanceof Error ? error.message : "ошибка"}`,
    );
    if (resident) {
      spawnFloatText(
        residentHomeX(resident),
        groundY - 116 * scale,
        "Обучение недоступно",
        "#e08b6a",
      );
    }
    renderResidents();
  }
}

/** Reconciles a finished study animation with the authoritative snapshot. */
function finishSchool(student: Student): void {
  const resident = residentById(student.residentId);
  if (!resident) {
    return;
  }
  playBuildDone();
  const trained = resident.state === "idle" && resident.schools.includes(student.school);
  spawnFloatText(
    student.x,
    groundY - 116 * scale,
    trained ? `${resident.name}: ${resident.profession}!` : `${resident.name} учится…`,
    "#e2b85f",
  );
  setStatus(
    trained
      ? `${resident.name}: новая профессия — ${resident.profession}`
      : `${resident.name} продолжает обучение`,
  );
  renderResidents();
}

let queuedJobs: Job[] = [];
let wood = 0;
let stone = 0;
let buildPending = false;
let width = 0;
let height = 0;
let groundY = 0;
let scale = 1;
let time = 0;
let grass: GrassTuft[] = [];

function setStatus(text: string): void {
  statusElement.textContent = text;
}

function isBusy(): boolean {
  return worker.job !== null || worker.phase !== "idle" || queuedJobs.length > 0;
}

function syncUI(): void {
  woodElement.textContent = String(wood);
  stoneElement.textContent = String(stone);
  treeHotspot.disabled = !tree.alive;
  chopButton.disabled = !tree.alive;

  document.body.dataset.house = houseStatus();
  document.body.dataset.sawmill = plots.sawmill.built ? "built" : "not-built";

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-building]")) {
    const id = button.dataset.building ?? "";
    const cost = button.querySelector<HTMLElement>(".build-copy small");
    if (!cost) {
      continue;
    }

    if (id === "storehouse") {
      button.disabled = true;
      cost.textContent = "Построен";
      continue;
    }

    if (id === "house") {
      const status = houseStatus();
      if (status === "built") {
        button.disabled = true;
        cost.textContent = "Готово";
      } else if (status === "building" || buildPending) {
        button.disabled = true;
        cost.textContent = "Строится";
      } else {
        button.disabled = false;
        cost.textContent = "8 брёвен + 4 доски";
      }
      continue;
    }

    if (id === "workshop" || id === "academy") {
      const label = id === "workshop" ? "Мастерская" : "Академия";
      const building = serverBuildingOfType(id);
      if (building && building.status !== "demolished") {
        button.disabled = true;
        cost.textContent = building.status === "complete" ? "Готово" : "Строится";
      } else if (buildPending) {
        button.disabled = true;
        cost.textContent = "Строится";
      } else {
        button.disabled = false;
        cost.textContent = `${label}: заказ на сервер`;
      }
      continue;
    }

    const plot = plots[id as BuildingId];
    if (!plot) {
      continue;
    }
    if (plot.built) {
      button.disabled = true;
      cost.textContent = "Готово";
    } else if (plot.scheduled) {
      button.disabled = true;
      cost.textContent = "Строится";
    } else {
      button.disabled = false;
      cost.textContent = `${plot.cost} дерева`;
    }
  }
}

function closeTreeMenu(): void {
  treeMenu.hidden = true;
}

function renderResidents(): void {
  const selected =
    residentById(selectedResidentId ?? "") ?? residents[0] ?? undefined;

  residentsList.replaceChildren();
  for (const resident of residents) {
    const item = document.createElement("li");
    item.className =
      "resident-row" + (resident && resident.id === selected?.id ? " is-selected" : "");
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
  if (!selected) {
    return;
  }

  const state = residentStateLabel(selected);
  const isStudent = selected.state === "school";
  const isActive = selected.id === activeResidentId;
  const knows = (school: SchoolId): boolean => selected.schools.includes(school);

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
    learned.length > 0
      ? `Школы: ${learned.join(" + ")} (${state})`
      : `Школы: нет (${state})`;

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
  fill.style.width = `${Math.round((selected.xpInto / selected.xpSpan) * 100)}%`;
  xpBar.append(fill);
  xpLine.append(xpLabel, xpBar);

  const assignButton = document.createElement("button");
  assignButton.type = "button";
  assignButton.setAttribute("data-testid", "assign-worker");
  assignButton.setAttribute("data-action", "assign");
  assignButton.textContent = isActive ? "Работает сейчас" : "Назначить рабочим";
  assignButton.disabled = isActive || isStudent;

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
}

function openTreeMenu(): void {
  if (!tree.alive) {
    setStatus("Дерево ещё не выросло");
    return;
  }

  treeMenu.hidden = false;
  const hotspot = treeHotspot.getBoundingClientRect();
  const menuWidth = treeMenu.offsetWidth;
  const menuHeight = treeMenu.offsetHeight;
  let left = hotspot.left + hotspot.width / 2 - menuWidth / 2;
  left = Math.max(10, Math.min(width - menuWidth - 10, left));

  let top = hotspot.top - menuHeight - 10;
  if (top < 80) {
    top = hotspot.bottom + 10;
  }
  const buildTop = buildbar.getBoundingClientRect().top;
  if (top + menuHeight > buildTop - 8) {
    top = hotspot.top - menuHeight - 10;
  }

  treeMenu.style.left = `${left}px`;
  treeMenu.style.top = `${Math.max(8, top)}px`;
}

function requestChop(): void {
  closeTreeMenu();
  if (!tree.alive) {
    setStatus("Дерево ещё не выросло");
    return;
  }
  if (isBusy()) {
    setStatus("Рабочий занят");
    return;
  }

  worker.job = { type: "chop" };
  worker.phase = "walk";
  worker.targetX = tree.x + 27 * scale;
  setStatus("Рабочий идёт к дереву");
}

function requestBuild(id: BuildableId): void {
  if (id === "house") {
    void requestServerHouse();
    return;
  }

  const plot = plots[id];
  if (plot.built) {
    return;
  }
  if (plot.scheduled) {
    setStatus(`${plot.label} уже в работе`);
    return;
  }
  if (wood < plot.cost) {
    setStatus(`Нужно ${plot.cost} дерева. На складе: ${wood}`);
    return;
  }

  wood -= plot.cost;
  plot.scheduled = true;
  queuedJobs.push({ type: "build", building: id });
  syncUI();
  setStatus(`${plot.label}: дерево списано со склада`);

  if (worker.phase === "idle" && worker.job === null) {
    startNextJob();
  }
}

// GDD Stolp 4: the house is built by the server. The client only sends the
// command and renders the result; it never grants itself a house.
async function requestServerHouse(): Promise<void> {
  if (!snapshot || buildPending) {
    return;
  }
  if (houseStatus() !== "not-built") {
    setStatus("Дом уже строится или готов");
    return;
  }
  const cell = firstFreeHouseCell();
  if (!cell) {
    setStatus("Нет свободного места для дома");
    return;
  }

  buildPending = true;
  syncUI();
  setStatus("Заказ на дом отправлен на сервер");
  try {
    const next = await enqueueCommand((current) =>
      sendBuild(current, { building_type: "house", ...cell }),
    );
    syncFromSnapshot(next);
    setStatus("Дом поставлен в план стройки");
  } catch (error) {
    setStatus(
      `Не удалось начать стройку: ${error instanceof Error ? error.message : "ошибка"}`,
    );
    syncFromSnapshot(await fetchState().catch(() => snapshot!));
  } finally {
    buildPending = false;
    syncUI();
    renderResidents();
  }
}

// GDD Stolp 4: production and research buildings are placed by the server too.
// The client only chooses a free cell and sends the command.
async function requestServerBuilding(
  type: PlacementBuildingId,
  cell: { sector_id: string; x: number; y: number },
): Promise<void> {
  if (!snapshot || buildPending) {
    return;
  }
  const existing = serverBuildingOfType(type);
  if (existing && existing.status !== "demolished") {
    setStatus(`${type === "workshop" ? "Мастерская" : "Академия"} уже построена или строится`);
    return;
  }
  buildPending = true;
  syncUI();
  setStatus("Заказ на постройку отправлен на сервер");
  try {
    const next = await enqueueCommand((current) =>
      sendBuild(current, { building_type: type, ...cell }),
    );
    syncFromSnapshot(next);
    setStatus("Постройка поставлена в план стройки");
    if (!craftPanel.hidden) {
      renderCraft();
    }
  } catch (error) {
    setStatus(
      `Не удалось начать стройку: ${error instanceof Error ? error.message : "ошибка"}`,
    );
    syncFromSnapshot(await fetchState().catch(() => snapshot!));
  } finally {
    buildPending = false;
    syncUI();
  }
}

function startNextJob(): void {
  if (worker.job !== null || worker.phase !== "idle") {
    return;
  }
  const next = queuedJobs.shift();
  if (!next || next.type !== "build") {
    return;
  }

  const plot = plots[next.building];
  worker.job = next;
  worker.phase = "walk";
  worker.targetX = plot.x;
  setStatus(`Рабочий идёт строить ${plot.label.toLowerCase()}`);
}

function moveWorker(targetX: number, delta: number): boolean {
  const distance = targetX - worker.x;
  const step = Math.max(210, width * 0.27) * SPEED * delta;
  if (Math.abs(distance) <= step) {
    worker.x = targetX;
    return true;
  }
  worker.x += Math.sign(distance) * step;
  worker.facing = distance >= 0 ? 1 : -1;
  return false;
}

function arrive(): void {
  if (worker.phase === "walk") {
    const job = worker.job;
    if (job?.type === "chop") {
      worker.phase = "work";
      worker.workTotal = CHOP_SECONDS;
      worker.workLeft = CHOP_SECONDS;
      setStatus("Рубит дерево");
      return;
    }
    if (job?.type === "build") {
      worker.phase = "work";
      worker.workTotal = BUILD_SECONDS;
      worker.workLeft = BUILD_SECONDS;
      plots[job.building].progress = 0;
      setStatus(`Строит ${plots[job.building].label.toLowerCase()}`);
      return;
    }
    worker.phase = "idle";
    return;
  }

  if (worker.phase === "carry") {
    worker.phase = "unload";
    worker.workTotal = UNLOAD_SECONDS;
    worker.workLeft = UNLOAD_SECONDS;
    setStatus("Сгружает бревно на склад");
    return;
  }

  if (worker.phase === "returning") {
    worker.phase = "idle";
    setStatus("Рабочий отдыхает");
    startNextJob();
  }
}

function finishWork(): void {
  const job = worker.job;
  if (!job) {
    worker.phase = "idle";
    return;
  }

  if (job.type === "chop") {
    tree.alive = false;
    tree.regrowLeft = REGROW_SECONDS;
    worker.carrying = true;
    worker.phase = "carry";
    worker.targetX = plots.storehouse.x - 42 * scale;
    setStatus("Бревно готово, несёт на склад");
    syncUI();
    return;
  }

  const plot = plots[job.building];
  plot.built = true;
  plot.scheduled = false;
  plot.progress = 1;
  worker.job = null;
  worker.phase = "returning";
  worker.targetX = worker.homeX;
  playBuildDone();
  spawnFloatText(plot.x, groundY - 110 * scale, `${plot.label} готов!`, "#e2b85f");
  setStatus(`${plot.label} готов`);
  syncUI();
}

function update(delta: number): void {
  time += delta;

  if (!tree.alive) {
    tree.regrowLeft -= delta;
    if (tree.regrowLeft <= 0) {
      tree.alive = true;
      tree.regrowLeft = 0;
      syncUI();
    }
  }

  if (
    worker.phase === "walk" ||
    worker.phase === "carry" ||
    worker.phase === "returning"
  ) {
    if (moveWorker(worker.targetX, delta)) {
      arrive();
    }
  }

  if (worker.phase === "work") {
    worker.workLeft = Math.max(0, worker.workLeft - delta);
    if (worker.job?.type === "build") {
      const plot = plots[worker.job.building];
      plot.progress = 1 - worker.workLeft / worker.workTotal;
    }
    if (worker.job?.type === "chop") {
      worker.hitTimer = (worker.hitTimer ?? 0) - delta;
      if (worker.hitTimer <= 0) {
        worker.hitTimer = 0.42 / SPEED;
        playChopHit();
        spawnWoodChips(tree.x + 6 * scale, groundY - 40 * scale);
      }
    }
    if (worker.job?.type === "build") {
      worker.hammerTimer = (worker.hammerTimer ?? 0) - delta;
      if (worker.hammerTimer <= 0) {
        worker.hammerTimer = 0.55 / SPEED;
        tone(340, 0, 0.07, 0.07, "square");
        tone(520, 0.03, 0.05, 0.05, "square");
        const plot = plots[worker.job.building];
        spawnWoodChips(plot.x, groundY - 30 * scale);
      }
    }
    if (worker.workLeft <= 0) {
      finishWork();
    }
  }

  if (worker.phase === "unload") {
    worker.workLeft = Math.max(0, worker.workLeft - delta);
    if (worker.workLeft <= 0) {
      wood += 1;
      worker.carrying = false;
      worker.job = null;
      worker.phase = "idle";
      playUnloadDing();
      spawnFloatText(
        plots.storehouse.x,
        groundY - 96 * scale,
        "+1 Дерево",
        "#f3ead4",
      );
      syncUI();
      setStatus(`Бревно на складе. Дерево: ${wood}`);
      startNextJob();
    }
  }

  for (let i = students.length - 1; i >= 0; i -= 1) {
    const student = students[i]!;
    if (student.phase === "walk") {
      const step = Math.max(210, width * 0.27) * SPEED * delta;
      const distance = student.targetX - student.x;
      if (Math.abs(distance) <= step) {
        student.x = student.targetX;
        student.phase = "study";
        student.left = SCHOOL_SECONDS;
        student.total = SCHOOL_SECONDS;
        const resident = residentById(student.residentId);
        if (resident) {
          setStatus(`${resident.name} учится в «${SCHOOLS[student.school].label}»`);
        }
      } else {
        student.x += Math.sign(distance) * step;
        student.facing = distance >= 0 ? 1 : -1;
      }
    } else {
      // Study progress is owned by the server; keep the visual in the loop
      // until the authoritative snapshot reports the resident back to idle.
      student.left = Math.max(0, student.left - delta);
    }
  }

  updateEffects(delta);
}

function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawGrass(): void {
  ctx.fillStyle = "#6f9d52";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(57, 92, 41, 0.34)";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const tuft of grass) {
    ctx.moveTo(tuft.x, tuft.y);
    ctx.lineTo(tuft.x + tuft.lean, tuft.y - tuft.height);
    ctx.moveTo(tuft.x + 3, tuft.y);
    ctx.lineTo(tuft.x + 3 - tuft.lean * 0.5, tuft.y - tuft.height * 0.8);
  }
  ctx.stroke();
}

function drawSign(x: number, y: number, text: string): void {
  ctx.fillStyle = "#6e5130";
  ctx.fillRect(x - 2, y, 4, 20);

  const signWidth = Math.max(58, text.length * 6.3 + 16);
  ctx.fillStyle = "#d8bd8f";
  roundedRect(x - signWidth / 2, y - 17, signWidth, 20, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(69, 49, 28, 0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#3b2a19";
  ctx.font = `700 9px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.toUpperCase(), x, y - 7);
}

function drawPlot(plot: Plot): void {
  const isHouse = plot === plots.house;
  const status = isHouse ? houseStatus() : plot.built ? "built" : "not-built";
  if (status === "built") {
    return;
  }
  const scheduled = isHouse ? status === "building" : plot.scheduled;

  const plotWidth = 80 * scale;
  const plotHeight = 52 * scale;
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(45, 67, 35, 0.62)";
  ctx.strokeRect(
    plot.x - plotWidth / 2,
    groundY - plotHeight,
    plotWidth,
    plotHeight,
  );
  ctx.restore();

  if (scheduled) {
    drawScaffold(plot, isHouse ? "house" : undefined);
  } else {
    drawSign(plot.x, groundY - 24, plot.label);
  }
}

function drawScaffold(plot: Plot, houseSprite?: SpriteName): void {
  const s = scale;
  const left = plot.x - 36 * s;
  const right = plot.x + 36 * s;
  const top = groundY - 48 * s;

  const house = houseSprite ? serverHouse() : undefined;
  const progress = house
    ? houseProgress(house)
    : Math.max(0, Math.min(1, plot.progress));

  if (progress > 0.03) {
    const spriteName: SpriteName =
      houseSprite ??
      (plot === plots.sawmill ? "sawmill" : plot === plots.storehouse ? "storehouse" : "house");
    drawSprite(spriteName, plot.x, groundY, 165 * s, {
      grow: 0.15 + progress * 0.85,
      alpha: 0.55 + progress * 0.45,
    });
  }

  ctx.strokeStyle = "#7e5a36";
  ctx.lineWidth = 4;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(left, groundY);
  ctx.lineTo(left, top);
  ctx.moveTo(right, groundY);
  ctx.lineTo(right, top);
  ctx.moveTo(left - 4 * s, top);
  ctx.lineTo(right + 4 * s, top);
  ctx.moveTo(left, top + 18 * s);
  ctx.lineTo(right, top + 4 * s);
  ctx.stroke();

  drawProgress(
    plot.x,
    groundY - 66 * s,
    72 * s,
    progress,
    progress > 0 ? "Строится" : "В очереди",
  );
}

function drawStockpile(x: number, y: number): void {
  if (wood <= 0) {
    return;
  }
  const count = Math.min(wood, 6);
  const alpha = 0.45 + (count / 6) * 0.55;
  if (!drawSprite("stockpile_logs", x, y, 95 * scale, { alpha })) {
    ctx.fillStyle = "#8d5b35";
    roundedRect(x - 25, y - 14, 44, 14, 6);
    ctx.fill();
  }
}

function drawStorehouse(x: number): void {
  const s = scale;

  ctx.fillStyle = "rgba(35, 55, 27, 0.24)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + 4 * s, 58 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!drawSprite("storehouse", x, groundY, 175 * s)) {
    ctx.fillStyle = "#8e603b";
    ctx.fillRect(x - 45 * s, groundY - 42 * s, 90 * s, 42 * s);
    ctx.fillStyle = "#5d3b24";
    ctx.beginPath();
    ctx.moveTo(x - 58 * s, groundY - 40 * s);
    ctx.lineTo(x, groundY - 72 * s);
    ctx.lineTo(x + 58 * s, groundY - 40 * s);
    ctx.closePath();
    ctx.fill();
  }

  drawSign(x, groundY - 138 * s, "Склад");
  drawStockpile(x - 74 * s, groundY + 1 * s);
}

function drawHouse(x: number): void {
  const s = scale;
  ctx.fillStyle = "rgba(35, 55, 27, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + 4 * s, 52 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!drawSprite("house", x, groundY, 165 * s)) {
    ctx.fillStyle = "#dfc58f";
    ctx.fillRect(x - 38 * s, groundY - 40 * s, 76 * s, 40 * s);
    ctx.fillStyle = "#8a432f";
    ctx.beginPath();
    ctx.moveTo(x - 50 * s, groundY - 37 * s);
    ctx.lineTo(x, groundY - 66 * s);
    ctx.lineTo(x + 50 * s, groundY - 37 * s);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSawmill(x: number): void {
  const s = scale;
  ctx.fillStyle = "rgba(35, 55, 27, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + 4 * s, 54 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!drawSprite("sawmill", x, groundY, 170 * s)) {
    ctx.fillStyle = "#95663e";
    ctx.fillRect(x - 42 * s, groundY - 43 * s, 84 * s, 43 * s);
    ctx.fillStyle = "#4e3523";
    ctx.beginPath();
    ctx.moveTo(x - 48 * s, groundY - 42 * s);
    ctx.lineTo(x, groundY - 63 * s);
    ctx.lineTo(x + 48 * s, groundY - 42 * s);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTree(): void {
  const s = tree.size;
  const regrowProgress = tree.alive
    ? 1
    : 1 - Math.max(0, tree.regrowLeft) / REGROW_SECONDS;
  const shake =
    worker.phase === "work" && worker.job?.type === "chop"
      ? Math.sin(time * 38) * 2.2 * scale
      : 0;

  ctx.save();
  ctx.fillStyle = "rgba(35, 55, 27, 0.25)";
  ctx.beginPath();
  ctx.ellipse(tree.x, groundY + 4 * scale, 46 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (!tree.alive) {
    const stumpDrawn = drawSprite("tree_stump", tree.x, groundY, 105 * s);
    if (!stumpDrawn) {
      ctx.save();
      ctx.translate(tree.x, groundY);
      ctx.fillStyle = "#694226";
      roundedRect(-17 * s, -18 * s, 34 * s, 18 * s, 5 * s);
      ctx.fill();
      ctx.restore();
    }
    if (regrowProgress > 0.35) {
      const grow = Math.min(1, (regrowProgress - 0.35) / 0.65);
      drawSprite("tree_full", tree.x + shake, groundY, 200 * s, { grow });
    }
    return;
  }

  if (!drawSprite("tree_full", tree.x + shake, groundY, 200 * s)) {
    // Fallback primitive tree while sprites load
    ctx.save();
    ctx.translate(tree.x + shake, groundY);
    ctx.fillStyle = "#6d4828";
    ctx.fillRect(-9 * s, -78 * s, 18 * s, 79 * s);
    ctx.fillStyle = "#2f683b";
    ctx.beginPath();
    ctx.arc(0, -105 * s, 42 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawProgress(
  x: number,
  y: number,
  progressWidth: number,
  progress: number,
  label: string,
): void {
  const barHeight = 7;
  const left = x - progressWidth / 2;

  ctx.fillStyle = "rgba(28, 40, 23, 0.72)";
  roundedRect(left - 2, y - 2, progressWidth + 4, barHeight + 4, 4);
  ctx.fill();

  ctx.fillStyle = "#e2b85f";
  roundedRect(left, y, progressWidth * Math.max(0, Math.min(1, progress)), barHeight, 3);
  ctx.fill();

  ctx.font = `700 10px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.strokeStyle = "rgba(27, 40, 21, 0.72)";
  ctx.lineWidth = 3;
  ctx.strokeText(label, x, y - 5);
  ctx.fillStyle = "#f7efdc";
  ctx.fillText(label, x, y - 5);
}

function drawWorker(): void {
  const x = worker.x;
  const walking =
    worker.phase === "walk" ||
    worker.phase === "carry" ||
    worker.phase === "returning";
  const bob = walking ? Math.abs(Math.sin(time * 13)) * 2.2 * scale : 0;
  const flip = worker.facing < 0;

  ctx.fillStyle = "rgba(35, 55, 27, 0.24)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + 2, 17 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const cell = 92 * scale;
  const y = groundY - bob;
  let drawn = false;

  if (worker.phase === "work" && worker.job?.type === "chop") {
    const swing = Math.sin(time * 16);
    drawn = drawSprite("worker_chop", x, y, cell, {
      flip,
      tilt: swing * 0.1 * (flip ? -1 : 1),
    });
  } else if (worker.phase === "work" && worker.job?.type === "build") {
    const swing = Math.sin(time * 14);
    drawn = drawSprite("worker_hammer", x, y, cell, {
      flip,
      tilt: swing * 0.08 * (flip ? -1 : 1),
    });
  } else if (worker.carrying) {
    drawn = drawSprite("worker_carry", x, y, cell, { flip });
  } else if (walking) {
    drawn = drawSprite("worker_walk", x, y, cell, { flip });
  } else {
    drawn = drawSprite("worker_idle", x, y, cell, { flip });
  }

  if (!drawn) {
    // Fallback primitive worker while sprites load
    const stride = walking ? Math.sin(time * 13) : 0;
    const hipY = groundY - 17 - bob;
    ctx.strokeStyle = "#253b2a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - 4, hipY);
    ctx.lineTo(x - 6 + stride * 4, groundY - 1);
    ctx.moveTo(x + 4, hipY);
    ctx.lineTo(x + 6 - stride * 4, groundY - 1);
    ctx.stroke();
    ctx.fillStyle = "#356b91";
    roundedRect(x - 9, groundY - 38 - bob, 18, 24, 5);
    ctx.fill();
    ctx.fillStyle = "#e6b98e";
    ctx.beginPath();
    ctx.arc(x, groundY - 46 - bob, 7.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (worker.phase === "work" && worker.job?.type === "chop") {
    const progress = 1 - worker.workLeft / worker.workTotal;
    drawProgress(x, groundY - 118 * scale, 58, progress, "Рубит");
  }

  const resident = activeResident();
  if (resident) {
    drawProfessionMark(x, resident.profession, bob);
    drawNameLabel(x, resident.name, groundY - 92 * scale, true);
  }
}

function drawProfessionMark(
  x: number,
  profession: Profession,
  bob: number,
): void {
  ctx.save();
  ctx.translate(x, groundY - 30 * scale - bob);
  ctx.rotate(-0.5);
  ctx.fillStyle = PROFESSION_COLORS[profession];
  ctx.strokeStyle = "rgba(30, 26, 16, 0.7)";
  ctx.lineWidth = 1.5;
  roundedRect(-12 * scale, -3 * scale, 24 * scale, 6 * scale, 2 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawNameLabel(
  x: number,
  text: string,
  y: number,
  highlight: boolean,
): void {
  ctx.font = `800 11px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = highlight
    ? "rgba(38, 28, 12, 0.9)"
    : "rgba(28, 38, 22, 0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = highlight ? "#f6d98a" : "#eef0e2";
  ctx.fillText(text, x, y);
}

function drawProfessionVillager(resident: ResidentSnapshot, x: number): void {
  const bob = Math.abs(Math.sin(time * 1.7 + residents.indexOf(resident))) * 1.1;
  ctx.fillStyle = "rgba(35, 55, 27, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + 2, 15 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const drawn = drawSprite("worker_idle", x, groundY - bob, 88 * scale, {
    flip: residents.indexOf(resident) % 2 === 1,
  });
  if (!drawn) {
    ctx.fillStyle = "#356b91";
    roundedRect(x - 9, groundY - 38 - bob, 18, 24, 5);
    ctx.fill();
    ctx.fillStyle = "#e6b98e";
    ctx.beginPath();
    ctx.arc(x, groundY - 46 - bob, 7.5, 0, Math.PI * 2);
    ctx.fill();
  }
  drawProfessionMark(x, resident.profession, bob);
  drawNameLabel(x, resident.name, groundY - 88 * scale, false);
}

function drawStudyPose(x: number, resident: ResidentSnapshot): void {
  // GDD 17.3: a distinct `study` cycle with a book/blueprint prop. The reader
  // sits behind a desk and leans over an open book with a gentle sway.
  const sway = Math.sin(time * 3.1) * 0.6 * scale;
  const deskH = 15 * scale;
  const deskW = 34 * scale;
  const deskY = groundY - deskH;

  ctx.fillStyle = "rgba(35, 55, 27, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + 2, 18 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Seat
  ctx.fillStyle = "#6b4a2c";
  roundedRect(x - 7 * scale, deskY - 10 * scale, 12 * scale, 12 * scale, 3);
  ctx.fill();

  // Body, leaning forward over the desk
  ctx.fillStyle = "#8a6fb0";
  roundedRect(x - 8 * scale + sway * 0.3, deskY - 34 * scale, 15 * scale, 26 * scale, 5);
  ctx.fill();
  // Head
  ctx.fillStyle = "#e8c9a0";
  ctx.beginPath();
  ctx.arc(x - 1 * scale + sway * 0.5, deskY - 40 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.fill();
  // Study cap
  ctx.fillStyle = "#4b3572";
  roundedRect(x - 8 * scale + sway * 0.5, deskY - 48 * scale, 14 * scale, 5 * scale, 2);
  ctx.fill();

  // Desk
  ctx.fillStyle = "#8a5a34";
  roundedRect(x - deskW / 2, deskY, deskW, deskH, 3);
  ctx.fill();
  ctx.fillStyle = "#6b4526";
  ctx.fillRect(x - deskW / 2 + 3 * scale, deskY + deskH, 4 * scale, groundY - deskY - deskH);
  ctx.fillRect(x + deskW / 2 - 7 * scale, deskY + deskH, 4 * scale, groundY - deskY - deskH);

  // Open book with flicking pages
  ctx.fillStyle = "#f4ecd6";
  const bookW = 20 * scale;
  ctx.beginPath();
  ctx.moveTo(x - bookW / 2, deskY - 2 * scale);
  ctx.lineTo(x, deskY - 5 * scale);
  ctx.lineTo(x + bookW / 2, deskY - 2 * scale);
  ctx.lineTo(x, deskY + 1 * scale);
  ctx.closePath();
  ctx.fill();
  if (Math.floor(time * 4) % 2 === 0) {
    ctx.fillStyle = "rgba(246, 217, 138, 0.9)";
    ctx.fillRect(x + 2 * scale, deskY - 3 * scale, 5 * scale, 1.4 * scale);
  }

  drawNameLabel(x, resident.name, groundY - 96 * scale, false);
}

function drawStudentSprite(student: Student, resident: ResidentSnapshot): void {
  const walking = student.phase === "walk";

  if (!walking) {
    drawStudyPose(student.x, resident);
    const progress = 1 - student.left / student.total;
    drawProgress(student.x, groundY - 116 * scale, 64, progress, "Учится");
    if (Math.floor(time * 3) % 4 === 0) {
      ctx.fillStyle = "rgba(246, 217, 138, 0.85)";
      ctx.font = `800 13px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("✦", student.x + 28 * scale, groundY - 78 * scale);
    }
    return;
  }

  const bob = Math.abs(Math.sin(time * 13)) * 2.2 * scale;
  const x = student.x;

  ctx.fillStyle = "rgba(35, 55, 27, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + 2, 15 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const drawn = drawSprite("worker_walk", x, groundY - bob, 88 * scale, {
    flip: student.facing < 0,
  });
  if (!drawn) {
    ctx.fillStyle = "#7c6aa0";
    roundedRect(x - 9, groundY - 38 - bob, 18, 24, 5);
    ctx.fill();
  }
  drawProfessionMark(x, resident.profession, bob);
  drawNameLabel(x, resident.name, groundY - 88 * scale, false);
}

function drawSchools(): void {
  const compact = width < 640;
  const cell = (compact ? 118 : 165) * scale;
  for (const school of ["gather", "craft"] as SchoolId[]) {
    const info = SCHOOLS[school];
    const x = schools[school].x;
    ctx.fillStyle = "rgba(35, 55, 27, 0.24)";
    ctx.beginPath();
    ctx.ellipse(x, groundY + 4 * scale, 52 * scale, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!drawSprite("school", x, groundY, cell)) {
      ctx.fillStyle = "#b9a06e";
      ctx.fillRect(x - 40 * scale, groundY - 46 * scale, 80 * scale, 46 * scale);
      ctx.fillStyle = "#7d4a33";
      ctx.beginPath();
      ctx.moveTo(x - 52 * scale, groundY - 44 * scale);
      ctx.lineTo(x, groundY - 74 * scale);
      ctx.lineTo(x + 52 * scale, groundY - 44 * scale);
      ctx.closePath();
      ctx.fill();
    }
    drawSign(x, groundY + 8 * scale, info.sign);
  }
}

function drawSawmillAndHouse(): void {
  if (plots.sawmill.built) {
    drawSawmill(plots.sawmill.x);
  }
  if (houseStatus() === "built") {
    drawHouse(plots.house.x);
  }
}

// Production and research buildings live on the server; the client draws them
// from `snapshot.buildings` so the settlement visibly grows when they appear.
function drawCraftBuildings(): void {
  const s = scale;
  const workshop = serverBuildingOfType("workshop");
  if (workshop && workshop.status !== "demolished") {
    const x = buildingSceneX(workshop, width * 0.66);
    drawSawmill(x);
    drawSign(x, groundY - 128 * s, workshop.status === "complete" ? "Мастерская" : "Стройка…");
  }
  const academy = serverBuildingOfType("academy");
  if (academy && academy.status !== "demolished") {
    const x = buildingSceneX(academy, width * 0.82);
    ctx.fillStyle = "rgba(35, 55, 27, 0.24)";
    ctx.beginPath();
    ctx.ellipse(x, groundY + 4 * s, 52 * s, 8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!drawSprite("school", x, groundY, 165 * s)) {
      ctx.fillStyle = "#b9a06e";
      ctx.fillRect(x - 40 * s, groundY - 46 * s, 80 * s, 46 * s);
      ctx.fillStyle = "#7d4a33";
      ctx.beginPath();
      ctx.moveTo(x - 52 * s, groundY - 44 * s);
      ctx.lineTo(x, groundY - 74 * s);
      ctx.lineTo(x + 52 * s, groundY - 44 * s);
      ctx.closePath();
      ctx.fill();
    }
    drawSign(x, groundY + 8 * s, academy.status === "complete" ? "Академия" : "Стройка…");
  }
}

function buildingSceneX(building: BuildingSnapshot, fallback: number): number {
  const storage = snapshot?.storages.find(
    (candidate) => candidate.sectorId === building.sectorId,
  );
  if (!storage) return fallback;
  const x = width * 0.5 + (building.x - storage.x) * 48 * scale;
  return Math.max(80 * scale, Math.min(width - 80 * scale, x));
}

function render(): void {
  ctx.clearRect(0, 0, width, height);
  drawGrass();
  drawSchools();
  drawPlot(plots.house);
  drawPlot(plots.sawmill);
  drawStorehouse(plots.storehouse.x);
  drawSawmillAndHouse();
  drawCraftBuildings();
  drawTree();
  for (const resident of residents) {
    if (resident.id === activeResidentId || studentOf(resident.id)) {
      continue;
    }
    drawProfessionVillager(resident, residentHomeX(resident));
  }
  for (const student of students) {
    const resident = residentById(student.residentId);
    if (resident) {
      drawStudentSprite(student, resident);
    }
  }
  drawWorker();
  drawEffects();
}

function makeGrass(): void {
  grass = [];
  let seed = 19 + Math.round(width);
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const count = Math.round((width * Math.max(240, height - groundY)) / 12000);
  for (let index = 0; index < count; index += 1) {
    grass.push({
      x: random() * width,
      y: groundY + random() * Math.max(20, height - groundY - 4),
      height: 3 + random() * 5,
      lean: -2 + random() * 4,
    });
  }
}

function resize(): void {
  width = window.innerWidth;
  height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  groundY = Math.min(height - 88, buildbar.getBoundingClientRect().top - 16);
  scale = Math.max(0.72, Math.min(1.35, width / 1060));

  const compact = width < 640;
  tree.x = width * (compact ? 0.16 : 0.18);
  tree.size = scale;

  schools.gather.x = width * (compact ? 0.26 : 0.33);
  schools.craft.x = width * (compact ? 0.4 : 0.45);

  plots.house.x = width * (compact ? 0.43 : 0.57);
  plots.sawmill.x = width * (compact ? 0.65 : 0.7);
  plots.storehouse.x = width * (compact ? 0.88 : 0.87);

  worker.homeX = plots.storehouse.x - 50 * scale;
  if (worker.phase === "idle") {
    worker.x = worker.homeX;
  } else if (worker.phase === "returning") {
    worker.targetX = worker.homeX;
  } else if (worker.phase === "carry" || worker.phase === "unload") {
    worker.targetX = plots.storehouse.x - 42 * scale;
  } else if (worker.job?.type === "chop") {
    worker.targetX = tree.x + 27 * scale;
  } else if (worker.job?.type === "build") {
    worker.targetX = plots[worker.job.building].x;
  }

  const hotspotWidth = 126 * tree.size;
  const hotspotHeight = 162 * tree.size;
  treeHotspot.style.left = `${tree.x - hotspotWidth / 2}px`;
  treeHotspot.style.top = `${groundY - hotspotHeight + 8}px`;
  treeHotspot.style.width = `${hotspotWidth}px`;
  treeHotspot.style.height = `${hotspotHeight}px`;

  makeGrass();
  closeTreeMenu();
}

function frame(now: number): void {
  const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  update(delta);
  render();
  requestAnimationFrame(frame);
}

treeHotspot.addEventListener("click", (event) => {
  event.stopPropagation();
  if (treeMenu.hidden) {
    openTreeMenu();
  } else {
    closeTreeMenu();
  }
});

chopButton.addEventListener("click", (event) => {
  event.stopPropagation();
  requestChop();
});

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
  if (!row?.dataset.id) {
    return;
  }
  selectedResidentId = row.dataset.id;
  renderResidents();
});

residentDetail.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!button?.dataset.action || !selectedResidentId) {
    return;
  }
  if (button.dataset.action === "assign") {
    assignWorker(selectedResidentId);
  } else if (button.dataset.action === "school-gather") {
    sendToSchool(selectedResidentId, "gather");
  } else if (button.dataset.action === "school-craft") {
    sendToSchool(selectedResidentId, "craft");
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
  if (!button) {
    return;
  }
  if (button.dataset.action === "craft-start" && button.dataset.recipe) {
    startCraftFor(button.dataset.recipe);
  } else if (button.dataset.action === "craft-cancel" && button.dataset.building) {
    const buildingId = button.dataset.building;
    void enqueueCommand((current) => cancelCraft(current, buildingId))
      .then((next) => {
        syncFromSnapshot(next);
        renderCraft();
        setStatus("Ремесло отменено");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Не удалось отменить ремесло");
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
  if (!button) {
    return;
  }
  if (button.dataset.action === "research-start" && button.dataset.tech) {
    startResearchFor(button.dataset.tech);
  } else if (button.dataset.action === "research-cancel") {
    void enqueueCommand((current) => cancelResearch(current))
      .then((next) => {
        syncFromSnapshot(next);
        renderResearch();
        setStatus("Исследование отменено");
      })
      .catch((error: unknown) => {
        setStatus(
          error instanceof Error ? error.message : "Не удалось отменить исследование",
        );
      });
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-building]")) {
  button.addEventListener("click", () => {
    const id = button.dataset.building;
    if (id === "house" || id === "sawmill") {
      requestBuild(id);
    } else if (id === "workshop" || id === "academy") {
      openPlacement(id);
    }
  });
}

placementCancel.addEventListener("click", closePlacement);

placementCells.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-testid=placement-cell]");
  const sectorId = button?.dataset.sector;
  const x = Number(button?.dataset.x);
  const y = Number(button?.dataset.y);
  if (!placementType || !sectorId || !Number.isInteger(x) || !Number.isInteger(y)) {
    return;
  }
  const type = placementType;
  closePlacement();
  void requestServerBuilding(type, { sector_id: sectorId, x, y });
});

document.addEventListener("pointerdown", (event) => {
  if (treeMenu.hidden) {
    return;
  }
  const target = event.target;
  if (target instanceof Node && (treeMenu.contains(target) || treeHotspot.contains(target))) {
    return;
  }
  closeTreeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTreeMenu();
    closePlacement();
  }
});

window.addEventListener("resize", resize);

// --- Server session & authoritative tick loop (GDD 9.6) ---------------------
// The client renders; the server decides. Game time advances on the server
// (ADR-0005): each sync point asks the server what changed since last time and
// the server computes elapsed ticks from its own clock. `?fast=1` only speeds
// up local animation playback; it never accelerates simulation time.
let commandQueue: Promise<unknown> = Promise.resolve();

function enqueueCommand(
  task: (current: WorldSnapshot) => Promise<WorldSnapshot>,
): Promise<WorldSnapshot> {
  const run = commandQueue.then(() => {
    if (!snapshot) {
      throw new Error("no active session");
    }
    return task(snapshot);
  });
  commandQueue = run.catch(() => undefined);
  return run;
}

async function tickServer(): Promise<void> {
  if (!snapshot) {
    return;
  }
  try {
    const next = await enqueueCommand((current) => advanceWorld(current));
    syncFromSnapshot(next);
    for (let i = students.length - 1; i >= 0; i -= 1) {
      const student = students[i]!;
      const resident = residentById(student.residentId);
      if (!resident || resident.state === "idle") {
        finishSchool(student);
        students.splice(i, 1);
      }
    }
    renderResidents();
  } catch {
    // Transient network/server hiccup: keep the last known state and retry.
  }
}

async function bootstrap(): Promise<void> {
  try {
    const initial = await startSession();
    syncFromSnapshot(initial);
    renderResidents();
  } catch (error) {
    setStatus(
      `Не удалось связаться с сервером: ${error instanceof Error ? error.message : "ошибка"}`,
    );
    return;
  }
  window.setInterval(() => {
    void tickServer();
  }, 400);
}

syncUI();
resize();
void bootstrap();
let lastFrame = performance.now();
requestAnimationFrame(frame);
