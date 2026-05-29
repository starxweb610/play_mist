/**
 * game.js — Main Phaser 3 configuration and game initialisation.
 *
 * Scenes load in order: BootScene → HomeScene → GameScene
 * PauseScene is launched on top of GameScene (additive mode).
 */

const config = {
  type: Phaser.AUTO,           // Use WebGL if available, else Canvas
  parent: 'game-container',    // Mount canvas inside this DOM element
  backgroundColor: '#0d0d1a',

  // RESIZE mode lets the canvas fill the viewport on any device
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },

  // Register all scenes (order = default stack order)
  scene: [BootScene, HomeScene, GameScene, PauseScene],
};

// Boot the game
const game = new Phaser.Game(config);

// Remove the HTML loading overlay once Phaser signals it is ready
game.events.on('ready', () => {
  const overlay = document.getElementById('boot-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 700);
  }
});
