import Phaser from 'phaser';
import type { PeaceWorldSnapshot, ReadOnlyWorldPreview } from '@avanpost/peace-v2-shared';

export class SettlementScene extends Phaser.Scene {
  private graphics?: Phaser.GameObjects.Graphics;
  private world?: PeaceWorldSnapshot;
  private preview?: ReadOnlyWorldPreview;
  private workerSelected = false;

  constructor() {
    super('peace-v2-settlement');
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.scale.on('resize', () => this.drawWorld());
    this.drawWorld();
  }

  showPreview(preview: ReadOnlyWorldPreview): void {
    this.preview = preview;
    this.world = undefined;
    this.drawWorld();
  }

  showWorld(world: PeaceWorldSnapshot): void {
    this.world = world;
    this.preview = undefined;
    this.drawWorld();
  }

  setWorkerSelected(selected: boolean): void {
    this.workerSelected = selected;
    this.drawWorld();
  }

  private drawWorld(): void {
    const graphics = this.graphics;
    if (!graphics) return;
    const width = this.scale.width;
    const height = this.scale.height;
    const ground = height * 0.72;
    const workerX = this.world
      ? width * (0.5 + this.world.worker.position.x * 0.075)
      : width * (0.5 + (this.preview?.actors[0]?.position.x ?? -3) * 0.075);
    const treeX = width * 0.79;

    graphics.clear();
    graphics.fillStyle(0xb7c99c, 1);
    graphics.fillRect(0, 0, width, height);
    graphics.fillStyle(0xc8d2aa, 1);
    graphics.fillPoints([
      new Phaser.Geom.Point(0, ground - 62),
      new Phaser.Geom.Point(width * 0.2, ground - 102),
      new Phaser.Geom.Point(width * 0.42, ground - 58),
      new Phaser.Geom.Point(width * 0.67, ground - 118),
      new Phaser.Geom.Point(width, ground - 65),
      new Phaser.Geom.Point(width, ground),
      new Phaser.Geom.Point(0, ground)
    ], true);
    graphics.fillStyle(0x87956b, 1);
    graphics.fillRect(0, ground, width, height - ground);
    graphics.fillStyle(0x9ba77a, 1);
    graphics.fillPoints([
      new Phaser.Geom.Point(0, ground + 26),
      new Phaser.Geom.Point(width * 0.27, ground + 5),
      new Phaser.Geom.Point(width * 0.58, ground + 24),
      new Phaser.Geom.Point(width, ground + 4),
      new Phaser.Geom.Point(width, height),
      new Phaser.Geom.Point(0, height)
    ], true);

    graphics.fillStyle(0xe2c781, 0.9);
    graphics.fillCircle(width * 0.87, height * 0.18, Math.min(width, height) * 0.055);

    graphics.lineStyle(Math.max(3, width * 0.006), 0xc7b27b, 0.85);
    graphics.lineBetween(width * 0.16, ground + 16, width * 0.82, ground + 12);

    this.drawStorehouse(graphics, width * 0.18, ground);
    const hasCabin = this.world?.buildings.length || this.preview?.buildings.some((building) => building.buildingId === 'cabin');
    if (hasCabin) this.drawCabin(graphics, width * 0.52, ground);
    this.drawTree(graphics, treeX, ground, this.world?.tree.remaining ?? 3);
    this.drawWorker(
      graphics,
      workerX,
      ground,
      Boolean(this.world?.worker.cargo || this.preview?.actors[0]?.visualState === 'carry'),
      this.workerSelected
    );
  }

  private drawStorehouse(graphics: Phaser.GameObjects.Graphics, x: number, ground: number): void {
    graphics.fillStyle(0x594d3d, 1);
    graphics.fillPoints([
      new Phaser.Geom.Point(x - 39, ground - 43), new Phaser.Geom.Point(x, ground - 70),
      new Phaser.Geom.Point(x + 40, ground - 43), new Phaser.Geom.Point(x + 31, ground - 37),
      new Phaser.Geom.Point(x - 30, ground - 37)
    ], true);
    graphics.fillStyle(0xc8a871, 1);
    graphics.fillRect(x - 30, ground - 39, 60, 39);
    graphics.fillStyle(0x715638, 1);
    graphics.fillRect(x - 9, ground - 27, 18, 27);
    graphics.lineStyle(2, 0xe0c28a, 0.8);
    graphics.lineBetween(x - 28, ground - 14, x + 28, ground - 14);
  }

  private drawCabin(graphics: Phaser.GameObjects.Graphics, x: number, ground: number): void {
    graphics.fillStyle(0x79503a, 1);
    graphics.fillPoints([
      new Phaser.Geom.Point(x - 39, ground - 49), new Phaser.Geom.Point(x, ground - 83),
      new Phaser.Geom.Point(x + 39, ground - 49), new Phaser.Geom.Point(x + 30, ground - 44),
      new Phaser.Geom.Point(x - 30, ground - 44)
    ], true);
    graphics.fillStyle(0xe2c99a, 1);
    graphics.fillRect(x - 29, ground - 47, 58, 47);
    graphics.fillStyle(0x765338, 1);
    graphics.fillRect(x - 8, ground - 29, 16, 29);
    graphics.fillStyle(0x8ca282, 1);
    graphics.fillRect(x + 13, ground - 36, 9, 10);
  }

  private drawTree(graphics: Phaser.GameObjects.Graphics, x: number, ground: number, remaining: number): void {
    graphics.fillStyle(0x70513c, 1);
    if (remaining < 1) {
      graphics.fillRoundedRect(x - 10, ground - 18, 20, 18, 4);
      graphics.fillStyle(0xc49a62, 1);
      graphics.fillEllipse(x, ground - 17, 17, 5);
      return;
    }
    graphics.fillRoundedRect(x - 7, ground - 56, 14, 56, 4);
    graphics.fillStyle(0x496d43, 1);
    graphics.fillCircle(x, ground - 81, 29);
    graphics.fillStyle(0x5b7c4e, 1);
    graphics.fillCircle(x - 19, ground - 67, 20);
    graphics.fillCircle(x + 19, ground - 68, 20);
    graphics.fillStyle(0x76905d, 1);
    graphics.fillCircle(x - 6, ground - 95, 15);
  }

  private drawWorker(graphics: Phaser.GameObjects.Graphics, x: number, ground: number, carrying: boolean, selected: boolean): void {
    if (selected) {
      graphics.lineStyle(2, 0xf0ce78, 0.95);
      graphics.strokeCircle(x, ground - 25, 20);
    }
    graphics.fillStyle(0x293d31, 0.19);
    graphics.fillEllipse(x, ground + 2, 25, 8);
    graphics.fillStyle(0x9b5436, 1);
    graphics.fillRoundedRect(x - 8, ground - 34, 16, 26, 5);
    graphics.fillStyle(0xd9ae7a, 1);
    graphics.fillCircle(x, ground - 42, 8);
    graphics.fillStyle(0x543c2e, 1);
    graphics.fillRoundedRect(x - 10, ground - 51, 20, 6, 3);
    graphics.lineStyle(4, 0x354838, 1);
    graphics.lineBetween(x - 4, ground - 10, x - 6, ground - 1);
    graphics.lineBetween(x + 4, ground - 10, x + 7, ground - 1);
    if (carrying) {
      graphics.fillStyle(0x9b7449, 1);
      graphics.fillRoundedRect(x + 8, ground - 30, 20, 9, 3);
      graphics.lineStyle(2, 0xead5a5, 0.8);
      graphics.lineBetween(x + 11, ground - 26, x + 24, ground - 26);
    }
  }
}
