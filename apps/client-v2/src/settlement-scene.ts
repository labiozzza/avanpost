import Phaser from 'phaser';
import type { PeaceWorldSnapshot, ReadOnlyWorldPreview } from '@avanpost/peace-v2-shared';

export const CELL_SIZE = 48;
const SURFACE_Y = 0;
const WORLD_HALF_WIDTH = 32 * CELL_SIZE;
const WORLD_HEIGHT = 14 * CELL_SIZE;

export interface PlacementAnchor {
  x: number;
  y: number;
}

export interface PlacementFeedback {
  valid: boolean;
  reason: string;
}

export type SettlementSelection = { kind: 'worker' } | { kind: 'building'; id: string } | { kind: 'tree'; id: string } | null;

export interface CameraFeedback {
  zoom: number;
}

interface SceneCallbacks {
  onSelect?: (selection: SettlementSelection) => void;
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
  stump: Phaser.GameObjects.Image;
  scale: number;
}

const ASSET = '/assets/peace-v2/';

export class SettlementScene extends Phaser.Scene {
  private background?: Phaser.GameObjects.TileSprite;
  private farRidge?: Phaser.GameObjects.Graphics;
  private middleRidge?: Phaser.GameObjects.Graphics;
  private terrain?: Phaser.GameObjects.Graphics;
  private surfaceFlora?: Phaser.GameObjects.Graphics;
  private routeGraphics?: Phaser.GameObjects.Graphics;
  private selectionGraphics?: Phaser.GameObjects.Graphics;
  private placementGraphics?: Phaser.GameObjects.Graphics;
  private placementHouse?: Phaser.GameObjects.Image;
  private workerSprite?: Phaser.GameObjects.Sprite;
  private readonly trees = new Map<string, TreeVisual>();
  private storageSprite?: Phaser.GameObjects.Image;
  private deliveryLog?: Phaser.GameObjects.Graphics;
  private readonly buildings = new Map<string, BuildingVisual>();
  private world?: PeaceWorldSnapshot;
  private preview?: ReadOnlyWorldPreview;
  private callbacks: SceneCallbacks = {};
  private selected: SettlementSelection = null;
  private placementMode = false;
  private placementAnchor: PlacementAnchor = { x: 0, y: -1 };
  private placementFeedback: PlacementFeedback = { valid: false, reason: 'Выберите клетку на поверхности.' };
  private workerAnimation = '';
  private workerPosition?: { x: number; y: number };
  private pointerDown?: { x: number; y: number; worldX: number; worldY: number };
  private cameraDragging = false;
  private pointerHitEntity = false;
  private draggingGhost = false;
  private pinchDistance = 0;
  private pinchZoom = 1;
  private pinchAnchor?: { x: number; y: number };
  private previousViewport = { width: 0, height: 0 };
  private lastDeliveryPhase = '';
  private nativePointerStart?: { x: number; y: number };
  private readonly nativePointerDown = (event: PointerEvent): void => {
    this.nativePointerStart = { x: event.clientX, y: event.clientY };
  };
  private readonly nativePointerUp = (event: PointerEvent): void => {
    const start = this.nativePointerStart;
    this.nativePointerStart = undefined;
    if (!start || this.placementMode || Phaser.Math.Distance.Between(start.x, start.y, event.clientX, event.clientY) >= 8) return;
    const canvas = this.game.canvas;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const camera = this.cameras.main;
    const screenX = (event.clientX - bounds.left) * camera.width / bounds.width;
    const screenY = (event.clientY - bounds.top) * camera.height / bounds.height;
    const worldPoint = camera.getWorldPoint(screenX, screenY);
    this.hitTestSelection(worldPoint.x, worldPoint.y);
  };

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
    this.routeGraphics = this.add.graphics().setDepth(16);
    this.selectionGraphics = this.add.graphics().setDepth(17);
    this.placementGraphics = this.add.graphics().setDepth(20);
    this.placementHouse = this.add.image(0, 0, 'house').setOrigin(0.5, 1).setDisplaySize(126, 106)
      .setAlpha(0.48).setDepth(19).setVisible(false);
    this.storageSprite = this.add.image(0, 0, 'storehouse').setOrigin(0.5, 1).setDepth(5).setDisplaySize(152, 127);
    this.workerSprite = this.add.sprite(0, 0, 'worker-atlas', 0).setOrigin(0.5, 1).setDepth(12).setDisplaySize(70, 82);
    this.workerSprite.setInteractive({ useHandCursor: true });
    this.workerSprite.on('pointerdown', () => {
      if (this.placementMode) return;
      this.pointerHitEntity = true;
      this.selectEntity({ kind: 'worker' });
      this.cameraDragging = false;
    });
    this.deliveryLog = this.add.graphics().setDepth(14);
    this.createAnimations();
    this.configureCamera();
    this.configureInput();
    this.game.canvas.addEventListener('pointerdown', this.nativePointerDown);
    this.game.canvas.addEventListener('pointerup', this.nativePointerUp);
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      this.input.off('pointerdown');
      this.input.off('pointermove');
      this.input.off('pointerup');
      this.input.off('wheel');
      this.game.canvas.removeEventListener('pointerdown', this.nativePointerDown);
      this.game.canvas.removeEventListener('pointerup', this.nativePointerUp);
    });
    this.updateScene();
  }

  setWorkerSelected(selected: boolean): void {
    this.selected = selected ? { kind: 'worker' } : null;
    this.callbacks.onSelect?.(this.selected);
    this.updateScene();
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

  setPlacementMode(enabled: boolean): void {
    this.placementMode = enabled;
    this.draggingGhost = false;
    if (enabled) this.reportPlacementAnchor(this.placementAnchor);
    this.updatePlacementGhost();
  }

  setPlacementAnchor(anchor: PlacementAnchor): void {
    this.reportPlacementAnchor(anchor);
  }

  setPlacementFeedback(feedback: PlacementFeedback): void {
    this.placementFeedback = feedback;
    this.updatePlacementGhost();
  }

  centerOnSelection(): void {
    if (this.selected?.kind === 'worker' && this.workerSprite) {
      this.centerCameraOn(this.workerSprite.x, this.workerSprite.y - 40);
    } else if (this.selected?.kind === 'building') {
      const building = this.buildings.get(this.selected.id);
      if (building) this.centerCameraOn(building.sprite.x, building.sprite.y - 32);
    } else {
      this.centerCameraOn(0, SURFACE_Y + 80);
    }
    this.emitCameraChange();
  }

  selectTree(id: string): void {
    const visual = this.trees.get(id);
    if (!visual) return;
    this.selectEntity({ kind: 'tree', id });
    const sprite = visual.tree.visible ? visual.tree : visual.stump;
    this.centerCameraOn(sprite.x, sprite.y - 80);
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
    this.centerCameraOn(0, SURFACE_Y + 50);
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
    const caveX = 12 * CELL_SIZE;
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
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, deltaY: number) => {
      this.zoomAt(pointer.x, pointer.y, this.cameras.main.zoom * Math.exp(-deltaY * 0.001));
    });
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.pointerDown = { x: pointer.x, y: pointer.y, worldX: worldPoint.x, worldY: worldPoint.y };
    if (this.placementMode) {
      this.draggingGhost = this.isOverPlacementGhost(worldPoint.x, worldPoint.y);
      this.cameraDragging = !this.draggingGhost;
    } else {
      this.cameraDragging = !this.hitTestSelection(worldPoint.x, worldPoint.y);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.placementMode && this.draggingGhost) {
      this.reportPlacementAnchor(this.anchorFromWorldPoint(worldPoint.x));
      return;
    }
    if (this.pointerHitEntity) return;
    if (!pointer.isDown || !this.pointerDown || !this.cameraDragging || this.activePointers().length > 1) return;
    const camera = this.cameras.main;
    camera.scrollX = this.pointerDown.worldX - pointer.x / camera.zoom - camera.x;
    camera.scrollY = this.pointerDown.worldY - pointer.y / camera.zoom - camera.y;
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
    if (!this.pointerHitEntity && this.pointerDown) {
      const distance = Phaser.Math.Distance.Between(this.pointerDown.x, this.pointerDown.y, pointer.x, pointer.y);
      if (distance < 8) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.hitTestSelection(worldPoint.x, worldPoint.y);
      }
    }
    this.cameraDragging = false;
    this.pointerHitEntity = false;
    this.pointerDown = undefined;
  }

  override update(): void {
    const pointers = this.activePointers();
    if (pointers.length < 2) {
      this.pinchDistance = 0;
      this.pinchAnchor = undefined;
      return;
    }
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
      const camera = this.cameras.main;
      this.pinchAnchor = {
        x: camera.scrollX + (midpoint.x - camera.x) / camera.zoom,
        y: camera.scrollY + (midpoint.y - camera.y) / camera.zoom
      };
      return;
    }
    const camera = this.cameras.main;
    camera.setZoom(Phaser.Math.Clamp(this.pinchZoom * distance / this.pinchDistance, 0.5, 3));
    if (this.pinchAnchor) {
      camera.scrollX = this.pinchAnchor.x - (midpoint.x - camera.x) / camera.zoom;
      camera.scrollY = this.pinchAnchor.y - (midpoint.y - camera.y) / camera.zoom;
    }
    this.emitCameraChange();
  }

  private activePointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter((pointer) => pointer.isDown);
  }

  private onResize(): void {
    const camera = this.cameras.main;
    if (this.previousViewport.width > 0 && this.previousViewport.height > 0) {
      const centerX = camera.scrollX + this.previousViewport.width / (2 * camera.zoom);
      const centerY = camera.scrollY + this.previousViewport.height / (2 * camera.zoom);
      this.centerCameraOn(centerX, centerY);
    }
    this.previousViewport = { width: this.scale.width, height: this.scale.height };
    this.emitCameraChange();
  }

  private zoomAt(screenX: number, screenY: number, zoom: number): void {
    const camera = this.cameras.main;
    const before = {
      x: camera.scrollX + (screenX - camera.x) / camera.zoom,
      y: camera.scrollY + (screenY - camera.y) / camera.zoom
    };
    camera.setZoom(Phaser.Math.Clamp(zoom, 0.5, 3));
    camera.scrollX = before.x - (screenX - camera.x) / camera.zoom;
    camera.scrollY = before.y - (screenY - camera.y) / camera.zoom;
    this.emitCameraChange();
  }

  private centerCameraOn(worldX: number, worldY: number): void {
    const camera = this.cameras.main;
    camera.scrollX = worldX - camera.width / (2 * camera.zoom);
    camera.scrollY = worldY - camera.height / (2 * camera.zoom);
  }

  private emitCameraChange(): void {
    const camera = this.cameras?.main;
    const zoom = camera?.zoom ?? 1;
    const parent = this.game?.canvas?.parentElement;
    if (parent && camera) {
      parent.dataset.cameraZoom = zoom.toFixed(2);
      parent.dataset.cameraCenterX = (camera.scrollX + camera.width / (2 * zoom)).toFixed(2);
      parent.dataset.cameraCenterY = (camera.scrollY + camera.height / (2 * zoom)).toFixed(2);
      parent.dataset.cameraScrollX = camera.scrollX.toFixed(2);
      parent.dataset.cameraScrollY = camera.scrollY.toFixed(2);
      parent.dataset.cameraViewportX = camera.x.toFixed(2);
      parent.dataset.cameraViewportY = camera.y.toFixed(2);
      parent.dataset.cameraViewportWidth = camera.width.toFixed(2);
      parent.dataset.cameraViewportHeight = camera.height.toFixed(2);
      parent.dataset.cameraWorldViewX = camera.worldView.x.toFixed(2);
      parent.dataset.cameraWorldViewY = camera.worldView.y.toFixed(2);
      parent.dataset.cameraWorldViewWidth = camera.worldView.width.toFixed(2);
      parent.dataset.cameraWorldViewHeight = camera.worldView.height.toFixed(2);
      if (this.workerSprite) {
        parent.dataset.workerCanvasX = ((this.workerSprite.x - camera.worldView.x) * zoom * this.game.canvas.clientWidth / camera.width).toFixed(2);
        parent.dataset.workerCanvasY = ((this.workerSprite.y - 41 - camera.worldView.y) * zoom * this.game.canvas.clientHeight / camera.height).toFixed(2);
      }
    }
    this.callbacks.onCameraChange?.({ zoom });
  }

  private hitTestSelection(worldX: number, worldY: number): boolean {
    if (this.workerSprite?.getBounds().contains(worldX, worldY)) {
      this.selected = { kind: 'worker' };
      this.callbacks.onSelect?.(this.selected);
      this.updateRoute();
      this.updateSelectionMarker();
      return true;
    }
    for (const [id, building] of this.buildings) {
      if (building.hitArea.contains(worldX, worldY)) {
        this.selected = { kind: 'building', id };
        this.callbacks.onSelect?.(this.selected);
        this.updateRoute();
        this.updateSelectionMarker();
        return true;
      }
    }
    for (const [id, visual] of this.trees) {
      const bounds = visual.tree.visible ? visual.tree.getBounds() : visual.stump.getBounds();
      if (bounds.contains(worldX, worldY)) {
        this.selectEntity({ kind: 'tree', id });
        return true;
      }
    }
    return false;
  }

  private selectEntity(selection: SettlementSelection): void {
    this.selected = selection;
    this.callbacks.onSelect?.(selection);
    this.updateRoute();
    this.updateSelectionMarker();
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
    this.callbacks.onPlacementAnchor?.(anchor);
    this.updatePlacementGhost();
  }

  private updateScene(): void {
    const world = this.world;
    const preview = this.preview;
    if (!world && !preview) return;
    const worker = world?.worker ?? preview?.actors[0];
    if (worker) {
      const position = { x: worker.position.x, y: worker.position.y };
      const nextPixel = this.worldToPixel(position);
      if (!this.workerPosition || !this.workerSprite || !world?.worker.task) {
        this.workerSprite?.setPosition(nextPixel.x, nextPixel.y);
      } else if (this.workerPosition.x !== position.x || this.workerPosition.y !== position.y) {
        this.tweens.killTweensOf(this.workerSprite);
        this.tweens.add({ targets: this.workerSprite, x: nextPixel.x, y: nextPixel.y, duration: 340, ease: 'Linear' });
      }
      this.workerPosition = position;
      this.setWorkerAnimation(world?.worker.visualState ?? preview?.actors[0]?.visualState ?? 'idle', world?.worker.task?.path[world.worker.task.pathIndex]);
      this.workerSprite?.setDepth(10 + position.y / 1000);
    }

    const resourceNodes = world?.trees.map((tree) => ({
      id: tree.id, position: tree.position, state: tree.state, sourceKind: tree.sourceKind
    })) ?? preview?.resourceNodes.map((tree) => ({
      id: tree.visualKey, position: tree.position, state: tree.state, sourceKind: tree.sourceKind
    })) ?? [];
    const activeTreeIds = new Set(resourceNodes.map((tree) => tree.id));
    for (const [id, visual] of this.trees) {
      if (!activeTreeIds.has(id)) {
        visual.tree.destroy();
        visual.stump.destroy();
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
        for (const sprite of [tree, stump]) sprite.on('pointerdown', () => {
          if (this.placementMode) return;
          this.pointerHitEntity = true;
          this.selectEntity({ kind: 'tree', id: node.id });
          this.cameraDragging = false;
        });
        visual = { tree, stump, scale };
        this.trees.set(node.id, visual);
      }
      const point = this.worldToPixel(node.position);
      visual.tree.setPosition(point.x, point.y).setVisible(node.state === 'standing');
      visual.stump.setPosition(point.x, point.y).setVisible(node.state === 'stump');
    }
    if (this.storageSprite && world) {
      this.storageSprite.setPosition(
        world.storage.anchor.x * CELL_SIZE + world.storage.footprint.width * CELL_SIZE / 2,
        SURFACE_Y
      );
    }
    this.updateBuildings(world?.buildings ?? []);
    this.updateDeliveryAnimation(world);
    this.updateRoute();
    this.updateSelectionMarker();
    this.updatePlacementGhost();
    this.emitCameraChange();
  }

  private setWorkerAnimation(state: string, nextStep?: { x: number; y: number }): void {
    const sprite = this.workerSprite;
    if (!sprite) return;
    const movingLeft = nextStep ? nextStep.x < (this.world?.worker.position.x ?? 0) : false;
    sprite.setFlipX(movingLeft);
    let animation = state;
    if (state === 'walking_to_source' || state === 'walking_to_build') animation = 'worker-walk';
    else if (state === 'carrying_to_storage') animation = 'worker-carry-walk';
    else if (state === 'gathering') animation = 'worker-gather';
    else if (state === 'building') animation = 'worker-build';
    else if (state === 'loading') animation = 'worker-load';
    else if (state === 'unloading') animation = 'worker-unload';
    else animation = 'idle';
    if (animation === this.workerAnimation) return;
    this.workerAnimation = animation;
    this.tweens.killTweensOf(sprite);
    if (animation === 'idle' || animation === 'blocked' || animation === 'waiting_path') {
      sprite.stop();
      sprite.setFrame(animation === 'idle' ? 0 : 0);
      this.tweens.add({ targets: sprite, y: SURFACE_Y - 2, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      return;
    }
    sprite.play(animation, true);
  }

  private updateDeliveryAnimation(world?: PeaceWorldSnapshot): void {
    const phase = world?.worker.task?.phase ?? '';
    if (phase === this.lastDeliveryPhase || !this.deliveryLog || !world) return;
    this.lastDeliveryPhase = phase;
    this.tweens.killTweensOf(this.deliveryLog);
    this.deliveryLog.clear();
    if (phase !== 'loading' && phase !== 'unloading') return;
    this.deliveryLog.fillStyle(0x9a7047, 1);
    this.deliveryLog.fillRoundedRect(-18, -6, 36, 12, 5);
    this.deliveryLog.lineStyle(2, 0xe2c99a, 1);
    this.deliveryLog.strokeCircle(-13, 0, 5);
    const worker = this.worldToPixel(world.worker.position);
    const storageX = world.storage.anchor.x * CELL_SIZE + world.storage.footprint.width * CELL_SIZE / 2;
    const task = world.worker.task;
    const source = task?.kind === 'gather-wood'
      ? world.trees.find((tree) => tree.id === task.sourceId)
      : world.trees[0];
    const treeX = this.worldToPixel(source?.position ?? { x: 3, y: 0 }).x;
    if (phase === 'loading') {
      this.deliveryLog.setPosition(treeX, SURFACE_Y - 38);
      this.tweens.add({ targets: this.deliveryLog, x: worker.x + 20, y: worker.y - 82, duration: 360, ease: 'Sine.easeInOut' });
    } else {
      this.deliveryLog.setPosition(worker.x + 20, worker.y - 82);
      this.tweens.add({ targets: this.deliveryLog, x: storageX, y: SURFACE_Y - 10, duration: 360, ease: 'Sine.easeInOut' });
    }
  }

  private updateBuildings(buildings: PeaceWorldSnapshot['buildings']): void {
    const activeIds = new Set(buildings.map((building) => building.id));
    for (const [id, visual] of this.buildings) {
      if (!activeIds.has(id)) {
        visual.sprite.destroy();
        visual.details.destroy();
        visual.progress.destroy();
        this.buildings.delete(id);
      }
    }
    for (const building of buildings) {
      let visual = this.buildings.get(building.id);
      if (!visual) {
        const sprite = this.add.image(0, 0, 'house').setOrigin(0.5, 1).setDisplaySize(142, 120).setDepth(7)
          .setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', () => {
          if (this.placementMode) return;
          this.pointerHitEntity = true;
          this.selectEntity({ kind: 'building', id: building.id });
          this.cameraDragging = false;
        });
        const details = this.add.graphics().setDepth(8);
        const progress = this.add.text(0, 0, '', {
          fontFamily: 'Avenir Next, sans-serif', fontSize: '11px', color: '#263528',
          backgroundColor: '#f7f3e8dd', padding: { x: 5, y: 3 }
        }).setOrigin(0.5, 1).setDepth(18);
        visual = { sprite, details, progress, hitArea: new Phaser.Geom.Rectangle(0, 0, 142, 120) };
        this.buildings.set(building.id, visual);
      }
      const x = building.anchor.x * CELL_SIZE + building.footprint.width * CELL_SIZE / 2;
      visual.sprite.setPosition(x, SURFACE_Y).setAlpha(building.state === 'planned' ? 0.38 : 1);
      visual.sprite.clearTint();
      if (building.state === 'foundation') visual.sprite.setAlpha(0.18);
      if (building.state === 'scaffold') visual.sprite.setAlpha(0.64);
      visual.details.clear();
      if (building.state === 'planned') {
        visual.details.lineStyle(2, 0x7f9d60, 0.95);
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
      visual.progress.setPosition(x, SURFACE_Y - 126)
        .setText(building.state === 'complete'
          ? 'Дом готов'
          : `${building.state === 'planned' ? 'Материалы зарезервированы' : building.state === 'foundation' ? 'Фундамент' : 'Каркас'} · ${building.progressTicks}/${building.progressRequired}`)
        .setVisible(building.state !== 'complete');
      visual.hitArea.setTo(x - 70, SURFACE_Y - 120, 140, 120);
    }
  }

  private updateRoute(): void {
    const graphics = this.routeGraphics;
    graphics?.clear();
    if (!graphics || this.selected?.kind !== 'worker' || !this.world?.worker.task) return;
    const task = this.world.worker.task;
    const points = [this.world.worker.position, ...task.path.slice(task.pathIndex)];
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
    if (this.selected.kind === 'worker' && this.workerSprite) {
      graphics.strokeEllipse(this.workerSprite.x, this.workerSprite.y - 4, 62, 22);
      return;
    }
    if (this.selected.kind === 'building') {
      const visual = this.buildings.get(this.selected.id);
      if (visual) graphics.strokeRect(visual.hitArea.x, visual.hitArea.y, visual.hitArea.width, visual.hitArea.height);
      return;
    }
    if (this.selected.kind === 'tree') {
      const visual = this.trees.get(this.selected.id);
      if (visual) graphics.strokeEllipse(visual.tree.x, visual.tree.y - (visual.tree.visible ? 8 : 3),
        118 * visual.scale, visual.tree.visible ? 18 : 12);
    }
  }

  private updatePlacementGhost(): void {
    const graphics = this.placementGraphics;
    graphics?.clear();
    if (!this.placementMode) {
      this.placementHouse?.setVisible(false);
      return;
    }
    if (!graphics) return;
    const x = this.placementAnchor.x * CELL_SIZE;
    const y = this.placementAnchor.y * CELL_SIZE;
    this.placementHouse?.setPosition(x + CELL_SIZE, SURFACE_Y).setVisible(true)
      .setTint(this.placementFeedback.valid ? 0xc9e5a7 : 0xe6a08c);
    graphics.fillStyle(this.placementFeedback.valid ? 0x88a966 : 0xc26858, 0.27);
    graphics.fillRect(x, y, 2 * CELL_SIZE, CELL_SIZE);
    graphics.lineStyle(3, this.placementFeedback.valid ? 0x537744 : 0xae483d, 0.95);
    graphics.strokeRect(x, y, 2 * CELL_SIZE, CELL_SIZE);
    graphics.lineStyle(2, this.placementFeedback.valid ? 0x66844c : 0xb45e4c, 0.9);
    graphics.lineBetween(x + 5, 0, x + 5, -78);
    graphics.lineBetween(x + 2 * CELL_SIZE - 5, 0, x + 2 * CELL_SIZE - 5, -78);
    graphics.lineBetween(x + 5, -76, x + 2 * CELL_SIZE - 5, -76);
  }

  private worldToPixel(point: { x: number; y: number }): { x: number; y: number } {
    return { x: point.x * CELL_SIZE + CELL_SIZE / 2, y: SURFACE_Y + point.y * CELL_SIZE };
  }
}
