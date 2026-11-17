import Phaser from 'phaser';
import { CameraGestureController } from './camera-gestures.js';
import {
  PLOTS, PROTOTYPE_CONFIG, PrototypeSimulation, WORLD,
  type PrototypeResident, type PrototypeSite
} from './simulation.js';

const ASSET = `${import.meta.env.BASE_URL}assets/peace-v2/`;
export const ART_SCALE = {
  residentScale: 0.54,
  house: { width: 377, height: 377, alpha: { width: 176 / 256, height: 129 / 256 } },
  store: { width: 377, height: 377, alpha: { width: 184 / 256, height: 119 / 256 } },
  tree: { width: 330, height: 330, alpha: { width: 159 / 256, height: 186 / 256 } },
  stone: { width: 190, height: 140, alpha: { width: 1354 / 1536, height: 937 / 1024 } }
} as const;
const ANIMATIONS: Record<string, number[]> = {
  idle: [0],
  gathering: [0, 1, 0, 1],
  walking: [3, 4, 5, 6],
  carrying: [7, 8, 9, 10],
  building: [0, 11, 12, 13, 14, 11]
};

export interface SceneCallbacks {
  onResident: (id: string) => void;
  onPlot: (id: number) => void;
  onObject: (kind: 'wood' | 'stone' | 'store' | 'building' | 'sector' | 'eastern-forest', id?: string) => void;
  isSelected: (id: string) => boolean;
  isPlacing: () => boolean;
  onForestNavigationState: (state: {
    prepared: boolean;
    visible: boolean;
    direction: 'left' | 'right';
  }) => void;
}

interface ResidentSprite {
  sprite: Phaser.GameObjects.Sprite;
  name: Phaser.GameObjects.Text;
  selection: Phaser.GameObjects.Arc;
  cargo: Phaser.GameObjects.Graphics;
  animation: string;
}
interface SiteVisual {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

const CAMERA_ZOOM_MIN = 0.58;
const CAMERA_ZOOM_MAX = 1.35;
const CAMERA_WORLD_TOP = -420;
const RESIDENT_LABEL_ZOOM = 0.60;
const RESIDENT_LABEL_BASELINE = 120;
const SETTLEMENT_X = 963;
const RESIDENT_IDLE_ALPHA = { left: 74, top: 36, right: 118, bottom: 214 } as const;

interface LabelBounds {
  kind: 'resident' | 'building' | 'resource' | 'construction' | 'sector';
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LabelInfo {
  kind: LabelBounds['kind'];
  id: string;
  priority: number;
  anchor: () => { x: number; y: number };
  objectBounds: () => Phaser.Geom.Rectangle;
}

interface WorldBounds {
  id: string;
  kind: 'resident';
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class PrototypeScene extends Phaser.Scene {
  private readonly residentVisuals = new Map<string, ResidentSprite>();
  private readonly siteVisuals = new Map<string, SiteVisual>();
  private readonly clearingStumps = new Map<number, Phaser.GameObjects.Image>();
  private staticLabels: Phaser.GameObjects.Text[] = [];
  private readonly labelInfo = new Map<Phaser.GameObjects.Text, LabelInfo>();
  private staticLayer!: Phaser.GameObjects.Container;
  private siteLayer!: Phaser.GameObjects.Graphics;
  private markerLayer!: Phaser.GameObjects.Graphics;
  private sectorLayer!: Phaser.GameObjects.Graphics;
  private easternForestLabel: Phaser.GameObjects.Text | null = null;
  private callbacks!: SceneCallbacks;
  private lastStructureKey = '';
  private notice!: Phaser.GameObjects.Text;
  private readonly gestures = new CameraGestureController();
  private lastForestNavigationState = '';
  private focusedX = SETTLEMENT_X;
  private cameraCenterY = WORLD.groundY;
  private settlementAnchorMinX: number | null = null;
  private settlementAnchorMaxX: number | null = null;

  constructor(private readonly simulation: PrototypeSimulation, callbacks: SceneCallbacks) {
    super('GameplayPrototype');
    this.callbacks = callbacks;
  }

  preload(): void {
    this.load.image('panorama', `${ASSET}background-panorama.png`);
    this.load.image('geology-atlas', `${ASSET}sideview-geology-atlas.png`);
    this.load.image('turf-tile', `${ASSET}sideview-turf-tile.png`);
    this.load.image('tree', `${ASSET}tree_full.png`);
    this.load.image('stump', `${ASSET}tree_stump.png`);
    this.load.image('stone-outcrop', `${ASSET}stone-outcrop.png`);
    this.load.image('storehouse', `${ASSET}storehouse.png`);
    this.load.image('house', `${ASSET}house.png`);
    this.load.spritesheet('worker', `${ASSET}worker-atlas.png`, { frameWidth: 192, frameHeight: 224 });
  }

  create(): void {
    this.residentVisuals.clear();
    this.siteVisuals.clear();
    this.clearingStumps.clear();
    this.staticLabels = [];
    this.labelInfo.clear();
    this.easternForestLabel = null;
    this.lastStructureKey = '';
    this.gestures.reset();
    this.lastForestNavigationState = '';
    this.game.canvas.dataset.projection = 'side-view';
    this.game.canvas.dataset.terrain = 'layered-cross-section';
    this.game.canvas.dataset.residentVisibleHeight = (178 * ART_SCALE.residentScale).toFixed(1);
    this.game.canvas.dataset.houseVisibleHeight = (ART_SCALE.house.height * ART_SCALE.house.alpha.height).toFixed(1);
    this.game.canvas.dataset.storeVisibleHeight = (ART_SCALE.store.height * ART_SCALE.store.alpha.height).toFixed(1);
    this.game.canvas.dataset.treeVisibleHeight = (ART_SCALE.tree.height * ART_SCALE.tree.alpha.height).toFixed(1);
    for (const [key, frames] of Object.entries(ANIMATIONS)) {
      if (!this.anims.exists(key)) {
        this.anims.create({
          key, frames: frames.map((frame) => ({ key: 'worker', frame })),
          frameRate: key === 'idle' ? 1 : 7, repeat: -1
        });
      }
    }
    const geology = this.textures.get('geology-atlas');
    geology.add('topsoil', 0, 0, 0, 256, 256);
    geology.add('clay', 0, 256, 0, 256, 256);
    geology.add('strata', 0, 512, 0, 256, 256);
    geology.add('bedrock', 0, 768, 0, 256, 256);
    // Extend the existing panorama upward while preserving its authored 4:1
    // aspect ratio; this avoids an empty canvas strip at the raised camera.
    const panoramaWidth = 1960 * 2.08;
    const panoramaHeight = 1960 * 0.52;
    for (let centerX = 1960 / 2; centerX - panoramaWidth / 2 < WORLD.width; centerX += panoramaWidth) {
      this.add.image(centerX, WORLD.groundY - panoramaHeight / 2, 'panorama')
        .setDisplaySize(panoramaWidth, panoramaHeight).setDepth(-30).setScrollFactor(1, 1);
    }
    const turf = this.add.tileSprite(WORLD.width / 2, WORLD.groundY - 1, WORLD.width, 44, 'turf-tile')
      .setDepth(-10);
    turf.setTileScale(1, 1);
    const topsoil = this.add.tileSprite(WORLD.width / 2, WORLD.groundY + 95, WORLD.width, 190, 'geology-atlas', 'topsoil')
      .setDepth(-11);
    const clay = this.add.tileSprite(WORLD.width / 2, WORLD.groundY + 315, WORLD.width, 250, 'geology-atlas', 'clay')
      .setDepth(-12);
    const strata = this.add.tileSprite(WORLD.width / 2, WORLD.groundY + 600, WORLD.width, 320, 'geology-atlas', 'strata')
      .setDepth(-13);
    const bedrock = this.add.tileSprite(WORLD.width / 2, WORLD.groundY + 950, WORLD.width, 400, 'geology-atlas', 'bedrock')
      .setDepth(-14);
    topsoil.setTileScale(0.8, 0.8);
    clay.setTileScale(0.9, 0.9);
    strata.setTileScale(1, 1);
    bedrock.setTileScale(1.05, 1.05);
    this.staticLayer = this.add.container(0, 0).setDepth(35);
    this.siteLayer = this.add.graphics().setDepth(40);
    this.markerLayer = this.add.graphics().setDepth(44);
    this.sectorLayer = this.add.graphics().setDepth(42);
    this.notice = this.add.text(WORLD.width / 2, 32, ' ', {
      fontFamily: 'DM Sans, sans-serif', fontSize: '14px', color: '#35543d', backgroundColor: '#f8f7e9dd',
      padding: { x: 11, y: 7 }
    }).setOrigin(0.5, 0).setDepth(100).setAlpha(0);

    this.drawStaticWorld();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.pointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.pointerMove(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer));
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer));
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.resizeWorld(size.width, size.height));
    this.resizeWorld(this.scale.width, this.scale.height);
  }

  update(): void {
    this.syncStructure();
    this.drawPlots();
    for (const person of this.simulation.world.residents) this.syncResident(person);
    this.drawSites();
    this.drawSectorStatus();
    this.syncClearingStumps();
    this.syncEasternForestLabel();
    this.layoutSceneLabels();
    this.publishForestNavigationState();
    this.publishSceneGeometry();
  }

  private resizeWorld(width: number, height: number): void {
    const camera = this.cameras.main;
    const zoom = this.settlementZoom(width, height);
    const centerX = this.settlementCameraCenterX(width, height);
    camera.setZoom(zoom);
    this.cameraCenterY = this.settlementCameraCenterY(width, height, zoom);
    camera.centerOn(centerX, this.cameraCenterY);
    this.focusedX = centerX;
    this.clampCameraX();
  }

  focusSettlement(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const zoom = this.settlementZoom(width, height);
    const centerX = this.settlementCameraCenterX(width, height);
    this.cameras.main.setZoom(zoom);
    this.cameraCenterY = this.settlementCameraCenterY(width, height, zoom);
    this.focusedX = centerX;
    this.cameras.main.centerOn(centerX, this.cameraCenterY);
    this.clampCameraX();
  }

  private settlementZoom(width: number, height: number): number {
    return Phaser.Math.Clamp(
      width > height ? Math.min(width / 620, height / 540) : width / 620,
      CAMERA_ZOOM_MIN,
      1.05
    );
  }

  private settlementCameraCenterX(width: number, height: number): number {
    if (width <= height || width < 750) return this.settlementFocusX();
    const horizontalBias = width < 900 ? 220 : 150;
    return this.settlementFocusX() - horizontalBias;
  }

  private settlementGroundRatio(width: number, height: number): number {
    if (width > height && width < 900) return 0.62;
    if (width < 600) return 0.68;
    return 0.64;
  }

  private settlementCameraCenterY(width: number, height: number, zoom: number): number {
    const groundScreenY = height * this.settlementGroundRatio(width, height);
    return WORLD.groundY - (groundScreenY - height / 2) / zoom;
  }

  private settlementFocusX(): number {
    if (this.settlementAnchorMinX === null || this.settlementAnchorMaxX === null) {
      const initialPositions = [
        ...this.simulation.world.stores.map((store) => store.x),
        ...this.simulation.world.buildings.map((building) => building.x),
        ...this.simulation.world.residents.map((person) => person.x),
        PLOTS[1].x
      ];
      this.settlementAnchorMinX = initialPositions.length === 0
        ? SETTLEMENT_X
        : Math.min(...initialPositions);
      this.settlementAnchorMaxX = initialPositions.length === 0
        ? SETTLEMENT_X
        : Math.max(...initialPositions);
    }
    const xPositions = [
      this.settlementAnchorMinX,
      this.settlementAnchorMaxX,
      ...this.simulation.world.stores.map((store) => store.x),
      ...this.simulation.world.buildings.map((building) => building.x)
    ];
    return (Math.min(...xPositions) + Math.max(...xPositions)) / 2;
  }

  focusResident(residentId: string): void {
    const resident = this.simulation.world.residents.find((person) => person.id === residentId);
    if (!resident) return;
    this.cameraCenterY = this.residentCameraCenterY(false);
    this.focusOn(resident.x);
  }

  focusEasternForest(): void {
    this.focusOn(PROTOTYPE_CONFIG.easternSector.forestX);
  }

  setResidentSheetExpanded(expanded: boolean): void {
    if (expanded) {
      this.cameraCenterY = this.residentCameraCenterY(true);
      this.focusOn(this.focusedX);
    }
    // Keep the focused view when the sheet collapses/closes to avoid a jump.
  }

  private residentCameraCenterY(expanded: boolean): number {
    const groundRatio = expanded ? 0.47 : 0.56;
    const height = this.scale.height;
    return WORLD.groundY - (height * groundRatio - height / 2) / this.cameras.main.zoom;
  }

  private focusOn(x: number): void {
    this.focusedX = Phaser.Math.Clamp(x, 0, WORLD.width);
    this.cameras.main.centerOn(this.focusedX, this.cameraCenterY);
    this.clampCameraX();
  }

  private clampCameraX(): void {
    const camera = this.cameras.main;
    const visibleWidth = camera.width / camera.zoom;
    const minX = (visibleWidth - camera.width) / 2;
    const maxX = WORLD.width - (visibleWidth + camera.width) / 2;
    camera.scrollX = maxX < minX
      ? (WORLD.width - camera.width) / 2
      : Phaser.Math.Clamp(camera.scrollX, minX, maxX);
    camera.midPoint.x = camera.scrollX + camera.width / 2;
    this.game.canvas.dataset.cameraZoom = camera.zoom.toFixed(3);
    this.game.canvas.dataset.cameraX = camera.scrollX.toFixed(1);
    this.clampCameraY();
  }

  private clampCameraY(): void {
    const camera = this.cameras.main;
    const visibleWidth = camera.width / camera.zoom;
    const visibleHeight = camera.height / camera.zoom;
    const minY = CAMERA_WORLD_TOP + (visibleHeight - camera.height) / 2;
    const maxY = Math.max(minY, WORLD.height - (visibleHeight + camera.height) / 2);
    camera.scrollY = Phaser.Math.Clamp(camera.scrollY, minY, maxY);
    camera.midPoint.y = camera.scrollY + camera.height / 2;
    this.cameraCenterY = camera.midPoint.y;
    this.game.canvas.dataset.cameraY = camera.scrollY.toFixed(1);
    const groundScreenRatio = 0.5 +
      (WORLD.groundY - camera.midPoint.y) * camera.zoom / camera.height;
    this.game.canvas.dataset.groundScreenRatio = groundScreenRatio.toFixed(4);
    this.game.canvas.dataset.worldView = JSON.stringify({
      x: camera.midPoint.x - visibleWidth / 2,
      y: camera.midPoint.y - visibleHeight / 2,
      width: camera.width / camera.zoom,
      height: camera.height / camera.zoom
    });
    this.game.canvas.dataset.worldBounds = JSON.stringify({
      left: 0, top: CAMERA_WORLD_TOP, right: WORLD.width, bottom: WORLD.height
    });
  }

  private labelRect(label: Phaser.GameObjects.Text): Phaser.Geom.Rectangle {
    return label.getBounds();
  }

  private intersectsWithMargin(a: Phaser.Geom.Rectangle, b: Phaser.Geom.Rectangle, margin = 6): boolean {
    return a.x < b.right + margin && a.right + margin > b.x &&
      a.y < b.bottom + margin && a.bottom + margin > b.y;
  }

  private registerLabel(label: Phaser.GameObjects.Text, info: LabelInfo, isStatic = false): void {
    this.labelInfo.set(label, info);
    if (isStatic) this.staticLabels.push(label);
  }

  private visibleArtBounds(
    centerX: number,
    groundY: number,
    art: { width: number; height: number; alpha: { width: number; height: number } }
  ): Phaser.Geom.Rectangle {
    const width = art.width * art.alpha.width;
    const height = art.height * art.alpha.height;
    return new Phaser.Geom.Rectangle(centerX - width / 2, groundY - height, width, height);
  }

  private screenRect(rectangle: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle {
    const camera = this.cameras.main;
    const zoom = camera.zoom;
    return new Phaser.Geom.Rectangle(
      camera.x + camera.width / 2 + (rectangle.x - camera.midPoint.x) * zoom,
      camera.y + camera.height / 2 + (rectangle.y - camera.midPoint.y) * zoom,
      rectangle.width * zoom,
      rectangle.height * zoom
    );
  }

  private screenObstructions(): Phaser.Geom.Rectangle[] {
    const canvasBounds = this.game.canvas.getBoundingClientRect();
    const camera = this.cameras.main;
    const scaleX = camera.width / Math.max(1, canvasBounds.width);
    const scaleY = camera.height / Math.max(1, canvasBounds.height);
    const obstructions: Phaser.Geom.Rectangle[] = [];
    const selectors = [
      '.hud-top',
      '.action-dock',
      '#control-panel',
      '.toast.visible',
      '.pwa-banner:not([hidden])',
      '#forest-wayfinder:not([hidden])'
    ];
    for (const selector of selectors) {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || getComputedStyle(element).display === 'none') continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) continue;
      obstructions.push(new Phaser.Geom.Rectangle(
        (bounds.left - canvasBounds.left) * scaleX,
        (bounds.top - canvasBounds.top) * scaleY,
        bounds.width * scaleX,
        bounds.height * scaleY
      ));
    }
    if (this.notice.alpha > 0) obstructions.push(this.screenRect(this.labelRect(this.notice)));
    return obstructions;
  }

  private layoutSceneLabels(): void {
    const camera = this.cameras.main;
    const zoom = camera.zoom;
    const lowZoom = zoom < RESIDENT_LABEL_ZOOM;
    const viewport = new Phaser.Geom.Rectangle(camera.x + 8, camera.y + 8, camera.width - 16, camera.height - 16);
    const obstructions = this.screenObstructions();
    const candidates = [...this.labelInfo.entries()]
      .map(([label, info]) => ({
        label,
        info,
        selected: info.kind === 'resident' && this.callbacks.isSelected(info.id),
        objectBounds: this.screenRect(info.objectBounds()),
        anchor: info.anchor()
      }))
      .sort((a, b) => {
        const priorityA = a.selected ? 100 : a.info.priority;
        const priorityB = b.selected ? 100 : b.info.priority;
        return priorityB - priorityA;
      });
    const occupied: Phaser.Geom.Rectangle[] = [];
    const screenLanes = [0, 22, 44, 66, 88, 110, 132, 154, 176];

    for (const candidate of candidates) {
      const { label, selected, objectBounds, anchor } = candidate;
      label.setVisible(false);
      if ((lowZoom && !selected) ||
          objectBounds.right <= viewport.x || objectBounds.x >= viewport.right ||
          objectBounds.bottom <= viewport.y || objectBounds.y >= viewport.bottom) continue;

      let placed = false;
      for (const lane of screenLanes) {
        label.setPosition(anchor.x, anchor.y - lane / zoom);
        const bounds = this.screenRect(this.labelRect(label));
        if (bounds.x < viewport.x || bounds.right > viewport.right ||
            bounds.y < viewport.y || bounds.bottom > viewport.bottom) continue;
        if (obstructions.some((other) => this.intersectsWithMargin(bounds, other, 3)) ||
            occupied.some((other) => this.intersectsWithMargin(bounds, other, 5))) continue;
        label.setVisible(true);
        occupied.push(bounds);
        placed = true;
        break;
      }
      if (!placed) label.setVisible(false);
    }
  }

  private publishForestNavigationState(): void {
    const forestX = PROTOTYPE_CONFIG.easternSector.forestX;
    const forestBounds = this.screenRect(this.visibleArtBounds(
      forestX, WORLD.groundY + 5, ART_SCALE.tree
    ));
    const camera = this.cameras.main;
    const viewport = new Phaser.Geom.Rectangle(camera.x, camera.y, camera.width, camera.height);
    const visibleWidth = Math.max(0, Math.min(forestBounds.right, viewport.right) - Math.max(forestBounds.x, viewport.x));
    const visibleHeight = Math.max(0, Math.min(forestBounds.bottom, viewport.bottom) - Math.max(forestBounds.y, viewport.y));
    const visible = forestBounds.width > 0 && forestBounds.height > 0 &&
      visibleWidth * visibleHeight >= forestBounds.width * forestBounds.height * 0.55;
    const state = {
      prepared: this.simulation.world.easternSector.state === 'prepared',
      visible,
      direction: camera.midPoint.x <= forestX ? 'right' as const : 'left' as const
    };
    const key = JSON.stringify(state);
    if (key === this.lastForestNavigationState) return;
    this.lastForestNavigationState = key;
    this.callbacks.onForestNavigationState(state);
  }

  private publishSceneGeometry(): void {
    const firstStore = this.simulation.world.stores[0];
    const warehouseBounds = firstStore ? {
      left: firstStore.x - ART_SCALE.store.width / 2 + ART_SCALE.store.width * 31 / 256,
      right: firstStore.x - ART_SCALE.store.width / 2 + ART_SCALE.store.width * 215 / 256,
      top: WORLD.groundY + 5 - ART_SCALE.store.height + ART_SCALE.store.height * 104 / 256,
      bottom: WORLD.groundY + 5 - ART_SCALE.store.height + ART_SCALE.store.height * 223 / 256
    } : null;
    const residents: WorldBounds[] = this.simulation.world.residents.map((person) => ({
      id: person.id,
      kind: 'resident',
      left: person.x - 192 * ART_SCALE.residentScale / 2 + RESIDENT_IDLE_ALPHA.left * ART_SCALE.residentScale,
      right: person.x - 192 * ART_SCALE.residentScale / 2 + RESIDENT_IDLE_ALPHA.right * ART_SCALE.residentScale,
      top: person.y - 224 * ART_SCALE.residentScale + RESIDENT_IDLE_ALPHA.top * ART_SCALE.residentScale,
      bottom: person.y - 224 * ART_SCALE.residentScale + RESIDENT_IDLE_ALPHA.bottom * ART_SCALE.residentScale
    }));
    const visibleLabels: LabelBounds[] = [...this.labelInfo.entries()]
      .filter(([label]) => label.visible)
      .map(([label, info]) => {
      const bounds = this.labelRect(label);
      return {
        kind: info.kind,
        id: info.id,
        text: label.text,
        x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height
      };
    });
    this.game.canvas.dataset.labelBounds = JSON.stringify(visibleLabels);
    this.game.canvas.dataset.labelScreenBounds = JSON.stringify(
      [...this.labelInfo.entries()]
        .filter(([label]) => label.visible)
        .map(([label, info]) => {
          const bounds = this.screenRect(this.labelRect(label));
          return {
            kind: info.kind, id: info.id, text: label.text,
            x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height
          };
        })
    );
    this.game.canvas.dataset.objectBounds = JSON.stringify({
      groundY: WORLD.groundY,
      warehouse: warehouseBounds ? { id: firstStore?.id ?? 'warehouse', ...warehouseBounds } : null,
      residents
    });
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    this.gestures.pointerDown(pointer, this.cameras.main.zoom);
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gestures.pointerMove(pointer, this.cameras.main.zoom);
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      const nextZoom = Phaser.Math.Clamp(
        gesture.startZoom * gesture.distance / Math.max(1, gesture.startDistance),
        CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX
      );
      this.cameraCenterY = this.cameras.main.midPoint.y;
      this.cameras.main.setZoom(nextZoom);
      this.focusOn(this.focusedX);
      return;
    }
    if (gesture.kind !== 'pan') return;

    this.cameras.main.scrollX -= gesture.dx / this.cameras.main.zoom;
    // Move the world with the finger: dragging up reveals deeper layers.
    this.cameras.main.scrollY -= gesture.dy / this.cameras.main.zoom;
    this.clampCameraX();
    this.clampCameraY();
    this.focusedX = this.cameras.main.midPoint.x;
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gestures.pointerUp(pointer);
    if (gesture?.kind === 'tap') {
      const worldPoint = this.cameras.main.getWorldPoint(gesture.x, gesture.y);
      this.handlePointer(worldPoint.x, worldPoint.y);
    }
  }

  private drawStaticWorld(): void {
    const tree = this.add.image(234, WORLD.groundY + 5, 'tree').setOrigin(0.5, 1)
      .setDisplaySize(ART_SCALE.tree.width, ART_SCALE.tree.height).setDepth(30);
    const stone = this.add.image(1900, WORLD.groundY + 5, 'stone-outcrop').setOrigin(0.5, 1)
      .setDisplaySize(ART_SCALE.stone.width, ART_SCALE.stone.height).setDepth(30);
    const treeName = this.add.text(234, WORLD.groundY - 250, 'Лесной участок', { ...this.labelStyle(), fontSize: '14px', color: '#3d5d37' }).setOrigin(0.5).setDepth(70);
    const stoneName = this.add.text(1900, WORLD.groundY - 155, 'Каменный выход', { ...this.labelStyle(), fontSize: '14px', color: '#4d6263' }).setOrigin(0.5).setDepth(70);
    const sector = this.simulation.world.easternSector;
    const config = PROTOTYPE_CONFIG.easternSector;
    const closed = sector.state === 'closed';
    const eastTrees = [2980, 3200, 3420].map((x) =>
      this.add.image(x, WORLD.groundY + 5, 'tree').setOrigin(0.5, 1)
        .setDisplaySize(ART_SCALE.tree.width, ART_SCALE.tree.height)
        .setAlpha(sector.state === 'prepared' ? 1 : closed ? 0.5 : 0.72)
        .setTint(sector.state === 'prepared' ? 0xffffff : 0xb8c0ad)
        .setDepth(30)
    );
    const boundary = this.add.graphics().setDepth(32);
    boundary.fillStyle(0x71583d, 0.95);
    boundary.fillRoundedRect(config.boundaryX - 7, WORLD.groundY - 116, 14, 116, 4);
    boundary.fillRoundedRect(config.boundaryX + 132, WORLD.groundY - 100, 12, 100, 4);
    boundary.lineStyle(5, closed ? 0x8a6942 : 0x94774e, 0.95);
    if (closed) {
      boundary.lineBetween(config.boundaryX, WORLD.groundY - 34, config.boundaryX + 136, WORLD.groundY - 34);
    } else {
      boundary.lineBetween(config.boundaryX - 2, WORLD.groundY - 30, config.boundaryX + 72, WORLD.groundY - 10);
    }
    boundary.lineStyle(2, 0xc5a574, 0.9);
    boundary.lineBetween(config.boundaryX - 2, WORLD.groundY - 48, config.boundaryX + (closed ? 136 : 74), WORLD.groundY - 48);
    boundary.fillStyle(0x6f563b, 0.96);
    boundary.fillRoundedRect(config.boundaryX - 60, WORLD.groundY - 174, 250, 37, 7);
    boundary.lineStyle(2, 0xc6a677, 0.9);
    boundary.strokeRoundedRect(config.boundaryX - 60, WORLD.groundY - 174, 250, 37, 7);
    const sectorName = this.add.text(
      config.boundaryX + 65,
      WORLD.groundY - 155,
      closed ? 'Восточная опушка · закрыто'
        : sector.state === 'prepared' ? 'Новая лесная площадка' : 'Восточная опушка · открыта',
      { fontFamily: 'DM Sans, sans-serif', fontSize: '13px', color: '#fff4d9', fontStyle: 'bold' }
    ).setOrigin(0.5).setDepth(70);
    this.easternForestLabel = this.add.text(
      config.forestX,
      WORLD.groundY - 260,
      '',
      { ...this.labelStyle(), fontSize: '14px', color: '#3d5d37' }
    ).setOrigin(0.5).setDepth(70);
    this.syncEasternForestLabel();
    const staticObjects: Phaser.GameObjects.GameObject[] = [
      tree, stone, treeName, stoneName, ...eastTrees, boundary, sectorName, this.easternForestLabel
    ];
    this.staticLayer.add(staticObjects);
    this.registerLabel(treeName, {
      kind: 'resource',
      id: 'wood:home',
      priority: 60,
      anchor: () => ({ x: 234, y: WORLD.groundY - 250 }),
      objectBounds: () => this.visibleArtBounds(234, WORLD.groundY + 5, ART_SCALE.tree)
    }, true);
    this.registerLabel(stoneName, {
      kind: 'resource',
      id: 'stone:outcrop',
      priority: 60,
      anchor: () => ({ x: 1900, y: WORLD.groundY - 155 }),
      objectBounds: () => this.visibleArtBounds(1900, WORLD.groundY + 5, ART_SCALE.stone)
    }, true);
    this.registerLabel(sectorName, {
      kind: 'sector',
      id: 'eastern',
      priority: 55,
      anchor: () => ({ x: config.boundaryX + 65, y: WORLD.groundY - 155 }),
      objectBounds: () => new Phaser.Geom.Rectangle(
        config.boundaryX - 60, WORLD.groundY - 174, 250, 37
      )
    }, true);
    this.registerLabel(this.easternForestLabel, {
      kind: 'resource',
      id: 'wood:eastern',
      priority: 65,
      anchor: () => ({ x: config.forestX, y: WORLD.groundY - 260 }),
      objectBounds: () => this.visibleArtBounds(config.forestX, WORLD.groundY + 5, ART_SCALE.tree)
    }, true);
  }

  private syncEasternForestLabel(): void {
    if (!this.easternForestLabel) return;
    const sector = this.simulation.world.easternSector;
    const config = PROTOTYPE_CONFIG.easternSector;
    const label = sector.state === 'prepared'
      ? `Лес Восточной опушки · ${sector.woodStock}/${config.forestCapacity}`
      : sector.state === 'closed' ? 'Лес за закрытой границей' : 'Лес ждёт расчистки';
    if (this.easternForestLabel.text !== label) this.easternForestLabel.setText(label);
  }

  private drawSectorStatus(): void {
    const sector = this.simulation.world.easternSector;
    this.sectorLayer.clear();
    if (sector.state !== 'clearing') return;
    const x = PROTOTYPE_CONFIG.easternSector.clearingX;
    const y = WORLD.groundY - 155;
    const width = 214;
    this.sectorLayer.fillStyle(0x283a2d, 0.72);
    this.sectorLayer.fillRoundedRect(x - width / 2, y - 11, width, 22, 6);
    this.sectorLayer.fillStyle(0xc5a56b, 0.95);
    this.sectorLayer.fillRoundedRect(x - width / 2 + 5, y - 6, (width - 10) * sector.clearingProgress, 12, 4);
    this.sectorLayer.lineStyle(2, 0xe7d2a0, 0.9);
    this.sectorLayer.strokeRoundedRect(x - width / 2, y - 11, width, 22, 6);
  }

  private syncClearingStumps(): void {
    const sector = this.simulation.world.easternSector;
    const visibleCount = sector.state === 'prepared'
      ? 3
      : sector.state === 'clearing' ? Math.floor(sector.clearingProgress * 3) : 0;
    const positions = [2120, 2200, 2280];
    while (this.clearingStumps.size < visibleCount) {
      const index = this.clearingStumps.size;
      const stump = this.add.image(positions[index]!, WORLD.groundY + 3, 'stump')
        .setOrigin(0.5, 1).setDisplaySize(95, 95).setDepth(31);
      this.clearingStumps.set(index, stump);
    }
    while (this.clearingStumps.size > visibleCount) {
      const index = this.clearingStumps.size - 1;
      this.clearingStumps.get(index)?.destroy();
      this.clearingStumps.delete(index);
    }
  }

  private syncStructure(): void {
    const key = JSON.stringify({
      stores: this.simulation.world.stores.map(({ id, x }) => [id, x]),
      buildings: this.simulation.world.buildings.map(({ id, kind, x }) => [id, kind, x]),
      easternSector: this.simulation.world.easternSector.state
    });
    if (key === this.lastStructureKey) return;
    this.lastStructureKey = key;
    this.staticLayer.removeAll(true);
    for (const label of this.staticLabels) this.labelInfo.delete(label);
    this.staticLabels = [];
    this.easternForestLabel = null;
    this.drawStaticWorld();
    for (const store of this.simulation.world.stores) {
      const sprite = this.add.image(store.x, WORLD.groundY + 5, 'storehouse').setOrigin(0.5, 1)
        .setDisplaySize(ART_SCALE.store.width, ART_SCALE.store.height).setDepth(35);
      const label = this.add.text(store.x, WORLD.groundY - 238, 'Склад', {
        ...this.labelStyle(), color: '#52676a', fontSize: '14px'
      }).setOrigin(0.5).setDepth(70);
      this.staticLayer.add([sprite, label]);
      this.registerLabel(label, {
        kind: 'building',
        id: store.id,
        priority: 55,
        anchor: () => ({ x: store.x, y: WORLD.groundY - 238 }),
        objectBounds: () => this.visibleArtBounds(store.x, WORLD.groundY + 5, ART_SCALE.store)
      }, true);
    }
    for (const building of this.simulation.world.buildings.filter((candidate) => candidate.kind === 'house')) {
      const sprite = this.add.image(building.x, WORLD.groundY, building.kind === 'house' ? 'house' : 'storehouse')
        .setOrigin(0.5, 1).setDisplaySize(
          building.kind === 'house' ? ART_SCALE.house.width : ART_SCALE.store.width,
          building.kind === 'house' ? ART_SCALE.house.height : ART_SCALE.store.height
        ).setDepth(35);
      const label = this.add.text(building.x, WORLD.groundY - 238,
        building.kind === 'house' ? 'Дом' : 'Склад', { ...this.labelStyle(), color: '#465a46' }).setOrigin(0.5).setDepth(70);
      this.staticLayer.add([sprite, label]);
      this.registerLabel(label, {
        kind: 'building',
        id: building.id,
        priority: 55,
        anchor: () => ({ x: building.x, y: WORLD.groundY - 238 }),
        objectBounds: () => this.visibleArtBounds(building.x, WORLD.groundY + 5, building.kind === 'house'
          ? ART_SCALE.house : ART_SCALE.store)
      }, true);
    }
  }

  private drawPlots(): void {
    this.markerLayer.clear();
    if (!this.callbacks.isPlacing()) return;
    for (const plot of PLOTS) {
      if (!this.simulation.isPlotAvailable(plot.id)) continue;
      this.markerLayer.lineStyle(2, 0xf7f5ce, 0.9);
      this.markerLayer.fillStyle(0xedf1cf, 0.26);
      this.markerLayer.fillRoundedRect(plot.x - 45, plot.y - 53, 90, 52, 10);
      this.markerLayer.strokeRoundedRect(plot.x - 45, plot.y - 53, 90, 52, 10);
      this.markerLayer.fillStyle(0xf9f7dc, 0.96);
      this.markerLayer.fillCircle(plot.x, plot.y - 28, 11);
      this.markerLayer.fillStyle(0x52734d, 1);
      this.markerLayer.fillCircle(plot.x, plot.y - 28, 4);
    }
  }

  private drawSites(): void {
    this.siteLayer.clear();
    const active = new Set(this.simulation.world.sites.map((site) => site.id));
    for (const [id, visual] of this.siteVisuals) {
      if (!active.has(id)) {
        visual.sprite.destroy();
        this.labelInfo.delete(visual.label);
        visual.label.destroy();
        this.siteVisuals.delete(id);
      }
    }
    for (const site of this.simulation.world.sites) this.drawSite(site);
  }

  private drawSite(site: PrototypeSite): void {
    const stage = site.stage;
    let visual = this.siteVisuals.get(site.id);
    if (!visual) {
      const sprite = this.add.image(site.x, site.y, site.kind === 'house' ? 'house' : 'storehouse')
        .setOrigin(0.5, 1).setDisplaySize(
          site.kind === 'house' ? ART_SCALE.house.width : ART_SCALE.store.width,
          site.kind === 'house' ? ART_SCALE.house.height : ART_SCALE.store.height
        )
        .setDepth(40).setVisible(false);
      const label = this.add.text(site.x, site.y - 119, site.kind === 'house' ? 'Дом' : 'Склад', {
        ...this.labelStyle(), fontSize: '13px', color: '#3b4e3f'
      }).setOrigin(0.5).setDepth(65);
      visual = { sprite, label };
      this.siteVisuals.set(site.id, visual);
      this.registerLabel(label, {
        kind: 'construction',
        id: site.id,
        priority: 75,
        anchor: () => ({ x: site.x, y: site.y - 298 }),
        objectBounds: () => new Phaser.Geom.Rectangle(site.x - 146, site.y - 275, 292, 275)
      });
    }
    visual.sprite.setVisible(stage >= 2).setAlpha(0.55 + site.progress * 0.35);
    if (stage >= 2) visual.sprite.setDepth(40);
    this.siteLayer.fillStyle(0x84653f, 0.48);
     this.siteLayer.fillRoundedRect(site.x - 146, site.y - 14, 292, 13, 4);
    this.siteLayer.fillStyle(0xba8a52, 0.8);
     this.siteLayer.fillRoundedRect(site.x - 136, site.y - 19, 272, 6, 2);
     this.siteLayer.fillRoundedRect(site.x - 136, site.y - 13, 8, 10, 2);
     this.siteLayer.fillRoundedRect(site.x + 128, site.y - 13, 8, 10, 2);
     this.siteLayer.lineStyle(3, stage >= 1 ? 0x95633b : 0xb1844f, 1);
    this.siteLayer.fillStyle(0xe0c993, 0.2);
     this.siteLayer.fillRect(site.x - 128, site.y - 150, 256, 132);
     this.siteLayer.strokeRect(site.x - 128, site.y - 150, 256, 132);
    if (stage >= 1) {
       this.siteLayer.lineBetween(site.x - 128, site.y - 18, site.x - 128, site.y - 250);
       this.siteLayer.lineBetween(site.x + 128, site.y - 18, site.x + 128, site.y - 250);
       this.siteLayer.lineBetween(site.x - 128, site.y - 250, site.x + 128, site.y - 250);
       this.siteLayer.lineBetween(site.x - 128, site.y - 130, site.x + 128, site.y - 250);
       this.siteLayer.lineBetween(site.x + 128, site.y - 130, site.x - 128, site.y - 250);
    }
    this.siteLayer.fillStyle(0x304338, 0.65);
     this.siteLayer.fillRoundedRect(site.x - 128, site.y - 275, 256, 18, 5);
    this.siteLayer.fillStyle(0xf4d988, 0.95);
     this.siteLayer.fillRoundedRect(site.x - 124, site.y - 272, 248 * site.progress, 12, 4);
    const labelText = `${site.kind === 'house' ? 'Дом' : 'Склад'} · ${Math.round(site.progress * 100)}%`;
    if (visual.label.text !== labelText) visual.label.setText(labelText);
    visual.label.setPosition(site.x, site.y - 298);
  }

  private syncResident(person: PrototypeResident): void {
    let view = this.residentVisuals.get(person.id);
    if (!view) {
      const sprite = this.add.sprite(person.x, person.y, 'worker', 0).setOrigin(0.5, 1).setScale(ART_SCALE.residentScale);
      const tint = person.id === 'r2' ? 0xd6b28c : person.id === 'r3' ? 0x8da57b : 0xc28d60;
      sprite.setTint(tint).setDepth(50);
      const name = this.add.text(person.x, person.y - RESIDENT_LABEL_BASELINE, person.name, {
        fontFamily: 'DM Sans, sans-serif', fontSize: '16px', color: '#344539',
        backgroundColor: '#f8f8eddd', padding: { x: 5, y: 3 }
      }).setOrigin(0.5, 1).setDepth(75);
      this.registerLabel(name, {
        kind: 'resident',
        id: person.id,
        priority: 45,
        anchor: () => ({ x: person.x, y: person.y - RESIDENT_LABEL_BASELINE }),
        objectBounds: () => new Phaser.Geom.Rectangle(
          person.x - 192 * ART_SCALE.residentScale / 2 + RESIDENT_IDLE_ALPHA.left * ART_SCALE.residentScale,
          person.y - 224 * ART_SCALE.residentScale + RESIDENT_IDLE_ALPHA.top * ART_SCALE.residentScale,
          (RESIDENT_IDLE_ALPHA.right - RESIDENT_IDLE_ALPHA.left) * ART_SCALE.residentScale,
          (RESIDENT_IDLE_ALPHA.bottom - RESIDENT_IDLE_ALPHA.top) * ART_SCALE.residentScale
        )
      });
      const selection = this.add.circle(person.x, person.y - 5, 24, 0x85bc7a, 0.13)
        .setStrokeStyle(2, 0x49805d, 0.9).setDepth(45);
      const cargo = this.add.graphics().setDepth(60);
      view = { sprite, name, selection, cargo, animation: '' };
      this.residentVisuals.set(person.id, view);
    }
    view.sprite.setPosition(person.x, person.y);
    if (view.name.text !== person.name) view.name.setText(person.name);
    view.selection.setPosition(person.x, person.y - 30).setVisible(this.callbacks.isSelected(person.id));
    view.cargo.clear();
    if (person.cargo) {
      view.cargo.fillStyle(person.cargo === 'wood' ? 0x8d552d : 0x87959a, 1);
      if (person.cargo === 'wood') {
        view.cargo.fillRoundedRect(person.x - 14, person.y - 83, 27, 7, 3);
        view.cargo.lineStyle(2, 0xc8945e, 1).lineBetween(person.x - 9, person.y - 86, person.x + 10, person.y - 86);
      } else {
        view.cargo.fillCircle(person.x, person.y - 86, 7);
        view.cargo.fillStyle(0xb8c1c1, 1).fillCircle(person.x - 3, person.y - 89, 3);
      }
    }
    const nextAnimation = person.mode === 'moving' ? 'walking'
      : person.mode === 'carrying' ? 'carrying'
        : person.mode === 'working' ? 'gathering'
          : person.mode === 'building' ? 'building' : 'idle';
    if (nextAnimation !== view.animation) {
      view.sprite.play(nextAnimation);
      view.animation = nextAnimation;
    }
    view.sprite.setFlipX(person.targetX !== null && person.targetX < person.x);
  }

  private handlePointer(x: number, y: number): void {
    // In placement mode an overlapping resident must not steal a tap intended
    // for a marked plot; otherwise a moving worker can make construction feel
    // randomly unresponsive.
    if (this.callbacks.isPlacing()) {
      const plot = PLOTS.find((candidate) => Math.abs(candidate.x - x) < 110 && Math.abs(candidate.y - y) < 90);
      if (plot) this.callbacks.onPlot(plot.id);
      return;
    }
    const resident = [...this.simulation.world.residents].reverse().find((person) =>
      Math.abs(person.x - x) < 28 && y > person.y - 106 && y < person.y);
    if (resident) { this.focusOn(resident.x); this.callbacks.onResident(resident.id); return; }
    if (Math.abs(x - 234) < 115 && y > WORLD.groundY - 205 && y < WORLD.groundY) {
      this.callbacks.onObject('wood'); this.showNotice(`Лесной участок · ${this.simulation.world.woodSource} единиц древесины`); return;
    }
    if (Math.abs(x - 1900) < 100 && y > WORLD.groundY - 155 && y < WORLD.groundY) {
      this.callbacks.onObject('stone'); this.showNotice(`Каменный выход · ${this.simulation.world.stoneSource} единиц камня`); return;
    }
    for (const store of this.simulation.world.stores) {
      if (Math.abs(store.x - x) < 150 && y > WORLD.groundY - 210 && y < WORLD.groundY + 30) {
        this.callbacks.onObject('store', store.id);
        this.showNotice(`Склад · дерево ${store.wood} · камень ${store.stone} · вместимость ${store.capacity}`);
        return;
      }
    }
    const eastern = PROTOTYPE_CONFIG.easternSector;
    if (Math.abs(eastern.forestX - x) < 240 && y > WORLD.groundY - 360 && y < WORLD.groundY + 35) {
      this.callbacks.onObject('eastern-forest');
      this.showNotice(this.simulation.world.easternSector.state === 'prepared'
        ? `Лес Восточной опушки · ${this.simulation.world.easternSector.woodStock} единиц`
        : 'Лес пока недоступен: сначала подготовь Восточную опушку.');
      return;
    }
    const building = this.simulation.world.buildings.find((candidate) => Math.abs(candidate.x - x) < 150 &&
      y > WORLD.groundY - 220 && y < WORLD.groundY + 15);
    if (building) {
      this.callbacks.onObject('building', building.id);
      this.showNotice(building.kind === 'house' ? 'Дом · увеличивает вместимость жилья' : 'Склад · увеличивает вместимость ресурсов');
      return;
    }
    if (x >= eastern.boundaryX - 100 && x < WORLD.width &&
        y > WORLD.groundY - 270 && y < WORLD.groundY + 50) {
      this.callbacks.onObject('sector', 'eastern');
      this.showNotice(`Восточная опушка · ${this.simulation.world.easternSector.state}`);
      return;
    }
  }

  showNotice(text: string): void {
    this.notice.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.notice);
    this.tweens.add({ targets: this.notice, alpha: 0, delay: 1800, duration: 500 });
  }

  private labelStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: 'DM Sans, sans-serif', fontSize: '15px', color: '#344539',
      backgroundColor: '#f8f8eacc', padding: { x: 6, y: 4 }, align: 'center'
    };
  }
}
