import Phaser from 'phaser';
import {
  WORLD_CONFIG,
  type SectorSnapshot,
  type TerrainCell,
  type TerrainType,
  type Transport,
  type WorldSnapshot
} from '@avanpost/shared';

const TILE = WORLD_CONFIG.tileSize;
const SIDE_DEPTH = 16;
const WORLD_OFFSET_Y = 240;

const FALLBACK_COLORS: Record<TerrainType, number> = {
  grass: 0x3f6b47,
  soil: 0x6b543a,
  forest: 0x24452f,
  scree: 0x8a7f6a,
  rock: 0x5a5f66,
  water: 0x2c5d7c
};

export interface SceneHandlers {
  onCellClick: (sectorId: string, x: number, y: number) => void;
  onBuildClick: (sectorId: string, x: number, y: number) => void;
  onFrontierClick: (x: number, y: number) => void;
  onNodeClick: (nodeId: string) => void;
  onPlacementConfirm: (sectorId: string, x: number, y: number) => void;
  onPlacementRejected: (reason: string) => void;
  onPlacementCancel: () => void;
}

export interface PlacementInfo {
  type: string;
  label: string;
  materials: Record<string, number>;
  footprint: { width: number; height: number };
}

interface Point {
  x: number;
  y: number;
}

export class WorldScene extends Phaser.Scene {
  private snapshot: WorldSnapshot;
  private handlers: SceneHandlers;
  private transport: Transport = 'person';
  private buildType: string | null = null;
  private layers: Phaser.GameObjects.GameObject[] = [];
  private dynamic!: Phaser.GameObjects.Graphics;
  private fromVisual = new Map<string, { x: number; y: number }>();
  private targetVisual = new Map<string, { x: number; y: number }>();
  private animStart = 0;
  private cameraInitialized = false;
  private hoverCell: { sectorId: string; x: number; y: number } | null = null;
  private placement: PlacementInfo | null = null;
  private pendingPlacement: { sectorId: string; x: number; y: number } | null = null;
  private placementGraphics: Phaser.GameObjects.Graphics | null = null;
  private dragStart: Point = { x: 0, y: 0 };
  private cameraStart: Point = { x: 0, y: 0 };
  private pointerStart: Point = { x: 0, y: 0 };

  constructor(snapshot: WorldSnapshot, handlers: SceneHandlers) {
    super('world');
    this.snapshot = snapshot;
    this.handlers = handlers;
  }

  create(): void {
    this.dynamic = this.add.graphics().setDepth(40);
    this.placementGraphics = this.add.graphics().setDepth(60);
    this.draw();
    this.applyCameraBounds(true);
    this.bindInput();
    this.recenter();
    this.scale.on('resize', () => {
      this.cameras.main.setSize(this.scale.width, this.scale.height);
    });
  }

  updateSnapshot(snapshot: WorldSnapshot): void {
    if (!this.dynamic) {
      this.snapshot = snapshot;
      return;
    }
    const known = new Set(this.snapshot.sectors.map((sector) => sector.id));
    const now = this.time.now;
    const current = new Map<string, { x: number; y: number }>();
    for (const laborer of this.snapshot.laborers) {
      current.set(laborer.id, this.visualAt(laborer.id, now));
    }

    this.snapshot = snapshot;
    this.fromVisual = new Map();
    this.targetVisual = new Map();
    for (const laborer of snapshot.laborers) {
      const target = this.globalCenter(laborer.sectorId, laborer.x, laborer.y);
      if (!target) continue;
      this.targetVisual.set(laborer.id, target);
      this.fromVisual.set(laborer.id, current.get(laborer.id) ?? target);
    }
    this.animStart = now;
    this.draw();
    this.applyCameraBounds(false);

    const added = snapshot.sectors.find((sector) => !known.has(sector.id));
    if (!added) return;
    const neighbor = snapshot.sectors.find(
      (sector) =>
        known.has(sector.id) &&
        Math.abs(sector.x - added.x) + Math.abs(sector.y - added.y) === 1
    );
    const camera = this.cameras.main;
    if (!neighbor) {
      camera.centerOn(
        (added.x + 0.5) * added.width * TILE,
        WORLD_OFFSET_Y + (added.y + 0.5) * added.height * SIDE_DEPTH
      );
      return;
    }
    camera.centerOn(
      ((added.x + neighbor.x) / 2 + 0.5) * added.width * TILE,
      WORLD_OFFSET_Y + ((added.y + neighbor.y) / 2 + 0.5) * added.height * SIDE_DEPTH
    );
  }

  recenter(): void {
    const first = this.snapshot.sectors[0];
    if (!first) return;
    const camera = this.cameras.main;
    const clearingX = Math.floor(first.width * 0.45) + 2;
    camera.setZoom(1.9);
    camera.centerOn(
      (first.x * first.width + clearingX) * TILE,
      WORLD_OFFSET_Y + first.height * SIDE_DEPTH * 0.3
    );
  }

  setTransport(transport: Transport): void {
    if (this.transport === transport) return;
    this.transport = transport;
    this.draw();
  }

  setBuildType(type: string | null): void {
    if (this.buildType === type) return;
    this.buildType = type;
    this.input.setDefaultCursor(type ? 'crosshair' : 'default');
    this.draw();
  }

  setPlacement(info: PlacementInfo | null): void {
    this.placement = info;
    this.pendingPlacement = null;
    this.hoverCell = null;
    this.input.setDefaultCursor(info ? 'crosshair' : 'default');
    this.draw();
  }

  confirmPendingPlacement(): void {
    if (!this.pendingPlacement) return;
    const target = this.pendingPlacement;
    this.pendingPlacement = null;
    this.handlers.onPlacementConfirm(target.sectorId, target.x, target.y);
  }

  cancelPlacement(): void {
    this.placement = null;
    this.pendingPlacement = null;
    this.hoverCell = null;
    this.input.setDefaultCursor('default');
    this.draw();
    this.handlers.onPlacementCancel();
  }

  screenPointFor(sectorId: string, x: number, y: number): { x: number; y: number } | null {
    if (!this.cameras?.main) return null;
    const origin = this.sectorOrigin(sectorId);
    if (!origin) return null;
    const worldX = (origin.x + x + 0.5) * TILE;
    const worldY = WORLD_OFFSET_Y + (origin.y + y + 0.5) * SIDE_DEPTH;
    const camera = this.cameras.main;
    const view = camera.worldView;
    return {
      x: (worldX - view.x) * camera.zoom,
      y: (worldY - view.y) * camera.zoom
    };
  }

  getTransport(): Transport {
    return this.transport;
  }

  private colorOf(type: TerrainType): number {
    const info = this.snapshot.catalog.terrains.find((terrain) => terrain.id === type);
    if (!info) return FALLBACK_COLORS[type];
    return Phaser.Display.Color.HexStringToColor(info.color).color;
  }

  private biomeTint(biomeId: string): number {
    const biome = this.snapshot.catalog.biomes.find((item) => item.id === biomeId);
    if (!biome) return 0x7fa88a;
    return Phaser.Display.Color.HexStringToColor(biome.tint).color;
  }

  private draw(): void {
    this.hoverCell = null;
    for (const layer of this.layers) layer.destroy();
    this.layers = [];

    const graphics = this.add.graphics();
    this.layers.push(graphics);

    this.drawSky(graphics);

    const sectorIds = new Set(this.snapshot.sectors.map((sector) => `${sector.x}:${sector.y}`));

    for (const sector of this.snapshot.sectors) {
      this.drawSector(graphics, sector);
    }

    for (const frontier of this.snapshot.frontier) {
      const key = `${frontier.x}:${frontier.y}`;
      if (sectorIds.has(key)) continue;
      this.drawFrontier(graphics, frontier.x, frontier.y, this.biomeTint(frontier.biome));
    }

    this.drawSchools(graphics);
    this.drawEconomy(graphics);
    this.drawPlacement();
  }

  private schoolCell(school: 'gather' | 'craft'): { sectorId: string; x: number; y: number } | null {
    const sector = this.snapshot.sectors[0];
    const storage = this.snapshot.storages.find(
      (item) => item.sectorId === sector?.id
    );
    if (!sector || !storage) return null;
    const offset = school === 'gather' ? -6 : 6;
    const x = Math.max(1, Math.min(sector.width - 2, storage.x + offset));
    const y = Math.max(1, Math.min(sector.height - 2, storage.y + 1));
    return { sectorId: sector.id, x, y };
  }

  private drawSchools(graphics: Phaser.GameObjects.Graphics): void {
    for (const school of ['gather', 'craft'] as const) {
      const cell = this.schoolCell(school);
      if (!cell) continue;
      const origin = this.sectorOrigin(cell.sectorId);
      if (!origin) continue;
      const px = (origin.x + cell.x + 0.5) * TILE;
      const base = WORLD_OFFSET_Y + (origin.y + cell.y + 1) * SIDE_DEPTH;
      graphics.fillStyle(0x0a0e12, 0.3);
      graphics.fillEllipse(px, base, 46, 8);
      graphics.fillStyle(school === 'gather' ? 0x6f8b4a : 0x5f7290, 1);
      graphics.fillRoundedRect(px - 20, base - 24, 40, 24, 4);
      graphics.fillStyle(school === 'gather' ? 0x9fbf6a : 0x8fa3c4, 1);
      graphics.fillTriangle(px - 24, base - 24, px + 24, base - 24, px, base - 38);
      graphics.lineStyle(1, 0x1c2419, 0.6);
      graphics.strokeRoundedRect(px - 20, base - 24, 40, 24, 4);
      graphics.fillStyle(0x2b2216, 0.8);
      graphics.fillRect(px - 4, base - 14, 8, 14);
    }
  }

  private sectorOrigin(sectorId: string): { x: number; y: number } | null {
    for (const sector of this.snapshot.sectors) {
      if (sector.id !== sectorId) continue;
      return { x: sector.x * sector.width, y: sector.y * sector.height };
    }
    return null;
  }

  private globalCenter(
    sectorId: string,
    x: number,
    y: number
  ): { x: number; y: number } | null {
    for (const sector of this.snapshot.sectors) {
      if (sector.id !== sectorId) continue;
      return {
        x: sector.x * sector.width + x + 0.5,
        y: sector.y * sector.height + y + 1
      };
    }
    return null;
  }

  private projectGlobal(x: number, y: number): { x: number; y: number } {
    return { x: x * TILE, y: WORLD_OFFSET_Y + y * SIDE_DEPTH };
  }

  private locateCell(worldX: number, worldY: number): { sectorId: string; x: number; y: number } | null {
    const tileX = Math.floor(worldX / TILE);
    const tileY = Math.floor((worldY - WORLD_OFFSET_Y) / SIDE_DEPTH);
    for (const sector of this.snapshot.sectors) {
      const x = tileX - sector.x * sector.width;
      const y = tileY - sector.y * sector.height;
      if (x < 0 || y < 0 || x >= sector.width || y >= sector.height) continue;
      return { sectorId: sector.id, x, y };
    }
    return null;
  }

  private cellAt(
    worldX: number,
    worldY: number
  ): { sectorId: string; x: number; y: number } | null {
    return this.locateCell(worldX, worldY);
  }

  private storageQty(item: string): number {
    return this.snapshot.storages.reduce(
      (total, storage) =>
        total +
        (storage.contents.find((entry) => entry.item === item)?.qty ?? 0),
      0
    );
  }

  private placementStatus(target: {
    sectorId: string;
    x: number;
    y: number;
  }): { status: 'allowed' | 'waiting' | 'blocked'; reason: string } {
    const info = this.placement;
    if (!info) return { status: 'blocked', reason: 'Режим размещения выключен' };
    const sector = this.snapshot.sectors.find(
      (item) => item.id === target.sectorId
    );
    if (!sector) return { status: 'blocked', reason: 'Сектор не найден' };

    const occupied = new Set<string>([
      ...this.snapshot.buildings
        .filter(
          (item) =>
            item.sectorId === sector.id && item.status !== 'demolished'
        )
        .map((item) => `${item.x}:${item.y}`),
      ...this.snapshot.storages
        .filter((item) => item.sectorId === sector.id)
        .map((item) => `${item.x}:${item.y}`),
      ...this.snapshot.nodes
        .filter((item) => item.sectorId === sector.id)
        .map((item) => `${item.x}:${item.y}`)
    ]);

    for (let dy = 0; dy < info.footprint.height; dy += 1) {
      for (let dx = 0; dx < info.footprint.width; dx += 1) {
        const x = target.x + dx;
        const y = target.y + dy;
        const cell = sector.terrain.find(
          (item) => item.x === x && item.y === y
        );
        if (!cell) return { status: 'blocked', reason: 'За пределами сектора' };
        if (!cell.passable) {
          return { status: 'blocked', reason: 'Клетка непроходима' };
        }
        if (!cell.reachable) {
          return { status: 'blocked', reason: 'К клетке нет доступа' };
        }
        if (cell.clearing) {
          return { status: 'blocked', reason: 'Клетка расчищается' };
        }
        if (occupied.has(`${x}:${y}`)) {
          return { status: 'blocked', reason: 'Клетка занята' };
        }
      }
    }

    const missing = Object.entries(info.materials).filter(
      ([item, qty]) => this.storageQty(item) < qty
    );
    if (missing.length > 0) {
      return {
        status: 'waiting',
        reason: `Ожидает доставки: ${missing
          .map(([item, qty]) => `${item} ${qty}`)
          .join(', ')}`
      };
    }
    return { status: 'allowed', reason: 'Можно строить' };
  }

  private drawPlacement(): void {
    const graphics = this.placementGraphics;
    if (!graphics) return;
    graphics.clear();
    if (!this.placement) {
      this.pendingPlacement = null;
      return;
    }

    graphics.lineStyle(1, 0xdfe8d2, 0.18);
    for (const sector of this.snapshot.sectors) {
      const ox = sector.x * sector.width * TILE;
      const oy =
        WORLD_OFFSET_Y + sector.y * sector.height * SIDE_DEPTH;
      for (let x = 0; x <= sector.width; x += 1) {
        graphics.lineBetween(
          ox + x * TILE,
          oy,
          ox + x * TILE,
          oy + sector.height * SIDE_DEPTH
        );
      }
      for (let y = 0; y <= sector.height; y += 1) {
        graphics.lineBetween(
          ox,
          oy + y * SIDE_DEPTH,
          ox + sector.width * TILE,
          oy + y * SIDE_DEPTH
        );
      }
    }

    const target = this.pendingPlacement ?? this.hoverCell;
    if (!target) return;
    const origin = this.sectorOrigin(target.sectorId);
    if (!origin) return;
    const result = this.placementStatus(target);
    const color =
      result.status === 'allowed'
        ? 0x6ee089
        : result.status === 'waiting'
          ? 0xe0b86e
          : 0xe06a5a;
    const width = this.placement.footprint.width * TILE;
    const height = this.placement.footprint.height * SIDE_DEPTH;
    const px = (origin.x + target.x) * TILE;
    const py =
      WORLD_OFFSET_Y + (origin.y + target.y) * SIDE_DEPTH;

    graphics.fillStyle(color, this.pendingPlacement ? 0.32 : 0.22);
    graphics.fillRect(px + 1, py + 1, width - 2, height - 2);
    graphics.lineStyle(2, color, 0.95);
    graphics.strokeRect(px + 1, py + 1, width - 2, height - 2);

    graphics.fillStyle(color, 0.35);
    graphics.fillRect(px + 4, py - 14, width - 8, 14);
    graphics.lineStyle(1, color, 0.9);
    graphics.lineBetween(px + 4, py - 14, px + width / 2, py - 22);
    graphics.lineBetween(px + width - 4, py - 14, px + width / 2, py - 22);
  }

  findPlacementPoint(): {
    sectorId: string;
    x: number;
    y: number;
    screen: { x: number; y: number };
  } | null {
    if (!this.placement) return null;
    const camera = this.cameras.main;
    const center = camera.getWorldPoint(camera.width / 2, camera.height / 2);
    const centerX = Math.floor(center.x / TILE);
    const centerY = Math.floor((center.y - WORLD_OFFSET_Y) / SIDE_DEPTH);
    let best:
      | { sectorId: string; x: number; y: number; screen: { x: number; y: number }; distance: number }
      | null = null;
    for (const sector of this.snapshot.sectors) {
      const originX = sector.x * sector.width;
      const originY = sector.y * sector.height;
      for (let y = 0; y < sector.height; y += 1) {
        for (let x = 0; x < sector.width; x += 1) {
          const target = { sectorId: sector.id, x, y };
          if (this.placementStatus(target).status === 'blocked') continue;
          const screen = this.screenPointFor(sector.id, x, y);
          if (!screen) continue;
          if (
            screen.x < 40 ||
            screen.y < 120 ||
            screen.x > camera.width - 40 ||
            screen.y > camera.height - 160
          ) {
            continue;
          }
          const distance = Math.hypot(
            originX + x - centerX,
            originY + y - centerY
          );
          if (!best || distance < best.distance) {
            best = { ...target, screen, distance };
          }
        }
      }
    }
    return best ? { sectorId: best.sectorId, x: best.x, y: best.y, screen: best.screen } : null;
  }

  private buildTargetAt(
    worldX: number,
    worldY: number
  ): { sectorId: string; x: number; y: number } | null {
    const located = this.locateCell(worldX, worldY);
    if (!located) return null;
    const sector = this.snapshot.sectors.find((item) => item.id === located.sectorId);
    if (!sector) return null;
    const occupied = new Set<string>([
      ...this.snapshot.buildings
        .filter((item) => item.sectorId === sector.id)
        .map((item) => `${item.x}:${item.y}`),
      ...this.snapshot.storages
        .filter((item) => item.sectorId === sector.id)
        .map((item) => `${item.x}:${item.y}`),
      ...this.snapshot.nodes
        .filter((item) => item.sectorId === sector.id)
        .map((item) => `${item.x}:${item.y}`)
    ]);
    const allowed = (x: number, y: number): boolean => {
      const cell = sector.terrain.find((item) => item.x === x && item.y === y);
      return Boolean(
        cell && cell.reachable && !cell.clearing && !occupied.has(`${x}:${y}`)
      );
    };
    if (allowed(located.x, located.y)) return located;

    let best: { sectorId: string; x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (let y = Math.max(0, located.y - 5); y <= Math.min(sector.height - 1, located.y + 5); y += 1) {
      for (let x = Math.max(0, located.x - 5); x <= Math.min(sector.width - 1, located.x + 5); x += 1) {
        if (!allowed(x, y)) continue;
        const distance = Math.hypot(x - located.x, y - located.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { sectorId: sector.id, x, y };
        }
      }
    }
    return best;
  }

  private shade(color: number, factor: number): number {
    const red = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
    const green = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
    const blue = Math.min(255, Math.floor((color & 0xff) * factor));
    return (red << 16) | (green << 8) | blue;
  }

  private visualAt(id: string, now: number): { x: number; y: number } {
    const from = this.fromVisual.get(id);
    const target = this.targetVisual.get(id);
    if (!target) return { x: 0, y: 0 };
    if (!from) return target;
    const progress = Phaser.Math.Clamp((now - this.animStart) / 720, 0, 1);
    const eased = Phaser.Math.Easing.Sine.Out(progress);
    return {
      x: Phaser.Math.Linear(from.x, target.x, eased),
      y: Phaser.Math.Linear(from.y, target.y, eased)
    };
  }

  override update(time: number): void {
    this.drawDynamic(time);
  }

  private drawDynamic(now: number): void {
    const graphics = this.dynamic;
    graphics.clear();
    const pulse = 0.5 + Math.sin(now / 180) * 0.5;
    const progress = Phaser.Math.Clamp((now - this.animStart) / 720, 0, 1);
    const studying = new Map(
      this.snapshot.residents
        .filter((resident) => resident.state === 'school' && resident.training)
        .map((resident) => [resident.id, resident])
    );

    for (const laborer of this.snapshot.laborers) {
      if (laborer.residentId && studying.has(laborer.residentId)) continue;
      const logical = this.visualAt(laborer.id, now);
      const point = this.projectGlobal(logical.x, logical.y);
      const previous = this.fromVisual.get(laborer.id) ?? logical;
      const moving = progress < 1 && Math.hypot(logical.x - previous.x, logical.y - previous.y) > 0.02;
      const bob = moving ? Math.sin(now / 65) * 1.8 : 0;
      const px = point.x;
      const py = point.y + bob;
      const facing = logical.x < previous.x ? -1 : 1;
      const haul =
        this.snapshot.haulTasks.find((task) => task.carrierId === laborer.id) ??
        this.snapshot.transferTasks.find((task) => task.carrierId === laborer.id);
      const carrying =
        haul && ['loading', 'moving', 'unloading'].includes(haul.status)
          ? haul.item
          : null;
      const building = laborer.buildingId
        ? this.snapshot.buildings.find((item) => item.id === laborer.buildingId)
        : undefined;
      const working = laborer.status === 'building' && building?.status === 'building';
      const bodyColor =
        laborer.role === 'builder'
          ? 0xe0b86e
          : laborer.role === 'carrier'
            ? 0x7fb2ff
            : 0xa7d78f;

      if (laborer.transport === 'cart') {
        if (moving) {
          graphics.fillStyle(0xcdbf9a, 0.12);
          graphics.fillCircle(px - facing * 16, py - 1, 5);
          graphics.fillCircle(px - facing * 24, py - 2, 3);
        }
        graphics.fillStyle(0x0a0e12, 0.25);
        graphics.fillEllipse(px, py, 42, 7);
        graphics.fillStyle(0x3b2a1b, 1);
        graphics.fillRoundedRect(px - 15, py - 17, 30, 14, 3);
        graphics.lineStyle(1, 0xa98350, 0.9);
        graphics.strokeRoundedRect(px - 15, py - 17, 30, 14, 3);
        graphics.fillStyle(0x1c1510, 1);
        graphics.fillCircle(px - 9, py - 2, 4.5);
        graphics.fillCircle(px + 9, py - 2, 4.5);
        const wheelAngle = now / 90;
        graphics.lineStyle(1, 0x8d7048, 0.8);
        for (const wheelX of [px - 9, px + 9]) {
          for (let spoke = 0; spoke < 3; spoke += 1) {
            const angle = wheelAngle + (spoke * Math.PI) / 3;
            graphics.lineBetween(
              wheelX,
              py - 2,
              wheelX + Math.cos(angle) * 3.6,
              py - 2 + Math.sin(angle) * 3.6
            );
          }
        }
        graphics.lineStyle(1, 0x8f6d43, 1);
        graphics.lineBetween(px + 15, py - 16, px + 20, py - 24);
        graphics.fillStyle(bodyColor, 1);
        graphics.fillCircle(px + 20, py - 28, 4.5);
        graphics.lineStyle(3, bodyColor, 1);
        graphics.lineBetween(px + 20, py - 24, px + 20 + facing * 2, py - 13);
        if (carrying) this.drawCargo(graphics, px, py, carrying, true);
      } else {
        if (moving) {
          graphics.fillStyle(0xcdbf9a, 0.1);
          graphics.fillCircle(px - facing * 8, py - 1, 4);
        }
        graphics.fillStyle(0x0b1118, 0.35);
        graphics.fillEllipse(px, py, 18, 6);
        graphics.lineStyle(3, bodyColor, 1);
        graphics.lineBetween(px, py - 20, px - facing * 3, py - 9);
        graphics.lineBetween(px - facing * 3, py - 9, px - 6, py);
        graphics.lineBetween(px - facing * 3, py - 9, px + 5, py);
        graphics.fillStyle(bodyColor, 1);
        graphics.fillCircle(px, py - 24, 4.5);
        if (carrying) this.drawCargo(graphics, px, py, carrying, false);
      }

      if (working) {
        graphics.fillStyle(0xd7a24a, 0.35 + pulse * 0.45);
        graphics.fillCircle(px + 10, py - 22, 6 + pulse * 2);
        graphics.lineStyle(2, 0xf0d39a, 0.9);
        graphics.lineBetween(px + 8, py - 20, px + 14, py - 28);
        graphics.lineBetween(px + 12, py - 28, px + 17, py - 26);
      }
    }

    for (const resident of studying.values()) {
      const training = resident.training;
      if (!training) continue;
      const cell = this.schoolCell(training.schoolId);
      if (!cell) continue;
      const origin = this.sectorOrigin(cell.sectorId);
      if (!origin) continue;
      const px = (origin.x + cell.x + 0.5) * TILE;
      const base = WORLD_OFFSET_Y + (origin.y + cell.y + 1) * SIDE_DEPTH;
      const bob = Math.sin(now / 400) * 1.4;
      graphics.fillStyle(0x0b1118, 0.3);
      graphics.fillEllipse(px, base, 16, 5);
      graphics.lineStyle(3, 0xb59ad6, 1);
      graphics.lineBetween(px, base - 18, px - 2, base - 8);
      graphics.lineBetween(px - 2, base - 8, px - 6, base);
      graphics.lineBetween(px - 2, base - 8, px + 5, base);
      graphics.fillStyle(0xd8c3ef, 1);
      graphics.fillCircle(px, base - 22 + bob, 4.5);
      const ratio = 1 - training.leftTicks / Math.max(1, training.totalTicks);
      graphics.fillStyle(0x141a13, 0.85);
      graphics.fillRoundedRect(px - 16, base - 34, 32, 5, 2);
      graphics.fillStyle(0xe0b86e, 1);
      graphics.fillRoundedRect(px - 16, base - 34, 32 * ratio, 5, 2);
      if (Math.floor(now / 300) % 2 === 0) {
        graphics.fillStyle(0xf3d58a, 0.9);
        graphics.fillCircle(px + 15, base - 26, 2);
      }
    }

    for (const building of this.snapshot.buildings) {
      const origin = this.sectorOrigin(building.sectorId);
      if (!origin) continue;
      const px = (origin.x + building.x + 0.5) * TILE;
      const base = WORLD_OFFSET_Y + (origin.y + building.y + 1) * SIDE_DEPTH;
      if (building.status === 'building') {
        for (let spark = 0; spark < 4; spark += 1) {
          const phase = ((now / 520 + spark / 4) % 1 + 1) % 1;
          graphics.fillStyle(0xe0b86e, (1 - phase) * 0.45);
          graphics.fillCircle(
            px + Math.sin(now / 180 + spark * 2) * 9,
            base - 4 - phase * 18,
            1.5 + (1 - phase) * 1.5
          );
        }
      }
      if (building.status === 'complete' && building.type === 'house') {
        for (let puff = 0; puff < 3; puff += 1) {
          const phase = ((now / 2200 + puff / 3) % 1 + 1) % 1;
          graphics.fillStyle(0xb8c3bd, (1 - phase) * 0.16);
          graphics.fillCircle(
            px + 7 + Math.sin(now / 900 + puff) * 3,
            base - 66 - phase * 34,
            3 + phase * 4
          );
        }
      }
    }

    if (this.buildType && this.hoverCell) {
      const sector = this.snapshot.sectors.find(
        (item) => item.id === this.hoverCell?.sectorId
      );
      const cell = sector?.terrain.find(
        (item) => item.x === this.hoverCell?.x && item.y === this.hoverCell?.y
      );
      if (sector && cell) {
        const occupied =
          this.snapshot.buildings.some(
            (item) => item.sectorId === sector.id && item.x === cell.x && item.y === cell.y
          ) ||
          this.snapshot.storages.some(
            (item) => item.sectorId === sector.id && item.x === cell.x && item.y === cell.y
          ) ||
          this.snapshot.nodes.some(
            (item) => item.sectorId === sector.id && item.x === cell.x && item.y === cell.y
          );
        const allowed = cell.reachable && !occupied;
        const px = (sector.x * sector.width + cell.x) * TILE;
        const base = WORLD_OFFSET_Y + (sector.y * sector.height + cell.y + 1) * SIDE_DEPTH;
        const tint = allowed ? 0x9ad0a2 : 0xd97b6c;
        graphics.fillStyle(tint, 0.16);
        graphics.fillRect(px + 1, base - 28, TILE - 2, 28);
        graphics.lineStyle(2, tint, 0.9);
        graphics.strokeRect(px + 1, base - 28, TILE - 2, 28);
        graphics.lineStyle(1, tint, 0.6);
        graphics.strokeRect(px + 1, base - SIDE_DEPTH - 1, TILE - 2, SIDE_DEPTH);
      }
    }
  }

  private drawCargo(
    graphics: Phaser.GameObjects.Graphics,
    px: number,
    py: number,
    item: string,
    onCart: boolean
  ): void {
    const color =
      item === 'stone' || item === 'clay'
        ? 0x9aa0a6
        : item === 'planks'
          ? 0xc69a5c
          : item === 'grain'
            ? 0xd6b85a
            : item === 'water'
              ? 0x6fa9c9
              : 0x8a5c35;
    const y = onCart ? py - 24 : py - 31;
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(px - 5, y - 5, 11, 7, 2);
    graphics.lineStyle(1, 0x2a2118, 0.8);
    graphics.strokeRoundedRect(px - 5, y - 5, 11, 7, 2);
  }

  private mixColor(from: number, to: number, amount: number): number {
    const mix = (shift: number): number => {
      const a = (from >> shift) & 0xff;
      const b = (to >> shift) & 0xff;
      return Math.round(a + (b - a) * amount);
    };
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
  }

  private drawSky(graphics: Phaser.GameObjects.Graphics): void {
    const first = this.snapshot.sectors[0];
    if (!first) return;
    let minX = first.x;
    let maxX = first.x;
    for (const sector of this.snapshot.sectors) {
      minX = Math.min(minX, sector.x);
      maxX = Math.max(maxX, sector.x);
    }
    for (const frontier of this.snapshot.frontier) {
      minX = Math.min(minX, frontier.x);
      maxX = Math.max(maxX, frontier.x);
    }
    const left = (minX - 1) * first.width * TILE;
    const width = (maxX - minX + 3) * first.width * TILE;
    const skyTop = WORLD_OFFSET_Y - 420;
    const skyBottom = WORLD_OFFSET_Y + 4;
    const stops = [0x071019, 0x0c1c28, 0x16303a, 0x29484c, 0x4d625b, 0x7c745f];
    const bands = 54;
    for (let index = 0; index < bands; index += 1) {
      const t = index / (bands - 1);
      const scaled = t * (stops.length - 1);
      const stop = Math.min(stops.length - 2, Math.floor(scaled));
      const color = this.mixColor(stops[stop] ?? 0, stops[stop + 1] ?? 0, scaled - stop);
      graphics.fillStyle(color, 1);
      graphics.fillRect(
        left,
        skyTop + t * (skyBottom - skyTop),
        width,
        (skyBottom - skyTop) / bands + 1
      );
    }

    const sunX = (first.x + 0.55) * first.width * TILE;
    const sunY = WORLD_OFFSET_Y - 190;
    for (let ring = 4; ring >= 1; ring -= 1) {
      graphics.fillStyle(0xe8cf9a, 0.025 * ring);
      graphics.fillCircle(sunX, sunY, 34 + ring * 16);
    }
    graphics.fillStyle(0xdcc18a, 0.8);
    graphics.fillCircle(sunX, sunY, 22);

    graphics.fillStyle(0x9ab4b0, 0.06);
    graphics.fillEllipse(sunX - 190, sunY + 70, 230, 34);
    graphics.fillEllipse(sunX + 150, sunY + 110, 320, 42);

    const horizon = WORLD_OFFSET_Y + 10;
    graphics.fillStyle(0x152b31, 0.95);
    graphics.beginPath();
    graphics.moveTo(left, horizon);
    for (let x = left; x <= left + width; x += 210) {
      const peak = 46 + ((Math.abs(x) / 210) % 4) * 17;
      graphics.lineTo(x + 105, horizon - peak);
      graphics.lineTo(x + 210, horizon - 8);
    }
    graphics.lineTo(left + width, horizon);
    graphics.lineTo(left, horizon);
    graphics.closePath();
    graphics.fillPath();

    graphics.fillStyle(0x1c383c, 1);
    graphics.beginPath();
    graphics.moveTo(left, horizon);
    for (let x = left; x <= left + width; x += 320) {
      const peak = 26 + ((Math.abs(x) / 170) % 3) * 11;
      graphics.lineTo(x + 160, horizon - peak);
      graphics.lineTo(x + 320, horizon + 4);
    }
    graphics.lineTo(left + width, horizon);
    graphics.lineTo(left, horizon);
    graphics.closePath();
    graphics.fillPath();

    graphics.fillStyle(0x6e8b80, 0.08);
    graphics.fillRect(left, horizon - 18, width, 34);
  }

  private drawEconomy(graphics: Phaser.GameObjects.Graphics): void {
    const nodeById = new Map(this.snapshot.nodes.map((node) => [node.id, node]));
    const originOf = (sectorId: string) => this.sectorOrigin(sectorId);

    const drawRoute = (
      sectorId: string,
      points: Array<[number, number]>,
      color: number
    ): void => {
      const origin = originOf(sectorId);
      if (!origin || points.length < 2) return;
      graphics.lineStyle(2, color, 0.6);
      graphics.beginPath();
      points.forEach(([x, y], index) => {
        const px = (origin.x + x + 0.5) * TILE;
        const py = WORLD_OFFSET_Y + (origin.y + y + 1) * SIDE_DEPTH - 5;
        if (index === 0) graphics.moveTo(px, py);
        else graphics.lineTo(px, py);
      });
      graphics.strokePath();
    };

    for (const task of this.snapshot.transferTasks) {
      const building = this.snapshot.buildings.find(
        (item) => item.id === task.buildingId
      );
      if (!building) continue;
      const storage = this.snapshot.storages.find(
        (item) => item.id === task.storageId
      );
      const points: Array<[number, number]> =
        task.path.length > 0
          ? task.path
          : storage
            ? [
                [building.x, building.y],
                [storage.x, storage.y]
              ]
            : [];
      drawRoute(building.sectorId, points, 0xe0b86e);
    }

    for (const task of this.snapshot.haulTasks) {
      const node = nodeById.get(task.nodeId);
      if (!node) continue;
      const storage = this.snapshot.storages.find(
        (item) => item.id === task.storageId
      );
      const points: Array<[number, number]> =
        task.path.length > 0
          ? task.path
          : storage
            ? [
                [node.x, node.y],
                [storage.x, storage.y]
              ]
            : [];
      drawRoute(node.sectorId, points, 0x7fd1c8);
    }

    const entities: Array<{ y: number; draw: () => void }> = [];

    for (const building of this.snapshot.buildings) {
      const origin = originOf(building.sectorId);
      if (!origin) continue;
      const gx = origin.x + building.x;
      const gy = origin.y + building.y;
      const px = gx * TILE;
      const base = WORLD_OFFSET_Y + (gy + 1) * SIDE_DEPTH;
      const tint = Phaser.Display.Color.HexStringToColor(building.tint).color;
      const ratio =
        building.status === 'awaiting_materials'
          ? building.materials.reduce((sum, item) => sum + item.delivered, 0) /
            Math.max(
              1,
              building.materials.reduce((sum, item) => sum + item.required, 0)
            )
          : building.workDone / Math.max(1, building.workRequired);
      entities.push({
        y: base,
        draw: () => {
          if (
            building.category === 'infrastructure' &&
            building.status === 'complete'
          ) {
            graphics.fillStyle(0x4b3d2c, 1);
            graphics.fillRect(px - 1, base - 5, TILE + 2, 7);
            graphics.fillStyle(tint, 0.9);
            if (building.type === 'stairs') {
              for (let step = 0; step < 4; step += 1) {
                graphics.fillRect(
                  px + 2 + step * 7,
                  base - 4 - step * 3,
                  8 + step * 2,
                  4
                );
              }
            } else {
              graphics.fillRect(px - 1, base - 5, TILE + 2, 3);
              graphics.lineStyle(1, 0x2a2118, 0.55);
              for (let offset = 4; offset < TILE; offset += 8) {
                graphics.lineBetween(px + offset, base - 5, px + offset, base + 1);
              }
            }
            return;
          }

          if (building.status === 'complete' || building.status === 'demolition') {
            const wide = building.type === 'storehouse';
            const workshop = building.type === 'workshop';
            const width = TILE * (wide ? 1.2 : 0.84);
            const bodyHeight = wide ? 26 : workshop ? 32 : 38;
            const left = px + (TILE - width) / 2;
            const alpha = building.status === 'demolition' ? 0.35 : 1;
            graphics.fillStyle(0x0a0e12, 0.35);
            graphics.fillEllipse(px + TILE / 2, base, width + 10, 9);
            graphics.fillStyle(tint, alpha);
            graphics.fillRect(left, base - bodyHeight, width, bodyHeight);
            graphics.fillStyle(this.shade(tint, 1.25), alpha);
            if (wide) {
              graphics.fillRect(left - 4, base - bodyHeight - 9, width + 8, 9);
              graphics.fillStyle(this.shade(tint, 0.72), alpha);
              graphics.fillRect(left - 4, base - bodyHeight - 3, width + 8, 3);
            } else {
              graphics.fillTriangle(
                left - 4,
                base - bodyHeight,
                px + TILE / 2,
                base - bodyHeight - 23,
                left + width + 4,
                base - bodyHeight
              );
            }
            graphics.fillStyle(0x2a2118, 0.85);
            graphics.fillRect(px + TILE / 2 - 4, base - 14, 8, 14);
            graphics.fillStyle(0xf0d39a, 0.9);
            graphics.fillRect(left + 5, base - bodyHeight + 10, 6, 6);
            if (workshop) {
              graphics.fillStyle(0x6b5544, alpha);
              graphics.fillRect(left + width - 11, base - bodyHeight - 20, 5, 20);
              graphics.fillStyle(0x9b8a70, alpha);
              graphics.fillRect(left + width - 12, base - bodyHeight - 21, 7, 3);
              graphics.lineStyle(2, 0x1f1712, 0.8);
              graphics.lineBetween(left + 11, base - 17, left + 19, base - 9);
              graphics.lineBetween(left + 19, base - 17, left + 11, base - 9);
              graphics.fillStyle(0xd8c49a, 0.9);
              graphics.fillRect(left + 13, base - 15, 4, 4);
            }
            if (wide) {
              graphics.fillStyle(0x2a2118, 0.7);
              graphics.fillRect(left + 6, base - 11, 9, 11);
              graphics.fillRect(left + width - 15, base - 11, 9, 11);
              graphics.fillStyle(0x9a7a4c, 0.9);
              graphics.fillCircle(left + width - 24, base - 6, 4);
              graphics.fillCircle(left + width - 29, base - 7, 3.5);
            }
            if (building.status === 'demolition') {
              graphics.lineStyle(3, 0xc4655c, 0.95);
              graphics.lineBetween(left, base - bodyHeight, left + width, base);
              graphics.lineBetween(left, base, left + width, base - bodyHeight);
            }
            return;
          }

          graphics.fillStyle(0x0a0e12, 0.3);
          graphics.fillEllipse(px + TILE / 2, base, TILE + 2, 7);
          graphics.lineStyle(2, 0xd7a24a, 0.85);
          const left = px + 4;
          const right = px + TILE - 4;
          const top = base - 26;
          graphics.lineBetween(left, base, left, top);
          graphics.lineBetween(right, base, right, top);
          graphics.lineBetween(left - 2, top, right + 2, top);
          graphics.lineBetween(left - 2, base - 12, right + 2, base - 12);
          graphics.fillStyle(0x2a2118, 0.35);
          graphics.fillRect(left, base - 11, right - left, 11);
          graphics.fillStyle(0xe0b86e, 0.95);
          graphics.fillRect(left, base - 9, (right - left) * Math.min(1, ratio), 3);
        }
      });
    }

    for (const storage of this.snapshot.storages) {
      const origin = originOf(storage.sectorId);
      if (!origin) continue;
      const px = (origin.x + storage.x) * TILE;
      const base = WORLD_OFFSET_Y + (origin.y + storage.y + 1) * SIDE_DEPTH;
      const ratio = storage.capacity > 0 ? storage.volume / storage.capacity : 0;
      entities.push({
        y: base,
        draw: () => {
          const width = TILE * 0.9;
          const left = px + (TILE - width) / 2;
          graphics.fillStyle(0x0a0e12, 0.35);
          graphics.fillEllipse(px + TILE / 2, base, width + 10, 9);
          graphics.fillStyle(0x5c4a2f, 1);
          graphics.fillRect(left, base - 28, width, 28);
          graphics.fillStyle(0x7b613a, 1);
          graphics.fillTriangle(
            left - 4,
            base - 28,
            px + TILE / 2,
            base - 44,
            left + width + 4,
            base - 28
          );
          graphics.lineStyle(1, 0x2a2118, 0.65);
          for (let row = 0; row < 2; row += 1) {
            for (let col = 0; col < 3; col += 1) {
              graphics.strokeRect(
                left + 4 + col * 8,
                base - 23 + row * 8,
                7,
                7
              );
            }
          }
          graphics.fillStyle(0x0b1118, 0.7);
          graphics.fillRect(left + 3, base - 4, width - 6, 3);
          graphics.fillStyle(0x9ad0a2, 0.95);
          graphics.fillRect(left + 3, base - 4, (width - 6) * Math.min(1, ratio), 3);
        }
      });
    }

    for (const node of this.snapshot.nodes) {
      const origin = originOf(node.sectorId);
      if (!origin) continue;
      const px = (origin.x + node.x + 0.5) * TILE;
      const base = WORLD_OFFSET_Y + (origin.y + node.y + 1) * SIDE_DEPTH;
      entities.push({
        y: base,
        draw: () => {
          graphics.fillStyle(0x0a0e12, 0.3);
          graphics.fillEllipse(px, base, TILE * 0.9, 7);
          if (node.kind === 'forest') {
            graphics.fillStyle(0x4a3524, 1);
            graphics.fillRect(px - 2, base - 17, 4, 17);
            graphics.fillStyle(node.amount <= 0 ? 0x4a4636 : 0x2f6b45, 1);
            graphics.fillCircle(px - 7, base - 20, 9);
            graphics.fillCircle(px + 6, base - 22, 10);
            graphics.fillCircle(px, base - 30, 9);
            graphics.fillStyle(0x3d8255, 0.9);
            graphics.fillCircle(px - 3, base - 27, 5);
          } else if (node.kind === 'water') {
            graphics.fillStyle(0x2c5d7c, 1);
            graphics.fillEllipse(px, base - 5, 24, 11);
            graphics.fillStyle(0x6fa9c9, 0.8);
            graphics.fillEllipse(px - 3, base - 7, 10, 4);
          } else if (node.kind === 'grain') {
            graphics.lineStyle(1, 0xb99a45, 0.95);
            for (let index = -2; index <= 2; index += 1) {
              graphics.lineBetween(px + index * 4, base, px + index * 4, base - 14);
              graphics.fillStyle(0xd6b85a, 0.95);
              graphics.fillCircle(px + index * 4, base - 15, 2);
            }
          } else {
            graphics.fillStyle(0x6d7075, 1);
            graphics.fillTriangle(px - 12, base, px - 3, base - 14, px + 5, base);
            graphics.fillTriangle(px - 2, base, px + 5, base - 11, px + 13, base);
            graphics.fillStyle(0x8b9096, 0.85);
            graphics.fillTriangle(px - 8, base - 2, px - 3, base - 11, px + 1, base - 2);
          }
          if (node.active) {
            graphics.lineStyle(2, 0xd7a24a, 0.9);
            graphics.strokeCircle(px, base - 8, 17);
          }
          if (node.bufferCapacity > 0) {
            const ratio = Math.min(1, node.buffer / node.bufferCapacity);
            graphics.fillStyle(0x0b1118, 0.75);
            graphics.fillRect(px - 13, base - 44, 26, 4);
            graphics.fillStyle(0x9ad0a2, 0.95);
            graphics.fillRect(px - 13, base - 44, 26 * ratio, 4);
          }
        }
      });
    }

    entities.sort((a, b) => a.y - b.y).forEach((entity) => entity.draw());
  }

  private drawSector(graphics: Phaser.GameObjects.Graphics, sector: SectorSnapshot): void {
    const originX = sector.x * sector.width;
    const originY = sector.y * sector.height;
    const reachable = (cell: TerrainCell): boolean =>
      this.transport === 'person' ? cell.reachable : cell.cartReachable;
    const taskKeys = new Set(
      this.snapshot.clearingTasks.map(
        (task) => `${task.sectorId}:${task.x}:${task.y}`
      )
    );
    const cells = new Map(sector.terrain.map((cell) => [`${cell.x}:${cell.y}`, cell]));
    const centerRow = sector.height / 2;

    for (let y = 0; y < sector.height; y += 1) {
      const focus = 1 - Math.min(1, Math.abs(y + 0.5 - centerRow) / (sector.height * 0.62));
      const ground = this.shade(this.biomeTint(sector.biome), 0.58 + focus * 0.42);
      graphics.fillStyle(ground, 1);
      graphics.fillRect(
        originX * TILE,
        WORLD_OFFSET_Y + (originY + y) * SIDE_DEPTH,
        sector.width * TILE,
        SIDE_DEPTH + 1
      );
      graphics.fillStyle(this.shade(ground, 1.18), 0.22);
      graphics.fillRect(
        originX * TILE,
        WORLD_OFFSET_Y + (originY + y) * SIDE_DEPTH,
        sector.width * TILE,
        1
      );
    }

    for (let y = 0; y < sector.height; y += 1) {
      for (let x = 0; x < sector.width; x += 1) {
        const cell = cells.get(`${x}:${y}`);
        if (!cell) continue;
        const gx = originX + x;
        const gy = originY + y;
        const px = gx * TILE;
        const py = WORLD_OFFSET_Y + gy * SIDE_DEPTH;
        const base = py + SIDE_DEPTH;
        const focus = 1 - Math.min(1, Math.abs(y + 0.5 - centerRow) / (sector.height * 0.62));
        const color = this.shade(this.colorOf(cell.type), 0.58 + focus * 0.42);
        if (cell.type !== 'grass') {
          const alpha =
            cell.type === 'water'
              ? 0.72
              : cell.type === 'forest' || cell.type === 'rock'
                ? 0.52
                : 0.34;
          graphics.fillStyle(color, alpha);
          graphics.fillRect(px, py, TILE, SIDE_DEPTH + 1);
          graphics.fillStyle(this.shade(color, 1.22), 0.22);
          graphics.fillRect(px, py, TILE, 1);
        }
        graphics.fillStyle(0x05080c, 0.1);
        graphics.fillRect(px, base - 1, TILE, 1);

        if (cell.type === 'forest') {
          graphics.fillStyle(this.shade(color, 0.62), 1);
          graphics.fillRect(px + TILE / 2 - 1, base - 8, 3, 8);
          graphics.fillStyle(this.shade(color, 1.12), 0.95);
          graphics.fillCircle(px + TILE / 2 - 5, base - 10, 6);
          graphics.fillCircle(px + TILE / 2 + 5, base - 12, 6);
          graphics.fillCircle(px + TILE / 2, base - 17, 6);
        } else if (cell.type === 'rock') {
          graphics.fillStyle(this.shade(color, 1.25), 0.95);
          graphics.fillTriangle(px + 3, base, px + 13, base - 9, px + 21, base);
          graphics.fillStyle(this.shade(color, 0.82), 0.95);
          graphics.fillTriangle(px + 14, base, px + 23, base - 6, px + 30, base);
        } else if (cell.type === 'water') {
          graphics.lineStyle(1, 0x7fb6cf, 0.5);
          graphics.lineBetween(px + 5, base - 7, px + 15, base - 7);
          graphics.lineBetween(px + 17, base - 13, px + 27, base - 13);
        } else if (cell.type === 'grass') {
          graphics.lineStyle(1, this.shade(color, 1.35), 0.55);
          const offset = (x * 7 + y * 11) % 18;
          graphics.lineBetween(px + 5 + offset, base, px + 7 + offset, base - 5);
          graphics.lineBetween(px + 8 + offset, base, px + 9 + offset, base - 3);
        } else if (cell.type === 'soil' || cell.type === 'scree') {
          graphics.fillStyle(this.shade(color, 1.3), 0.4);
          graphics.fillCircle(px + 8, base - 5, 1.5);
          graphics.fillCircle(px + 19, base - 9, 1.2);
        }

        if (!reachable(cell)) {
          graphics.fillStyle(0x05080c, 0.55);
          graphics.fillRect(px, py, TILE, SIDE_DEPTH + 1);
        }

        if (taskKeys.has(`${sector.id}:${x}:${y}`)) {
          graphics.lineStyle(2, 0xd7a24a, cell.clearing ? 0.95 : 0.7);
          graphics.strokeRect(px + 1, py + 1, TILE - 2, SIDE_DEPTH - 1);
        }

        if (cell.clearing) {
          const width = TILE - 6;
          const ratio = Phaser.Math.Clamp(
            cell.clearing.workDone / Math.max(1, cell.clearing.workRequired),
            0,
            1
          );
          graphics.fillStyle(0x05080c, 0.75);
          graphics.fillRect(px + 3, base - 8, width, 4);
          graphics.fillStyle(0xd7a24a, 0.95);
          graphics.fillRect(px + 3, base - 8, width * ratio, 4);
        }
      }
    }

    graphics.lineStyle(2, 0xd7a24a, 0.4);
    graphics.strokeRect(
      originX * TILE + 1,
      WORLD_OFFSET_Y + originY * SIDE_DEPTH + 1,
      sector.width * TILE - 2,
      sector.height * SIDE_DEPTH - 2
    );
  }

  private drawFrontier(
    graphics: Phaser.GameObjects.Graphics,
    sectorX: number,
    sectorY: number,
    tint: number
  ): void {
    const { width, height } = this.snapshot.sectors[0] ?? {
      width: 64,
      height: 24
    };
    const originX = sectorX * width * TILE;
    const originY = WORLD_OFFSET_Y + sectorY * height * SIDE_DEPTH;
    const w = width * TILE;
    const h = height * SIDE_DEPTH;

    graphics.fillStyle(tint, 0.16);
    graphics.fillRect(originX, originY, w, h);
    graphics.lineStyle(1, tint, 0.22);
    for (let x = -h; x < w; x += 42) {
      graphics.beginPath();
      graphics.moveTo(originX + Math.max(0, x), originY + Math.max(0, -x));
      graphics.lineTo(
        originX + Math.min(w, x + h),
        originY + Math.min(h, h - Math.max(0, -x))
      );
      graphics.strokePath();
    }

    graphics.lineStyle(2, tint, 0.85);
    const dash = 12;
    const step = dash * 2;
    for (let x = 0; x < w; x += step) {
      graphics.beginPath();
      graphics.moveTo(originX + x, originY);
      graphics.lineTo(originX + Math.min(w, x + dash), originY);
      graphics.moveTo(originX + x, originY + h);
      graphics.lineTo(originX + Math.min(w, x + dash), originY + h);
      graphics.strokePath();
    }
    for (let y = 0; y < h; y += step) {
      graphics.beginPath();
      graphics.moveTo(originX, originY + y);
      graphics.lineTo(originX, originY + Math.min(h, y + dash));
      graphics.moveTo(originX + w, originY + y);
      graphics.lineTo(originX + w, originY + Math.min(h, y + dash));
      graphics.strokePath();
    }

    const label = this.snapshot.frontier.find(
      (item) => item.x === sectorX && item.y === sectorY
    );
    const biomeInfo = this.snapshot.catalog.biomes.find(
      (item) => item.id === label?.biome
    );
    const text = this.add.text(
      originX + w / 2,
      originY + 12,
      `${biomeInfo?.label ?? label?.biome ?? 'фронтир'} (${sectorX}, ${sectorY})`,
      {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: '16px',
        color: '#e8e2d6'
      }
    );
    text.setOrigin(0.5, 0);
    text.setAlpha(0.9);
    this.layers.push(text);
  }

  private applyCameraBounds(center: boolean): void {
    const first = this.snapshot.sectors[0];
    if (!first) return;

    let minX = first.x;
    let minY = first.y;
    let maxX = first.x;
    let maxY = first.y;
    for (const sector of this.snapshot.sectors) {
      minX = Math.min(minX, sector.x);
      minY = Math.min(minY, sector.y);
      maxX = Math.max(maxX, sector.x);
      maxY = Math.max(maxY, sector.y);
    }
    for (const frontier of this.snapshot.frontier) {
      minX = Math.min(minX, frontier.x);
      minY = Math.min(minY, frontier.y);
      maxX = Math.max(maxX, frontier.x);
      maxY = Math.max(maxY, frontier.y);
    }

    const camera = this.cameras.main;
    const left = (minX - 1) * first.width * TILE;
    const top = WORLD_OFFSET_Y + (minY - 1) * first.height * SIDE_DEPTH - 360;
    const width = (maxX - minX + 3) * first.width * TILE;
    const height = (maxY - minY + 3) * first.height * SIDE_DEPTH + 900;
    camera.setBounds(left, top, width, height);

    if (center && !this.cameraInitialized) {
      const clearingX = Math.floor(first.width * 0.45) + 2;
      const clearingY = Math.floor(first.height * 0.4) + 2;
      camera.centerOn(
        (first.x * first.width + clearingX) * TILE,
        WORLD_OFFSET_Y + first.height * SIDE_DEPTH * 0.3
      );
      camera.setZoom(1.9);
      this.cameraInitialized = true;
    }
  }

  private bindInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() && this.placement) {
        this.cancelPlacement();
        return;
      }
      this.dragStart = { x: pointer.x, y: pointer.y };
      this.pointerStart = { x: pointer.x, y: pointer.y };
      this.cameraStart = {
        x: this.cameras.main.scrollX,
        y: this.cameras.main.scrollY
      };
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.hoverCell = this.placement
          ? this.cellAt(world.x, world.y)
          : this.buildType
            ? this.buildTargetAt(world.x, world.y)
            : this.locateCell(world.x, world.y);
        this.drawPlacement();
        return;
      }
      const camera = this.cameras.main;
      camera.scrollX =
        this.cameraStart.x - (pointer.x - this.dragStart.x) / camera.zoom;
      camera.scrollY =
        this.cameraStart.y - (pointer.y - this.dragStart.y) / camera.zoom;
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const moved = Math.hypot(
        pointer.x - this.pointerStart.x,
        pointer.y - this.pointerStart.y
      );
      if (moved > 6) return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tileX = Math.floor(world.x / TILE);
      const tileY = Math.floor((world.y - WORLD_OFFSET_Y) / SIDE_DEPTH);

      if (this.placement) {
        const target = this.cellAt(world.x, world.y);
        if (!target) {
          this.handlers.onPlacementRejected('Выберите клетку на карте');
          return;
        }
        const status = this.placementStatus(target);
        if (status.status === 'blocked') {
          this.handlers.onPlacementRejected(status.reason);
          return;
        }
        if (pointer.wasTouch) {
          if (
            !this.pendingPlacement ||
            this.pendingPlacement.sectorId !== target.sectorId ||
            this.pendingPlacement.x !== target.x ||
            this.pendingPlacement.y !== target.y
          ) {
            this.pendingPlacement = target;
            this.hoverCell = target;
            this.drawPlacement();
            return;
          }
          this.confirmPendingPlacement();
          return;
        }
        this.handlers.onPlacementConfirm(target.sectorId, target.x, target.y);
        return;
      }

      if (this.buildType) {
        const target = this.buildTargetAt(world.x, world.y);
        if (target) {
          this.handlers.onBuildClick(target.sectorId, target.x, target.y);
        }
        return;
      }

      for (const node of this.snapshot.nodes) {
        const sector = this.snapshot.sectors.find(
          (item) => item.id === node.sectorId
        );
        if (!sector) continue;
        const gx = sector.x * sector.width + node.x + 0.5;
        const base = WORLD_OFFSET_Y + (sector.y * sector.height + node.y + 1) * SIDE_DEPTH;
        if (
          Math.abs(world.x - gx * TILE) < TILE * 0.85 &&
          world.y > base - 62 &&
          world.y < base + 10
        ) {
          this.handlers.onNodeClick(node.id);
          return;
        }
      }

      const frontier = this.snapshot.frontier.find((item) => {
        const base = this.snapshot.sectors[0];
        if (!base) return false;
        return (
          tileX >= item.x * base.width &&
          tileX < (item.x + 1) * base.width &&
          world.y >= WORLD_OFFSET_Y + item.y * base.height * SIDE_DEPTH &&
          world.y < WORLD_OFFSET_Y + (item.y + 1) * base.height * SIDE_DEPTH
        );
      });
      if (frontier) {
        this.handlers.onFrontierClick(frontier.x, frontier.y);
        return;
      }

      for (const sector of this.snapshot.sectors) {
        const localX = tileX - sector.x * sector.width;
        const localY = tileY - sector.y * sector.height;
        if (localX < 0 || localY < 0 || localX >= sector.width || localY >= sector.height) {
          continue;
        }
        const cell = sector.terrain.find(
          (item) => item.x === localX && item.y === localY
        );
        if (!cell || !cell.clearable || cell.clearing) continue;

        const neighbors: Array<[number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ];
        const reachable = new Set(
          sector.terrain
            .filter((item) => item.reachable)
            .map((item) => `${item.x}:${item.y}`)
        );
        const adjacent = neighbors.some(([dx, dy]) =>
          reachable.has(`${localX + dx}:${localY + dy}`)
        );
        if (!cell.reachable && !adjacent) continue;
        this.handlers.onCellClick(sector.id, localX, localY);
        return;
      }
    });

    this.input.on('gameout', () => {
      this.hoverCell = null;
      this.drawPlacement();
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.placement) this.cancelPlacement();
    });

    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _currentlyOver: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number
      ) => {
        const camera = this.cameras.main;
        camera.zoom = Phaser.Math.Clamp(camera.zoom - deltaY * 0.001, 0.4, 2.5);
      }
    );
  }
}
