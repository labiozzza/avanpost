import Phaser from 'phaser';
import { PLOTS, PrototypeSimulation, WORLD, type PrototypeResident, type PrototypeSite } from './simulation.js';

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
  onObject: (kind: 'wood' | 'stone' | 'store' | 'building', id?: string) => void;
  isSelected: (id: string) => boolean;
  isPlacing: () => boolean;
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

interface ActivePointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const CAMERA_ZOOM_MIN = 0.58;
const CAMERA_ZOOM_MAX = 1.35;
const SETTLEMENT_X = 963;

export class PrototypeScene extends Phaser.Scene {
  private readonly residentVisuals = new Map<string, ResidentSprite>();
  private readonly siteVisuals = new Map<string, SiteVisual>();
  private staticLayer!: Phaser.GameObjects.Container;
  private siteLayer!: Phaser.GameObjects.Graphics;
  private markerLayer!: Phaser.GameObjects.Graphics;
  private callbacks!: SceneCallbacks;
  private lastStructureKey = '';
  private notice!: Phaser.GameObjects.Text;
  private readonly activePointers = new Map<number, ActivePointer>();
  private pinchStart: { distance: number; zoom: number } | null = null;
  private focusedX = SETTLEMENT_X;
  private cameraCenterY = WORLD.groundY + 100;
  private firstResize = true;

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
    this.lastStructureKey = '';
    this.firstResize = true;
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
    this.add.image(WORLD.width / 2, WORLD.groundY - 320, 'panorama')
      .setDisplaySize(WORLD.width, WORLD.width / 3).setDepth(-30).setScrollFactor(1, 1);
    const turf = this.add.tileSprite(WORLD.width / 2, WORLD.groundY - 1, WORLD.width, 44, 'turf-tile')
      .setDepth(-10);
    turf.setTileScale(1, 1);
    const topsoil = this.add.tileSprite(WORLD.width / 2, WORLD.groundY + 95, WORLD.width, 190, 'geology-atlas', 'topsoil')
      .setDepth(-11);
    const clay = this.add.tileSprite(WORLD.width / 2, WORLD.groundY + 315, WORLD.width, 250, 'geology-atlas', 'clay')
      .setDepth(-12);
    const strata = this.add.tileSprite(WORLD.width / 2, WORLD.groundY + 605, WORLD.width, 310, 'geology-atlas', 'strata')
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
  }

  private resizeWorld(width: number, height: number): void {
    const camera = this.cameras.main;
    const centerX = this.firstResize ? this.settlementFocusX() : camera.midPoint.x;
    const responsiveZoom = Phaser.Math.Clamp(width / 500, CAMERA_ZOOM_MIN, 1.05);
    camera.setZoom(responsiveZoom);
    this.cameraCenterY = WORLD.groundY + height * 0.15 / responsiveZoom;
    camera.centerOn(centerX, this.cameraCenterY);
    this.focusedX = centerX;
    this.firstResize = false;
    this.clampCameraX();
  }

  focusSettlement(): void {
    const centerX = this.settlementFocusX();
    this.focusOn(centerX);
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.scale.width / 500, CAMERA_ZOOM_MIN, 1.05));
    this.cameraCenterY = WORLD.groundY + this.scale.height * 0.15 / this.cameras.main.zoom;
    this.cameras.main.centerOn(centerX, this.cameraCenterY);
    this.focusedX = centerX;
    this.clampCameraX();
  }

  private settlementFocusX(): number {
    const xPositions = [
      ...this.simulation.world.stores.map((store) => store.x),
      ...this.simulation.world.buildings.map((building) => building.x),
      PLOTS[1].x
    ];
    if (xPositions.length === 0) return SETTLEMENT_X;
    return (Math.min(...xPositions) + Math.max(...xPositions)) / 2;
  }

  focusResident(residentId: string): void {
    const resident = this.simulation.world.residents.find((person) => person.id === residentId);
    if (!resident) return;
    this.cameraCenterY = this.residentCameraCenterY(false);
    this.focusOn(resident.x);
  }

  setResidentSheetExpanded(expanded: boolean): void {
    this.cameraCenterY = this.residentCameraCenterY(expanded);
    this.focusOn(this.focusedX);
  }

  private residentCameraCenterY(expanded: boolean): number {
    const targetFloor = this.scale.height * (expanded ? 0.42 : 0.6);
    return WORLD.groundY - (targetFloor - this.scale.height / 2) / this.cameras.main.zoom;
  }

  private focusOn(x: number): void {
    this.focusedX = Phaser.Math.Clamp(x, 0, WORLD.width);
    this.cameras.main.centerOn(this.focusedX, this.cameraCenterY);
    this.clampCameraX();
  }

  private clampCameraX(): void {
    const camera = this.cameras.main;
    const visibleWidth = camera.width / camera.zoom;
    const minX = Math.min(0, (WORLD.width - visibleWidth) / 2);
    const maxX = Math.max(minX, WORLD.width - visibleWidth);
    camera.scrollX = Phaser.Math.Clamp(camera.scrollX, minX, maxX);
    this.game.canvas.dataset.cameraZoom = camera.zoom.toFixed(3);
    this.game.canvas.dataset.cameraX = camera.scrollX.toFixed(1);
    this.clampCameraY();
  }

  private clampCameraY(): void {
    const camera = this.cameras.main;
    const visibleHeight = camera.height / camera.zoom;
    const minY = Math.min(0, (WORLD.height - visibleHeight) / 2);
    const maxY = Math.max(minY, WORLD.height - visibleHeight);
    camera.scrollY = Phaser.Math.Clamp(camera.scrollY, minY, maxY);
    this.cameraCenterY = camera.midPoint.y;
    this.game.canvas.dataset.cameraY = camera.scrollY.toFixed(1);
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    this.activePointers.set(pointer.id, {
      x: pointer.x, y: pointer.y, startX: pointer.x, startY: pointer.y, moved: false
    });
    if (this.activePointers.size >= 2) {
      for (const active of this.activePointers.values()) active.moved = true;
      this.pinchStart = { distance: this.pointerDistance(), zoom: this.cameras.main.zoom };
    }
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    const active = this.activePointers.get(pointer.id);
    if (!active) return;
    const previousX = active.x;
    active.x = pointer.x;
    active.y = pointer.y;

    if (this.activePointers.size >= 2) {
      active.moved = true;
      if (!this.pinchStart) this.pinchStart = { distance: this.pointerDistance(), zoom: this.cameras.main.zoom };
      const nextZoom = Phaser.Math.Clamp(
        this.pinchStart.zoom * this.pointerDistance() / Math.max(1, this.pinchStart.distance),
        CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX
      );
      this.cameraCenterY = this.cameras.main.midPoint.y;
      this.cameras.main.setZoom(nextZoom);
      this.focusOn(this.focusedX);
      return;
    }

    if (Math.hypot(pointer.x - active.startX, pointer.y - active.startY) > 8) active.moved = true;
    if (active.moved) {
      this.cameras.main.scrollX -= (pointer.x - previousX) / this.cameras.main.zoom;
      this.cameras.main.scrollY -= (pointer.y - active.startY) / this.cameras.main.zoom;
      active.startY = pointer.y;
      this.clampCameraX();
      this.clampCameraY();
      this.focusedX = this.cameras.main.midPoint.x;
    }
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    const active = this.activePointers.get(pointer.id);
    if (!active) return;
    const wasMultiTouch = this.pinchStart !== null || this.activePointers.size > 1;
    this.activePointers.delete(pointer.id);
    if (wasMultiTouch) {
      this.pinchStart = null;
      return;
    }
    if (!active.moved) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.handlePointer(worldPoint.x, worldPoint.y);
    }
  }

  private pointerDistance(): number {
    const [first, second] = [...this.activePointers.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 1;
  }

  private drawStaticWorld(): void {
    const tree = this.add.image(234, WORLD.groundY + 5, 'tree').setOrigin(0.5, 1)
      .setDisplaySize(ART_SCALE.tree.width, ART_SCALE.tree.height).setDepth(30);
    const stone = this.add.image(1900, WORLD.groundY + 5, 'stone-outcrop').setOrigin(0.5, 1)
      .setDisplaySize(ART_SCALE.stone.width, ART_SCALE.stone.height).setDepth(30);
    const treeName = this.add.text(234, WORLD.groundY - 205, 'Лесной участок', { ...this.labelStyle(), fontSize: '14px', color: '#3d5d37' }).setOrigin(0.5).setDepth(70);
    const stoneName = this.add.text(1900, WORLD.groundY - 155, 'Каменный выход', { ...this.labelStyle(), fontSize: '14px', color: '#4d6263' }).setOrigin(0.5).setDepth(70);
    this.staticLayer.add([tree, stone, treeName, stoneName]);

  }

  private syncStructure(): void {
    const key = JSON.stringify({
      stores: this.simulation.world.stores.map(({ id, x }) => [id, x]),
      buildings: this.simulation.world.buildings.map(({ id, kind, x }) => [id, kind, x])
    });
    if (key === this.lastStructureKey) return;
    this.lastStructureKey = key;
    this.staticLayer.removeAll(true);
    this.drawStaticWorld();
    for (const store of this.simulation.world.stores) {
      const sprite = this.add.image(store.x, WORLD.groundY + 5, 'storehouse').setOrigin(0.5, 1)
        .setDisplaySize(ART_SCALE.store.width, ART_SCALE.store.height).setDepth(35);
      const label = this.add.text(store.x, WORLD.groundY - 200, `Склад · ${store.capacity}`, {
        ...this.labelStyle(), color: '#52676a', fontSize: '14px'
      }).setOrigin(0.5).setDepth(70);
      const stock = this.add.text(store.x, WORLD.groundY - 174, `${store.wood}🪵  ${store.stone}◈`, {
        ...this.labelStyle(), fontSize: '12px', backgroundColor: '#ffffffcc', padding: { x: 5, y: 3 }
      }).setOrigin(0.5, 0).setDepth(71);
      this.staticLayer.add([sprite, label, stock]);
    }
    for (const building of this.simulation.world.buildings.filter((candidate) => candidate.kind === 'house')) {
      const sprite = this.add.image(building.x, WORLD.groundY, building.kind === 'house' ? 'house' : 'storehouse')
        .setOrigin(0.5, 1).setDisplaySize(
          building.kind === 'house' ? ART_SCALE.house.width : ART_SCALE.store.width,
          building.kind === 'house' ? ART_SCALE.house.height : ART_SCALE.store.height
        ).setDepth(35);
      const label = this.add.text(building.x, WORLD.groundY - (building.kind === 'house' ? 204 : 200),
        building.kind === 'house' ? 'Дом' : 'Склад', { ...this.labelStyle(), color: '#465a46' }).setOrigin(0.5).setDepth(70);
      this.staticLayer.add([sprite, label]);
    }
  }

  private drawPlots(): void {
    this.markerLayer.clear();
    if (!this.callbacks.isPlacing()) return;
    for (const plot of PLOTS) {
      if (this.simulation.world.occupiedPlots.includes(plot.id)) continue;
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
        visual.label.destroy();
        this.siteVisuals.delete(id);
      }
    }
    for (const site of this.simulation.world.sites) this.drawSite(site);
  }

  private drawSite(site: PrototypeSite): void {
    const cost = site.kind === 'house' ? { wood: 6, stone: 5 } : { wood: 5, stone: 4 };
    const stage = site.stage;
    let visual = this.siteVisuals.get(site.id);
    if (!visual) {
      const sprite = this.add.image(site.x, site.y, site.kind === 'house' ? 'house' : 'storehouse')
        .setOrigin(0.5, 1).setDisplaySize(
          site.kind === 'house' ? ART_SCALE.house.width : ART_SCALE.store.width,
          site.kind === 'house' ? ART_SCALE.house.height : ART_SCALE.store.height
        )
        .setDepth(40).setVisible(false);
      const label = this.add.text(site.x, site.y - 119, site.kind === 'house' ? 'Площадка дома' : 'Площадка склада', {
        ...this.labelStyle(), fontSize: '13px', color: '#3b4e3f'
      }).setOrigin(0.5).setDepth(65);
      visual = { sprite, label };
      this.siteVisuals.set(site.id, visual);
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
    const materials = `${site.deliveredWood}/${cost.wood} дерева · ${site.deliveredStone}/${cost.stone} камня`;
    const labelText = `${site.kind === 'house' ? 'Дом' : 'Склад'} · ${materials}`;
    if (visual.label.text !== labelText) visual.label.setText(labelText);
     visual.label.setPosition(site.x, site.y - 298);
  }

  private syncResident(person: PrototypeResident): void {
    let view = this.residentVisuals.get(person.id);
    if (!view) {
      const sprite = this.add.sprite(person.x, person.y, 'worker', 0).setOrigin(0.5, 1).setScale(ART_SCALE.residentScale);
      const tint = person.id === 'r2' ? 0xd6b28c : person.id === 'r3' ? 0x8da57b : 0xc28d60;
      sprite.setTint(tint).setDepth(50);
      const name = this.add.text(person.x, person.y - 104, person.name, {
        fontFamily: 'DM Sans, sans-serif', fontSize: '13px', color: '#344539',
        backgroundColor: '#f8f8eddd', padding: { x: 5, y: 3 }
      }).setOrigin(0.5, 1).setDepth(75);
      const selection = this.add.circle(person.x, person.y - 5, 24, 0x85bc7a, 0.13)
        .setStrokeStyle(2, 0x49805d, 0.9).setDepth(45);
      const cargo = this.add.graphics().setDepth(60);
      view = { sprite, name, selection, cargo, animation: '' };
      this.residentVisuals.set(person.id, view);
    }
    view.sprite.setPosition(person.x, person.y);
     view.name.setPosition(person.x, person.y - 104);
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
    if (this.callbacks.isPlacing()) {
      const plot = PLOTS.find((candidate) => Math.abs(candidate.x - x) < 110 && Math.abs(candidate.y - y) < 90);
      if (plot) this.callbacks.onPlot(plot.id);
      return;
    }
    const building = this.simulation.world.buildings.find((candidate) => Math.abs(candidate.x - x) < 150 &&
      y > WORLD.groundY - 220 && y < WORLD.groundY + 15);
    if (building) { this.callbacks.onObject('building', building.id); this.showNotice(building.kind === 'house' ? 'Дом · увеличивает вместимость жилья' : 'Склад · увеличивает вместимость ресурсов'); }
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
