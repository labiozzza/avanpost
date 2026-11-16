import Phaser from 'phaser';
import { PLOTS, PrototypeSimulation, RESOURCE_NODES, WORLD, type PrototypeResident, type PrototypeSite } from './simulation.js';

const ASSET = `${import.meta.env.BASE_URL}assets/peace-v2/`;
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

function firstPointerX(pointers: Map<number, ActivePointer>): number {
  return [...pointers.values()][0]?.x ?? 0;
}
function secondPointerX(pointers: Map<number, ActivePointer>): number {
  return [...pointers.values()][1]?.x ?? 0;
}
function firstPointerY(pointers: Map<number, ActivePointer>): number {
  return [...pointers.values()][0]?.y ?? 0;
}
function secondPointerY(pointers: Map<number, ActivePointer>): number {
  return [...pointers.values()][1]?.y ?? 0;
}

const CAMERA_ZOOM_MIN = 0.58;
const CAMERA_ZOOM_MAX = 1.35;
const SETTLEMENT_X = 535;
const OBJECT_SIZE = {
  resident: { width: 49, height: 57 },
  house: { width: 205, height: 184 },
  store: { width: 212, height: 172 },
  tree: { width: 190, height: 246 },
  stone: { width: 176, height: 128 },
  nameOffset: 68,
  selectionRadius: 28
} as const;

export class PrototypeScene extends Phaser.Scene {
  private readonly residentVisuals = new Map<string, ResidentSprite>();
  private readonly siteVisuals = new Map<string, SiteVisual>();
  private readonly staticVisuals: Phaser.GameObjects.GameObject[] = [];
  private siteLayer!: Phaser.GameObjects.Graphics;
  private markerLayer!: Phaser.GameObjects.Graphics;
  private callbacks!: SceneCallbacks;
  private lastStructureKey = '';
  private notice!: Phaser.GameObjects.Text;
  private readonly activePointers = new Map<number, ActivePointer>();
  private pinchStart: { distance: number; zoom: number } | null = null;
  private focusedX = SETTLEMENT_X;
  private cameraCenterY = WORLD.groundY;
  private firstResize = true;

  constructor(private readonly simulation: PrototypeSimulation, callbacks: SceneCallbacks) {
    super('GameplayPrototype');
    this.callbacks = callbacks;
  }

  preload(): void {
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
    for (const [key, frames] of Object.entries(ANIMATIONS)) {
      if (!this.anims.exists(key)) {
        this.anims.create({
          key, frames: frames.map((frame) => ({ key: 'worker', frame })),
          frameRate: key === 'idle' ? 1 : 7, repeat: -1
        });
      }
    }
    this.drawTerrain();
    this.siteLayer = this.add.graphics();
    this.markerLayer = this.add.graphics();
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
    this.cameraCenterY = Phaser.Math.Clamp(WORLD.groundY, height / (2 * responsiveZoom), WORLD.height - height / (2 * responsiveZoom));
    camera.centerOn(centerX, this.cameraCenterY);
    this.focusedX = centerX;
    this.firstResize = false;
    this.clampCamera();
  }

  focusSettlement(): void {
    const centerX = this.settlementFocusX();
    this.focusOn(centerX);
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.scale.width / 500, CAMERA_ZOOM_MIN, 1.05));
    this.cameraCenterY = WORLD.groundY;
    this.cameras.main.centerOn(centerX, this.cameraCenterY);
    this.focusedX = centerX;
    this.clampCamera();
  }

  private settlementFocusX(): number {
    const xPositions = [
      ...this.simulation.world.stores.map((store) => store.x),
      ...this.simulation.world.buildings.map((building) => building.x)
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
    return this.cameraCenterY + (expanded ? -45 : 0);
  }

  private focusOn(x: number): void {
    this.focusedX = Phaser.Math.Clamp(x, 0, WORLD.width);
    this.cameras.main.centerOn(this.focusedX, this.cameraCenterY);
    this.clampCamera();
  }

  private clampCamera(): void {
    const camera = this.cameras.main;
    const visibleWidth = camera.width / camera.zoom;
    const visibleHeight = camera.height / camera.zoom;
    const minX = Math.min(0, (WORLD.width - visibleWidth) / 2);
    const maxX = Math.max(minX, WORLD.width - visibleWidth);
    const minY = Math.min(0, (WORLD.height - visibleHeight) / 2);
    const maxY = Math.max(minY, WORLD.height - visibleHeight);
    camera.scrollX = Phaser.Math.Clamp(camera.scrollX, minX, maxX);
    camera.scrollY = Phaser.Math.Clamp(camera.scrollY, minY, maxY);
    this.game.canvas.dataset.cameraZoom = camera.zoom.toFixed(3);
    this.game.canvas.dataset.cameraX = camera.scrollX.toFixed(1);
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
    const previousY = active.y;
    active.x = pointer.x;
    active.y = pointer.y;

    if (this.activePointers.size >= 2) {
      active.moved = true;
      if (!this.pinchStart) this.pinchStart = { distance: this.pointerDistance(), zoom: this.cameras.main.zoom };
      const nextZoom = Phaser.Math.Clamp(
        this.pinchStart.zoom * this.pointerDistance() / Math.max(1, this.pinchStart.distance),
        CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX
      );
      const anchorX = (firstPointerX(this.activePointers) + secondPointerX(this.activePointers)) / 2;
      const anchorY = (firstPointerY(this.activePointers) + secondPointerY(this.activePointers)) / 2;
      const camera = this.cameras.main;
      const anchor = camera.getWorldPoint(anchorX, anchorY);
      camera.setZoom(nextZoom);
      const after = camera.getWorldPoint(anchorX, anchorY);
      camera.scrollX += anchor.x - after.x;
      camera.scrollY += anchor.y - after.y;
      this.clampCamera();
      this.focusedX = camera.midPoint.x;
      this.cameraCenterY = camera.midPoint.y;
      return;
    }

    if (Math.hypot(pointer.x - active.startX, pointer.y - active.startY) > 8) active.moved = true;
    if (active.moved) {
      this.cameras.main.scrollX -= (pointer.x - previousX) / this.cameras.main.zoom;
      this.cameras.main.scrollY -= (pointer.y - previousY) / this.cameras.main.zoom;
      this.clampCamera();
      this.focusedX = this.cameras.main.midPoint.x;
      this.cameraCenterY = this.cameras.main.midPoint.y;
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
    const wood = RESOURCE_NODES.wood;
    const rock = RESOURCE_NODES.stone;
    const shadows = this.add.graphics().setDepth(0);
    shadows.fillStyle(0x273528, 0.2).fillEllipse(wood.x, wood.y - 5, 142, 24)
      .fillEllipse(rock.x, rock.y - 3, 120, 22);
    const tree = this.add.image(wood.x, wood.y, 'tree').setOrigin(0.5, 1)
      .setDisplaySize(OBJECT_SIZE.tree.width, OBJECT_SIZE.tree.height);
    tree.setDepth(wood.y - 1);
    const stone = this.add.image(rock.x, rock.y, 'stone-outcrop').setOrigin(0.5, 1)
      .setDisplaySize(OBJECT_SIZE.stone.width, OBJECT_SIZE.stone.height);
    stone.setDepth(rock.y - 1);
    shadows.setDepth(Math.max(wood.y, rock.y) - 2);
    const treeName = this.add.text(wood.x, wood.y - OBJECT_SIZE.tree.height - 8, 'Лесной участок', { ...this.labelStyle(), fontSize: '14px', color: '#3d5d37' }).setOrigin(0.5).setDepth(wood.y + 40);
    const stoneName = this.add.text(rock.x, rock.y - OBJECT_SIZE.stone.height - 8, 'Каменный выход', { ...this.labelStyle(), fontSize: '14px', color: '#4d6263' }).setOrigin(0.5).setDepth(rock.y + 40);
    this.staticVisuals.push(shadows, tree, stone, treeName, stoneName);

  }

  private drawTerrain(): void {
    const terrain = this.add.graphics().setDepth(-100);
    const points = [
      new Phaser.Math.Vector2(0, 190), new Phaser.Math.Vector2(170, 125),
      new Phaser.Math.Vector2(490, 95), new Phaser.Math.Vector2(830, 135),
      new Phaser.Math.Vector2(1210, 100), new Phaser.Math.Vector2(1535, 150),
      new Phaser.Math.Vector2(1700, 240), new Phaser.Math.Vector2(1700, 1660),
      new Phaser.Math.Vector2(1450, 1755), new Phaser.Math.Vector2(1110, 1780),
      new Phaser.Math.Vector2(760, 1750), new Phaser.Math.Vector2(390, 1785),
      new Phaser.Math.Vector2(95, 1700), new Phaser.Math.Vector2(0, 1610)
    ];
    terrain.fillStyle(0x514b37, 0.62).fillPoints(points.map((point) => new Phaser.Math.Vector2(point.x + 6, point.y + 18)), true);
    terrain.fillStyle(0x927c53, 1).fillPoints(points, true);
    terrain.lineStyle(18, 0x71834c, 0.78).strokePoints(points, true);
    terrain.fillStyle(0x87945a, 0.54).fillPoints([
      new Phaser.Math.Vector2(0, 630), new Phaser.Math.Vector2(260, 570), new Phaser.Math.Vector2(700, 590),
      new Phaser.Math.Vector2(890, 690), new Phaser.Math.Vector2(740, 785), new Phaser.Math.Vector2(270, 800),
      new Phaser.Math.Vector2(0, 760)
    ], true);
    terrain.fillStyle(0x829057, 0.56).fillPoints([
      new Phaser.Math.Vector2(1020, 560), new Phaser.Math.Vector2(1390, 565), new Phaser.Math.Vector2(1700, 690),
      new Phaser.Math.Vector2(1700, 850), new Phaser.Math.Vector2(1440, 900), new Phaser.Math.Vector2(1120, 820)
    ], true);
    const path = this.add.graphics().setDepth(-90);
    path.lineStyle(42, 0x6d6248, 0.58);
    const trails = [
      [[250, 850], [440, 850], [620, 875], [812, 860], [1040, 910], [1330, 900], [1490, 790]],
      [[812, 860], [780, 1010], [650, 1110], [630, 1310], [850, 1430]],
      [[812, 860], [940, 760], [1032, 720]],
      [[850, 1430], [1080, 1330], [1270, 1200], [1450, 1280]]
    ];
    for (const trail of trails) {
      for (let index = 1; index < trail.length; index++) {
        const [x1, y1] = trail[index - 1]!;
        const [x2, y2] = trail[index]!;
        path.lineBetween(x1!, y1!, x2!, y2!);
      }
    }
    path.lineStyle(25, 0xb19a69, 0.42);
    for (const trail of trails) {
      for (let index = 1; index < trail.length; index++) {
        const [x1, y1] = trail[index - 1]!;
        const [x2, y2] = trail[index]!;
        path.lineBetween(x1!, y1!, x2!, y2!);
      }
    }
    const flecks = this.add.graphics().setDepth(-80);
    for (const [x, y, radius] of [
      [370, 620, 5], [490, 720, 4], [680, 610, 5], [1180, 650, 4], [1370, 730, 5],
      [350, 1130, 4], [1020, 1190, 5], [1320, 1410, 4], [500, 1440, 5], [1510, 1080, 4]
    ]) flecks.fillCircle(x!, y!, radius!);
  }

  private syncStructure(): void {
    const key = JSON.stringify({
      stores: this.simulation.world.stores.map(({ id, x, y }) => [id, x, y]),
      buildings: this.simulation.world.buildings.map(({ id, kind, x, y }) => [id, kind, x, y])
    });
    if (key === this.lastStructureKey) return;
    this.lastStructureKey = key;
    for (const visual of this.staticVisuals) visual.destroy();
    this.staticVisuals.length = 0;
    this.drawStaticWorld();
    for (const store of this.simulation.world.stores) {
      const shadow = this.add.ellipse(store.x, store.y - 4, 180, 26, 0x273528, 0.2).setDepth(store.y - 1);
      const sprite = this.add.image(store.x, store.y, 'storehouse').setOrigin(0.5, 1)
        .setDisplaySize(OBJECT_SIZE.store.width, OBJECT_SIZE.store.height).setDepth(store.y);
      const label = this.add.text(store.x, store.y - OBJECT_SIZE.store.height - 8, `Склад · ${store.capacity}`, {
        ...this.labelStyle(), color: '#52676a', fontSize: '14px'
      }).setOrigin(0.5).setDepth(store.y + 40);
      const stock = this.add.text(store.x, store.y + 8, `${store.wood}🪵  ${store.stone}◈`, {
        ...this.labelStyle(), fontSize: '12px', backgroundColor: '#ffffffcc', padding: { x: 5, y: 3 }
      }).setOrigin(0.5, 0).setDepth(store.y + 42);
      this.staticVisuals.push(shadow, sprite, label, stock);
    }
    for (const building of this.simulation.world.buildings) {
      const size = building.kind === 'house' ? OBJECT_SIZE.house : OBJECT_SIZE.store;
      const sprite = this.add.image(building.x, building.y, building.kind === 'house' ? 'house' : 'storehouse')
        .setOrigin(0.5, 1).setDisplaySize(size.width, size.height).setDepth(building.y);
      const label = this.add.text(building.x, building.y - size.height - 8,
        building.kind === 'house' ? 'Дом' : 'Склад', { ...this.labelStyle(), color: '#465a46' }).setOrigin(0.5).setDepth(building.y + 40);
      const shadow = this.add.ellipse(building.x, building.y - 4, 174, 25, 0x273528, 0.2).setDepth(building.y - 1);
      this.staticVisuals.push(shadow, sprite, label);
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
    const size = site.kind === 'house' ? OBJECT_SIZE.house : OBJECT_SIZE.store;
    let visual = this.siteVisuals.get(site.id);
    if (!visual) {
      const sprite = this.add.image(site.x, site.y, site.kind === 'house' ? 'house' : 'storehouse')
        .setOrigin(0.5, 1).setDisplaySize(size.width, size.height)
        .setDepth(site.y).setVisible(false);
      const label = this.add.text(site.x, site.y - 119, site.kind === 'house' ? 'Площадка дома' : 'Площадка склада', {
        ...this.labelStyle(), fontSize: '13px', color: '#3b4e3f'
      }).setOrigin(0.5).setDepth(65);
      visual = { sprite, label };
      this.siteVisuals.set(site.id, visual);
    }
    visual.sprite.setVisible(stage >= 2).setAlpha(0.55 + site.progress * 0.35);
    if (stage >= 2) visual.sprite.setDepth(40);
    this.siteLayer.fillStyle(0x84653f, 0.48);
    this.siteLayer.fillRoundedRect(site.x - 51, site.y - 14, 102, 13, 4);
    this.siteLayer.fillStyle(0xba8a52, 0.8);
    this.siteLayer.fillRoundedRect(site.x - 42, site.y - 19, 84, 6, 2);
    this.siteLayer.fillRoundedRect(site.x - 42, site.y - 13, 6, 10, 2);
    this.siteLayer.fillRoundedRect(site.x + 36, site.y - 13, 6, 10, 2);
    this.siteLayer.lineStyle(3, stage >= 1 ? 0x95633b : 0xb1844f, 1);
    this.siteLayer.fillStyle(0xe0c993, 0.2);
    this.siteLayer.fillRect(site.x - 42, site.y - 49, 84, 31);
    this.siteLayer.strokeRect(site.x - 42, site.y - 49, 84, 31);
    if (stage >= 1) {
      this.siteLayer.lineBetween(site.x - 38, site.y - 16, site.x - 38, site.y - 80);
      this.siteLayer.lineBetween(site.x + 38, site.y - 16, site.x + 38, site.y - 80);
      this.siteLayer.lineBetween(site.x - 38, site.y - 80, site.x + 38, site.y - 80);
      this.siteLayer.lineBetween(site.x - 38, site.y - 49, site.x + 38, site.y - 80);
      this.siteLayer.lineBetween(site.x + 38, site.y - 49, site.x - 38, site.y - 80);
    }
    this.siteLayer.fillStyle(0x304338, 0.65);
    this.siteLayer.fillRoundedRect(site.x - 42, site.y - 103, 84, 18, 5);
    this.siteLayer.fillStyle(0xf4d988, 0.95);
    this.siteLayer.fillRoundedRect(site.x - 39, site.y - 100, 78 * site.progress, 12, 4);
    const materials = `${site.deliveredWood}/${cost.wood} дерева · ${site.deliveredStone}/${cost.stone} камня`;
    const labelText = `${site.kind === 'house' ? 'Дом' : 'Склад'} · ${materials}`;
    if (visual.label.text !== labelText) visual.label.setText(labelText);
      visual.label.setPosition(site.x, site.y - size.height - 24).setDepth(site.y + 45);
  }

  private syncResident(person: PrototypeResident): void {
    let view = this.residentVisuals.get(person.id);
    if (!view) {
      const sprite = this.add.sprite(person.x, person.y, 'worker', 0).setOrigin(0.5, 1)
        .setDisplaySize(OBJECT_SIZE.resident.width, OBJECT_SIZE.resident.height);
      const tint = person.id === 'r2' ? 0xd6b28c : person.id === 'r3' ? 0x8da57b : 0xc28d60;
      sprite.setTint(tint).setDepth(50);
       const name = this.add.text(person.x, person.y - OBJECT_SIZE.nameOffset, person.name, {
        fontFamily: 'DM Sans, sans-serif', fontSize: '14px', color: '#344539',
        backgroundColor: '#f8f8eddd', padding: { x: 5, y: 3 }
      }).setOrigin(0.5, 1).setDepth(55);
      const selection = this.add.circle(person.x, person.y - 5, OBJECT_SIZE.selectionRadius, 0x85bc7a, 0.13)
        .setStrokeStyle(2, 0x49805d, 0.9).setDepth(45);
      const cargo = this.add.graphics().setDepth(60);
      view = { sprite, name, selection, cargo, animation: '' };
      this.residentVisuals.set(person.id, view);
    }
    view.sprite.setPosition(person.x, person.y);
     view.name.setPosition(person.x, person.y - OBJECT_SIZE.nameOffset);
     view.selection.setPosition(person.x, person.y - 5).setVisible(this.callbacks.isSelected(person.id));
     view.sprite.setDepth(person.y + 20);
     view.name.setDepth(person.y + 25);
     view.selection.setDepth(person.y + 19);
     view.cargo.setDepth(person.y + 30);
    view.cargo.clear();
    if (person.cargo) {
      view.cargo.fillStyle(person.cargo === 'wood' ? 0x8d552d : 0x87959a, 1);
      if (person.cargo === 'wood') {
       view.cargo.fillRoundedRect(person.x - 14, person.y - 46, 27, 7, 3);
       view.cargo.lineStyle(2, 0xc8945e, 1).lineBetween(person.x - 9, person.y - 49, person.x + 10, person.y - 49);
      } else {
       view.cargo.fillCircle(person.x, person.y - 48, 6);
       view.cargo.fillStyle(0xb8c1c1, 1).fillCircle(person.x - 3, person.y - 51, 2);
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
      Math.abs(person.x - x) < 30 && y > person.y - OBJECT_SIZE.resident.height - 12 && y < person.y + 8);
    if (resident) { this.focusOn(resident.x); this.callbacks.onResident(resident.id); return; }
    const wood = RESOURCE_NODES.wood;
    if (Math.abs(x - wood.x) < OBJECT_SIZE.tree.width / 2 && y > wood.y - OBJECT_SIZE.tree.height && y < wood.y) {
      this.callbacks.onObject('wood'); this.showNotice(`Лесной участок · ${this.simulation.world.woodSource} единиц древесины`); return;
    }
    const rock = RESOURCE_NODES.stone;
    if (Math.abs(x - rock.x) < OBJECT_SIZE.stone.width / 2 && y > rock.y - OBJECT_SIZE.stone.height && y < rock.y) {
      this.callbacks.onObject('stone'); this.showNotice(`Каменный выход · ${this.simulation.world.stoneSource} единиц камня`); return;
    }
    for (const store of this.simulation.world.stores) {
      if (Math.abs(store.x - x) < OBJECT_SIZE.store.width / 2 && y > store.y - OBJECT_SIZE.store.height && y < store.y + 30) {
        this.callbacks.onObject('store', store.id);
        this.showNotice(`Склад · дерево ${store.wood} · камень ${store.stone} · вместимость ${store.capacity}`);
        return;
      }
    }
    if (this.callbacks.isPlacing()) {
      const plot = PLOTS.find((candidate) => Math.abs(candidate.x - x) < 48 && Math.abs(candidate.y - y) < 68);
      if (plot) this.callbacks.onPlot(plot.id);
      return;
    }
    const building = this.simulation.world.buildings.find((candidate) => {
      const size = candidate.kind === 'house' ? OBJECT_SIZE.house : OBJECT_SIZE.store;
      return Math.abs(candidate.x - x) < size.width / 2 && y > candidate.y - size.height && y < candidate.y + 15;
    });
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
