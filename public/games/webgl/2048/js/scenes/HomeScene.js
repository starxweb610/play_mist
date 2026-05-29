/**
 * HomeScene.js — Main menu / home screen.
 *
 * Layout (top → bottom):
 *   • Full-screen background image (or gradient fallback)
 *   • Game logo — 150 px from the top of the screen
 *   • High-score display — vertically centred
 *   • START button — near the bottom
 *
 * Highscore is persisted via localStorage ('2048_highscore').
 */

class HomeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HomeScene' });
  }

  create() {
    this.cameras.main.setBackgroundColor('#0d0d1a');
    this.buildUI();
    this.scale.on('resize', this.handleResize, this);

    // ── AUDIO: play background music on home screen ──────────────────────────
    // Uncomment once 'bgMusic' is loaded in BootScene.
    // if (!this.sound.get('bgMusic')) {
    //   this.bgMusic = this.sound.add('bgMusic', { loop: true, volume: 0.4 });
    //   this.bgMusic.play();
    // }
  }

  // ── Build / rebuild all UI elements ────────────────────────────────────────
  buildUI() {
    // Clean up previous objects on resize
    if (this.uiGroup) this.uiGroup.destroy(true);
    this.uiGroup = this.add.group();

    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;

    // ── 1. BACKGROUND ────────────────────────────────────────────────────────
    if (this.textures.exists('bg')) {
      // Use the loaded background image
      const bg = this.add.image(0, 0, 'bg')
        .setOrigin(0, 0)
        .setDisplaySize(W, H);
      this.uiGroup.add(bg);

      // Dark vignette overlay so text stays readable
      const overlay = this.add.graphics();
      overlay.fillStyle(0x000000, 0.55);
      overlay.fillRect(0, 0, W, H);
      this.uiGroup.add(overlay);
    } else {
      // Fallback: animated gradient-like background drawn with graphics
      this.drawFallbackBg(W, H);
    }

    // ── 2. LOGO — 150 px from top ────────────────────────────────────────────
    if (this.textures.exists('logo')) {
      const logo = this.add.image(cx, 150, 'logo').setOrigin(0.5, 0);
      // Scale logo to fit within 80% of screen width, max 380px
      const maxLogoW = Math.min(W * 0.8, 380);
      if (logo.width > maxLogoW) {
        logo.setScale(maxLogoW / logo.width);
      }
      this.uiGroup.add(logo);
    } else {
      // Fallback: rendered text logo
      this.drawFallbackLogo(cx, 150);
    }

    // ── 3. HIGH-SCORE PANEL — vertically centred ─────────────────────────────
    const highscore = this.getHighScore();
    const panelY = H * 0.50;

    // Glassmorphism card
    const cardW = Math.min(W * 0.65, 280);
    const cardH = 110;
    const cardX = cx - cardW / 2;

    const card = this.add.graphics();
    card.fillStyle(0xffffff, 0.06);
    card.fillRoundedRect(cardX, panelY - cardH / 2, cardW, cardH, 20);
    card.lineStyle(1.5, 0x8b5cf6, 0.4);
    card.strokeRoundedRect(cardX, panelY - cardH / 2, cardW, cardH, 20);
    this.uiGroup.add(card);

    const labelStyle = {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '13px',
      color: '#9d8fd4',
      letterSpacing: 3,
    };
    const scoreNumStyle = {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '42px',
      fontStyle: 'bold',
      color: '#ffffff',
    };

    const hsLabel = this.add.text(cx, panelY - 22, 'BEST SCORE', labelStyle).setOrigin(0.5);
    const hsNum   = this.add.text(cx, panelY + 18, highscore.toString(), scoreNumStyle).setOrigin(0.5);
    this.uiGroup.add(hsLabel);
    this.uiGroup.add(hsNum);

    // ── 4. START BUTTON — near the bottom ────────────────────────────────────
    const btnY  = H * 0.82;
    const btnW  = Math.min(W * 0.6, 240);
    const btnH  = 60;

    this.createStartButton(cx, btnY, btnW, btnH);

    // ── 5. Subtle floating particles ─────────────────────────────────────────
    this.spawnParticles(W, H);
  }

  // ── Draw a dark radial-gradient fallback background ─────────────────────────
  drawFallbackBg(W, H) {
    const steps = 8;
    for (let i = steps; i >= 0; i--) {
      const r = (Math.max(W, H) * 1.4 * i) / steps;
      const t = i / steps;
      // Interpolate: centre #1a0a3d → outer #0d0d1a
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x1a0a3d),
        Phaser.Display.Color.ValueToColor(0x0d0d1a),
        steps, i
      );
      const g = this.add.graphics();
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillCircle(W / 2, H / 2, r);
      this.uiGroup.add(g);
    }
  }

  // ── Text-based logo fallback ────────────────────────────────────────────────
  drawFallbackLogo(cx, topY) {
    // Tile-style "2048" wordmark
    const tileSize = Math.min(this.scale.width * 0.18, 78);
    const gap = 8;
    const digits = ['2', '0', '4', '8'];
    const colors = [0x7c3aed, 0x6d28d9, 0x2563eb, 0x0891b2];
    const totalW = digits.length * tileSize + (digits.length - 1) * gap;
    let startX = cx - totalW / 2;

    digits.forEach((d, i) => {
      const tx = startX + i * (tileSize + gap);
      const ty = topY;

      const tile = this.add.graphics();
      tile.fillStyle(colors[i], 1);
      tile.fillRoundedRect(tx, ty, tileSize, tileSize, 10);
      this.uiGroup.add(tile);

      const t = this.add.text(tx + tileSize / 2, ty + tileSize / 2, d, {
        fontFamily: 'Outfit, sans-serif',
        fontSize: `${Math.floor(tileSize * 0.48)}px`,
        fontStyle: 'bold',
        color: '#ffffff',
      }).setOrigin(0.5);
      this.uiGroup.add(t);
    });

    // Sub-tagline
    const tag = this.add.text(cx, topY + tileSize + 14, 'SLIDE & MERGE', {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '12px',
      color: '#7c7ca0',
      letterSpacing: 4,
    }).setOrigin(0.5);
    this.uiGroup.add(tag);
  }

  // ── Gradient-filled Start button with hover / press states ─────────────────
  createStartButton(cx, cy, btnW, btnH) {
    const container = this.add.container(cx, cy);
    this.uiGroup.add(container);

    // Button glow (outer halo)
    const glow = this.add.graphics();
    glow.fillStyle(0x7c3aed, 0.18);
    glow.fillRoundedRect(-btnW / 2 - 10, -btnH / 2 - 10, btnW + 20, btnH + 20, 22);
    container.add(glow);

    // Button body
    const body = this.add.graphics();
    const drawBody = (alpha) => {
      body.clear();
      // Gradient simulation: two overlapping rects
      body.fillStyle(0x7c3aed, alpha);
      body.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 16);
      body.fillStyle(0x6d28d9, alpha * 0.6);
      body.fillRoundedRect(-btnW / 2, 0, btnW, btnH / 2, 16);
    };
    drawBody(1);
    container.add(body);

    // Highlight stripe
    const shine = this.add.graphics();
    shine.fillStyle(0xffffff, 0.12);
    shine.fillRoundedRect(-btnW / 2 + 6, -btnH / 2 + 6, btnW - 12, btnH / 2 - 6, 10);
    container.add(shine);

    // Label
    const label = this.add.text(0, 2, 'START GAME', {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#ffffff',
      letterSpacing: 2,
    }).setOrigin(0.5);
    container.add(label);

    // Hit area
    const hitArea = this.add.rectangle(0, 0, btnW, btnH)
      .setInteractive({ useHandCursor: true })
      .setAlpha(0.001);
    container.add(hitArea);

    // Hover & click interactions
    hitArea.on('pointerover', () => {
      this.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 120, ease: 'Power2' });
      glow.setAlpha(1.6);
    });
    hitArea.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 120, ease: 'Power2' });
      glow.setAlpha(1);
    });
    hitArea.on('pointerdown', () => {
      this.tweens.add({ targets: container, scaleX: 0.95, scaleY: 0.95, duration: 80, ease: 'Power2' });

      // ── AUDIO: play button click sound ──────────────────────────────────
      // Uncomment once 'sfxButton' is loaded.
      // this.sound.play('sfxButton', { volume: 0.8 });
    });
    hitArea.on('pointerup', () => {
      this.tweens.add({
        targets: container, scaleX: 1, scaleY: 1, duration: 80, ease: 'Power2',
        onComplete: () => this.startGame(),
      });
    });
  }

  // ── Spawn a handful of drifting particle dots for ambience ─────────────────
  spawnParticles(W, H) {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const g = this.add.graphics();
      const radius = Phaser.Math.Between(2, 5);
      const alpha  = Phaser.Math.FloatBetween(0.15, 0.5);
      const colour = Phaser.Utils.Array.GetRandom([0x8b5cf6, 0x6d28d9, 0x0891b2, 0xffffff]);
      g.fillStyle(colour, alpha);
      g.fillCircle(0, 0, radius);
      g.setPosition(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H));
      this.uiGroup.add(g);

      this.tweens.add({
        targets: g,
        y: g.y - Phaser.Math.Between(80, 200),
        alpha: 0,
        duration: Phaser.Math.Between(3000, 7000),
        delay: Phaser.Math.Between(0, 4000),
        repeat: -1,
        repeatDelay: Phaser.Math.Between(0, 2000),
        onRepeat: () => {
          g.setPosition(Phaser.Math.Between(0, W), H + 20);
          g.setAlpha(alpha);
        },
      });
    }
  }

  // ── Read highscore from localStorage ────────────────────────────────────────
  getHighScore() {
    return parseInt(localStorage.getItem('2048_highscore') || '0', 10);
  }

  // ── Transition to the game ──────────────────────────────────────────────────
  startGame() {
    this.scale.off('resize', this.handleResize, this);
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('GameScene');
    });
  }

  // ── Rebuild UI on window resize ────────────────────────────────────────────
  handleResize() {
    this.buildUI();
  }

  shutdown() {
    this.scale.off('resize', this.handleResize, this);
  }
}
