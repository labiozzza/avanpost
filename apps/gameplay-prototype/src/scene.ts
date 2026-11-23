import Phaser from 'phaser';
import { CameraGestureController } from './camera-gestures.js';
import { calculatePanoramaLayout, type PanoramaLayout } from './panorama-layout.js';
import { groundedSpriteLayout, type AlphaBounds } from './sprite-geometry.js';
import {
  PROTOTYPE_CONFIG, PrototypeSimulation, WORLD, isLooseMaterial, cellBounds,
  type PrototypeResident, type PrototypeSite, type BuildingKind
} from './simulation.js';
import {
  LAND_GRID_CELLS, LAND_GRID_EASTERN_CELL_IDS, LAND_GRID_EXPANSION_ORDER,
  CELL_SIZE, LAND_GRID_CONFIG, cellsForFootprint, cellStateLabel, landCellAt, landCellById,
  type GridFootprint, type GridMode
} from './land-grid.js';
import { ROAD_CONFIG } from './roads.js';
import { FEATURES } from './features.js';

const ASSET = `${import.meta.env.BASE_URL}assets/peace-v2/`;
const PROTOTYPE_ASSET = `${import.meta.env.BASE_URL}assets/gameplay-prototype/`;
export const ART_SCALE = {
  residentScale: 0.54,
  residentFeetOffset: 224 * 0.54 * (1 - 214 / 224),
  house: {
    width: 339, height: 339, alpha: { width: 176 / 256, height: 129 / 256 },
    bounds: { left: 44, top: 106, right: 220, bottom: 235 }
  },
  store: {
    width: 339, height: 339, alpha: { width: 184 / 256, height: 119 / 256 },
    bounds: { left: 31, top: 104, right: 215, bottom: 223 }
  },
  sawmill: { width: 520, height: 235, alpha: { width: 0.94, height: 0.82 } },
  tree: { width: 330, height: 330, alpha: { width: 159 / 256, height: 186 / 256 } },
  stone: { width: 190, height: 190 * 1024 / 1536, alpha: { width: 1354 / 1536, height: 937 / 1024 } }
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
  onRoadPosition: (worldX: number) => void;
  onObject: (kind: 'wood' | 'stone' | 'store' | 'building' | 'site' | 'stockpile' | 'sector' | 'cell' | 'eastern-forest' | 'road', id?: string) => void;
  isSelected: (id: string) => boolean;
  isPlacing: () => boolean;
  getGridMode: () => GridMode;
  getPreviewPlotId: () => number | null;
  getPreviewFootprint: () => GridFootprint;
  getPlacementKind: () => BuildingKind | 'road' | null;
  getRoadPreviewX: () => number | null;
  getRoadPreviewError: () => string | null;
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
  cargo: Phaser.GameObjects.Image;
  animation: string;
}
interface SiteVisual {
  sprite: Phaser.GameObjects.Image | null;
  label: Phaser.GameObjects.Text;
}

interface CellForestVisual {
  cellId: number;
  trees: Phaser.GameObjects.Image;
  understory: Phaser.GameObjects.Image;
  ground: Phaser.GameObjects.Image;
  status: Phaser.GameObjects.Text;
}

interface StockpileVisual {
  pileId: string;
  image: Phaser.GameObjects.Image;
  overlay: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

const CAMERA_ZOOM_MIN = 0.58;
const CAMERA_ZOOM_MAX = 1.35;
const CAMERA_WORLD_TOP = -420;
const PANORAMA_REFERENCE_HEIGHT = 1960 * 0.52;
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
  private readonly forestVisuals = new Map<number, CellForestVisual>();
  private readonly stockpileVisuals = new Map<string, StockpileVisual>();
  private staticLabels: Phaser.GameObjects.Text[] = [];
  private readonly labelInfo = new Map<Phaser.GameObjects.Text, LabelInfo>();
  private staticLayer!: Phaser.GameObjects.Container;
  private siteLayer!: Phaser.GameObjects.Graphics;
  private roadLayer!: Phaser.GameObjects.Graphics;
  private markerLayer!: Phaser.GameObjects.Graphics;
  private sectorLayer!: Phaser.GameObjects.Graphics;
  private easternForestLabel: Phaser.GameObjects.Text | null = null;
  private easternSourceTree: Phaser.GameObjects.Image | null = null;
  private callbacks!: SceneCallbacks;
  private lastStructureKey = '';
  private notice!: Phaser.GameObjects.Text;
  private panorama: Phaser.GameObjects.Image | null = null;
  private panoramaGeometry: PanoramaLayout | null = null;
  private readonly gestures = new CameraGestureController();
  private lastForestNavigationState = '';
  private readonly gridLabels = new Map<number, Phaser.GameObjects.Text>();
  private placementPreview: Phaser.GameObjects.Image | null = null;
  private focusedX = SETTLEMENT_X;
  private cameraCenterY = WORLD.groundY;
  private settlementAnchorMinX: number | null = null;
  private settlementAnchorMaxX: number | null = null;
  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => this.pointerDown(pointer);
  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => this.pointerMove(pointer);
  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer): void => this.pointerUp(pointer);
  private readonly handlePointerCancel = (): void => this.gestures.reset();
  private readonly handleWindowBlur = (): void => this.gestures.reset();
  private readonly handleResize = (size: Phaser.Structs.Size): void => this.resizeWorld(size.width, size.height);

  constructor(private readonly simulation: PrototypeSimulation, callbacks: SceneCallbacks) {
    super('GameplayPrototype');
    this.callbacks = callbacks;
  }

  preload(): void {
    this.load.image('panorama', `${ASSET}background-panorama.png`);
    this.load.image('geology-atlas', `${ASSET}sideview-geology-atlas.png`);
    this.load.image('turf-tile', `${ASSET}sideview-turf-tile.png`);
    this.load.image('tree', `${ASSET}tree_full.png`);
    this.load.image('stone-outcrop', `${ASSET}stone-outcrop.png`);
    this.load.image('wood-stockpile', `${PROTOTYPE_ASSET}stockpile_logs.png`);
    this.load.image('storehouse', `${ASSET}storehouse.png`);
    this.load.image('house', `${ASSET}house.png`);
    this.load.image('workshop', `${PROTOTYPE_ASSET}sawmill.svg`);
    this.load.image('eastern-marsh-trees', `${PROTOTYPE_ASSET}eastern-marsh-trees.svg`);
    this.load.image('eastern-marsh-understory', `${PROTOTYPE_ASSET}eastern-marsh-understory.svg`);
    this.load.image('eastern-marsh-ground', `${PROTOTYPE_ASSET}eastern-marsh-ground.svg`);
    this.load.spritesheet('worker', `${ASSET}worker-atlas.png`, { frameWidth: 192, frameHeight: 224 });
  }

  create(): void {
    this.residentVisuals.clear();
    this.siteVisuals.clear();
    this.stockpileVisuals.clear();
    this.gridLabels.clear();
    this.staticLabels = [];
    this.labelInfo.clear();
    this.easternForestLabel = null;
    this.lastStructureKey = '';
    this.panorama = null;
    this.panoramaGeometry = null;
    this.gestures.reset();
    this.lastForestNavigationState = '';
    this.game.canvas.dataset.projection = 'side-view';
    this.game.canvas.dataset.terrain = 'layered-cross-section';
    this.game.canvas.dataset.roadsEnabled = String(FEATURES.roadsEnabled);
    this.game.canvas.dataset.residentVisibleHeight = (178 * ART_SCALE.residentScale).toFixed(1);
    this.game.canvas.dataset.houseVisibleHeight = (ART_SCALE.house.height * ART_SCALE.house.alpha.height).toFixed(1);
    this.game.canvas.dataset.storeVisibleHeight = (ART_SCALE.store.height * ART_SCALE.store.alpha.height).toFixed(1);
    this.game.canvas.dataset.treeVisibleHeight = (ART_SCALE.tree.height * ART_SCALE.tree.alpha.height).toFixed(1);
    const textureAspect = (key: string) => {
      const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
      return source.width / source.height;
    };
    this.game.canvas.dataset.spriteAspectScale = JSON.stringify({
      resident: (192 / 224) / (192 / 224),
      house: (ART_SCALE.house.width / ART_SCALE.house.height) / textureAspect('house'),
      store: (ART_SCALE.store.width / ART_SCALE.store.height) / textureAspect('storehouse'),
      tree: (ART_SCALE.tree.width / ART_SCALE.tree.height) / textureAspect('tree'),
      stone: (ART_SCALE.stone.width / ART_SCALE.stone.height) / textureAspect('stone-outcrop'),
      woodStockpile: 1 / textureAspect('wood-stockpile')
    });
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
    const panoramaSource = this.textures.get('panorama').getSourceImage() as HTMLImageElement;
    const visiblePanoramaHeight = Math.max(
      PANORAMA_REFERENCE_HEIGHT,
      WORLD.groundY - CAMERA_WORLD_TOP + 2
    );
    // Fit the actual 3:1 source across the whole world with one uniform scale,
    // then crop only the excess sky from the top. The lower edge stays on the
    // ground line and the visible height remains aligned with the camera world.
    const panoramaGeometry = calculatePanoramaLayout(
      panoramaSource.width,
      panoramaSource.height,
      WORLD.width,
      WORLD.groundY,
      visiblePanoramaHeight
    );
    this.panoramaGeometry = panoramaGeometry;
    this.panorama = this.add.image(
      panoramaGeometry.centerX, panoramaGeometry.bottomY, 'panorama'
    ).setOrigin(0.5, 1)
      .setDisplaySize(panoramaGeometry.displayWidth, panoramaGeometry.displayHeight)
      .setCrop(
        panoramaGeometry.cropX,
        panoramaGeometry.cropY,
        panoramaGeometry.cropWidth,
        panoramaGeometry.cropHeight
      )
      .setDepth(-30)
      .setScrollFactor(1, 1);
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
    // Keep roads above the ground container (depth 35), but below stockpiles,
    // construction sites and residents so the route reads as part of the terrain.
    this.roadLayer = this.add.graphics().setDepth(36);
    this.siteLayer = this.add.graphics().setDepth(40);
    this.markerLayer = this.add.graphics().setDepth(44);
    this.sectorLayer = this.add.graphics().setDepth(42);
    this.notice = this.add.text(WORLD.width / 2, 32, ' ', {
      fontFamily: 'DM Sans, sans-serif', fontSize: '14px', color: '#35543d', backgroundColor: '#f8f7e9dd',
      padding: { x: 11, y: 7 }
    }).setOrigin(0.5, 0).setDepth(100).setAlpha(0);

    this.drawStaticWorld();
    this.input.on('pointerdown', this.handlePointerDown);
    this.input.on('pointermove', this.handlePointerMove);
    this.input.on('pointerup', this.handlePointerUp);
    this.input.on('pointerupoutside', this.handlePointerUp);
    const canvas = this.game.canvas;
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('blur', this.handleWindowBlur);
    this.scale.on('resize', this.handleResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', this.handlePointerDown);
      this.input.off('pointermove', this.handlePointerMove);
      this.input.off('pointerup', this.handlePointerUp);
      this.input.off('pointerupoutside', this.handlePointerUp);
      this.scale.off('resize', this.handleResize);
      canvas.removeEventListener('pointercancel', this.handlePointerCancel);
      window.removeEventListener('blur', this.handleWindowBlur);
      this.gestures.reset();
    });
    this.resizeWorld(this.scale.width, this.scale.height);
  }

  update(): void {
    this.syncStructure();
    this.syncEasternArt();
    this.syncRoads();
    this.syncStockpiles();
    this.drawPlots();
    for (const person of this.simulation.world.residents) this.syncResident(person);
    this.drawSites();
    this.drawSectorStatus();
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
    const layoutZoom = width > height ? Math.min(width / 620, height / 540) : width / 620;
    const stoneRightEdge = PROTOTYPE_CONFIG.sources.stoneX + ART_SCALE.stone.width / 2 + 120;
    const landmarkFitZoom = width > height ? width / stoneRightEdge : 1.05;
    return Phaser.Math.Clamp(
      Math.min(layoutZoom, landmarkFitZoom),
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
        ...this.simulation.world.residents.map((person) => person.x)
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
    this.game.canvas.dataset.cameraScaleX = camera.zoom.toFixed(4);
    this.game.canvas.dataset.cameraScaleY = camera.zoom.toFixed(4);
    this.game.canvas.dataset.devicePixelRatio = String(window.devicePixelRatio || 1);
    const canvasBounds = this.game.canvas.getBoundingClientRect();
    this.game.canvas.dataset.canvasCssAspect = (canvasBounds.width / Math.max(1, canvasBounds.height)).toFixed(5);
    this.game.canvas.dataset.canvasBufferAspect = (this.game.canvas.width / Math.max(1, this.game.canvas.height)).toFixed(5);
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
    if (this.panoramaGeometry) {
      this.game.canvas.dataset.panoramaGeometry = JSON.stringify({
        ...this.panoramaGeometry,
        instanceCount: this.panorama
          ? this.children.list.filter((child) => child === this.panorama).length
          : 0,
        worldWidth: WORLD.width,
        worldTop: CAMERA_WORLD_TOP,
        groundY: WORLD.groundY
      });
    }
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
    art: { width: number; height: number; alpha: { width: number; height: number }; bounds?: AlphaBounds }
  ): Phaser.Geom.Rectangle {
    if (!art.bounds) {
      const width = art.width * art.alpha.width;
      const height = art.height * art.alpha.height;
      return new Phaser.Geom.Rectangle(centerX - width / 2, groundY - height, width, height);
    }
    const layout = groundedSpriteLayout({
      worldX: centerX, groundY, textureWidth: 256, textureHeight: 256,
      displayWidth: art.width, displayHeight: art.height, alpha: art.bounds
    });
    return new Phaser.Geom.Rectangle(
      layout.visibleBounds.left,
      layout.visibleBounds.top,
      layout.visibleBounds.right - layout.visibleBounds.left,
      layout.visibleBounds.bottom - layout.visibleBounds.top
    );
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

      let anchorX = anchor.x;
      if (candidate.info.kind === 'resident') {
        const halfWidth = this.labelRect(label).width * zoom / 2;
        const screenAnchorX = camera.x + camera.width / 2 + (anchor.x - camera.midPoint.x) * zoom;
        const safeLeft = viewport.x + halfWidth + 8;
        const safeRight = viewport.right - halfWidth - 8;
        const safeScreenX = Phaser.Math.Clamp(screenAnchorX, safeLeft, safeRight);
        anchorX += (safeScreenX - screenAnchorX) / zoom;
      }

      let placed = false;
      for (const lane of screenLanes) {
        label.setPosition(anchorX, anchor.y - lane / zoom);
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
      prepared: this.simulation.hasEasternForest(),
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
    const config = PROTOTYPE_CONFIG.easternSector;
    const easternCellIds = new Set<number>(LAND_GRID_EASTERN_CELL_IDS);
    const eastCells = this.simulation.world.landCells
      .filter((cell) => easternCellIds.has(cell.id))
      .sort((a, b) => a.x - b.x);
    this.forestVisuals.clear();
    for (let index = 0; index < eastCells.length; index++) {
      const cell = eastCells[index]!;
      const bounds = cellBounds(cell.id)!;
      const left = bounds.left;
      const right = bounds.right;
      const width = right - left;
      const center = (left + right) / 2;
      const treesKey = this.makeCellArtTexture(cell.id, 'trees', 'eastern-marsh-trees', left, right);
      const understoryKey = this.makeCellArtTexture(cell.id, 'understory', 'eastern-marsh-understory', left, right);
      const groundKey = this.makeCellArtTexture(cell.id, 'ground', 'eastern-marsh-ground', left, right);
      const treesSource = this.textures.get('eastern-marsh-trees').getSourceImage() as HTMLImageElement;
      const understorySource = this.textures.get('eastern-marsh-understory').getSourceImage() as HTMLImageElement;
      const groundSource = this.textures.get('eastern-marsh-ground').getSourceImage() as HTMLImageElement;
      const trees = this.add.image(center, WORLD.groundY + 5, treesKey).setOrigin(0.5, 1)
        .setDisplaySize(width, treesSource.height).setDepth(27);
      const understory = this.add.image(center, WORLD.groundY + 5, understoryKey).setOrigin(0.5, 1)
        .setDisplaySize(width, understorySource.height).setDepth(31);
      const ground = this.add.image(center, WORLD.groundY + 5, groundKey).setOrigin(0.5, 1)
        .setDisplaySize(width, groundSource.height).setDepth(32);
      const status = this.add.text(center, WORLD.groundY - Math.min(190, treesSource.height * 0.58),
        `Клетка ${landCellById(cell.id)?.number ?? cell.id + 1} · закрыта`, {
          fontFamily: 'DM Sans, sans-serif', fontSize: '12px', color: '#fff4d9', fontStyle: 'bold',
          backgroundColor: '#24382dbb', padding: { x: 8, y: 5 }
        }).setOrigin(0.5).setDepth(70);
      this.forestVisuals.set(cell.id, { cellId: cell.id, trees, understory, ground, status });
    }
    const easternSourceVisible = this.simulation.hasEasternForest();
    const eastTree = this.add.image(config.forestX, WORLD.groundY + 5, 'tree').setOrigin(0.5, 1)
      .setDisplaySize(ART_SCALE.tree.width, ART_SCALE.tree.height).setDepth(34).setVisible(easternSourceVisible);
    this.easternSourceTree = eastTree;
    this.easternForestLabel = this.add.text(config.forestX, WORLD.groundY - 260, '', {
      ...this.labelStyle(), fontSize: '14px', color: '#3d5d37'
    }).setOrigin(0.5).setDepth(70).setVisible(easternSourceVisible);
    this.syncEasternForestLabel();
    const staticObjects: Phaser.GameObjects.GameObject[] = [
      tree, stone, treeName, stoneName, eastTree,
      ...[...this.forestVisuals.values()].flatMap((visual) => [visual.trees, visual.understory, visual.ground, visual.status]),
      this.easternForestLabel
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
    for (const cell of eastCells) {
      const visual = this.forestVisuals.get(cell.id)!;
      this.registerLabel(visual.status, {
        kind: 'sector', id: `land-${cell.id}`, priority: 54,
        anchor: () => ({ x: visual.status.x, y: visual.status.y }),
        objectBounds: () => new Phaser.Geom.Rectangle(
          visual.trees.x - visual.trees.displayWidth / 2, WORLD.groundY - visual.trees.displayHeight,
          visual.trees.displayWidth, visual.trees.displayHeight
        )
      }, true);
    }
    if (this.easternForestLabel) this.registerLabel(this.easternForestLabel, {
      kind: 'resource', id: 'wood:eastern', priority: 65,
      anchor: () => ({ x: config.forestX, y: WORLD.groundY - 260 }),
      objectBounds: () => this.visibleArtBounds(config.forestX, WORLD.groundY + 5, ART_SCALE.tree)
    }, true);
  }

  private makeCellArtTexture(
    cellId: number, layer: string, sourceKey: string, left: number, right: number
  ): string {
    const key = `land-cell-${cellId}-${layer}`;
    if (this.textures.exists(key)) return key;
    const source = this.textures.get(sourceKey).getSourceImage() as HTMLImageElement;
    const fullStart = landCellById(4)?.left ?? PROTOTYPE_CONFIG.easternSector.boundaryX;
    const fullWidth = WORLD.width - fullStart;
    const sourceLeft = Math.max(0, Math.round((left - fullStart) / fullWidth * source.width));
    const sourceRight = Math.min(source.width, Math.round((right - fullStart) / fullWidth * source.width));
    // Every slice belongs to one continuous landscape. Keep each layer at one
    // vertical scale across all cells; sizing each crop by its own width makes
    // adjacent tree tops and ground edges jump at every cell boundary.
    const scale = 1.5;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((right - left) * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create land art crop');
    context.drawImage(source, sourceLeft, 0, sourceRight - sourceLeft, source.height,
      0, 0, canvas.width, canvas.height);
    this.textures.addCanvas(key, canvas);
    return key;
  }

  private syncEasternForestLabel(): void {
    if (!this.easternForestLabel) return;
    const sector = this.simulation.world.easternSector;
    const config = PROTOTYPE_CONFIG.easternSector;
    const available = this.simulation.hasEasternForest();
    this.easternSourceTree?.setVisible(available);
    this.easternForestLabel.setVisible(available);
    const label = available
      ? `Лес Восточной опушки · ${sector.woodStock}/${config.forestCapacity}`
      : 'Лес за закрытой территорией';
    if (this.easternForestLabel.text !== label) this.easternForestLabel.setText(label);
  }

  private syncEasternArt(): void {
    const states: Record<number, { state: string; clearingProgress: number }> = {};
    for (const cell of this.simulation.world.landCells.filter((candidate) =>
      LAND_GRID_EASTERN_CELL_IDS.includes(candidate.id as typeof LAND_GRID_EASTERN_CELL_IDS[number]))) {
      const visual = this.forestVisuals.get(cell.id);
      if (!visual) continue;
      const progress = cell.state === 'clearing' ? cell.clearingProgress : 0;
      const currentState = this.simulation.landCellState(cell.id) ?? cell.state;
      const overgrown = !['prepared', 'occupied', 'construction'].includes(currentState);
      visual.trees.setVisible(overgrown && !(cell.state === 'clearing' && progress >= 0.5));
      visual.understory.setVisible(overgrown && !(cell.state === 'clearing' && progress >= 0.25));
      const lateClearingAlpha = progress < 0.75 ? 1 : Math.max(0.08, 1 - (progress - 0.75) * 3.68);
      visual.ground.setVisible(overgrown).setAlpha(overgrown ? lateClearingAlpha : 0);
      const number = landCellById(cell.id)?.number ?? cell.id + 1;
      const label = currentState === 'clearing'
        ? `Клетка ${number} · ${Math.round(progress * 100)}%`
        : `Клетка ${number} · ${cellStateLabel(currentState)}`;
      if (visual.status.text !== label) visual.status.setText(label);
      states[cell.id] = { state: currentState, clearingProgress: progress };
    }
    const frontier = this.simulation.world.landCells
      .filter((cell) => LAND_GRID_EASTERN_CELL_IDS.includes(cell.id as typeof LAND_GRID_EASTERN_CELL_IDS[number]) &&
        LAND_GRID_EXPANSION_ORDER.includes(cell.id as typeof LAND_GRID_EXPANSION_ORDER[number]))
      .sort((a, b) => a.x - b.x)
      .find((cell) => cell.state !== 'prepared');
    this.game.canvas.dataset.easternSectorState = frontier
      ? this.simulation.landCellState(frontier.id) ?? frontier.state : 'prepared';
    this.game.canvas.dataset.easternClearingProgress = (frontier?.clearingProgress ?? 1).toFixed(3);
    this.game.canvas.dataset.landCells = JSON.stringify(states);
    this.game.canvas.dataset.easternArtLayers = JSON.stringify([...this.forestVisuals.values()].map((visual) => ({
      cellId: visual.cellId,
      trees: visual.trees.visible,
      understory: visual.understory.visible,
      ground: visual.ground.visible
    })));
    this.game.canvas.dataset.easternGroundAlpha = JSON.stringify([...this.forestVisuals.values()].map((v) => ({ cellId: v.cellId, alpha: v.ground.alpha, visible: v.ground.visible })));
    this.game.canvas.dataset.easternArtGeometry = JSON.stringify([...this.forestVisuals.values()].map((visual) => ({
      cellId: visual.cellId,
      left: visual.trees.x - visual.trees.displayWidth / 2,
      right: visual.trees.x + visual.trees.displayWidth / 2,
      treesHeight: visual.trees.displayHeight,
      understoryHeight: visual.understory.displayHeight,
      groundHeight: visual.ground.displayHeight
    })));
  }

  private drawSectorStatus(): void {
    this.sectorLayer.clear();
    for (const cell of this.simulation.world.landCells.filter((candidate) => candidate.state === 'clearing')) {
      const x = cell.x;
      const y = WORLD.groundY - 155;
      const width = 214;
      this.sectorLayer.fillStyle(0x283a2d, 0.72);
      this.sectorLayer.fillRoundedRect(x - width / 2, y - 11, width, 22, 6);
      this.sectorLayer.fillStyle(0xc5a56b, 0.95);
      this.sectorLayer.fillRoundedRect(x - width / 2 + 5, y - 6, (width - 10) * cell.clearingProgress, 12, 4);
      this.sectorLayer.lineStyle(2, 0xe7d2a0, 0.9);
      this.sectorLayer.strokeRoundedRect(x - width / 2, y - 11, width, 22, 6);
    }
  }

  private syncStructure(): void {
    const key = JSON.stringify({
      stores: this.simulation.world.stores.map(({ id, x, buildingId, closedForDemolition }) =>
        [id, x, buildingId, closedForDemolition]),
      buildings: this.simulation.world.buildings.map(({ id, kind, x, demolition, level }) =>
        [id, kind, x, Boolean(demolition), demolition?.paused, level]),
      landCells: this.simulation.world.landCells.map(({ id, state }) => [id, state])
    });
    if (key === this.lastStructureKey) return;
    this.lastStructureKey = key;
    this.staticLayer.removeAll(true);
    for (const label of this.staticLabels) this.labelInfo.delete(label);
    this.staticLabels = [];
    this.easternForestLabel = null;
    this.easternSourceTree = null;
    this.drawStaticWorld();
    for (const store of this.simulation.world.stores) {
      const layout = groundedSpriteLayout({
        worldX: store.x, groundY: WORLD.groundY, textureWidth: 256, textureHeight: 256,
        displayWidth: ART_SCALE.store.width, displayHeight: ART_SCALE.store.height, alpha: ART_SCALE.store.bounds
      });
      const sprite = this.add.image(layout.x, layout.y, 'storehouse').setOrigin(0.5, 1)
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
        objectBounds: () => this.visibleArtBounds(store.x, WORLD.groundY, ART_SCALE.store)
      }, true);
    }
    for (const building of this.simulation.world.buildings.filter((candidate) => candidate.kind === 'house')) {
      const art = ART_SCALE.house;
      const layout = groundedSpriteLayout({
        worldX: building.x, groundY: WORLD.groundY, textureWidth: 256, textureHeight: 256,
        displayWidth: art.width, displayHeight: art.height, alpha: art.bounds
      });
      const sprite = this.add.image(layout.x, layout.y, 'house')
        .setOrigin(0.5, 1).setDisplaySize(
          art.width, art.height
        ).setDepth(35);
      const label = this.add.text(building.x, WORLD.groundY - 238,
        (building.level ?? 1) > 1 ? `Дом · ур. ${building.level}` : 'Дом',
        { ...this.labelStyle(), color: '#465a46' }).setOrigin(0.5).setDepth(70);
      this.staticLayer.add([sprite, label]);
      this.registerLabel(label, {
        kind: 'building',
        id: building.id,
        priority: 55,
        anchor: () => ({ x: building.x, y: WORLD.groundY - 238 }),
        objectBounds: () => this.visibleArtBounds(building.x, WORLD.groundY, art)
      }, true);
    }
    for (const building of this.simulation.world.buildings.filter((candidate) => candidate.kind === 'sawmill')) {
      const art = ART_SCALE.sawmill;
      const sprite = this.add.image(building.x, WORLD.groundY + 5, 'workshop')
        .setOrigin(0.5, 1).setDisplaySize(art.width, art.height).setDepth(35);
      const machinery = this.add.graphics();
      machinery.fillStyle(0x5b3923, 0.96);
      machinery.fillCircle(building.x + 175, WORLD.groundY - 91, 29);
      machinery.lineStyle(5, 0xd7c18c, 0.98);
      machinery.strokeCircle(building.x + 175, WORLD.groundY - 91, 24);
      machinery.lineStyle(3, 0xead9a6, 0.98);
      for (let spoke = 0; spoke < 8; spoke++) {
        const angle = spoke * Math.PI / 4;
        machinery.lineBetween(building.x + 175 + Math.cos(angle) * 5, WORLD.groundY - 91 + Math.sin(angle) * 5,
          building.x + 175 + Math.cos(angle) * 19, WORLD.groundY - 91 + Math.sin(angle) * 19);
      }
      machinery.fillStyle(0x8d673f, 1);
      machinery.fillRoundedRect(building.x - 190, WORLD.groundY - 52, 106, 13, 5);
      machinery.fillRoundedRect(building.x - 182, WORLD.groundY - 67, 92, 12, 5);
      machinery.lineStyle(2, 0x57391f, 1);
      machinery.strokeRoundedRect(building.x - 190, WORLD.groundY - 52, 106, 13, 5);
      machinery.strokeRoundedRect(building.x - 182, WORLD.groundY - 67, 92, 12, 5);
      const label = this.add.text(building.x, WORLD.groundY - 238, 'Лесопилка', {
        ...this.labelStyle(), color: '#465a46', fontSize: '14px'
      }).setOrigin(0.5).setDepth(70);
      this.staticLayer.add([sprite, machinery, label]);
      this.registerLabel(label, {
        kind: 'building', id: building.id, priority: 55,
        anchor: () => ({ x: building.x, y: WORLD.groundY - 238 }),
        objectBounds: () => this.visibleArtBounds(building.x, WORLD.groundY, art)
      }, true);
    }
    this.publishStructureGrounding();
  }

  private publishStructureGrounding(): void {
    const entries = [
      ...this.simulation.world.stores.map((store) => ({ id: store.buildingId ?? store.id, kind: 'warehouse' as const, x: store.x })),
      ...this.simulation.world.buildings.filter((building) => building.kind === 'house')
        .map((building) => ({ id: building.id, kind: 'house' as const, x: building.x })),
      ...this.simulation.world.buildings.filter((building) => building.kind === 'sawmill')
        .map((building) => ({ id: building.id, kind: 'sawmill' as const, x: building.x })),
      ...this.simulation.world.sites.filter((site) => site.kind !== 'road')
        .map((site) => ({ id: site.id, kind: site.kind === 'house-upgrade' ? 'house' as const : site.kind, x: site.x }))
    ];
    this.game.canvas.dataset.structureGrounding = JSON.stringify(entries.map((entry) => {
      if (entry.kind === 'sawmill') return {
        id: entry.id, kind: entry.kind, groundY: WORLD.groundY,
        visibleBottomY: WORLD.groundY + 5, displayWidth: ART_SCALE.sawmill.width, displayHeight: ART_SCALE.sawmill.height
      };
      const art = entry.kind === 'house' ? ART_SCALE.house : ART_SCALE.store;
      const layout = groundedSpriteLayout({
        worldX: entry.x, groundY: WORLD.groundY, textureWidth: 256, textureHeight: 256,
        displayWidth: art.width, displayHeight: art.height, alpha: art.bounds
      });
      return {
        id: entry.id, kind: entry.kind, groundY: WORLD.groundY,
        visibleBottomY: layout.visibleBounds.bottom, displayWidth: art.width, displayHeight: art.height
      };
    }));
  }

  private drawPlots(): void {
    this.markerLayer.clear();
    const mode = this.callbacks.getGridMode();
    const planning = mode === 'planning' || this.callbacks.isPlacing();
    const visible = mode !== 'off' || this.callbacks.isPlacing();
    const colors: Record<string, number> = {
      closed: 0x67747a, unlockable: 0xd2a35b, unlocked: 0xc3934c, clearing: 0xe0b05d,
      prepared: 0x66ae76, occupied: 0x78a6cf, construction: 0xe2a06a
    };
    const geometry = LAND_GRID_CELLS.map((bounds) => {
      const state = this.simulation.landCellState(bounds.id) ?? 'closed';
      const available = this.simulation.isPlotAvailable(bounds.id);
      let label = this.gridLabels.get(bounds.id);
      if (!label) {
        label = this.add.text(bounds.centerX, WORLD.groundY - 33, '', {
          ...this.labelStyle(), fontSize: '12px'
        }).setOrigin(0.5, 0).setDepth(46);
        this.gridLabels.set(bounds.id, label);
      }
      label.setVisible(visible && planning && bounds.environment === 'surface');
      if (visible) {
        const color = colors[state] ?? colors.closed!;
        if (planning) {
          this.markerLayer.fillStyle(color, 0.07);
          this.markerLayer.fillRect(bounds.left, bounds.top, CELL_SIZE, CELL_SIZE);
          const number = bounds.number;
          const labelText = `Клетка ${number} · ${cellStateLabel(state)}`;
          if (label.text !== labelText) label.setText(labelText);
        } else if (bounds.environment === 'surface') {
          this.markerLayer.lineStyle(1.4, color, 0.58);
          this.markerLayer.strokeRect(bounds.left, bounds.top, CELL_SIZE, CELL_SIZE);
        }
        if (this.callbacks.isPlacing() && bounds.environment === 'surface' && available) {
          this.markerLayer.fillStyle(0xf9f7dc, 0.10);
          this.markerLayer.fillRect(bounds.left, bounds.top, CELL_SIZE, CELL_SIZE);
          this.markerLayer.fillStyle(0xf9f7dc, 0.96);
          this.markerLayer.fillCircle(bounds.centerX, bounds.centerY, 11);
          this.markerLayer.fillStyle(0x52734d, 1);
          this.markerLayer.fillCircle(bounds.centerX, bounds.centerY, 4);
        }
      }
      return { ...bounds, state, available };
    });

    if (visible && planning) {
      this.markerLayer.lineStyle(1.4, 0xe7ead9, 0.74);
      for (let column = 0; column <= LAND_GRID_CONFIG.columns; column += 1) {
        const x = LAND_GRID_CONFIG.left + column * CELL_SIZE;
        this.markerLayer.lineBetween(x, LAND_GRID_CONFIG.top, x, LAND_GRID_CONFIG.bottom);
      }
      for (let row = 0; row <= LAND_GRID_CONFIG.rows; row += 1) {
        const y = LAND_GRID_CONFIG.top + row * CELL_SIZE;
        this.markerLayer.lineBetween(LAND_GRID_CONFIG.left, y, LAND_GRID_CONFIG.right, y);
      }
    }

    const previewId = this.callbacks.getPreviewPlotId();
    const placementKind = this.callbacks.getPlacementKind();
    const roadPreviewX = this.callbacks.getRoadPreviewX();
    if (FEATURES.roadsEnabled && this.callbacks.isPlacing() && placementKind === 'road') {
      this.placementPreview?.setVisible(false);
      if (roadPreviewX !== null) {
        const invalid = Boolean(this.callbacks.getRoadPreviewError());
        this.drawRoadSurface(this.markerLayer, roadPreviewX, 0.78);
        this.markerLayer.lineStyle(2, invalid ? 0xc45143 : 0xf5efce, 0.95);
        this.markerLayer.strokeRoundedRect(
          roadPreviewX - ROAD_CONFIG.segmentLength / 2,
          WORLD.groundY - ROAD_CONFIG.visualWidth / 2 - 3,
          ROAD_CONFIG.segmentLength,
          ROAD_CONFIG.visualWidth + 6,
          8
        );
      }
    } else if (this.callbacks.isPlacing() && previewId !== null && placementKind) {
      const plot = landCellById(previewId);
      if (plot) {
        const footprint = this.callbacks.getPreviewFootprint();
        const footprintCells = cellsForFootprint({ column: plot.column, row: plot.row }, footprint);
        const placement = this.simulation.canPlaceFootprint(
          { column: plot.column, row: plot.row }, footprint
        );
        const previewLeft = plot.left;
        const previewTop = plot.bottom - footprint.heightCells * CELL_SIZE;
        this.markerLayer.fillStyle(placement.ok ? 0x9bc782 : 0xd87566, 0.22);
        this.markerLayer.fillRect(previewLeft, previewTop,
          footprint.widthCells * CELL_SIZE, footprint.heightCells * CELL_SIZE);
        this.markerLayer.lineStyle(2.5, placement.ok ? 0xe6f2c8 : 0xffb5a6, 0.95);
        this.markerLayer.strokeRect(previewLeft, previewTop,
          footprint.widthCells * CELL_SIZE, footprint.heightCells * CELL_SIZE);
        if (footprintCells) for (const cell of footprintCells) {
          if (!placement.cellIds.includes(cell.id)) continue;
          this.markerLayer.fillStyle(placement.ok ? 0x95c879 : 0xd85f53, 0.12);
          this.markerLayer.fillRect(cell.left + 4, cell.top + 4, CELL_SIZE - 8, CELL_SIZE - 8);
        }
        const art = placementKind === 'house' ? ART_SCALE.house
          : placementKind === 'sawmill' ? ART_SCALE.sawmill : ART_SCALE.store;
        const texture = placementKind === 'house' ? 'house'
          : placementKind === 'sawmill' ? 'workshop' : 'storehouse';
        if (!this.placementPreview) {
          this.placementPreview = this.add.image(plot.centerX, WORLD.groundY + 5, texture)
            .setOrigin(0.5, 1).setDepth(48).setAlpha(0.52);
        } else this.placementPreview.setTexture(texture);
        this.placementPreview.setPosition(
          plot.left + footprint.widthCells * CELL_SIZE / 2, WORLD.groundY + 5
        )
          .setDisplaySize(art.width, art.height).setVisible(true)
          .setTint(placement.ok ? 0xdde8d2 : 0xe7c5b5);
      }
    } else {
      this.placementPreview?.setVisible(false);
    }
    this.game.canvas.dataset.gridVisible = String(visible);
    this.game.canvas.dataset.gridMode = this.callbacks.isPlacing() ? 'planning' : mode;
    this.game.canvas.dataset.gridCells = JSON.stringify(geometry);
  }

  private syncRoads(): void {
    this.roadLayer.clear();
    if (FEATURES.roadsEnabled) {
      for (const road of this.simulation.world.roads) this.drawRoadSurface(this.roadLayer, road.x, 1);
    }
    this.game.canvas.dataset.roads = JSON.stringify(FEATURES.roadsEnabled ? this.simulation.world.roads : []);
  }

  private drawRoadSurface(graphics: Phaser.GameObjects.Graphics, x: number, alpha: number): void {
    const length = ROAD_CONFIG.segmentLength;
    const half = length / 2;
    const centerY = WORLD.groundY - 7;
    graphics.fillStyle(0x53402d, alpha * 0.94);
    graphics.fillRoundedRect(x - half, centerY - 8, length, 16, 7);
    graphics.fillStyle(0x8c704e, alpha);
    graphics.fillRoundedRect(x - half + 3, centerY - 6, length - 6, 12, 5);
    // Rounded joints join adjacent segments; speckles give the packed earth a
    // varied surface without covering the underlying game art with a flat band.
    graphics.fillStyle(0x8c704e, alpha);
    graphics.fillCircle(x - half, centerY, 5);
    graphics.fillCircle(x + half, centerY, 5);
    const seed = Math.abs(Math.round(x / length));
    for (let index = 0; index < 6; index += 1) {
      const px = x - half + 9 + ((index * 13 + seed * 7) % (length - 18));
      const py = centerY + (index % 2 === 0 ? -2.5 : 2.5);
      graphics.fillStyle(index % 3 === 0 ? 0xc0a175 : 0x675038, alpha * 0.74);
      graphics.fillCircle(px, py, index % 3 === 0 ? 1.5 : 1.2);
    }
  }

  private syncStockpiles(): void {
    const stockpiles = this.simulation.world.stockpiles;
    const liveIds = new Set(stockpiles.map((pile) => pile.id));
    for (const [id, visual] of this.stockpileVisuals) {
      if (liveIds.has(id)) continue;
      visual.image.destroy();
      visual.overlay.destroy();
      visual.label.destroy();
      this.stockpileVisuals.delete(id);
    }
    for (const pile of stockpiles) {
      let visual = this.stockpileVisuals.get(pile.id);
      if (!visual) {
        const texture = pile.resource === 'stone' ? 'stone-outcrop' : 'wood-stockpile';
        const image = this.add.image(pile.x, WORLD.groundY - 5, texture)
          .setOrigin(0.5, 1).setDepth(38).setVisible(false);
        const overlay = this.add.graphics().setDepth(39).setVisible(false);
        const label = this.add.text(pile.x, WORLD.groundY - 78, '', {
          ...this.labelStyle(), fontSize: '11px', color: pile.resource === 'stone' ? '#4f5c61' : '#65472d'
        }).setOrigin(0.5).setDepth(71);
        visual = { pileId: pile.id, image, overlay, label };
        this.stockpileVisuals.set(pile.id, visual);
      }
      const boards = pile.resource === 'boards';
      visual.image.setTexture(pile.resource === 'stone' ? 'stone-outcrop' : 'wood-stockpile')
        .setAlpha(boards ? 0 : 1);
      const loose = isLooseMaterial(pile);
      const group = loose ? stockpiles.filter((other) => isLooseMaterial(other) &&
        other.x === pile.x && other.resource === pile.resource && other.amount > 0) : [pile];
      const count = group.reduce((sum, other) => sum + other.amount, 0);
      const visible = count > 0 && (!loose || group[0]?.id === pile.id);
      const size = pile.resource === 'stone' ? 30 + Math.min(10, count) * 4.6 : 32 + Math.min(10, count) * 5;
      const height = pile.resource === 'stone' ? size * 1024 / 1536 : boards ? size * 0.62 : size;
      const visualX = loose
        ? pile.x + (pile.resource === 'stone' ? 82 : -82)
        : pile.x;
      visual.image.setVisible(visible).setPosition(visualX, WORLD.groundY - 5).setDisplaySize(size, height);
      visual.overlay.clear();
      visual.overlay.setVisible(visible && boards);
      if (visible && boards) {
        const plankWidth = size * 1.18;
        const plankHeight = Math.max(6, height * 0.22);
        const plankColors = [0xc18a4d, 0xd6a05d, 0xa9743e];
        for (let plank = 0; plank < 3; plank++) {
          const left = visualX - plankWidth / 2 + (plank % 2) * 4;
          const top = WORLD.groundY - 7 - (plank + 1) * (plankHeight - 1);
          visual.overlay.fillStyle(plankColors[plank]!, 1);
          visual.overlay.fillRoundedRect(left, top, plankWidth - (plank % 2) * 8, plankHeight, 3);
          visual.overlay.lineStyle(1.5, 0x6b472c, 0.9);
          visual.overlay.strokeRoundedRect(left, top, plankWidth - (plank % 2) * 8, plankHeight, 3);
        }
      }
      const label = loose
        ? `${pile.resource === 'boards' ? 'Доски' : pile.resource === 'wood' ? 'Дерево' : 'Камень'} · ${pile.sourceId === 'sawmill-output' ? 'у лесопилки' : pile.sourceId === 'demolition' ? 'снос' : 'на земле'} ${count}`
        : pile.resource === 'wood' ? `Древесина у леса: ${count}/${pile.capacity}`
          : pile.resource === 'stone' ? `Камень у выхода: ${count}/${pile.capacity}`
            : `Доски: ${count}/${pile.capacity}`;
      if (visual.label.text !== label) visual.label.setText(label);
      visual.label.setVisible(visible);
      visual.label.setPosition(Phaser.Math.Clamp(visualX, visual.label.width / 2 + 8, WORLD.width - visual.label.width / 2 - 8),
        WORLD.groundY - (loose && pile.resource === 'stone' ? 98 : boards ? 76 : 79));
    }
    this.game.canvas.dataset.stockpiles = JSON.stringify(stockpiles.map(({ id, resource, amount, capacity, x }) =>
      ({ id, resource, amount, capacity, x })));
  }

  private drawSites(): void {
    this.siteLayer.clear();
    const active = new Set(this.simulation.world.sites.map((site) => site.id));
    for (const [id, visual] of this.siteVisuals) {
      if (!active.has(id)) {
        visual.sprite?.destroy();
        this.labelInfo.delete(visual.label);
        visual.label.destroy();
        this.siteVisuals.delete(id);
      }
    }
    for (const site of this.simulation.world.sites) this.drawSite(site);
    for (const building of this.simulation.world.buildings) {
      const demolition = building.demolition;
      if (!demolition) continue;
      this.siteLayer.fillStyle(0x304338, 0.75);
      this.siteLayer.fillRoundedRect(building.x - 60, WORLD.groundY - 25, 120, 7, 3);
      this.siteLayer.fillStyle(demolition.paused ? 0xb58a49 : 0xf4d988, 1);
      this.siteLayer.fillRoundedRect(building.x - 58, WORLD.groundY - 23, 116 * demolition.progress, 3, 2);
    }
    this.publishStructureGrounding();
  }

  private drawSite(site: PrototypeSite): void {
    const stage = site.stage;
    let visual = this.siteVisuals.get(site.id);
    if (site.kind === 'road') {
      if (!FEATURES.roadsEnabled) return;
      if (!visual) {
        const label = this.add.text(site.x, WORLD.groundY - 28, '', {
          ...this.labelStyle(), fontSize: '11px', color: '#3b4e3f'
        }).setOrigin(0.5, 1).setDepth(65);
        visual = { sprite: null, label };
        this.siteVisuals.set(site.id, visual);
        this.registerLabel(label, {
          kind: 'construction', id: site.id, priority: 75,
          anchor: () => ({ x: site.x, y: WORLD.groundY - 35 }),
          objectBounds: () => new Phaser.Geom.Rectangle(
            site.x - ROAD_CONFIG.segmentLength / 2, WORLD.groundY - 24,
            ROAD_CONFIG.segmentLength, ROAD_CONFIG.visualWidth + 20
          )
        });
      }
      this.drawRoadSurface(this.siteLayer, site.x, 0.8);
      this.siteLayer.fillStyle(0x304338, 0.8);
      this.siteLayer.fillRoundedRect(site.x - 27, WORLD.groundY - 29, 54, 5, 2);
      this.siteLayer.fillStyle(0xf4d988, 0.98);
      this.siteLayer.fillRoundedRect(site.x - 25, WORLD.groundY - 28, 50 * site.progress, 3, 1);
      const labelText = `Дорога · ${Math.round(site.progress * 100)}%`;
      if (visual.label.text !== labelText) visual.label.setText(labelText);
      visual.label.setPosition(site.x, WORLD.groundY - 31);
      return;
    }
    if (!visual) {
      const siteIsHouse = site.kind === 'house' || site.kind === 'house-upgrade';
      const art = site.kind === 'sawmill' ? ART_SCALE.sawmill
        : siteIsHouse ? ART_SCALE.house : ART_SCALE.store;
      const texture = site.kind === 'sawmill' ? 'workshop' : siteIsHouse ? 'house' : 'storehouse';
      const layout = site.kind === 'sawmill'
        ? { x: site.x, y: site.y + 5 }
        : groundedSpriteLayout({
          worldX: site.x, groundY: site.y, textureWidth: 256, textureHeight: 256,
          displayWidth: art.width, displayHeight: art.height,
          alpha: 'bounds' in art ? art.bounds : { left: 0, top: 0, right: 256, bottom: 256 }
        });
      const sprite = this.add.image(layout.x, layout.y, texture)
        .setOrigin(0.5, 1).setDisplaySize(
          art.width, art.height
        )
        .setDepth(40).setVisible(false);
      const labelText = site.kind === 'sawmill' ? 'Лесопилка' : site.kind === 'house-upgrade' ? 'Улучшение дома'
        : site.kind === 'house' ? 'Дом' : 'Склад';
      const label = this.add.text(site.x, site.y - (site.kind === 'sawmill' ? 250 : 119), labelText, {
        ...this.labelStyle(), fontSize: '13px', color: '#3b4e3f'
      }).setOrigin(0.5).setDepth(65);
      visual = { sprite, label };
      this.siteVisuals.set(site.id, visual);
      this.registerLabel(label, {
        kind: 'construction',
        id: site.id,
        priority: 75,
        anchor: () => ({ x: site.x, y: site.y - (site.kind === 'sawmill' ? 280 : 298) }),
        objectBounds: () => site.kind === 'sawmill'
          ? new Phaser.Geom.Rectangle(site.x - art.width / 2, site.y - art.height, art.width, art.height)
          : new Phaser.Geom.Rectangle(site.x - 146, site.y - 275, 292, 275)
      });
    }
    visual.sprite?.setVisible(stage >= 2).setAlpha(0.55 + site.progress * 0.35);
    if (stage >= 2) visual.sprite?.setDepth(40);
    const scaffoldWidth = site.kind === 'sawmill' ? 500 : 292;
    const scaffoldHeight = site.kind === 'sawmill' ? 164 : 250;
    const left = site.x - scaffoldWidth / 2;
    this.siteLayer.fillStyle(0x84653f, 0.48);
     this.siteLayer.fillRoundedRect(site.x - scaffoldWidth / 2, site.y - 14, scaffoldWidth, 13, 4);
    this.siteLayer.fillStyle(0xba8a52, 0.8);
     this.siteLayer.fillRoundedRect(left + 10, site.y - 19, scaffoldWidth - 20, 6, 2);
     this.siteLayer.fillRoundedRect(left + 10, site.y - 13, 8, 10, 2);
     this.siteLayer.fillRoundedRect(site.x + scaffoldWidth / 2 - 18, site.y - 13, 8, 10, 2);
     this.siteLayer.lineStyle(3, stage >= 1 ? 0x95633b : 0xb1844f, 1);
    this.siteLayer.fillStyle(0xe0c993, 0.2);
     this.siteLayer.fillRect(site.x - scaffoldWidth / 2 + 12, site.y - scaffoldHeight, scaffoldWidth - 24, scaffoldHeight - 18);
     this.siteLayer.strokeRect(site.x - scaffoldWidth / 2 + 12, site.y - scaffoldHeight, scaffoldWidth - 24, scaffoldHeight - 18);
    if (stage >= 1) {
       this.siteLayer.lineBetween(left + 12, site.y - 18, left + 12, site.y - scaffoldHeight - 25);
       this.siteLayer.lineBetween(site.x + scaffoldWidth / 2 - 12, site.y - 18, site.x + scaffoldWidth / 2 - 12, site.y - scaffoldHeight - 25);
       this.siteLayer.lineBetween(left + 12, site.y - scaffoldHeight - 25, site.x + scaffoldWidth / 2 - 12, site.y - scaffoldHeight - 25);
       this.siteLayer.lineBetween(left + 12, site.y - scaffoldHeight / 2, site.x + scaffoldWidth / 2 - 12, site.y - scaffoldHeight - 25);
       this.siteLayer.lineBetween(site.x + scaffoldWidth / 2 - 12, site.y - scaffoldHeight / 2, left + 12, site.y - scaffoldHeight - 25);
    }
    this.siteLayer.fillStyle(0x304338, 0.65);
     this.siteLayer.fillRoundedRect(site.x - scaffoldWidth / 2, site.y - scaffoldHeight - 31, scaffoldWidth, 18, 5);
    this.siteLayer.fillStyle(0xf4d988, 0.95);
     this.siteLayer.fillRoundedRect(site.x - scaffoldWidth / 2 + 4, site.y - scaffoldHeight - 28,
       (scaffoldWidth - 8) * site.progress, 12, 4);
    const kindLabel = site.kind === 'sawmill' ? 'Лесопилка' : site.kind === 'house-upgrade' ? 'Улучшение дома'
      : site.kind === 'house' ? 'Дом' : 'Склад';
    const labelText = `${kindLabel} · ${Math.round(site.progress * 100)}%`;
    if (visual.label.text !== labelText) visual.label.setText(labelText);
    visual.label.setPosition(site.x, site.y - (site.kind === 'sawmill' ? scaffoldHeight + 55 : 298));
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
      const cargo = this.add.image(person.x, person.y, 'stone-outcrop').setDisplaySize(25, 17).setDepth(60).setVisible(false);
      view = { sprite, name, selection, cargo, animation: '' };
      this.residentVisuals.set(person.id, view);
    }
    view.sprite.setPosition(person.x, person.y + ART_SCALE.residentFeetOffset);
    if (view.name.text !== person.name) view.name.setText(person.name);
    view.selection.setPosition(person.x, person.y - 30).setVisible(this.callbacks.isSelected(person.id));
    // The legacy carrying strip contains a baked-in log. Stone uses clean
    // walking frames with the existing rock artwork attached to the moving hand.
    const nextAnimation = person.cargo === 'wood' ? 'carrying'
      : person.cargo === 'stone' ? 'walking'
        : person.mode === 'moving' ? 'walking'
          : person.mode === 'working' ? 'gathering'
            : person.mode === 'building' ? 'building' : 'idle';
    if (nextAnimation !== view.animation) {
      view.sprite.play(nextAnimation);
      view.animation = nextAnimation;
    }
    const left = person.targetX !== null && person.targetX < person.x;
    view.sprite.setFlipX(left);
    const frame = Number(view.sprite.frame.name);
    const hand = ({ 3: [16, -49], 4: [12, -48], 5: [7, -49], 6: [13, -50] } as Record<number, number[]>)[frame] ?? [13, -49];
    view.cargo.setVisible(person.cargo === 'stone').setFlipX(left)
      .setPosition(person.x + hand[0]! * (left ? -1 : 1), person.y + hand[1]!);
    this.game.canvas.dataset.cargoArt = JSON.stringify([...this.residentVisuals].map(([id, visual]) => ({
      id, animation: visual.animation, stoneVisible: visual.cargo.visible,
      texture: visual.cargo.texture.key, frame: Number(visual.sprite.frame.name)
    })));

  }

  private handlePointer(x: number, y: number): void {
    const pointerCell = landCellAt(x, y);
    this.game.canvas.dataset.lastPointerWorld = JSON.stringify({
      x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), cellId: pointerCell?.id ?? null
    });
    // In placement mode an overlapping resident must not steal a tap intended
    // for a marked plot; otherwise a moving worker can make construction feel
    // randomly unresponsive.
    if (this.callbacks.isPlacing()) {
      if (FEATURES.roadsEnabled && this.callbacks.getPlacementKind() === 'road') {
        if (y >= WORLD.groundY - 44 && y <= WORLD.groundY + 12) this.callbacks.onRoadPosition(x);
        else this.showNotice('Коснись поверхности земли, чтобы выбрать дорожный сегмент.');
        return;
      }
      const plot = landCellAt(x, y);
      if (plot?.environment === 'surface') this.callbacks.onPlot(plot.id);
      else this.showNotice('Выбери опорную клетку на поверхности земли.');
      return;
    }
    if (this.callbacks.getGridMode() !== 'off') {
      const plot = landCellAt(x, y);
      if (plot) { this.callbacks.onObject('cell', String(plot.id)); return; }
    }
    // Keep returned materials selectable when a worker is standing beside the
    // demolition site; these small piles are otherwise covered by resident hit areas.
    for (const pile of this.simulation.world.stockpiles.filter((candidate) => candidate.amount > 0)) {
      const visual = this.stockpileVisuals.get(pile.id)?.image;
      if (!visual?.visible) continue;
      const size = visual.displayWidth;
      const height = visual.displayHeight;
      const visualX = visual.x;
      if (Math.abs(visualX - x) <= Math.max(34, size / 2) &&
          y >= WORLD.groundY - height - 15 && y <= WORLD.groundY + 5) {
        this.callbacks.onObject('stockpile', pile.id);
        this.showNotice(`${pile.resource === 'wood' ? 'Дерево' : pile.resource === 'stone' ? 'Камень' : 'Доски'} на земле · партия ${pile.amount} ед.`);
        return;
      }
    }
    const resident = [...this.simulation.world.residents].reverse().find((person) =>
      Math.abs(person.x - x) < 28 && y > person.y - 106 && y < person.y);
    if (resident) { this.focusOn(resident.x); this.callbacks.onResident(resident.id); return; }
    if (FEATURES.roadsEnabled && y >= WORLD.groundY - ROAD_CONFIG.visualWidth && y <= WORLD.groundY + 8) {
      const road = this.simulation.world.roads.find((candidate) =>
        Math.abs(candidate.x - x) <= ROAD_CONFIG.segmentLength / 2);
      if (road) {
        this.callbacks.onObject('road', road.id);
        this.showNotice(`Дорожный сегмент · скорость на этом участке ×${ROAD_CONFIG.speedMultiplier}`);
        return;
      }
    }
    if (Math.abs(x - 234) < 115 && y > WORLD.groundY - 205 && y < WORLD.groundY) {
      const pile = this.simulation.world.stockpiles.find((candidate) => candidate.sourceId === 'home');
      this.callbacks.onObject('wood'); this.showNotice(`Лесной участок · у леса ${pile?.amount ?? 0}/10 · природный запас ${this.simulation.world.woodSource}`); return;
    }
    if (Math.abs(x - 1900) < 100 && y > WORLD.groundY - 155 && y < WORLD.groundY) {
      const pile = this.simulation.world.stockpiles.find((candidate) => candidate.sourceId === 'stone');
      this.callbacks.onObject('stone'); this.showNotice(`Каменный выход · куча ${pile?.amount ?? 0}/10 · природный запас ${this.simulation.world.stoneSource}`); return;
    }
    const homePile = this.simulation.world.stockpiles.find((candidate) => candidate.sourceId === 'home');
    if (homePile && Math.abs(homePile.x - x) < 90 && y > WORLD.groundY - 95 && y < WORLD.groundY) {
      this.callbacks.onObject('wood'); this.showNotice(`Древесина у леса · ${homePile.amount}/${homePile.capacity}`); return;
    }
    const site = this.simulation.world.sites.find((candidate) => Math.abs(candidate.x - x) < 145 &&
      y > WORLD.groundY - 310 && y < WORLD.groundY + 16);
    if (site) { this.callbacks.onObject('site', site.id); return; }
    const building = this.simulation.world.buildings.find((candidate) =>
      Math.abs(candidate.x - x) < (candidate.kind === 'sawmill' ? ART_SCALE.sawmill.width / 2 + 12 : 150) &&
      y > WORLD.groundY - (candidate.kind === 'sawmill' ? ART_SCALE.sawmill.height + 20 : 220) &&
      y < WORLD.groundY + 15);
    if (building) {
      this.callbacks.onObject('building', building.id);
      this.showNotice(building.kind === 'house' ? `Дом · уровень ${building.level ?? 1} · увеличивает вместимость жилья`
        : building.kind === 'sawmill' ? 'Лесопилка · превращает брёвна в доски' : 'Склад · увеличивает вместимость ресурсов');
      return;
    }
    for (const store of this.simulation.world.stores) {
      if (Math.abs(store.x - x) < 150 && y > WORLD.groundY - 210 && y < WORLD.groundY + 30) {
        this.callbacks.onObject(store.buildingId ? 'building' : 'store', store.buildingId ?? store.id);
        this.showNotice(`Склад · дерево ${store.wood} · камень ${store.stone} · вместимость ${store.capacity}`);
        return;
      }
    }
    const eastern = PROTOTYPE_CONFIG.easternSector;
    if (this.simulation.hasEasternForest() && Math.abs(eastern.forestX - x) < 240 && y > WORLD.groundY - 360 && y < WORLD.groundY + 35) {
      const pile = this.simulation.world.stockpiles.find((candidate) => candidate.sourceId === 'eastern');
      this.callbacks.onObject('eastern-forest');
      this.showNotice(`Лес Восточной опушки · куча ${pile?.amount ?? 0}/10 · природный запас ${this.simulation.world.easternSector.woodStock}`);
      return;
    }
    if (x >= eastern.boundaryX && x < WORLD.width && y > WORLD.groundY - 570 && y < WORLD.groundY + 50) {
      const cell = this.simulation.world.landCells.find((candidate) => {
        const bounds = landCellById(candidate.id);
        return bounds?.environment === 'surface' && (candidate.id === 9 || candidate.id >= 4) &&
          x >= bounds.left && x < bounds.right;
      });
      if (cell) {
        this.callbacks.onObject('cell', String(cell.id));
        this.showNotice(`Земельная клетка ${landCellById(cell.id)?.number ?? cell.id + 1} · ${cell.state}`);
        return;
      }
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
