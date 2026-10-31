import Phaser from 'phaser';
import type { PeaceWorldSnapshot, ReadOnlyWorldPreview } from '@avanpost/peace-v2-shared';

export const CELL_SIZE = 48;
const SURFACE_Y = 0;
const WORLD_HALF_WIDTH = 32 * CELL_SIZE;
const WORLD_HEIGHT = 28 * CELL_SIZE;
const BUILDING_DISPLAY_SIZE = {
  cabin: { width: 142, height: 120 },
  workshop: { width: 192, height: 96 }
} as const;

export interface PlacementAnchor {
  x: number;
  y: number;
}

export interface PlacementFeedback {
  valid: boolean;
  reason: string;
  footprintCells?: Array<{ x: number; y: number }>;
  supportCells?: Array<{ x: number; y: number }>;
  unsupportedCells?: Array<{ x: number; y: number }>;
  walkBlockedCells?: Array<{ x: number; y: number }>;
  overlapCells?: Array<{ x: number; y: number }>;
  entrance?: { x: number; y: number };
  workPoint?: { x: number; y: number };
  route?: Array<{ x: number; y: number }>;
  blockedRoute?: { from: { x: number; y: number }; to: { x: number; y: number } };
}

export interface SceneScreenPoint {
  x: number;
  y: number;
}

export type SettlementSelection = { kind: 'resident'; id: string } | { kind: 'building'; id: string } | { kind: 'storage'; id: string } |
  { kind: 'tree'; id: string } | { kind: 'stone-deposit'; id: string } | null;

export interface CameraFeedback {
  zoom: number;
}

interface SceneCallbacks {
  onSelect?: (selection: SettlementSelection, point: SceneScreenPoint) => void;
  onEmptyGroundClick?: (anchor: PlacementAnchor, point: SceneScreenPoint) => void;
  onDropPreview?: (residentId: string, target: SettlementSelection) => boolean;
  onResidentDragStart?: (residentId: string) => void;
  onResidentDragHover?: (residentId: string, target: SettlementSelection, valid: boolean, point: SceneScreenPoint) => void;
  onResidentDragEnd?: () => void;
  onResidentDrop?: (residentId: string, target: SettlementSelection, point: SceneScreenPoint) => void;
  onPlacementAnchor?: (anchor: PlacementAnchor) => void;
  onCameraChange?: (camera: CameraFeedback) => void;
}

interface BuildingVisual {
  sprite: Phaser.GameObjects.Image;
  details: Phaser.GameObjects.Graphics;
  progress: Phaser.GameObjects.Text;
  hitArea: Phaser.Geom.Rectangle;
}

interface TreeVisual {
  tree: Phaser.GameObjects.Image;
  young: Phaser.GameObjects.Image;
  stump: Phaser.GameObjects.Image;
  bufferLabel: Phaser.GameObjects.Text;
  scale: number;
}

interface StoneDepositVisual {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  hitArea: Phaser.Geom.Rectangle;
}

interface ResidentVisual {
  sprite: Phaser.GameObjects.Sprite;
  name: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Graphics;
  animation: string;
  position?: { x: number; y: number };
}

const ASSET = '/assets/peace-v2/';

export class SettlementScene extends Phaser.Scene {
  private background?: Phaser.GameObjects.TileSprite;
  private farRidge?: Phaser.GameObjects.Graphics;
  private middleRidge?: Phaser.GameObjects.Graphics;
  private terrain?: Phaser.GameObjects.Graphics;
  private surfaceFlora?: Phaser.GameObjects.Graphics;
  private surfaceFeatureGraphics?: Phaser.GameObjects.Graphics;
  private readonly surfaceFeatureLabels = new Map<string, Phaser.GameObjects.Text>();
  private routeGraphics?: Phaser.GameObjects.Graphics;
  private selectionGraphics?: Phaser.GameObjects.Graphics;
  private dropGraphics?: Phaser.GameObjects.Graphics;
  private dragSourceGraphics?: Phaser.GameObjects.Graphics;
  private placementGraphics?: Phaser.GameObjects.Graphics;
  private placementHouse?: Phaser.GameObjects.Image;
  private placementWorkshop?: Phaser.GameObjects.Image;
  private draggedResidentSprite?: Phaser.GameObjects.Sprite;
  private dragTargets: Exclude<SettlementSelection, null>[] = [];
  private readonly residents = new Map<string, ResidentVisual>();
  private readonly trees = new Map<string, TreeVisual>();
  private readonly stoneDeposits = new Map<string, StoneDepositVisual>();
  private readonly storageSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly deliveryLogs = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly deliveryPhases = new Map<string, string>();
  private readonly buildings = new Map<string, BuildingVisual>();
  private world?: PeaceWorldSnapshot;
  private preview?: ReadOnlyWorldPreview;
  private callbacks: SceneCallbacks = {};
  private selected: SettlementSelection = null;
  private placementMode = false;
  private placementBuildingKind: 'cabin' | 'workshop' = 'cabin';
  private placementAnchor: PlacementAnchor = { x: 0, y: -1 };
  private placementFeedback: PlacementFeedback = { valid: false, reason: 'Выберите клетку на поверхности.' };
  private pointerDown?: { x: number; y: number; worldX: number; worldY: number };
  private pointerSelection: SettlementSelection = null;
  private cameraDragging = false;
  private pointerHitEntity = false;
  private draggingGhost = false;
  private dragCandidate?: { residentId: string; startX: number; startY: number };
  private residentDragActive = false;
  private dropTarget: SettlementSelection = null;
  private dropTargetValid = false;
  private pinchDistance = 0;
  private pinchZoom = 1;
  private pinchAnchor?: { x: number; y: number };
  private previousViewport = { width: 0, height: 0 };

  constructor() {
    super('peace-v2-settlement');
  }

  setCallbacks(callbacks: SceneCallbacks): void {
    this.callbacks = callbacks;
  }

  preload(): void {
    this.load.image('settlement-panorama', `${ASSET}background-panorama.png`);
    this.load.spritesheet('worker-atlas', `${ASSET}worker-atlas.png`, { frameWidth: 192, frameHeight: 224 });
    this.load.image('tree-full', `${ASSET}tree_full.png`);
    this.load.image('tree-stump', `${ASSET}tree_stump.png`);
    this.load.image('storehouse', `${ASSET}storehouse.png`);
    this.load.image('house', `${ASSET}house.png`);
    this.load.image('workshop', `${ASSET}workshop.png`);
    this.load.image('stone-outcrop', `${ASSET}stone-outcrop.png`);
  }

  create(): void {
    // Backdrop, ridges, soil scatter and flora are visual-only Graphics/TileSprite layers.
    // None is interactive; entity hit tests remain limited to server-backed objects.
    this.background = this.add.tileSprite(0, -920, 8192, 1800, 'settlement-panorama')
      .setOrigin(0.5, 0).setTileScale(3, 2).setScrollFactor(0.16, 0.04).setDepth(-140);
    this.drawParallaxRidges();
    this.terrain = this.add.graphics().setDepth(-100);
    this.drawTerrain();
    this.surfaceFlora = this.add.graphics().setDepth(2);
    this.drawSurfaceFlora();
    this.surfaceFeatureGraphics = this.add.graphics().setDepth(3);
    this.routeGraphics = this.add.graphics().setDepth(16);
    this.selectionGraphics = this.add.graphics().setDepth(17);
    this.dropGraphics = this.add.graphics().setDepth(18);
    this.dragSourceGraphics = this.add.graphics().setDepth(19);
    this.placementGraphics = this.add.graphics().setDepth(20);
    this.placementHouse = this.add.image(0, 0, 'house').setOrigin(0.5, 1)
      .setDisplaySize(BUILDING_DISPLAY_SIZE.cabin.width, BUILDING_DISPLAY_SIZE.cabin.height)
      .setAlpha(0.68).setDepth(21).setVisible(false);
    this.placementWorkshop = this.add.image(0, 0, 'workshop').setOrigin(0.5, 1)
      .setDisplaySize(BUILDING_DISPLAY_SIZE.workshop.width, BUILDING_DISPLAY_SIZE.workshop.height)
      .setAlpha(0.68).setDepth(21).setVisible(false);
    this.createAnimations();
    this.configureCamera();
    this.configureInput();
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      this.input.off('pointerdown');
      this.input.off('pointermove');
      this.input.off('pointerup');
      this.input.off('wheel');
    });
    this.updateScene();
  }

  setResidentSelected(residentId: string | null): void {
    this.selected = residentId ? { kind: 'resident', id: residentId } : null;
    this.callbacks.onSelect?.(this.selected, this.clientPointForSelection(this.selected));
    this.updateScene();
  }

  selectResident(residentId: string): void {
    const resident = this.residents.get(residentId);
    this.setResidentSelected(residentId);
    if (resident) {
      this.centerCameraOn(resident.sprite.x, resident.sprite.y - 40);
      this.emitCameraChange();
    }
  }

  showPreview(preview: ReadOnlyWorldPreview): void {
    this.preview = preview;
    this.world = undefined;
    this.updateScene();
  }

  showWorld(world: PeaceWorldSnapshot): void {
    this.world = world;
    this.preview = undefined;
    this.updateScene();
  }

  flashSelection(selection: SettlementSelection, success: boolean): void {
    if (!selection || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const color = success ? 0x77a45e : 0xc15a4a;
    const graphics = this.add.graphics().setDepth(31).setAlpha(0.95);
    graphics.lineStyle(4, color, 0.98).fillStyle(color, 0.12);
    if (selection.kind === 'resident') {
      const visual = this.residents.get(selection.id);
      if (!visual) { graphics.destroy(); return; }
      graphics.fillEllipse(visual.sprite.x, visual.sprite.y - 18, 76, 34)
        .strokeEllipse(visual.sprite.x, visual.sprite.y - 18, 76, 34);
    } else if (selection.kind === 'building') {
      const visual = this.buildings.get(selection.id);
      if (!visual) { graphics.destroy(); return; }
      graphics.fillRoundedRect(visual.hitArea.x, visual.hitArea.y, visual.hitArea.width, visual.hitArea.height, 8)
        .strokeRoundedRect(visual.hitArea.x, visual.hitArea.y, visual.hitArea.width, visual.hitArea.height, 8);
    } else if (selection.kind === 'tree') {
      const visual = this.trees.get(selection.id);
      if (!visual) { graphics.destroy(); return; }
      const sprite = visual.tree.visible ? visual.tree : visual.young.visible ? visual.young : visual.stump;
      graphics.fillEllipse(sprite.x, sprite.y - 8, 124 * visual.scale, 22)
        .strokeEllipse(sprite.x, sprite.y - 8, 124 * visual.scale, 22);
    } else if (selection.kind === 'stone-deposit') {
      const visual = this.stoneDeposits.get(selection.id);
      if (!visual) { graphics.destroy(); return; }
      graphics.fillEllipse(visual.sprite.x, visual.sprite.y - 4, 124, 22)
        .strokeEllipse(visual.sprite.x, visual.sprite.y - 4, 124, 22);
    } else if (selection.kind === 'storage') {
      const sprite = this.storageSprites.get(selection.id);
      if (!sprite) { graphics.destroy(); return; }
      graphics.fillRoundedRect(sprite.x - 74, sprite.y - 122, 148, 124, 8)
        .strokeRoundedRect(sprite.x - 74, sprite.y - 122, 148, 124, 8);
    }
    this.tweens.add({ targets: graphics, alpha: 0, duration: 240, ease: 'Quad.Out', onComplete: () => graphics.destroy() });
  }

  setPlacementMode(enabled: boolean, anchor?: PlacementAnchor): void {
    if (anchor) this.placementAnchor = anchor;
    this.placementMode = enabled;
    this.draggingGhost = false;
    if (enabled) {
      this.reportPlacementAnchor(this.placementAnchor);
      this.centerCameraOn(this.placementAnchor.x * CELL_SIZE + CELL_SIZE, SURFACE_Y - CELL_SIZE / 2);
      this.emitCameraChange();
    }
    this.updatePlacementGhost();
  }

  setPlacementBuildingKind(kind: 'cabin' | 'workshop'): void {
    this.placementBuildingKind = kind;
    this.updatePlacementGhost();
  }

  setPlacementAnchor(anchor: PlacementAnchor): void {
    this.reportPlacementAnchor(anchor);
  }

  setPlacementFeedback(feedback: PlacementFeedback): void {
    this.placementFeedback = feedback;
    this.updatePlacementGhost();
  }

  getPlacementGhostViewportBounds(): { left: number; top: number; right: number; bottom: number } | null {
    const ghost = this.placementBuildingKind === 'workshop' ? this.placementWorkshop : this.placementHouse;
    const canvas = this.game?.canvas;
    const camera = this.cameras?.main;
    if (!ghost?.visible || !canvas || !camera) return null;
    const canvasBounds = canvas.getBoundingClientRect();
    const viewX = camera.scrollX + camera.width / 2 - camera.width / (2 * camera.zoom);
    const viewY = camera.scrollY + camera.height / 2 - camera.height / (2 * camera.zoom);
    const scaleX = canvasBounds.width / camera.width;
    const scaleY = canvasBounds.height / camera.height;
    const left = canvasBounds.left + (camera.x + (ghost.x - ghost.displayWidth / 2 - viewX) * camera.zoom) * scaleX;
    const top = canvasBounds.top + (camera.y + (ghost.y - ghost.displayHeight - viewY) * camera.zoom) * scaleY;
    const width = ghost.displayWidth * camera.zoom * scaleX;
    const height = ghost.displayHeight * camera.zoom * scaleY;
    return { left, top, right: left + width, bottom: top + height };
  }

  clearSelection(): void {
    this.selectEntity(null);
  }

  centerOnSelection(): void {
    if (this.selected?.kind === 'resident') {
      const resident = this.residents.get(this.selected.id);
      if (resident) this.centerCameraOn(resident.sprite.x, resident.sprite.y - 40);
    } else if (this.selected?.kind === 'building') {
      const building = this.buildings.get(this.selected.id);
      if (building) this.centerCameraOn(building.sprite.x, building.sprite.y - 32);
    } else if (this.selected?.kind === 'storage') {
      const storage = this.storageSprites.get(this.selected.id);
      if (storage) this.centerCameraOn(storage.x, storage.y - 40);
    } else {
      this.centerCameraOn(0, SURFACE_Y + 80);
    }
    this.emitCameraChange();
  }

  selectTree(id: string): void {
    const visual = this.trees.get(id);
    this.selectEntity({ kind: 'tree', id });
    if (visual) {
      const sprite = visual.tree.visible ? visual.tree : visual.young.visible ? visual.young : visual.stump;
      this.centerCameraOn(sprite.x, sprite.y - 80);
      this.emitCameraChange();
    }
  }

  selectStoneDeposit(id: string): void {
    const visual = this.stoneDeposits.get(id);
    this.selectEntity({ kind: 'stone-deposit', id });
    if (visual) {
      this.centerCameraOn(visual.sprite.x, visual.sprite.y - 34);
      this.emitCameraChange();
    }
  }

  selectBuilding(id: string): void {
    const visual = this.buildings.get(id);
    if (!visual) return;
    this.centerCameraOn(visual.sprite.x, visual.sprite.y - 32);
    this.selectEntity({ kind: 'building', id });
    this.emitCameraChange();
  }

  zoomBy(factor: number): void {
    const camera = this.cameras.main;
    this.zoomAt(camera.width / 2, camera.height / 2, camera.zoom * factor);
  }

  private createAnimations(): void {
    const add = (key: string, frames: number[], frameRate: number, repeat: number): void => {
      if (this.anims.exists(key)) return;
      this.anims.create({
        key,
        frames: frames.map((frame) => ({ key: 'worker-atlas', frame })),
        frameRate,
        repeat
      });
    };
    add('worker-walk', [3, 4, 5, 6], 8, -1);
    add('worker-carry-walk', [7, 8, 9, 10], 8, -1);
    add('worker-gather', [0, 1, 0, 1], 3, -1);
    add('worker-build', [0, 11, 12, 13, 14, 11], 4, -1);
    add('worker-load', [0, 2], 3, 0);
    add('worker-unload', [2, 0], 3, 0);
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    camera.setBounds(-WORLD_HALF_WIDTH, -10 * CELL_SIZE, WORLD_HALF_WIDTH * 2, WORLD_HEIGHT);
    camera.setZoom(this.scale.width <= 650 ? 0.72 : 1);
    this.centerCameraOn(this.scale.width <= 650 ? CELL_SIZE : 0, SURFACE_Y + 50);
    this.previousViewport = { width: this.scale.width, height: this.scale.height };
    this.emitCameraChange();
  }

  private drawTerrain(): void {
    const graphics = this.terrain;
    if (!graphics) return;
    graphics.clear();
    const left = -32;
    const right = 32;
    graphics.fillStyle(0x657b4e, 1);
    graphics.fillRect(left * CELL_SIZE, SURFACE_Y - 8, (right - left) * CELL_SIZE, 8);
    graphics.fillStyle(0x82975e, 1);
    graphics.fillRect(left * CELL_SIZE, SURFACE_Y, (right - left) * CELL_SIZE, 11);
    graphics.fillStyle(0x9aa16a, 1);
    graphics.fillRect(left * CELL_SIZE, SURFACE_Y + 11, (right - left) * CELL_SIZE, 16);

    // Distinct, shallow horizontal cutaway bands clarify grass, topsoil, clay and stone.
    graphics.fillStyle(0x875d40, 1);
    graphics.fillRect(left * CELL_SIZE, SURFACE_Y + 27, (right - left) * CELL_SIZE, 2.45 * CELL_SIZE);
    graphics.fillStyle(0x76513b, 1);
    graphics.fillRect(left * CELL_SIZE, SURFACE_Y + 2.45 * CELL_SIZE + 27, (right - left) * CELL_SIZE, 2.55 * CELL_SIZE);
    graphics.fillStyle(0x625044, 1);
    graphics.fillRect(left * CELL_SIZE, SURFACE_Y + 5 * CELL_SIZE + 27, (right - left) * CELL_SIZE, 1.4 * CELL_SIZE);
    graphics.fillStyle(0x555c59, 1);
    graphics.fillRect(left * CELL_SIZE, SURFACE_Y + 6.4 * CELL_SIZE + 27, (right - left) * CELL_SIZE, 2.5 * CELL_SIZE);
    graphics.fillStyle(0x454c4a, 1);
    graphics.fillRect(left * CELL_SIZE, SURFACE_Y + 8.9 * CELL_SIZE + 27, (right - left) * CELL_SIZE, 1.5 * CELL_SIZE);

    for (let band = 0; band < 6; band += 1) {
      const y = SURFACE_Y + 76 + band * 61;
      graphics.lineStyle(band < 3 ? 2 : 3, band < 3 ? 0x4b443d : 0x343d3d, 0.22);
      graphics.lineBetween(left * CELL_SIZE, y, right * CELL_SIZE, y + ((band % 2) * 3));
    }
    for (let x = left * CELL_SIZE; x < right * CELL_SIZE; x += 28) {
      const seed = (Math.imul(x + 32768, 7919) >>> 0);
      const topsoilY = 40 + (seed % 180);
      graphics.fillStyle(seed % 3 === 0 ? 0x583f32 : 0xc18b57, 0.42);
      graphics.fillEllipse(x + (seed % 23), topsoilY, 4 + (seed % 5), 2 + (seed % 3));
      if (seed % 4 === 0) {
        const rockY = 340 + (seed % 330);
        graphics.fillStyle(seed % 8 === 0 ? 0x939386 : 0x777a72, 0.62);
        graphics.fillEllipse(x + (seed % 19), rockY, 12 + (seed % 14), 6 + (seed % 8));
        graphics.lineStyle(1, 0xb0afa0, 0.38);
        graphics.lineBetween(x - 2, rockY, x + 8, rockY - 3);
      }
    }

    // Decorative cave cutaway only; this slice has no mine or underground extraction.
    const caveX = 8 * CELL_SIZE;
    graphics.fillStyle(0x343331, 1);
    graphics.fillRoundedRect(caveX, SURFACE_Y + 2.15 * CELL_SIZE + 27, 3.3 * CELL_SIZE, 1.55 * CELL_SIZE, 18);
    graphics.fillStyle(0x53483b, 1);
    graphics.fillRoundedRect(caveX + 10, SURFACE_Y + 2.38 * CELL_SIZE + 27, 3.05 * CELL_SIZE, 1.31 * CELL_SIZE, 18);
    graphics.fillStyle(0x393b38, 1);
    graphics.fillRoundedRect(caveX + 34, SURFACE_Y + 2.68 * CELL_SIZE + 27, 2.55 * CELL_SIZE, .98 * CELL_SIZE, 18);
    graphics.lineStyle(4, 0x46382d, 0.92);
    graphics.strokeRoundedRect(caveX - 3, SURFACE_Y + 2.12 * CELL_SIZE + 27, 3.45 * CELL_SIZE, 1.62 * CELL_SIZE, 18);
    graphics.lineStyle(2, 0xc1a67a, 0.46);
    graphics.lineBetween(caveX + 42, SURFACE_Y + 2.86 * CELL_SIZE + 27, caveX + 84, SURFACE_Y + 2.73 * CELL_SIZE + 27);
    graphics.lineBetween(caveX + 102, SURFACE_Y + 3.26 * CELL_SIZE + 27, caveX + 150, SURFACE_Y + 3.12 * CELL_SIZE + 27);
    this.add.text(caveX + 12, SURFACE_Y + 3.82 * CELL_SIZE + 27, 'Декоративный разрез · добычи нет', {
      fontFamily: 'Avenir Next, sans-serif', fontSize: '12px', color: '#e6ddc2',
      backgroundColor: '#342e29bb', padding: { x: 6, y: 4 }
    }).setDepth(-90);
  }

  private drawParallaxRidges(): void {
    const pointsForRidge = (
      baseY: number,
      amplitude: number,
      phase: number,
      bottomY: number
    ): Phaser.Types.Math.Vector2Like[] => {
      const points: Phaser.Types.Math.Vector2Like[] = [{ x: -6000, y: bottomY }];
      for (let index = 0; index <= 120; index += 1) {
        const x = -6000 + index * 100;
        const wave = Math.sin(index * 0.23 + phase) * amplitude + Math.sin(index * 0.071 + phase * 2) * amplitude * 0.56;
        points.push({ x, y: baseY + wave });
      }
      points.push({ x: 6000, y: bottomY });
      return points;
    };
    this.farRidge = this.add.graphics().setDepth(-130).setScrollFactor(0.24, 0.08);
    this.farRidge.fillStyle(0x546e68, 0.42);
    this.farRidge.fillPoints(pointsForRidge(-182, 37, 1.4, -11), true);
    this.farRidge.fillStyle(0x74866b, 0.55);
    this.farRidge.fillPoints(pointsForRidge(-109, 23, 4.2, -10), true);
    this.middleRidge = this.add.graphics().setDepth(-120).setScrollFactor(0.42, 0.18);
    this.middleRidge.fillStyle(0x778653, 0.65);
    this.middleRidge.fillPoints(pointsForRidge(-72, 16, 2.1, -9), true);
    this.middleRidge.fillStyle(0x89905b, 0.62);
    this.middleRidge.fillPoints(pointsForRidge(-35, 8, 5.5, -8), true);
  }

  private drawSurfaceFlora(): void {
    const graphics = this.surfaceFlora;
    if (!graphics) return;
    graphics.clear();
    for (let x = -WORLD_HALF_WIDTH; x < WORLD_HALF_WIDTH; x += 15) {
      const seed = Math.imul(x + 16384, 104729) >>> 0;
      const groundY = SURFACE_Y + 8 + (seed % 5);
      const height = 5 + (seed % 10);
      graphics.lineStyle(2, seed % 3 === 0 ? 0x405b39 : 0x526b3d, 0.84);
      graphics.lineBetween(x, groundY, x + (seed % 7) - 3, groundY - height);
      if (seed % 11 === 0) {
        graphics.lineBetween(x + 4, groundY, x + 7, groundY - height * 0.72);
        graphics.lineBetween(x - 3, groundY, x - 7, groundY - height * 0.64);
      }
      if (seed % 59 === 0) {
        graphics.fillStyle(seed % 2 === 0 ? 0xb8755d : 0xd0ab5b, 0.92);
        graphics.fillCircle(x + 2, groundY - height - 1, 2.2);
      }
    }
    // Low shrubs are ambient decoration only; all gameplay targets remain server-backed sprites.
    const shrubs = [-1370, -970, -170, 560, 1110, 1410];
    for (const x of shrubs) {
      const baseY = SURFACE_Y + 7;
      graphics.fillStyle(0x4f6641, 0.92);
      graphics.fillEllipse(x, baseY - 7, 42, 22);
      graphics.fillStyle(0x66804b, 0.98);
      graphics.fillCircle(x - 12, baseY - 12, 12);
      graphics.fillCircle(x + 2, baseY - 16, 15);
      graphics.fillCircle(x + 15, baseY - 10, 11);
      graphics.fillStyle(0xa6ad73, 0.64);
      graphics.fillCircle(x - 3, baseY - 20, 3);
    }
  }

  private configureInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onPointerUp(pointer));
    this.input.on('pointerupoutside', () => this.cancelPointerGesture());
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, deltaY: number) => {
      this.zoomAt(pointer.x, pointer.y, this.cameras.main.zoom * Math.exp(-deltaY * 0.001));
    });
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.pointerDown = { x: pointer.x, y: pointer.y, worldX: worldPoint.x, worldY: worldPoint.y };
    this.pointerSelection = null;
    if (this.placementMode) {
      this.draggingGhost = this.isOverPlacementGhost(worldPoint.x, worldPoint.y);
      this.cameraDragging = !this.draggingGhost;
    } else {
      this.pointerSelection = this.selectionAtWorld(worldPoint.x, worldPoint.y);
      this.pointerHitEntity = this.pointerSelection !== null;
      this.cameraDragging = !this.pointerHitEntity;
      if (this.pointerSelection) {
        this.selected = this.pointerSelection;
        this.updateRoute();
        this.updateSelectionMarker();
        if (this.pointerSelection.kind === 'resident') {
          this.dragCandidate = { residentId: this.pointerSelection.id, startX: pointer.x, startY: pointer.y };
          this.residentDragActive = false;
        }
      } else {
        this.selected = null;
        this.updateRoute();
        this.updateSelectionMarker();
      }
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.placementMode && this.draggingGhost) {
      this.reportPlacementAnchor(this.anchorFromWorldPoint(worldPoint.x));
      return;
    }
    if (this.dragCandidate && pointer.isDown && this.pointerDown) {
      if (!this.residentDragActive && Phaser.Math.Distance.Between(
        this.dragCandidate.startX, this.dragCandidate.startY, pointer.x, pointer.y
      ) >= 8) {
        this.residentDragActive = true;
        this.beginResidentDragFeedback(this.dragCandidate.residentId);
      }
      if (this.residentDragActive) {
        this.dropTarget = this.selectionAtWorld(worldPoint.x, worldPoint.y);
        this.dropTargetValid = this.dropTarget !== null &&
          (this.callbacks.onDropPreview?.(this.dragCandidate.residentId, this.dropTarget) ?? false);
        this.draggedResidentSprite?.setPosition(worldPoint.x, worldPoint.y);
        this.updateDropMarker();
        this.callbacks.onResidentDragHover?.(this.dragCandidate.residentId, this.dropTarget,
          this.dropTargetValid, this.clientPointForPointer(pointer));
        return;
      }
    }
    if (this.pointerHitEntity) return;
    if (!this.pointerDown || !this.cameraDragging || this.activePointers().length > 1) return;
    this.setCameraScrollAtWorldPoint(this.pointerDown.worldX, this.pointerDown.worldY, pointer.x, pointer.y);
    this.emitCameraChange();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.placementMode) {
      if (this.draggingGhost) this.reportPlacementAnchor(this.anchorFromWorldPoint(
        this.cameras.main.getWorldPoint(pointer.x, pointer.y).x
      ));
      else if (this.pointerDown && Phaser.Math.Distance.Between(this.pointerDown.x, this.pointerDown.y, pointer.x, pointer.y) < 8) {
        this.reportPlacementAnchor(this.anchorFromWorldPoint(this.cameras.main.getWorldPoint(pointer.x, pointer.y).x));
      }
      this.draggingGhost = false;
      this.cameraDragging = false;
      this.pointerDown = undefined;
      return;
    }
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const screenPoint = this.clientPointForPointer(pointer);
    const clickDistance = this.pointerDown
      ? Phaser.Math.Distance.Between(this.pointerDown.x, this.pointerDown.y, pointer.x, pointer.y) : Infinity;
    if (this.dragCandidate && this.residentDragActive) {
      const target = this.selectionAtWorld(worldPoint.x, worldPoint.y);
      this.callbacks.onResidentDrop?.(this.dragCandidate.residentId, target, screenPoint);
      this.clearResidentDrag();
      this.resetPointerState();
      return;
    }
    if (clickDistance < 8) {
      const selection = this.selectionAtWorld(worldPoint.x, worldPoint.y);
      if (selection) {
        this.selectEntity(selection, screenPoint);
      } else {
        this.selected = null;
        this.updateRoute();
        this.updateSelectionMarker();
        this.callbacks.onSelect?.(null, screenPoint);
        if (!this.placementMode && Math.abs(worldPoint.y - SURFACE_Y) <= CELL_SIZE * 0.75) {
          this.callbacks.onEmptyGroundClick?.(this.anchorFromWorldPoint(worldPoint.x), screenPoint);
        }
      }
    } else if (this.pointerSelection) {
      // Dragging on an object other than a resident is not a gameplay command.
      this.selectEntity(this.pointerSelection, screenPoint);
    }
    this.clearResidentDrag();
    this.resetPointerState();
  }

  private cancelPointerGesture(): void {
    this.clearResidentDrag();
    this.resetPointerState();
  }

  private clearResidentDrag(): void {
    const wasActive = this.residentDragActive;
    this.dragCandidate = undefined;
    this.residentDragActive = false;
    this.dropTarget = null;
    this.dropTargetValid = false;
    this.dragTargets = [];
    this.draggedResidentSprite?.destroy();
    this.draggedResidentSprite = undefined;
    this.dropGraphics?.clear();
    this.dragSourceGraphics?.clear();
    const parent = this.game?.canvas?.parentElement;
    if (parent) {
      parent.dataset.residentDragActive = 'false';
      parent.dataset.residentDragId = '';
      parent.dataset.dropTargetKind = '';
      parent.dataset.dropTargetValid = 'false';
      parent.dataset.assignableDropTargetCount = '0';
      parent.dataset.assignableDropTargetKinds = '';
    }
    if (wasActive) this.callbacks.onResidentDragEnd?.();
  }

  private resetPointerState(): void {
    this.cameraDragging = false;
    this.pointerHitEntity = false;
    this.pointerDown = undefined;
    this.pointerSelection = null;
  }

  override update(): void {
    const pointers = this.activePointers();
    if (pointers.length < 2) {
      this.pinchDistance = 0;
      this.pinchAnchor = undefined;
      return;
    }
    this.clearResidentDrag();
    this.pointerDown = undefined;
    this.pointerHitEntity = true;
    this.pointerSelection = null;
    const first = pointers[0];
    const second = pointers[1];
    if (!first || !second) return;
    this.cameraDragging = false;
    this.draggingGhost = false;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const distance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y);
    if (this.pinchDistance === 0) {
      this.pinchDistance = distance;
      this.pinchZoom = this.cameras.main.zoom;
      this.pinchAnchor = this.cameras.main.getWorldPoint(midpoint.x, midpoint.y);
      return;
    }
    const camera = this.cameras.main;
    camera.setZoom(Phaser.Math.Clamp(this.pinchZoom * distance / this.pinchDistance, 0.5, 3));
    if (this.pinchAnchor) {
      this.setCameraScrollAtWorldPoint(this.pinchAnchor.x, this.pinchAnchor.y, midpoint.x, midpoint.y);
    }
    this.emitCameraChange();
  }

  private activePointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter((pointer) => pointer.isDown);
  }

  private onResize(): void {
    const camera = this.cameras.main;
    if (this.previousViewport.width > 0 && this.previousViewport.height > 0) {
      const centerX = camera.scrollX + this.previousViewport.width / 2;
      const centerY = camera.scrollY + this.previousViewport.height / 2;
      this.centerCameraOn(centerX, centerY);
    }
    this.previousViewport = { width: this.scale.width, height: this.scale.height };
    this.emitCameraChange();
  }

  private zoomAt(screenX: number, screenY: number, zoom: number): void {
    const camera = this.cameras.main;
    const before = camera.getWorldPoint(screenX, screenY);
    camera.setZoom(Phaser.Math.Clamp(zoom, 0.5, 3));
    this.setCameraScrollAtWorldPoint(before.x, before.y, screenX, screenY);
    this.emitCameraChange();
  }

  private centerCameraOn(worldX: number, worldY: number): void {
    const camera = this.cameras.main;
    camera.scrollX = worldX - camera.width / 2;
    camera.scrollY = worldY - camera.height / 2;
  }

  private setCameraScrollAtWorldPoint(worldX: number, worldY: number, screenX: number, screenY: number): void {
    const camera = this.cameras.main;
    camera.scrollX = worldX - camera.width / 2 + camera.width / (2 * camera.zoom) - (screenX - camera.x) / camera.zoom;
    camera.scrollY = worldY - camera.height / 2 + camera.height / (2 * camera.zoom) - (screenY - camera.y) / camera.zoom;
  }

  private emitCameraChange(): void {
    const camera = this.cameras?.main;
    const zoom = camera?.zoom ?? 1;
    const parent = this.game?.canvas?.parentElement;
    if (parent && camera) {
      parent.dataset.cameraZoom = zoom.toFixed(2);
      parent.dataset.cameraCenterX = (camera.scrollX + camera.width / 2).toFixed(2);
      parent.dataset.cameraCenterY = (camera.scrollY + camera.height / 2).toFixed(2);
      parent.dataset.cameraScrollX = camera.scrollX.toFixed(2);
      parent.dataset.cameraScrollY = camera.scrollY.toFixed(2);
      parent.dataset.cameraViewportX = camera.x.toFixed(2);
      parent.dataset.cameraViewportY = camera.y.toFixed(2);
      parent.dataset.cameraViewportWidth = camera.width.toFixed(2);
      parent.dataset.cameraViewportHeight = camera.height.toFixed(2);
      const viewX = camera.scrollX + camera.width / 2 - camera.width / (2 * zoom);
      const viewY = camera.scrollY + camera.height / 2 - camera.height / (2 * zoom);
      parent.dataset.cameraWorldViewX = viewX.toFixed(2);
      parent.dataset.cameraWorldViewY = viewY.toFixed(2);
      parent.dataset.cameraWorldViewWidth = (camera.width / zoom).toFixed(2);
      parent.dataset.cameraWorldViewHeight = (camera.height / zoom).toFixed(2);
      parent.dataset.cabinDisplayWidth = String(BUILDING_DISPLAY_SIZE.cabin.width);
      parent.dataset.cabinDisplayHeight = String(BUILDING_DISPLAY_SIZE.cabin.height);
      parent.dataset.workshopDisplayWidth = String(BUILDING_DISPLAY_SIZE.workshop.width);
      parent.dataset.workshopDisplayHeight = String(BUILDING_DISPLAY_SIZE.workshop.height);
      parent.dataset.stoneTextureLoaded = String(this.textures.exists('stone-outcrop'));
      const stoneImage = this.textures.exists('stone-outcrop')
        ? this.textures.get('stone-outcrop').source[0]?.image as HTMLImageElement | undefined : undefined;
      if (stoneImage) parent.dataset.stoneTextureSize = `${stoneImage.naturalWidth}x${stoneImage.naturalHeight}`;
      const firstDepositVisual = this.stoneDeposits.values().next().value;
      if (firstDepositVisual) parent.dataset.stoneSpriteTextureKey = firstDepositVisual.sprite.texture.key;
      const project = (worldX: number, worldY: number) => ({
        x: (camera.x + (worldX - viewX) * zoom) * this.game.canvas.clientWidth / camera.width,
        y: (camera.y + (worldY - viewY) * zoom) * this.game.canvas.clientHeight / camera.height
      });
      const actors = this.world?.residents ?? [];
      actors.slice(0, 2).forEach((actor, index) => {
        const visual = this.residents.get(actor.id);
        if (!visual) return;
        const point = project(visual.sprite.x, visual.sprite.y - 41);
        parent.dataset[`resident${index}CanvasX`] = point.x.toFixed(2);
        parent.dataset[`resident${index}CanvasY`] = point.y.toFixed(2);
        if (index === 0) {
          parent.dataset.residentCanvasX = point.x.toFixed(2);
          parent.dataset.residentCanvasY = point.y.toFixed(2);
          parent.dataset.workerCanvasX = point.x.toFixed(2);
          parent.dataset.workerCanvasY = point.y.toFixed(2);
        }
      });
      const firstTree = this.world?.trees[0];
      const treeVisual = firstTree ? this.trees.get(firstTree.id) : undefined;
      if (treeVisual) {
        const treeSprite = treeVisual.tree.visible ? treeVisual.tree : treeVisual.young.visible ? treeVisual.young : treeVisual.stump;
        const point = project(treeSprite.x, treeSprite.y - (treeVisual.tree.visible ? 78 : 32));
        parent.dataset.firstTreeCanvasX = point.x.toFixed(2);
        parent.dataset.firstTreeCanvasY = point.y.toFixed(2);
      }
      const firstDeposit = this.world?.stoneDeposits[0];
      const depositVisual = firstDeposit ? this.stoneDeposits.get(firstDeposit.id) : undefined;
      if (depositVisual) {
        const point = project(depositVisual.sprite.x, depositVisual.sprite.y - 38);
        parent.dataset.firstStoneCanvasX = point.x.toFixed(2);
        parent.dataset.firstStoneCanvasY = point.y.toFixed(2);
      }
      (this.world?.buildings ?? []).slice(0, 4).forEach((building, index) => {
        const visual = this.buildings.get(building.id);
        if (!visual) return;
        const point = project(visual.sprite.x, visual.sprite.y - 45);
        parent.dataset[`building${index}CanvasX`] = point.x.toFixed(2);
        parent.dataset[`building${index}CanvasY`] = point.y.toFixed(2);
        parent.dataset[`building${index}DisplayWidth`] = String(visual.sprite.displayWidth);
        parent.dataset[`building${index}DisplayHeight`] = String(visual.sprite.displayHeight);
        if (index === 0) {
          parent.dataset.firstBuildingCanvasX = point.x.toFixed(2);
          parent.dataset.firstBuildingCanvasY = point.y.toFixed(2);
        }
      });
      const storages = this.world?.storages ?? this.preview?.storages ?? (this.world ? [{
        id: this.world.storage.id, anchor: this.world.storage.anchor, footprint: this.world.storage.footprint
      }] : []);
      storages.slice(0, 4).forEach((storage, index) => {
        const sprite = this.storageSprites.get(storage.id);
        if (!sprite) return;
        const point = project(sprite.x, sprite.y - 64);
        parent.dataset[`storage${index}CanvasX`] = point.x.toFixed(2);
        parent.dataset[`storage${index}CanvasY`] = point.y.toFixed(2);
      });
    }
    this.callbacks.onCameraChange?.({ zoom });
  }

  private selectionAtWorld(worldX: number, worldY: number): SettlementSelection {
    for (const [id, resident] of this.residents) {
      if (resident.sprite.getBounds().contains(worldX, worldY)) return { kind: 'resident', id };
    }
    for (const [id, building] of this.buildings) {
      if (building.hitArea.contains(worldX, worldY)) return { kind: 'building', id };
    }
    for (const [id, visual] of this.trees) {
      const sprite = visual.tree.visible ? visual.tree : visual.young.visible ? visual.young : visual.stump;
      if (!sprite.visible) continue;
      const bounds = sprite.getBounds();
      if (bounds.contains(worldX, worldY)) return { kind: 'tree', id };
    }
    for (const [id, visual] of this.stoneDeposits) {
      if (visual.hitArea.contains(worldX, worldY)) return { kind: 'stone-deposit', id };
    }
    for (const [id, sprite] of this.storageSprites) {
      if (sprite.getBounds().contains(worldX, worldY)) return { kind: 'storage', id };
    }
    return null;
  }

  private selectEntity(selection: SettlementSelection, point = this.clientPointForSelection(selection)): void {
    this.selected = selection;
    this.callbacks.onSelect?.(selection, point);
    this.updateRoute();
    this.updateSelectionMarker();
    if (selection) this.flashSelection(selection, true);
  }

  private clientPointForPointer(pointer: Phaser.Input.Pointer): SceneScreenPoint {
    const bounds = this.game.canvas.getBoundingClientRect();
    return {
      x: bounds.left + pointer.x * bounds.width / this.scale.width,
      y: bounds.top + pointer.y * bounds.height / this.scale.height
    };
  }

  screenPointForSelection(selection: SettlementSelection): SceneScreenPoint {
    return this.clientPointForSelection(selection);
  }

  private clientPointForSelection(selection: SettlementSelection): SceneScreenPoint {
    const bounds = this.game.canvas.getBoundingClientRect();
    let point = { x: 0, y: 0 };
    if (selection?.kind === 'resident') {
      const visual = this.residents.get(selection.id);
      if (visual) point = { x: visual.sprite.x, y: visual.sprite.y - 42 };
    } else if (selection?.kind === 'building') {
      const visual = this.buildings.get(selection.id);
      if (visual) point = { x: visual.sprite.x, y: visual.sprite.y - 54 };
    } else if (selection?.kind === 'tree') {
      const visual = this.trees.get(selection.id);
      if (visual) {
        const sprite = visual.tree.visible ? visual.tree : visual.young.visible ? visual.young : visual.stump;
        point = { x: sprite.x, y: sprite.y - 42 };
      }
    } else if (selection?.kind === 'stone-deposit') {
      const visual = this.stoneDeposits.get(selection.id);
      if (visual) point = { x: visual.sprite.x, y: visual.sprite.y - 38 };
    } else if (selection?.kind === 'storage') {
      const sprite = this.storageSprites.get(selection.id);
      if (sprite) point = { x: sprite.x, y: sprite.y - 38 };
    }
    const camera = this.cameras.main;
    const viewX = camera.scrollX + camera.width / 2 - camera.width / (2 * camera.zoom);
    const viewY = camera.scrollY + camera.height / 2 - camera.height / (2 * camera.zoom);
    const screenX = camera.x + (point.x - viewX) * camera.zoom;
    const screenY = camera.y + (point.y - viewY) * camera.zoom;
    return {
      x: bounds.left + screenX * bounds.width / camera.width,
      y: bounds.top + screenY * bounds.height / camera.height
    };
  }

  private updateDropMarker(): void {
    const graphics = this.dropGraphics;
    graphics?.clear();
    const parent = this.game?.canvas?.parentElement;
    if (parent) {
      parent.dataset.dropTargetKind = this.dropTarget?.kind ?? '';
      parent.dataset.dropTargetValid = String(this.dropTargetValid);
      parent.dataset.assignableDropTargetCount = String(this.dragTargets.length);
      parent.dataset.assignableDropTargetKinds = this.dragTargets.map((target) => target.kind).join(',');
    }
    if (!graphics || !this.residentDragActive) return;
    for (const target of this.dragTargets) this.drawDropTarget(target, 0x83a36b, 0.46, 2, true);
    if (this.dropTarget) this.drawDropTarget(this.dropTarget,
      this.dropTargetValid ? 0x75a853 : 0xc15a4a, 0.98, 4, false);
  }

  private drawDropTarget(
    target: Exclude<SettlementSelection, null>, color: number, alpha: number, lineWidth: number, fill: boolean
  ): void {
    const graphics = this.dropGraphics;
    if (!graphics) return;
    graphics.lineStyle(lineWidth, color, alpha);
    if (target.kind === 'building') {
      const visual = this.buildings.get(target.id);
      if (!visual) return;
      if (fill) {
        graphics.fillStyle(color, 0.08);
        graphics.fillRect(visual.hitArea.x, visual.hitArea.y, visual.hitArea.width, visual.hitArea.height);
      }
      graphics.strokeRoundedRect(visual.hitArea.x, visual.hitArea.y, visual.hitArea.width, visual.hitArea.height, 8);
    } else if (target.kind === 'tree') {
      const visual = this.trees.get(target.id);
      if (!visual) return;
      const sprite = visual.tree.visible ? visual.tree : visual.young.visible ? visual.young : visual.stump;
      if (fill) {
        graphics.fillStyle(color, 0.08);
        graphics.fillEllipse(sprite.x, sprite.y - 8, 124 * visual.scale, 22);
      }
      graphics.strokeEllipse(sprite.x, sprite.y - 8, 124 * visual.scale, 22);
    } else if (target.kind === 'stone-deposit') {
      const visual = this.stoneDeposits.get(target.id);
      if (!visual) return;
      if (fill) {
        graphics.fillStyle(color, 0.08);
        graphics.fillEllipse(visual.sprite.x, visual.sprite.y - 4, 124, 22);
      }
      graphics.strokeEllipse(visual.sprite.x, visual.sprite.y - 4, 124, 22);
    } else if (target.kind === 'storage') {
      const sprite = this.storageSprites.get(target.id);
      if (!sprite) return;
      if (fill) {
        graphics.fillStyle(color, 0.08);
        graphics.fillRoundedRect(sprite.x - 74, sprite.y - 122, 148, 124, 8);
      }
      graphics.strokeRoundedRect(sprite.x - 74, sprite.y - 122, 148, 124, 8);
    }
  }

  private beginResidentDragFeedback(residentId: string): void {
    this.dragTargets = [];
    if (this.world) {
      const candidates: Array<Exclude<SettlementSelection, null>> = [
        ...[...this.trees.keys()].map((id) => ({ kind: 'tree' as const, id })),
        ...[...this.stoneDeposits.keys()].map((id) => ({ kind: 'stone-deposit' as const, id })),
        ...[...this.buildings.keys()].map((id) => ({ kind: 'building' as const, id })),
        ...[...this.storageSprites.keys()].map((id) => ({ kind: 'storage' as const, id }))
      ];
      this.dragTargets = candidates.filter((target) => this.callbacks.onDropPreview?.(residentId, target) ?? false);
    }
    const parent = this.game?.canvas?.parentElement;
    if (parent) {
      parent.dataset.residentDragActive = 'true';
      parent.dataset.residentDragId = residentId;
    }
    const source = this.residents.get(residentId);
    if (source) {
      this.dragSourceGraphics?.clear();
      this.dragSourceGraphics?.lineStyle(3, 0xf1c26a, 0.98).fillStyle(0xf1c26a, 0.12)
        .fillEllipse(source.sprite.x, source.sprite.y - 18, 76, 34)
        .strokeEllipse(source.sprite.x, source.sprite.y - 18, 76, 34);
      const ghost = this.add.sprite(source.sprite.x, source.sprite.y, source.sprite.texture.key, source.sprite.frame.name)
        .setOrigin(source.sprite.originX, source.sprite.originY)
        .setDisplaySize(source.sprite.displayWidth, source.sprite.displayHeight)
        .setFlipX(source.sprite.flipX).setAlpha(0.82).setDepth(32);
      if (source.animation) ghost.play(source.animation);
      this.draggedResidentSprite = ghost;
    }
    this.updateDropMarker();
    this.callbacks.onResidentDragStart?.(residentId);
  }

  private isOverPlacementGhost(worldX: number, worldY: number): boolean {
    const left = this.placementAnchor.x * CELL_SIZE;
    const top = this.placementAnchor.y * CELL_SIZE;
    return worldX >= left && worldX <= left + 2 * CELL_SIZE && worldY >= top && worldY <= top + CELL_SIZE;
  }

  private anchorFromWorldPoint(worldX: number): PlacementAnchor {
    return { x: Math.floor(worldX / CELL_SIZE), y: -1 };
  }

  private reportPlacementAnchor(anchor: PlacementAnchor): void {
    if (anchor.x === this.placementAnchor.x && anchor.y === this.placementAnchor.y) return;
    this.placementAnchor = anchor;
    const parent = this.game?.canvas?.parentElement;
    if (parent) {
      parent.dataset.placementAnchorX = String(anchor.x);
      parent.dataset.placementAnchorY = String(anchor.y);
    }
    this.callbacks.onPlacementAnchor?.(anchor);
    this.updatePlacementGhost();
  }

  private updateScene(): void {
    const world = this.world;
    const preview = this.preview;
    if (!world && !preview) return;
    const residentViews = world?.residents.map((resident) => ({
      id: resident.id,
      name: resident.name,
      appearanceKey: resident.appearanceKey,
      workRole: resident.workRole,
      position: resident.position,
      facing: resident.facing,
      visualState: resident.visualState,
      task: resident.task,
      cargo: resident.cargo,
      cargoItemId: resident.cargoItemId
    })) ?? preview?.actors.map((actor, index) => ({
      id: actor.visualKey,
      name: `Житель ${index + 1}`,
      appearanceKey: actor.appearanceKey ?? `resident-${index + 1}`,
      workRole: actor.workRole ?? 'none',
      position: actor.position,
      facing: 'right' as const,
      visualState: actor.visualState,
      task: null,
      cargo: actor.cargo ?? 0,
      cargoItemId: actor.cargoItemId ?? null
    })) ?? [];
    this.updateResidents(residentViews);

    const resourceNodes = world?.trees.map((tree) => ({
      id: tree.id, position: tree.position, state: tree.state, sourceKind: tree.sourceKind,
      remaining: tree.remaining, maxRemaining: tree.maxRemaining,
      bufferQuantity: tree.bufferQuantity, bufferCapacity: tree.bufferCapacity
    })) ?? preview?.resourceNodes.map((tree) => ({
      id: tree.visualKey, position: tree.position, state: tree.state, sourceKind: tree.sourceKind,
      remaining: tree.remaining, maxRemaining: tree.maxRemaining,
      bufferQuantity: tree.bufferQuantity, bufferCapacity: tree.bufferCapacity
    })) ?? [];
    const activeTreeIds = new Set(resourceNodes.map((tree) => tree.id));
    for (const [id, visual] of this.trees) {
      if (!activeTreeIds.has(id)) {
        visual.tree.destroy();
        visual.young.destroy();
        visual.stump.destroy();
        visual.bufferLabel.destroy();
        this.trees.delete(id);
      }
    }
    for (const node of resourceNodes) {
      let visual = this.trees.get(node.id);
      if (!visual) {
        const scale = node.sourceKind === 'renewable_plot' ? 0.76
          : node.id === 'tree-3' ? 1.14
            : node.id === 'tree-2' ? 1.04 : 0.92;
        const tree = this.add.image(0, 0, 'tree-full').setOrigin(0.5, 1).setDepth(4)
          .setDisplaySize(130 * scale, 160 * scale)
          .setInteractive({ useHandCursor: true });
        const stump = this.add.image(0, 0, 'tree-stump').setOrigin(0.5, 1).setDepth(4)
          .setDisplaySize(95 * scale, 64 * scale)
          .setInteractive({ useHandCursor: true }).setVisible(false);
        const young = this.add.image(0, 0, 'tree-full').setOrigin(0.5, 1).setDepth(4)
          .setDisplaySize(76 * scale, 92 * scale).setTint(0x9ab86a)
          .setInteractive({ useHandCursor: true }).setVisible(false);
        const bufferLabel = this.add.text(0, 0, '', {
          fontFamily: 'Avenir Next, sans-serif', fontSize: '10px', color: '#26313a',
          backgroundColor: '#f7f3e8ee', padding: { x: 4, y: 2 }
        }).setOrigin(0.5, 1).setDepth(16).setVisible(false);
        visual = { tree, young, stump, bufferLabel, scale };
        this.trees.set(node.id, visual);
      }
      const point = this.worldToPixel(node.position);
      const adult = node.state === 'standing' && node.remaining >= node.maxRemaining;
      const sapling = node.state === 'standing' && node.remaining > 0 && node.remaining < node.maxRemaining;
      visual.tree.setPosition(point.x, point.y).setVisible(adult);
      visual.young.setPosition(point.x, point.y).setVisible(sapling);
      visual.stump.setPosition(point.x, point.y).setVisible(node.state === 'stump');
      visual.bufferLabel.setPosition(point.x, point.y - 8)
        .setText(`${node.bufferQuantity}/${node.bufferCapacity} брёвен в буфере`)
        .setVisible(node.bufferQuantity > 0);
    }
    this.updateStoneDeposits(world?.stoneDeposits ?? preview?.stoneDeposits ?? []);
    this.updateSurfaceFeatures(world?.surfaceCells ?? []);
    const storages = world?.storages ?? preview?.storages ?? (world ? [{
      id: world.storage.id, anchor: world.storage.anchor, footprint: world.storage.footprint
    }] : []);
    const activeStorageIds = new Set(storages.map((storage) => storage.id));
    for (const [id, sprite] of this.storageSprites) {
      if (!activeStorageIds.has(id)) { sprite.destroy(); this.storageSprites.delete(id); }
    }
    for (const storage of storages) {
      let sprite = this.storageSprites.get(storage.id);
      if (!sprite) {
        sprite = this.add.image(0, 0, 'storehouse').setOrigin(0.5, 1).setDepth(5).setDisplaySize(152, 127);
        this.storageSprites.set(storage.id, sprite);
      }
      sprite.setPosition(storage.anchor.x * CELL_SIZE + storage.footprint.width * CELL_SIZE / 2, SURFACE_Y);
    }
    const sceneRoot = this.game.canvas.parentElement;
    if (sceneRoot) sceneRoot.dataset.storageVisualCount = String(this.storageSprites.size);
    this.updateBuildings(world?.buildings ?? []);
    this.updateDeliveryAnimations(world);
    this.updateRoute();
    this.updateSelectionMarker();
    this.updatePlacementGhost();
    this.emitCameraChange();
  }

  private updateResidents(actors: Array<{
    id: string;
    name: string;
    appearanceKey: string;
    workRole: 'none' | 'woodcutter' | 'builder' | 'stone_miner' | 'hauler';
    position: { x: number; y: number };
    facing: 'left' | 'right';
    visualState: string;
    task: PeaceWorldSnapshot['residents'][number]['task'];
    cargo: number;
    cargoItemId: 'wood' | 'stone' | null;
  }>): void {
    const activeIds = new Set(actors.map((actor) => actor.id));
    for (const [id, visual] of this.residents) {
      if (activeIds.has(id)) continue;
      visual.sprite.destroy();
      visual.name.destroy();
      visual.badge.destroy();
      this.residents.delete(id);
    }
    for (let actorIndex = 0; actorIndex < actors.length; actorIndex += 1) {
      const actor = actors[actorIndex]!;
      let visual = this.residents.get(actor.id);
      if (!visual) {
        const sprite = this.add.sprite(0, 0, 'worker-atlas', 0).setOrigin(0.5, 1).setDepth(12).setDisplaySize(70, 82);
        if (actor.appearanceKey !== 'ilya') sprite.setTint(0xf2c49e);
        sprite.setInteractive({ useHandCursor: true });
        const name = this.add.text(0, 0, actor.name, {
          fontFamily: 'Avenir Next, sans-serif', fontSize: '12px', color: '#263528',
          backgroundColor: '#f7f3e8ee', padding: { x: 5, y: 3 }
        }).setOrigin(0.5, 1).setDepth(15);
        const badge = this.add.graphics().setDepth(13);
        visual = { sprite, name, badge, animation: '', position: undefined };
        this.residents.set(actor.id, visual);
      }
      const nextPixel = this.worldToPixel(actor.position);
      const hasTask = Boolean(actor.task);
      if (!visual.position || !hasTask) {
        visual.sprite.setPosition(nextPixel.x, nextPixel.y);
      } else if (visual.position.x !== actor.position.x || visual.position.y !== actor.position.y) {
        this.tweens.killTweensOf(visual.sprite);
        this.tweens.add({ targets: visual.sprite, x: nextPixel.x, y: nextPixel.y, duration: 340, ease: 'Linear' });
      }
      visual.position = { ...actor.position };
      visual.sprite.setFlipX(actor.facing === 'left').setDepth(10 + actor.position.y / 1000);
      this.setResidentAnimation(visual, actor.visualState);
        const roleName = actor.workRole === 'woodcutter' ? 'Лесоруб'
          : actor.workRole === 'stone_miner' ? 'Добытчик'
            : actor.workRole === 'builder' ? 'Строитель'
              : actor.workRole === 'hauler' ? 'Носильщик' : '';
        visual.name.setText(roleName ? `${actor.name} · ${roleName}` : actor.name);
        const camera = this.cameras.main;
        const viewX = camera.scrollX + camera.width / 2 - camera.width / (2 * camera.zoom);
        const viewWidth = camera.width / camera.zoom;
        const labelHalfWidth = visual.name.width / 2;
        const labelX = Phaser.Math.Clamp(visual.sprite.x,
          viewX + labelHalfWidth + 6, viewX + viewWidth - labelHalfWidth - 6);
        const baseLabelY = visual.sprite.y - 86;
        let labelLane = 0;
        while (actors.slice(0, actorIndex).some((previous) => {
          const previousVisual = this.residents.get(previous.id);
          return Boolean(previousVisual &&
            Math.abs(previousVisual.name.x - labelX) < (previousVisual.name.width + visual.name.width) / 2 + 8 &&
            Math.abs(previousVisual.name.y - (baseLabelY - labelLane * 18)) < previousVisual.name.height + 2);
        })) labelLane += 1;
        visual.name.setPosition(labelX, baseLabelY - labelLane * 18);
       visual.badge.clear();
        const badgeColor = actor.workRole === 'woodcutter' ? 0x547546
          : actor.workRole === 'stone_miner' ? 0x68747d
            : actor.workRole === 'builder' ? 0x9a6a3f
              : actor.workRole === 'hauler' ? 0x477e82 : actor.appearanceKey === 'ilya' ? 0x69844e : 0xa95f47;
       visual.badge.fillStyle(badgeColor, 0.98);
      visual.badge.fillRoundedRect(visual.sprite.x - 9, visual.sprite.y - 61, 18, 7, 3);
    }
  }

  private updateStoneDeposits(deposits: PeaceWorldSnapshot['stoneDeposits']): void {
    const activeIds = new Set(deposits.map((deposit) => deposit.id));
    for (const [id, visual] of this.stoneDeposits) {
      if (activeIds.has(id)) continue;
      visual.sprite.destroy();
      visual.label.destroy();
      this.stoneDeposits.delete(id);
    }
    for (const deposit of deposits) {
      let visual = this.stoneDeposits.get(deposit.id);
      if (!visual) {
        const sprite = this.add.image(0, 0, 'stone-outcrop').setOrigin(0.5, 1)
          .setDisplaySize(118, 78).setDepth(3).setInteractive({ useHandCursor: true });
        const label = this.add.text(0, 0, '', {
          fontFamily: 'Avenir Next, sans-serif', fontSize: '10px', color: '#26313a',
          backgroundColor: '#f7f3e8ee', padding: { x: 4, y: 2 }
        }).setOrigin(0.5, 1).setDepth(16);
        visual = { sprite, label, hitArea: new Phaser.Geom.Rectangle(0, 0, 118, 78) };
        this.stoneDeposits.set(deposit.id, visual);
      }
      const point = this.worldToPixel(deposit.position);
      if (visual.sprite.texture.key !== 'stone-outcrop') {
        visual.sprite.setTexture('stone-outcrop').setDisplaySize(118, 78);
      }
      visual.sprite.setPosition(point.x, point.y).setAlpha(deposit.remaining > 0 || deposit.bufferQuantity > 0 ? 1 : 0.5);
      visual.hitArea.setTo(point.x - 59, point.y - 78, 118, 78);
      visual.label.setPosition(point.x, point.y - 4)
        .setText(`${deposit.remaining} · ${deposit.bufferQuantity}/${deposit.bufferCapacity}`);
    }
  }

  private setResidentAnimation(visual: ResidentVisual, state: string): void {
    const sprite = visual.sprite;
    let animation = state;
    if (['walking_to_source', 'walking_to_build', 'walking_to_stone', 'hauling_to_source', 'hauling_to_storage', 'hauling_to_worksite'].includes(state)) animation = 'worker-walk';
    else if (['carrying_to_storage', 'carrying_materials_to_build', 'carrying_stone_to_storage', 'carrying_stone_to_build'].includes(state)) animation = 'worker-carry-walk';
    else if (state === 'gathering' || state === 'mining_stone' || state === 'hauling_loading') animation = 'worker-gather';
    else if (state === 'building') animation = 'worker-build';
    else if (state === 'loading' || state === 'loading_stone') animation = 'worker-load';
    else if (state === 'unloading' || state === 'unloading_stone' || state === 'unloading_stone_at_build' || state === 'hauling_unloading') animation = 'worker-unload';
    else animation = 'idle';
    if (animation === visual.animation) return;
    visual.animation = animation;
    this.tweens.killTweensOf(sprite);
    if (animation === 'idle' || animation === 'blocked' || animation === 'waiting_path') {
      sprite.stop();
      sprite.setFrame(animation === 'idle' ? 0 : 0);
      this.tweens.add({ targets: sprite, y: SURFACE_Y - 2, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      return;
    }
    sprite.play(animation, true);
  }

  private updateDeliveryAnimations(world?: PeaceWorldSnapshot): void {
    if (!world) {
      for (const log of this.deliveryLogs.values()) log.setVisible(false);
      this.deliveryPhases.clear();
      return;
    }
    const activeIds = new Set(world.residents.map((resident) => resident.id));
    for (const [id, log] of this.deliveryLogs) {
      if (activeIds.has(id)) continue;
      log.destroy();
      this.deliveryLogs.delete(id);
      this.deliveryPhases.delete(id);
    }
    const storageX = world.storage.anchor.x * CELL_SIZE + world.storage.footprint.width * CELL_SIZE / 2;
    for (const resident of world.residents) {
      const task = resident.task;
      const phase = task?.kind === 'gather-wood' ? task.phase : '';
      if (phase === this.deliveryPhases.get(resident.id)) continue;
      this.deliveryPhases.set(resident.id, phase);
      let log = this.deliveryLogs.get(resident.id);
      if (!log) {
        log = this.add.graphics().setDepth(14);
        this.deliveryLogs.set(resident.id, log);
      }
      this.tweens.killTweensOf(log);
      log.clear().setVisible(phase === 'loading' || phase === 'unloading');
      if (phase !== 'loading' && phase !== 'unloading') continue;
      log.fillStyle(0x9a7047, 1);
      log.fillRoundedRect(-18, -6, 36, 12, 5);
      log.lineStyle(2, 0xe2c99a, 1);
      log.strokeCircle(-13, 0, 5);
      const residentPixel = this.worldToPixel(resident.position);
      const source = task?.kind === 'gather-wood'
        ? world.trees.find((tree) => tree.id === task.sourceId)
        : undefined;
      const sourceX = this.worldToPixel(source?.position ?? { x: 3, y: 0 }).x;
      if (phase === 'loading') {
        log.setPosition(sourceX, SURFACE_Y - 38);
        this.tweens.add({ targets: log, x: residentPixel.x + 20, y: residentPixel.y - 82, duration: 360, ease: 'Sine.easeInOut' });
      } else {
        log.setPosition(residentPixel.x + 20, residentPixel.y - 82);
        this.tweens.add({ targets: log, x: storageX, y: SURFACE_Y - 10, duration: 360, ease: 'Sine.easeInOut' });
      }
    }
  }

  private updateBuildings(buildings: PeaceWorldSnapshot['buildings']): void {
    const visibleBuildings = buildings.filter((building) => building.state !== 'cancelled' && building.state !== 'demolished');
    const activeIds = new Set(visibleBuildings.map((building) => building.id));
    for (const [id, visual] of this.buildings) {
      if (!activeIds.has(id)) {
        this.tweens.killTweensOf(visual.sprite);
        this.tweens.killTweensOf(visual.details);
        this.tweens.killTweensOf(visual.progress);
        visual.sprite.destroy();
        visual.details.destroy();
        visual.progress.destroy();
        this.buildings.delete(id);
      }
    }
    if (this.selected?.kind === 'building' && !activeIds.has(this.selected.id)) {
      this.selectEntity(null);
    }
    for (const building of visibleBuildings) {
      let visual = this.buildings.get(building.id);
      if (!visual) {
        const workshop = building.kind === 'workshop';
        const displaySize = BUILDING_DISPLAY_SIZE[building.kind];
        const sprite = this.add.image(0, 0, workshop ? 'workshop' : 'house').setOrigin(0.5, 1)
          .setDisplaySize(displaySize.width, displaySize.height).setDepth(7)
          .setInteractive({ useHandCursor: true });
        const details = this.add.graphics().setDepth(8);
        const progress = this.add.text(0, 0, '', {
          fontFamily: 'Avenir Next, sans-serif', fontSize: '11px', color: '#263528',
          backgroundColor: '#f7f3e8dd', padding: { x: 5, y: 3 }
        }).setOrigin(0.5, 1).setDepth(18);
        visual = { sprite, details, progress, hitArea: new Phaser.Geom.Rectangle(0, 0, workshop ? 192 : 142, workshop ? 96 : 120) };
        this.buildings.set(building.id, visual);
      }
      const x = building.anchor.x * CELL_SIZE + building.footprint.width * CELL_SIZE / 2;
      visual.sprite.setPosition(x, SURFACE_Y).setVisible(building.state === 'complete').setAlpha(1);
      visual.sprite.clearTint();
      if (building.state === 'waiting_builder') visual.sprite.setTint(0xd6ae64);
      if (building.state === 'waiting_materials') visual.sprite.setTint(0xc88949);
      visual.details.clear();
      if (['planned', 'waiting_materials', 'waiting_builder', 'in_progress', 'cancelling'].includes(building.state)) {
        visual.details.lineStyle(2, building.state === 'waiting_materials' ? 0xc88949 : building.state === 'waiting_builder' ? 0xd6ae64 : 0x7f9d60, 0.95);
        visual.details.strokeRect(building.anchor.x * CELL_SIZE, SURFACE_Y - CELL_SIZE, building.footprint.width * CELL_SIZE, CELL_SIZE);
      } else if (building.state === 'foundation') {
        visual.details.fillStyle(0x8b7860, 1);
        visual.details.fillRoundedRect(building.anchor.x * CELL_SIZE + 4, SURFACE_Y - 12, building.footprint.width * CELL_SIZE - 8, 12, 3);
        for (let stone = 0; stone < building.footprint.width; stone += 1) {
          visual.details.lineStyle(1, 0xd8c4a1, 0.9);
          visual.details.lineBetween(building.anchor.x * CELL_SIZE + stone * CELL_SIZE + 4, SURFACE_Y - 7,
            building.anchor.x * CELL_SIZE + (stone + 1) * CELL_SIZE - 4, SURFACE_Y - 7);
        }
      } else if (building.state === 'scaffold') {
        visual.details.lineStyle(4, 0x8e6745, 0.96);
        const left = building.anchor.x * CELL_SIZE + 2;
        const right = left + building.footprint.width * CELL_SIZE - 4;
        visual.details.lineBetween(left, SURFACE_Y - 3, left, SURFACE_Y - 90);
        visual.details.lineBetween(right, SURFACE_Y - 3, right, SURFACE_Y - 90);
        visual.details.lineBetween(left, SURFACE_Y - 54, right, SURFACE_Y - 54);
        visual.details.lineBetween(left, SURFACE_Y - 84, right, SURFACE_Y - 84);
      }
      const buildingName = building.kind === 'workshop' ? 'Мастерская' : 'Дом';
      visual.progress.setPosition(x, SURFACE_Y - (building.kind === 'workshop' ? 102 : 126))
        .setText(building.state === 'complete' ? `${buildingName} готова`
          : building.state === 'cancelling' ? 'Возврат материалов на склад'
          : building.state === 'waiting_materials' ? 'Ждёт дерево и камень'
          : building.state === 'waiting_builder' ? 'Ждёт рабочего-строителя'
            : building.state === 'in_progress' ? 'Строится'
              : `${building.state === 'planned' ? 'В очереди' : building.state === 'foundation' ? 'Фундамент' : 'Каркас'} · ${building.progressTicks}/${building.progressRequired}`)
        .setVisible(building.state !== 'complete');
      visual.hitArea.setTo(x - 70, SURFACE_Y - 120, 140, 120);
    }
    const parent = this.game.canvas.parentElement;
    if (parent) {
      parent.dataset.buildingVisualCount = String(this.buildings.size);
      parent.dataset.buildingStageVisualCount = String(visibleBuildings.filter((building) => building.state !== 'complete').length);
    }
  }

  private updateSurfaceFeatures(cells: PeaceWorldSnapshot['surfaceCells']): void {
    const graphics = this.surfaceFeatureGraphics;
    if (!graphics) return;
    graphics.clear();
    const labels = new Map<string, { x: number; text: string; color: string }>();
    const unstable = cells.filter((cell) => cell.visualFeature === 'unstable-ground' && cell.position.y === 0)
      .sort((a, b) => a.position.x - b.position.x);
    for (const cell of unstable) {
      const x = cell.position.x * CELL_SIZE;
      graphics.fillStyle(0x664c3c, 0.96).fillEllipse(x + CELL_SIZE / 2, SURFACE_Y + 7, CELL_SIZE - 5, 17);
      graphics.lineStyle(2, 0xb76751, 0.98)
        .lineBetween(x + 10, SURFACE_Y + 2, x + 19, SURFACE_Y + 9)
        .lineBetween(x + 19, SURFACE_Y + 9, x + 14, SURFACE_Y + 14)
        .lineBetween(x + 32, SURFACE_Y + 1, x + 26, SURFACE_Y + 8);
    }
    const unstableRuns: Array<{ start: number; end: number }> = [];
    for (const cell of unstable) {
      const x = cell.position.x;
      const run = unstableRuns[unstableRuns.length - 1];
      if (run && x === run.end + 1) run.end = x;
      else unstableRuns.push({ start: x, end: x });
    }
    for (const run of unstableRuns) {
      labels.set(`unstable-${run.start}-${run.end}`, {
        x: (run.start + run.end + 1) * CELL_SIZE / 2, text: 'НЕТ ОПОРЫ', color: '#7d392d'
      });
    }

    const passageXs = cells.filter((cell) => cell.visualFeature === 'narrow-passage' && cell.position.y === 0)
      .map((cell) => cell.position.x).sort((a, b) => a - b);
    const passageRuns: Array<{ start: number; end: number }> = [];
    for (const x of passageXs) {
      const run = passageRuns[passageRuns.length - 1];
      if (run && x === run.end + 1) run.end = x;
      else passageRuns.push({ start: x, end: x });
    }
    for (const run of passageRuns) {
      const left = run.start * CELL_SIZE;
      const width = (run.end - run.start + 1) * CELL_SIZE;
      graphics.fillStyle(0x816348, 0.82).fillRoundedRect(left, SURFACE_Y - 2, width, 19, 5);
      graphics.lineStyle(2, 0x4c4031, 0.9).strokeRoundedRect(left, SURFACE_Y - 2, width, 19, 5);
      for (let x = run.start; x <= run.end; x += 2) {
        const center = x * CELL_SIZE + CELL_SIZE / 2;
        graphics.fillStyle(0x4c4031, 0.9).fillEllipse(center, SURFACE_Y + 21, 7, 4);
      }
      labels.set(`passage-${run.start}-${run.end}`, {
        x: left + CELL_SIZE / 2, text: 'УЗКИЙ ПРОХОД', color: '#5c4935'
      });
    }

    for (const [key, label] of this.surfaceFeatureLabels) {
      if (!labels.has(key)) {
        label.destroy();
        this.surfaceFeatureLabels.delete(key);
      }
    }
    for (const [key, spec] of labels) {
      let label = this.surfaceFeatureLabels.get(key);
      if (!label) {
        label = this.add.text(spec.x, SURFACE_Y - 4, spec.text, {
          fontFamily: 'Avenir Next, sans-serif', fontSize: '9px', fontStyle: 'bold', color: spec.color,
          backgroundColor: '#f5eedddd', padding: { x: 4, y: 2 }
        }).setOrigin(0.5, 1).setDepth(4);
        this.surfaceFeatureLabels.set(key, label);
      } else {
        label.setPosition(spec.x, SURFACE_Y - 4).setText(spec.text).setColor(spec.color);
      }
    }
    const parent = this.game.canvas.parentElement;
    if (parent) {
      parent.dataset.surfaceFeatureCount = String(labels.size);
      parent.dataset.unstableGroundCount = String(unstableRuns.length);
      parent.dataset.narrowPassageCount = String(passageRuns.length);
    }
  }

  private updateRoute(): void {
    const graphics = this.routeGraphics;
    graphics?.clear();
    if (!graphics || this.selected?.kind !== 'resident' || !this.world) return;
    const resident = this.world.residents.find((candidate) => candidate.id === this.selected?.id);
    const task = resident?.task;
    if (!resident || !task) return;
    const points = [resident.position, ...task.path.slice(task.pathIndex)];
    if (points.length < 2) return;
    graphics.lineStyle(3, task.phase === 'blocked' || task.phase === 'waiting_path' ? 0xc06c51 : 0xe0b85d, 0.82);
    const first = this.worldToPixel(points[0]!);
    graphics.beginPath();
    graphics.moveTo(first.x, first.y - 4);
    for (const point of points.slice(1)) {
      const pixel = this.worldToPixel(point);
      graphics.lineTo(pixel.x, pixel.y - 4);
    }
    graphics.strokePath();
    for (const point of points.slice(1)) {
      const pixel = this.worldToPixel(point);
      graphics.fillStyle(0xf2d890, 0.9);
      graphics.fillCircle(pixel.x, pixel.y - 4, 3);
    }
  }

  private updateSelectionMarker(): void {
    const graphics = this.selectionGraphics;
    graphics?.clear();
    if (!graphics || !this.selected) return;
    graphics.lineStyle(3, 0xf0c66f, 0.98);
    if (this.selected.kind === 'resident') {
      const resident = this.residents.get(this.selected.id);
      if (resident) graphics.strokeEllipse(resident.sprite.x, resident.sprite.y - 4, 62, 22);
      return;
    }
    if (this.selected.kind === 'building') {
      const visual = this.buildings.get(this.selected.id);
      if (visual) graphics.strokeRect(visual.hitArea.x, visual.hitArea.y, visual.hitArea.width, visual.hitArea.height);
      return;
    }
    if (this.selected.kind === 'tree') {
      const visual = this.trees.get(this.selected.id);
      if (visual && visual.stump.visible) {
        graphics.strokeEllipse(visual.stump.x, visual.stump.y - 3, 118 * visual.scale, 12);
      } else if (visual) {
        const sprite = visual.tree.visible ? visual.tree : visual.young;
        if (sprite.visible) graphics.strokeEllipse(sprite.x, sprite.y - 8, 118 * visual.scale, 18);
      }
      return;
    }
    if (this.selected.kind === 'stone-deposit') {
      const visual = this.stoneDeposits.get(this.selected.id);
      if (visual) graphics.strokeEllipse(visual.sprite.x, visual.sprite.y - 4, 116, 16);
      return;
    }
    if (this.selected.kind === 'storage') {
      const sprite = this.storageSprites.get(this.selected.id);
      if (sprite) graphics.strokeRect(sprite.x - 72, sprite.y - 124, 144, 124);
    }
  }

  private updatePlacementGhost(): void {
    const graphics = this.placementGraphics;
    graphics?.clear();
    const parent = this.game?.canvas?.parentElement;
    if (!this.placementMode) {
      this.placementHouse?.setVisible(false);
      this.placementWorkshop?.setVisible(false);
      if (parent) {
        parent.dataset.placementGhostVisible = 'false';
        parent.dataset.placementHouseVisible = 'false';
        parent.dataset.placementWorkshopVisible = 'false';
      }
      return;
    }
    if (!graphics) return;
    const fallbackCells = [{ x: this.placementAnchor.x, y: this.placementAnchor.y },
      { x: this.placementAnchor.x + 1, y: this.placementAnchor.y }];
    const footprintCells = this.placementFeedback.footprintCells?.length
      ? this.placementFeedback.footprintCells : fallbackCells;
    const minX = Math.min(...footprintCells.map((cell) => cell.x));
    const maxX = Math.max(...footprintCells.map((cell) => cell.x));
    const minY = Math.min(...footprintCells.map((cell) => cell.y));
    const maxY = Math.max(...footprintCells.map((cell) => cell.y));
    const x = minX * CELL_SIZE;
    const y = minY * CELL_SIZE;
    const centerX = (minX + maxX + 1) * CELL_SIZE / 2;
    const baseY = (maxY + 1) * CELL_SIZE;
    const ghost = this.placementBuildingKind === 'workshop' ? this.placementWorkshop : this.placementHouse;
    const wasVisible = Boolean(ghost?.visible);
    this.placementHouse?.setVisible(this.placementBuildingKind === 'cabin');
    this.placementWorkshop?.setVisible(this.placementBuildingKind === 'workshop');
    const entering = Boolean(ghost && !wasVisible);
    ghost?.setPosition(centerX, baseY).setVisible(true)
      .clearTint();
    if (ghost) {
      if (entering && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        ghost.setAlpha(0.16);
        this.tweens.add({ targets: ghost, alpha: 0.68, duration: 140, ease: 'Quad.Out' });
      } else {
        ghost.setAlpha(0.68);
      }
    }
    if (ghost && parent) {
      parent.dataset.placementGhostDisplayWidth = String(ghost.displayWidth);
      parent.dataset.placementGhostDisplayHeight = String(ghost.displayHeight);
      parent.dataset.placementGhostKind = this.placementBuildingKind;
      parent.dataset.placementGhostTexture = ghost.texture.key;
      parent.dataset.placementGhostTextureLoaded = String(this.textures.exists(ghost.texture.key));
      parent.dataset.placementGhostVisible = String(ghost.visible);
      parent.dataset.placementHouseVisible = String(Boolean(this.placementHouse?.visible));
      parent.dataset.placementWorkshopVisible = String(Boolean(this.placementWorkshop?.visible));
      parent.dataset.placementGhostAlpha = String(ghost.alpha);
      parent.dataset.placementGhostDepth = String(ghost.depth);
      parent.dataset.placementGhostX = String(ghost.x);
      parent.dataset.placementGhostY = String(ghost.y);
      const screenBounds = this.getPlacementGhostViewportBounds();
      if (screenBounds) {
        parent.dataset.placementGhostScreenLeft = String(screenBounds.left);
        parent.dataset.placementGhostScreenTop = String(screenBounds.top);
        parent.dataset.placementGhostScreenRight = String(screenBounds.right);
        parent.dataset.placementGhostScreenBottom = String(screenBounds.bottom);
      }
    }
    const overlaps = new Set((this.placementFeedback.overlapCells ?? []).map((cell) => `${cell.x},${cell.y}`));
    const unsupported = new Set((this.placementFeedback.unsupportedCells ?? []).map((cell) => `${cell.x},${cell.y}`));
    for (const cell of footprintCells) {
      const cellX = cell.x * CELL_SIZE;
      const cellY = cell.y * CELL_SIZE;
      const invalid = overlaps.has(`${cell.x},${cell.y}`) || !this.placementFeedback.valid;
      graphics.fillStyle(invalid ? 0xc26858 : 0x88a966, 0.24);
      graphics.fillRect(cellX, cellY, CELL_SIZE, CELL_SIZE);
      graphics.lineStyle(3, invalid ? 0xae483d : 0x537744, 0.95);
      graphics.strokeRect(cellX, cellY, CELL_SIZE, CELL_SIZE);
    }
    for (const cell of this.placementFeedback.supportCells ?? []) {
      const point = this.worldToPixel(cell);
      const invalid = unsupported.has(`${cell.x},${cell.y}`);
      graphics.fillStyle(invalid ? 0xc26858 : 0x88a966, 0.9);
      graphics.fillCircle(point.x, point.y, 5);
    }
    for (const cell of this.placementFeedback.walkBlockedCells ?? []) {
      const cellX = cell.x * CELL_SIZE;
      const cellY = cell.y * CELL_SIZE;
      graphics.lineStyle(1, 0x394438, 0.45);
      graphics.strokeRect(cellX + 3, cellY + 3, CELL_SIZE - 6, CELL_SIZE - 6);
    }
    const route = this.placementFeedback.route ?? [];
    if (route.length > 1) {
      graphics.lineStyle(3, 0x4b9b77, 0.9);
      for (let index = 1; index < route.length; index += 1) {
        const from = this.worldToPixel(route[index - 1]!);
        const to = this.worldToPixel(route[index]!);
        graphics.lineBetween(from.x, from.y, to.x, to.y);
      }
    }
    if (this.placementFeedback.blockedRoute) {
      const from = this.worldToPixel(this.placementFeedback.blockedRoute.from);
      const to = this.worldToPixel(this.placementFeedback.blockedRoute.to);
      graphics.lineStyle(3, 0xc26858, 0.95);
      graphics.lineBetween(from.x, from.y, to.x, to.y);
    }
    for (const [point, color] of [[this.placementFeedback.entrance, 0xd4a34a], [this.placementFeedback.workPoint, 0x4f8eb8]] as const) {
      if (!point) continue;
      const pixel = this.worldToPixel(point);
      graphics.fillStyle(color, 1);
      graphics.fillCircle(pixel.x, pixel.y, 7);
      graphics.lineStyle(2, 0xf7f3e8, 0.95);
      graphics.strokeCircle(pixel.x, pixel.y, 7);
    }
  }

  private worldToPixel(point: { x: number; y: number }): { x: number; y: number } {
    return { x: point.x * CELL_SIZE + CELL_SIZE / 2, y: SURFACE_Y + point.y * CELL_SIZE };
  }
}
