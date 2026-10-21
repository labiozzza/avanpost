import Phaser from 'phaser';

const W = 1600;
const H = 900;
const GROUND = 610;

export class SideViewSpike extends Phaser.Scene {
  private hills!: Phaser.GameObjects.Graphics;
  private mist!: Phaser.GameObjects.Graphics;
  private birds: Phaser.GameObjects.Graphics[] = [];
  private pointerX = 0.5;
  private pointerY = 0.5;

  constructor() {
    super('side-view-spike');
  }

  preload(): void {
    this.load.svg('spike-house', '/spike/house.svg', { width: 520, height: 440 });
    this.load.svg('spike-tree', '/spike/tree.svg', { width: 340, height: 460 });
    this.load.svg('spike-villager', '/spike/villager.svg', { width: 140, height: 240 });
    this.load.svg('spike-well', '/spike/well.svg', { width: 220, height: 220 });
  }

  create(): void {
    this.buildSky();
    this.hills = this.add.graphics();
    this.drawHills();
    this.buildGround();
    this.buildSettlement();
    this.buildAtmosphere();
    this.buildForeground();
    this.bindParallax();
  }

  private buildSky(): void {
    const texture = this.textures.createCanvas('spike-sky', W, H);
    if (!texture) return;
    const context = texture.getContext();
    const gradient = context.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#223846');
    gradient.addColorStop(0.32, '#48697a');
    gradient.addColorStop(0.58, '#9da293');
    gradient.addColorStop(0.72, '#e4b07a');
    gradient.addColorStop(1, '#5c5946');
    context.fillStyle = gradient;
    context.fillRect(0, 0, W, H);

    const sun = context.createRadialGradient(1130, 300, 10, 1130, 300, 280);
    sun.addColorStop(0, 'rgba(255, 224, 166, 0.95)');
    sun.addColorStop(0.18, 'rgba(255, 196, 122, 0.45)');
    sun.addColorStop(1, 'rgba(255, 180, 100, 0)');
    context.fillStyle = sun;
    context.fillRect(800, 0, 700, 620);

    context.fillStyle = 'rgba(255, 238, 202, 0.9)';
    context.beginPath();
    context.arc(1130, 300, 34, 0, Math.PI * 2);
    context.fill();

    texture.refresh();
    this.add.image(W / 2, H / 2, 'spike-sky').setDepth(0);
  }

  private drawHills(): void {
    this.hills.clear();
    this.hills.fillStyle(0x2f4b50, 0.75);
    this.hills.beginPath();
    this.hills.moveTo(0, 470);
    this.hills.lineTo(0, 380);
    this.hills.lineTo(160, 322);
    this.hills.lineTo(320, 372);
    this.hills.lineTo(480, 302);
    this.hills.lineTo(670, 366);
    this.hills.lineTo(860, 316);
    this.hills.lineTo(1080, 370);
    this.hills.lineTo(1280, 320);
    this.hills.lineTo(1460, 364);
    this.hills.lineTo(1600, 336);
    this.hills.lineTo(1600, 470);
    this.hills.closePath();
    this.hills.fillPath();

    this.hills.fillStyle(0x28433f, 0.85);
    this.hills.beginPath();
    this.hills.moveTo(0, 520);
    this.hills.lineTo(0, 430);
    this.hills.lineTo(210, 392);
    this.hills.lineTo(410, 438);
    this.hills.lineTo(620, 386);
    this.hills.lineTo(840, 442);
    this.hills.lineTo(1060, 400);
    this.hills.lineTo(1280, 446);
    this.hills.lineTo(1480, 404);
    this.hills.lineTo(1600, 430);
    this.hills.lineTo(1600, 520);
    this.hills.closePath();
    this.hills.fillPath();
    this.hills.setDepth(1);

    this.mist = this.add.graphics().setDepth(2);
    this.mist.fillStyle(0xd8c5a4, 0.1);
    this.mist.fillEllipse(360, 470, 620, 54);
    this.mist.fillEllipse(1180, 454, 700, 46);
  }

  private buildGround(): void {
    const ground = this.textures.createCanvas('spike-ground', W, 330);
    if (!ground) return;
    const context = ground.getContext();
    const soil = context.createLinearGradient(0, 0, 0, 330);
    soil.addColorStop(0, '#5e4a32');
    soil.addColorStop(0.18, '#4f3d2a');
    soil.addColorStop(0.52, '#3b2e22');
    soil.addColorStop(1, '#241d18');
    context.fillStyle = soil;
    context.fillRect(0, 0, W, 330);

    context.fillStyle = '#6f7e4a';
    context.beginPath();
    context.moveTo(0, 22);
    for (let x = 0; x <= W; x += 40) {
      context.lineTo(x, 18 + Math.sin(x * 0.045) * 5 + Math.sin(x * 0.013) * 4);
    }
    context.lineTo(W, 42);
    context.lineTo(0, 42);
    context.closePath();
    context.fill();

    context.fillStyle = '#58693d';
    context.fillRect(0, 22, W, 12);
    context.fillStyle = 'rgba(150, 172, 105, 0.45)';
    context.fillRect(0, 30, W, 3);

    const layers: Array<[number, string, number]> = [
      [86, 'rgba(124, 101, 70, 0.28)', 3],
      [150, 'rgba(82, 65, 46, 0.5)', 2],
      [236, 'rgba(58, 44, 32, 0.5)', 2]
    ];
    for (const [y, color, width] of layers) {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      for (let x = 0; x <= W; x += 30) {
        context.lineTo(x, y + Math.sin(x * 0.02 + y) * 8);
      }
      context.stroke();
    }

    for (let index = 0; index < 220; index += 1) {
      const x = (index * 137.5) % W;
      const y = 60 + ((index * 71) % 250);
      const radius = 1 + ((index * 13) % 4);
      context.fillStyle =
        index % 3 === 0 ? 'rgba(150, 136, 108, 0.28)' : 'rgba(28, 22, 18, 0.3)';
      context.beginPath();
      context.ellipse(x, y, radius * 2.2, radius, 0.4, 0, Math.PI * 2);
      context.fill();
    }

    ground.refresh();
    this.add.image(W / 2, 500 + 165, 'spike-ground').setDepth(3);
  }

  private addShadow(x: number, y: number, width: number, alpha = 0.3): void {
    const shadow = this.add.graphics().setDepth(4);
    shadow.fillStyle(0x141a14, alpha);
    shadow.fillEllipse(x, y, width, width * 0.13);
  }

  private buildSettlement(): void {
    const path = this.add.graphics().setDepth(4);
    path.fillStyle(0x8b7350, 0.55);
    path.beginPath();
    path.moveTo(780, 612);
    path.lineTo(900, 612);
    path.lineTo(960, 720);
    path.lineTo(1020, 900);
    path.lineTo(560, 900);
    path.lineTo(700, 720);
    path.closePath();
    path.fillPath();
    path.fillStyle(0x9c8258, 0.22);
    path.fillEllipse(820, 700, 260, 80);

    this.addShadow(260, 616, 340, 0.34);
    const tree = this.add
      .image(260, GROUND + 8, 'spike-tree')
      .setOrigin(0.5, 1)
      .setScale(1.02)
      .setDepth(6);
    this.tweens.add({
      targets: tree,
      angle: { from: -0.55, to: 0.55 },
      duration: 5200,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });

    this.addShadow(1370, 606, 260, 0.26);
    const farTree = this.add
      .image(1370, 602, 'spike-tree')
      .setOrigin(0.5, 1)
      .setScale(0.74)
      .setDepth(5)
      .setTint(0xb9c4a4);
    this.tweens.add({
      targets: farTree,
      angle: { from: 0.35, to: -0.35 },
      duration: 6100,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });

    this.addShadow(860, 606, 520, 0.38);
    const house = this.add
      .image(860, 604, 'spike-house')
      .setOrigin(0.5, 1)
      .setDepth(8);
    this.tweens.add({
      targets: house,
      y: 602,
      duration: 4200,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });

    this.addShadow(1080, 612, 190, 0.28);
    this.add
      .image(1070, 608, 'spike-well')
      .setOrigin(0.5, 1)
      .setScale(0.86)
      .setDepth(7);

    const smoke = this.add.graphics().setDepth(9);
    smoke.fillStyle(0xd8d0c0, 0.35);
    smoke.fillCircle(1050, 170, 10);
    for (let index = 0; index < 4; index += 1) {
      const puff = this.add
        .circle(1048 + index * 2, 158 - index * 6, 9 + index * 2, 0xd8d0c0, 0.16)
        .setDepth(9);
      this.tweens.add({
        targets: puff,
        y: puff.y - 120,
        x: puff.x + 26 + index * 5,
        alpha: 0,
        scale: 1.8,
        duration: 4200,
        delay: index * 850,
        repeat: -1,
        ease: 'Sine.easeOut'
      });
    }

    this.addVillager(640, 616, 0.92, false);
    this.addVillager(946, 622, 0.84, true);

    const fence = this.add.graphics().setDepth(6);
    fence.lineStyle(5, 0x6b523a, 0.95);
    for (let x = 470; x < 700; x += 34) {
      fence.beginPath();
      fence.moveTo(x, 606);
      fence.lineTo(x + 2, 566);
      fence.strokePath();
    }
    fence.lineStyle(3, 0x8b6b47, 0.9);
    fence.beginPath();
    fence.moveTo(466, 584);
    fence.lineTo(700, 580);
    fence.moveTo(466, 602);
    fence.lineTo(700, 598);
    fence.strokePath();
  }

  private addVillager(x: number, y: number, scale: number, flip: boolean): void {
    this.addShadow(x, y, 92, 0.25);
    const villager = this.add
      .image(x, y, 'spike-villager')
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(10)
      .setFlipX(flip);
    this.tweens.add({
      targets: villager,
      y: y - 3,
      duration: 1700 + Math.random() * 300,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });
    this.tweens.add({
      targets: villager,
      angle: { from: -1.2, to: 1.2 },
      duration: 2600,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      delay: 300
    });
  }

  private buildAtmosphere(): void {
    const birdsLayer = this.add.graphics().setDepth(2);
    for (let index = 0; index < 3; index += 1) {
      const bird = this.add.graphics().setDepth(2);
      bird.lineStyle(2, 0x1c2528, 0.6);
      bird.beginPath();
      bird.arc(0, 0, 8, Math.PI * 1.1, Math.PI * 1.9);
      bird.arc(16, 0, 8, Math.PI * 1.1, Math.PI * 1.9);
      bird.strokePath();
      bird.setPosition(300 + index * 120, 210 + index * 36);
      this.birds.push(bird);
      this.tweens.add({
        targets: bird,
        x: '+=360',
        y: '-=30',
        duration: 14000 + index * 2600,
        delay: index * 1800,
        repeat: -1,
        yoyo: true,
        ease: 'Sine.easeInOut'
      });
    }
    void birdsLayer;

    for (let index = 0; index < 22; index += 1) {
      const mote = this.add
        .circle(
          200 + ((index * 97) % 1250),
          340 + ((index * 53) % 240),
          1.2 + (index % 3) * 0.6,
          0xffe2a8,
          0.3
        )
        .setDepth(11);
      this.tweens.add({
        targets: mote,
        x: mote.x + 16 + (index % 5) * 4,
        y: mote.y - 40 - (index % 7) * 5,
        alpha: { from: 0.05, to: 0.5 },
        duration: 4200 + (index % 6) * 700,
        delay: index * 220,
        repeat: -1,
        yoyo: true,
        ease: 'Sine.easeInOut'
      });
    }
  }

  private buildForeground(): void {
    const foreground = this.add.graphics().setDepth(12);
    foreground.fillStyle(0x1c2a21, 0.85);
    for (let x = -20; x < W + 20; x += 26) {
      const height = 16 + ((x * 7) % 30);
      foreground.fillTriangle(x, 900, x + 9, 900 - height, x + 18, 900);
    }
    foreground.fillStyle(0x0f1712, 0.8);
    foreground.fillTriangle(40, 900, 72, 806, 96, 900);
    foreground.fillTriangle(1500, 900, 1534, 828, 1570, 900);
    foreground.fillStyle(0x7a6748, 0.3);
    foreground.fillRect(0, 878, W, 22);

    const vignette = this.textures.createCanvas('spike-vignette', W, H);
    if (vignette) {
      const context = vignette.getContext();
      const gradient = context.createRadialGradient(
        W / 2,
        H / 2,
        H * 0.35,
        W / 2,
        H / 2,
        H * 0.92
      );
      gradient.addColorStop(0, 'rgba(4, 8, 10, 0)');
      gradient.addColorStop(1, 'rgba(4, 8, 10, 0.62)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, W, H);
      vignette.refresh();
      this.add.image(W / 2, H / 2, 'spike-vignette').setDepth(14);
    }
  }

  private bindParallax(): void {
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.pointerX = pointer.x / this.scale.width;
      this.pointerY = pointer.y / this.scale.height;
    });
  }

  override update(): void {
    const offsetX = (this.pointerX - 0.5) * 22;
    const offsetY = (this.pointerY - 0.5) * 8;
    if (this.hills) this.hills.x = Phaser.Math.Linear(this.hills.x, -offsetX, 0.04);
    if (this.mist) this.mist.x = Phaser.Math.Linear(this.mist.x, offsetX * 0.4, 0.04);
    this.hills.y = Phaser.Math.Linear(this.hills.y, -offsetY * 0.3, 0.04);
  }
}
