/**
 * PauseScene.js — Pause overlay (launched additively over GameScene).
 */
class PauseScene extends Phaser.Scene {
  constructor() { super({ key: 'PauseScene' }); }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;

    // Semi-transparent backdrop
    const backdrop = this.add.rectangle(0, 0, W, H, 0x000000, 0.65).setOrigin(0);
    backdrop.setInteractive(); // block input to GameScene

    // ── Panel ─────────────────────────────────────────────────────────────────
    const pw = Math.min(W * 0.82, 340);
    const ph = 280;
    const panel = this.add.graphics();
    panel.fillStyle(0x13132b, 0.97);
    panel.fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 24);
    panel.lineStyle(1.5, 0x8b5cf6, 0.6);
    panel.strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 24);

    // Title
    this.add.text(cx, cy - 95, 'PAUSED', {
      fontFamily: 'Outfit, sans-serif', fontSize: '26px',
      fontStyle: 'bold', color: '#ffffff', letterSpacing: 6,
    }).setOrigin(0.5);

    // Divider
    const div = this.add.graphics();
    div.lineStyle(1, 0x8b5cf6, 0.3);
    div.lineBetween(cx - pw / 2 + 30, cy - 58, cx + pw / 2 - 30, cy - 58);

    // ── RESUME button ─────────────────────────────────────────────────────────
    this.makeButton(cx, cy - 10, pw * 0.75, 54, '▶  RESUME', 0x7c3aed, () => {
      // ── AUDIO: button click ────────────────────────────────────────────────
      // this.sound.play('sfxButton', { volume: 0.8 });
      this.scene.resume('GameScene');
      this.scene.stop();
    });

    // ── EXIT TO MENU button ───────────────────────────────────────────────────
    this.makeButton(cx, cy + 62, pw * 0.75, 54, '⏹  EXIT TO MENU', 0x2d1b4e, () => {
      // ── AUDIO: button click ────────────────────────────────────────────────
      // this.sound.play('sfxButton', { volume: 0.8 });
      this.scene.stop('GameScene');
      this.scene.stop();
      this.scene.start('HomeScene');
    });
  }

  // ── Reusable button factory ───────────────────────────────────────────────
  makeButton(cx, cy, w, h, label, color, callback) {
    const g = this.add.graphics();
    const draw = (c) => {
      g.clear();
      g.fillStyle(c, 1);
      g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 14);
    };
    draw(color);

    const txt = this.add.text(cx, cy, label, {
      fontFamily: 'Outfit, sans-serif', fontSize: '15px',
      fontStyle: 'bold', color: '#ffffff', letterSpacing: 1,
    }).setOrigin(0.5);

    const hit = this.add.rectangle(cx, cy, w, h)
      .setInteractive({ useHandCursor: true }).setAlpha(0.001);

    hit.on('pointerover', () => draw(Phaser.Display.Color.ValueToColor(color).lighten(20).color));
    hit.on('pointerout',  () => draw(color));
    hit.on('pointerdown', () => draw(Phaser.Display.Color.ValueToColor(color).darken(20).color));
    hit.on('pointerup',   () => { draw(color); callback(); });
  }
}
