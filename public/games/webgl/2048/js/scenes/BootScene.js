/**
 * BootScene.js — Asset preloader.
 *
 * Loads all images and audio before any other scene runs.
 * Shows a progress bar while loading.
 * Falls back to programmatic placeholders if asset files are missing.
 */

class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;

    // ── Progress bar background ──────────────────────────────────────────────
    const barW = Math.min(W * 0.7, 320);
    const barH = 6;
    const barX = cx - barW / 2;
    const barY = cy + 40;

    const bgBar = this.add.graphics();
    bgBar.fillStyle(0x2d2d4e, 1);
    bgBar.fillRoundedRect(barX, barY, barW, barH, 3);

    const fillBar = this.add.graphics();

    const loadingText = this.add.text(cx, cy, 'LOADING', {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '14px',
      color: '#7c7ca0',
      letterSpacing: 4,
    }).setOrigin(0.5);

    this.load.on('progress', (value) => {
      fillBar.clear();
      fillBar.fillStyle(0x8b5cf6, 1);
      fillBar.fillRoundedRect(barX, barY, barW * value, barH, 3);
    });

    // ── IMAGES ───────────────────────────────────────────────────────────────
    // HOME SCREEN BACKGROUND
    // → Replace 'assets/images/bg.jpg' with your own background image.
    //   Recommended: 1080×1920px dark-themed JPEG / PNG / WebP.
    this.load.image('bg', 'assets/images/bg.jpg');

    // GAME LOGO
    // → Replace 'assets/images/logo.png' with your game logo.
    //   Recommended: transparent PNG, roughly 400×200px.
    this.load.image('logo', 'assets/images/logo.png');

    // ── AUDIO ────────────────────────────────────────────────────────────────
    // Uncomment each line and replace paths once you have the audio files.

    // BACKGROUND MUSIC (looping, ambient/chill theme)
    // this.load.audio('bgMusic', 'assets/audio/background.mp3');

    // TILE SLIDE SOUND (short swoosh, plays on every valid move)
    // this.load.audio('sfxMove', 'assets/audio/move.wav');

    // TILE MERGE SOUND (satisfying "pop" or "ding")
    // this.load.audio('sfxMerge', 'assets/audio/merge.wav');

    // WIN SOUND (fanfare, plays when 2048 is reached)
    // this.load.audio('sfxWin', 'assets/audio/win.mp3');

    // LOSE / GAME-OVER SOUND (plays when no moves remain)
    // this.load.audio('sfxLose', 'assets/audio/lose.mp3');

    // BUTTON CLICK SOUND (short click / tick)
    // this.load.audio('sfxButton', 'assets/audio/button.wav');

    // ── Handle load errors gracefully (missing placeholders) ─────────────────
    this.load.on('loaderror', (file) => {
      console.warn(`[BootScene] Could not load asset: ${file.src} — using fallback.`);
    });
  }

  create() {
    // Brief pause so the progress bar reaches 100% visually
    this.time.delayedCall(200, () => {
      this.scene.start('HomeScene');
    });
  }
}
