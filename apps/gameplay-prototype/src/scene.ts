import Phaser from 'phaser';
import { PLOTS, PrototypeSimulation, WORLD, type PrototypeResident, type PrototypeSite } from './simulation.js';

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

export class PrototypeScene extends Phaser.Scene {
  private readonly residentVisuals = new Map<string, ResidentSprite>();
  private readonly siteVisuals = new Map<string, SiteVisual>();
  private staticLayer!: Phaser.GameObjects.Container;
  private siteLayer!: Phaser.GameObjects.Graphics;
  private markerLayer!: Phaser.GameObjects.Graphics;
  private sourceLabels: Phaser.GameObjects.Text[] = [];
  private callbacks!: SceneCallbacks;
  private lastStructureKey = '';
  private notice!: Phaser.GameObjects.Text;

  constructor(private readonly simulation: PrototypeSimulation, callbacks: SceneCallbacks) {
    super('GameplayPrototype');
    this.callbacks = callbacks;
  }

  preload(): void {
    this.load.image('panorama', `${ASSET}background-panorama.png`);
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
    this.sourceLabels = [];
    this.lastStructureKey = '';
    for (const [key, frames] of Object.entries(ANIMATIONS)) {
      if (!this.anims.exists(key)) {
        this.anims.create({
          key, frames: frames.map((frame) => ({ key: 'worker', frame })),
          frameRate: key === 'idle' ? 1 : 7, repeat: -1
        });
      }
    }
    this.add.image(WORLD.width / 2, 186, 'panorama')
      .setDisplaySize(WORLD.width, WORLD.width * 724 / 2172).setAlpha(0.92);
    const ground = this.add.graphics();
    ground.fillStyle(0x789351, 0.26).fillRect(0, WORLD.groundY - 68, WORLD.width, WORLD.height - WORLD.groundY + 100);
    ground.fillStyle(0x9eaa68, 0.62).fillRect(0, WORLD.groundY - 9, WORLD.width, 20);
    ground.lineStyle(3, 0x7c8b51, 0.7).lineBetween(0, WORLD.groundY, WORLD.width, WORLD.groundY);
    this.staticLayer = this.add.container(0, 0);
    this.siteLayer = this.add.graphics();
    this.markerLayer = this.add.graphics();
    this.notice = this.add.text(WORLD.width / 2, 32, ' ', {
      fontFamily: 'DM Sans, sans-serif', fontSize: '14px', color: '#35543d', backgroundColor: '#f8f7e9dd',
      padding: { x: 11, y: 7 }
    }).setOrigin(0.5, 0).setDepth(100).setAlpha(0);

    this.drawStaticWorld();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handlePointer(pointer.worldX, pointer.worldY));
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
    const fit = Math.min(width / WORLD.width, height / WORLD.height);
    this.cameras.main.setZoom(fit);
    this.cameras.main.centerOn(WORLD.width / 2, WORLD.height / 2);
  }

  private drawStaticWorld(): void {
    const tree = this.add.image(130, WORLD.groundY, 'tree').setOrigin(0.5, 1).setDisplaySize(126, 164);
    const stone = this.add.image(985, WORLD.groundY + 2, 'stone-outcrop').setOrigin(0.5, 1).setDisplaySize(112, 86);
    const treeLabel = this.add.text(130, WORLD.groundY - 176, 'Запас древесины', this.labelStyle()).setOrigin(0.5);
    const stoneLabel = this.add.text(985, WORLD.groundY - 96, 'Запас камня', this.labelStyle()).setOrigin(0.5);
    const treeName = this.add.text(130, WORLD.groundY - 182, 'Лесной участок', { ...this.labelStyle(), fontSize: '11px', color: '#3d5d37' }).setOrigin(0.5);
    const stoneName = this.add.text(985, WORLD.groundY - 108, 'Каменный выход', { ...this.labelStyle(), fontSize: '11px', color: '#4d6263' }).setOrigin(0.5);
    this.sourceLabels.push(treeLabel, stoneLabel);
    this.staticLayer.add([tree, stone, treeName, treeLabel, stoneName, stoneLabel]);

    const clouds = this.add.graphics();
    clouds.fillStyle(0xf8f3d9, 0.35);
    clouds.fillEllipse(380, 80, 170, 22);
    clouds.fillEllipse(850, 120, 205, 18);
    this.staticLayer.add(clouds);
  }

  private syncStructure(): void {
    const key = JSON.stringify({
      stores: this.simulation.world.stores.map(({ id, x }) => [id, x]),
      buildings: this.simulation.world.buildings.map(({ id, kind, x }) => [id, kind, x])
    });
    if (key === this.lastStructureKey) return;
    this.lastStructureKey = key;
    this.staticLayer.removeAll(true);
    this.sourceLabels = [];
    this.drawStaticWorld();
    for (const store of this.simulation.world.stores) {
      const sprite = this.add.image(store.x, WORLD.groundY, 'storehouse').setOrigin(0.5, 1).setDisplaySize(128, 104);
      const label = this.add.text(store.x, WORLD.groundY - 113, `Склад · ${store.capacity}`, {
        ...this.labelStyle(), color: '#52676a', fontSize: '11px'
      }).setOrigin(0.5);
      const stock = this.add.text(store.x, WORLD.groundY + 10, `${store.wood}🪵  ${store.stone}◈`, {
        ...this.labelStyle(), fontSize: '10px', backgroundColor: '#ffffffcc', padding: { x: 5, y: 3 }
      }).setOrigin(0.5, 0);
      this.staticLayer.add([sprite, label, stock]);
    }
    for (const building of this.simulation.world.buildings.filter((candidate) => candidate.kind === 'house')) {
      const sprite = this.add.image(building.x, WORLD.groundY, building.kind === 'house' ? 'house' : 'storehouse')
        .setOrigin(0.5, 1).setDisplaySize(building.kind === 'house' ? 126 : 128, building.kind === 'house' ? 112 : 104);
      const label = this.add.text(building.x, WORLD.groundY - (building.kind === 'house' ? 120 : 113),
        building.kind === 'house' ? 'Дом' : 'Склад', { ...this.labelStyle(), color: '#465a46' }).setOrigin(0.5);
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
        .setOrigin(0.5, 1).setDisplaySize(site.kind === 'house' ? 126 : 128, site.kind === 'house' ? 112 : 104)
        .setDepth(40).setVisible(false);
      const label = this.add.text(site.x, site.y - 119, site.kind === 'house' ? 'Площадка дома' : 'Площадка склада', {
        ...this.labelStyle(), fontSize: '10px', color: '#3b4e3f'
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
    visual.label.setPosition(site.x, site.y - 119);
  }

  private syncResident(person: PrototypeResident): void {
    let view = this.residentVisuals.get(person.id);
    if (!view) {
      const sprite = this.add.sprite(person.x, person.y, 'worker', 0).setOrigin(0.5, 1).setScale(0.44);
      const tint = person.id === 'r2' ? 0xd6b28c : person.id === 'r3' ? 0x8da57b : 0xc28d60;
      sprite.setTint(tint).setDepth(50);
      const name = this.add.text(person.x, person.y - 102, person.name, {
        fontFamily: 'DM Sans, sans-serif', fontSize: '10px', color: '#344539',
        backgroundColor: '#f8f8eddd', padding: { x: 5, y: 3 }
      }).setOrigin(0.5, 1).setDepth(55);
      const selection = this.add.circle(person.x, person.y - 7, 36, 0x85bc7a, 0.13)
        .setStrokeStyle(2, 0x49805d, 0.9).setDepth(45);
      const cargo = this.add.graphics().setDepth(60);
      view = { sprite, name, selection, cargo, animation: '' };
      this.residentVisuals.set(person.id, view);
    }
    view.sprite.setPosition(person.x, person.y);
    view.name.setPosition(person.x, person.y - 102);
    view.selection.setPosition(person.x, person.y - 34).setVisible(this.callbacks.isSelected(person.id));
    view.cargo.clear();
    if (person.cargo) {
      view.cargo.fillStyle(person.cargo === 'wood' ? 0x8d552d : 0x87959a, 1);
      if (person.cargo === 'wood') {
        view.cargo.fillRoundedRect(person.x - 14, person.y - 105, 27, 7, 3);
        view.cargo.lineStyle(2, 0xc8945e, 1).lineBetween(person.x - 9, person.y - 108, person.x + 10, person.y - 108);
      } else {
        view.cargo.fillCircle(person.x, person.y - 108, 8);
        view.cargo.fillStyle(0xb8c1c1, 1).fillCircle(person.x - 3, person.y - 111, 3);
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
      Math.abs(person.x - x) < 26 && y > person.y - 103 && y < person.y);
    if (resident) { this.callbacks.onResident(resident.id); return; }
    if (Math.abs(x - 130) < 74 && y > WORLD.groundY - 176 && y < WORLD.groundY) {
      this.callbacks.onObject('wood'); this.showNotice(`Лесной участок · ${this.simulation.world.woodSource} единиц древесины`); return;
    }
    if (Math.abs(x - 985) < 70 && y > WORLD.groundY - 110 && y < WORLD.groundY) {
      this.callbacks.onObject('stone'); this.showNotice(`Каменный выход · ${this.simulation.world.stoneSource} единиц камня`); return;
    }
    for (const store of this.simulation.world.stores) {
      if (Math.abs(store.x - x) < 70 && y > WORLD.groundY - 120 && y < WORLD.groundY + 30) {
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
    const building = this.simulation.world.buildings.find((candidate) => Math.abs(candidate.x - x) < 65 &&
      y > WORLD.groundY - 130 && y < WORLD.groundY + 15);
    if (building) { this.callbacks.onObject('building', building.id); this.showNotice(building.kind === 'house' ? 'Дом · увеличивает вместимость жилья' : 'Склад · увеличивает вместимость ресурсов'); }
  }

  showNotice(text: string): void {
    this.notice.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.notice);
    this.tweens.add({ targets: this.notice, alpha: 0, delay: 1800, duration: 500 });
  }

  private labelStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: 'DM Sans, sans-serif', fontSize: '12px', color: '#344539',
      backgroundColor: '#f8f8eacc', padding: { x: 6, y: 4 }, align: 'center'
    };
  }
}
