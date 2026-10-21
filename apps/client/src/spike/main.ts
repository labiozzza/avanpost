import Phaser from 'phaser';
import { SideViewSpike } from './scene';
import './spike.css';

const parent = document.querySelector<HTMLElement>('#spike');
if (!parent) throw new Error('#spike not found');

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'spike',
  width: 1600,
  height: 900,
  backgroundColor: '#0b1118',
  scale: {
    mode: Phaser.Scale.ENVELOP,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: {
    antialias: true,
    roundPixels: false
  },
  scene: [SideViewSpike]
});
