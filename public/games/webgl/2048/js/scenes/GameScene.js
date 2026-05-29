/**
 * GameScene.js — Core 2048 gameplay.
 *
 * Features:
 *  • 4×4 sliding-tile grid with merge animations
 *  • Keyboard (arrow keys / WASD) + touch-swipe controls
 *  • Score & live high-score (localStorage)
 *  • Pause button (top-right) → PauseScene overlay
 *  • Exit button (top-left)   → HomeScene
 *  • Win (2048 tile) and Lose (no moves left) overlays
 *  • Audio + image placeholder comments throughout
 */

// ── Tile colour palette (dark neon theme) ────────────────────────────────────
const TILE_STYLE = {
  0:    { bg: 0x1e1e38, text: '#1e1e38' },
  2:    { bg: 0x2d1b69, text: '#c4b5fd' },
  4:    { bg: 0x4c1d95, text: '#ddd6fe' },
  8:    { bg: 0x7c3aed, text: '#ffffff' },
  16:   { bg: 0x6d28d9, text: '#ffffff' },
  32:   { bg: 0x2563eb, text: '#ffffff' },
  64:   { bg: 0x0891b2, text: '#ffffff' },
  128:  { bg: 0x0d9488, text: '#ffffff' },
  256:  { bg: 0x16a34a, text: '#ffffff' },
  512:  { bg: 0xca8a04, text: '#ffffff' },
  1024: { bg: 0xdc2626, text: '#ffffff' },
  2048: { bg: 0xf59e0b, text: '#1a1a2e' },
};

// ── Pure 2048 grid logic ─────────────────────────────────────────────────────

/** Slide a single row left; returns { row, score, moved }. */
function slideRowLeft(row) {
  const cells = row.filter(v => v !== 0);
  let score = 0;
  const result = [];
  let i = 0;
  while (i < cells.length) {
    if (i + 1 < cells.length && cells[i] === cells[i + 1]) {
      const merged = cells[i] * 2;
      result.push(merged);
      score += merged;
      i += 2;
    } else {
      result.push(cells[i]);
      i++;
    }
  }
  while (result.length < 4) result.push(0);
  const moved = result.some((v, idx) => v !== row[idx]);
  return { row: result, score, moved };
}

/**
 * Apply a move to the grid.
 * direction: 'left' | 'right' | 'up' | 'down'
 * Returns { newGrid, score, moved }
 *
 * Uses explicit row/column iteration for each direction so there is no
 * ambiguity from rotation helpers (the previous rotateCW/rotateCCW
 * implementations produced identical results, breaking 'down').
 */
function applyMove(grid, direction) {
  // Deep-copy so we never mutate the original
  const g = grid.map(r => [...r]);
  let totalScore = 0;
  let anyMoved = false;

  if (direction === 'left') {
    // Slide every row toward column 0
    for (let r = 0; r < 4; r++) {
      const res = slideRowLeft(g[r]);
      if (res.moved) anyMoved = true;
      totalScore += res.score;
      g[r] = res.row;
    }

  } else if (direction === 'right') {
    // Slide every row toward column 3 (reverse → slide left → reverse)
    for (let r = 0; r < 4; r++) {
      const res = slideRowLeft([...g[r]].reverse());
      if (res.moved) anyMoved = true;
      totalScore += res.score;
      g[r] = res.row.reverse();
    }

  } else if (direction === 'up') {
    // Slide every column toward row 0
    for (let c = 0; c < 4; c++) {
      // Extract the column top-to-bottom
      const col = [g[0][c], g[1][c], g[2][c], g[3][c]];
      const res = slideRowLeft(col);
      if (res.moved) anyMoved = true;
      totalScore += res.score;
      // Write merged values back into the column (top = index 0)
      for (let r = 0; r < 4; r++) g[r][c] = res.row[r];
    }

  } else if (direction === 'down') {
    // Slide every column toward row 3 (reverse → slide left → reverse)
    for (let c = 0; c < 4; c++) {
      // Extract the column BOTTOM-to-top so index 0 = row 3
      const col = [g[3][c], g[2][c], g[1][c], g[0][c]];
      const res = slideRowLeft(col);
      if (res.moved) anyMoved = true;
      totalScore += res.score;
      // Write back reversed: res.row[0] → row 3, res.row[1] → row 2, …
      for (let r = 0; r < 4; r++) g[3 - r][c] = res.row[r];
    }
  }

  return { newGrid: g, score: totalScore, moved: anyMoved };
}

/** Return true if any moves remain. */
function hasMoves(grid) {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      if (grid[r][c] === 0) return true;
      if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
    }
  return false;
}

/** Return true if any cell has value 2048. */
function hasWon(grid) {
  return grid.some(row => row.includes(2048));
}

// ── GameScene class ──────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  create() {
    this.isAnimating = false;
    this.gameOver    = false;
    this.score       = 0;
    this.highscore   = parseInt(localStorage.getItem('2048_highscore') || '0', 10);

    // 4×4 grid of numbers (0 = empty)
    this.gridData = Array.from({ length: 4 }, () => Array(4).fill(0));
    // 4×4 grid of Phaser containers (visual tiles)
    this.tileSprites = Array.from({ length: 4 }, () => Array(4).fill(null));

    this.cameras.main.setBackgroundColor('#0d0d1a');
    this.buildLayout();
    this.spawnTile();
    this.spawnTile();

    this.setupKeyboard();
    this.setupTouch();
    this.scale.on('resize', this.handleResize, this);

    this.cameras.main.fadeIn(300);

    // ── AUDIO: start background music ──────────────────────────────────────
    // Uncomment once 'bgMusic' is loaded in BootScene.
    // if (!this.sound.get('bgMusic')) {
    //   this.bgMusic = this.sound.add('bgMusic', { loop: true, volume: 0.35 });
    //   this.bgMusic.play();
    // }
  }

  // ── Calculate grid metrics from current screen size ───────────────────────
  getMetrics() {
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;

    // Header height: score area at the top
    const headerH = Math.min(H * 0.20, 120);

    // Available space below header
    const availW = W;
    const availH = H - headerH;

    // Grid must be square; fit inside available area with padding
    const maxGridSize = Math.min(availW * 0.94, availH * 0.94, 520);
    const GAP  = Math.max(8, Math.floor(maxGridSize * 0.026));
    const PAD  = GAP;
    const CELL = Math.floor((maxGridSize - 5 * GAP - 2 * PAD) / 4);
    const GRID_W = 4 * CELL + 5 * GAP + 2 * PAD;
    const GRID_H = GRID_W;

    // Centre the grid in the remaining vertical space below the header
    const GRID_X = cx - GRID_W / 2;
    const GRID_Y = headerH + (availH - GRID_H) / 2;

    return { W, H, cx, headerH, GAP, PAD, CELL, GRID_W, GRID_H, GRID_X, GRID_Y };
  }

  // ── Pixel position of a cell ───────────────────────────────────────────────
  cellPixel(row, col) {
    const { GAP, PAD, CELL, GRID_X, GRID_Y } = this.metrics;
    const x = GRID_X + PAD + col * (CELL + GAP) + GAP + CELL / 2;
    const y = GRID_Y + PAD + row * (CELL + GAP) + GAP + CELL / 2;
    return { x, y };
  }

  // ── Build all static UI elements ──────────────────────────────────────────
  buildLayout() {
    this.metrics = this.getMetrics();
    if (this.staticGroup) this.staticGroup.destroy(true);
    this.staticGroup = this.add.group();

    const { W, H, cx, headerH, GRID_X, GRID_Y, GRID_W, GRID_H, CELL, GAP, PAD } = this.metrics;

    // ── Header background ──────────────────────────────────────────────────
    const hdr = this.add.graphics();
    hdr.fillStyle(0x13132b, 1);
    hdr.fillRect(0, 0, W, headerH);
    this.staticGroup.add(hdr);

    // ── Score box ─────────────────────────────────────────────────────────
    const boxW = Math.min(W * 0.28, 180);
    const boxH = 60;
    const boxY = headerH / 2;
    const boxGap = 10;
    const totalBoxW = boxW * 2 + boxGap;

    this.drawScoreBox(cx - totalBoxW / 2,          boxY - boxH / 2, boxW, boxH, 'SCORE', 'scoreLabel', 'scoreText');
    this.drawScoreBox(cx - totalBoxW / 2 + boxW + boxGap, boxY - boxH / 2, boxW, boxH, 'BEST',  'bestLabel',  'bestText');

    // Initial score display
    this.updateScoreDisplay();

    // ── EXIT button (top-left) ────────────────────────────────────────────
    this.makeIconButton(36, headerH / 2, '✕', () => this.exitToMenu());

    // ── PAUSE button (top-right) ──────────────────────────────────────────
    this.makeIconButton(W - 36, headerH / 2, '⏸', () => this.pauseGame());

    // ── Grid background ───────────────────────────────────────────────────
    const gridBg = this.add.graphics();
    gridBg.fillStyle(0x16213e, 1);
    gridBg.fillRoundedRect(GRID_X, GRID_Y, GRID_W, GRID_H, 14);
    this.staticGroup.add(gridBg);

    // Empty cell slots
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const px = GRID_X + PAD + c * (CELL + GAP) + GAP;
        const py = GRID_Y + PAD + r * (CELL + GAP) + GAP;
        const slot = this.add.graphics();
        slot.fillStyle(0x1e1e38, 1);
        slot.fillRoundedRect(px, py, CELL, CELL, 8);
        this.staticGroup.add(slot);
      }
    }

    // ── Redraw tiles at correct positions after resize ────────────────────
    this.redrawAllTiles();
  }

  // ── Score box helper ──────────────────────────────────────────────────────
  drawScoreBox(x, y, w, h, title, labelKey, valueKey) {
    const g = this.add.graphics();
    g.fillStyle(0x2d1b4e, 1);
    g.fillRoundedRect(x, y, w, h, 10);
    this.staticGroup.add(g);

    this.add.text(x + w / 2, y + 13, title, {
      fontFamily: 'Outfit, sans-serif', fontSize: '11px',
      color: '#9d8fd4', letterSpacing: 2,
    }).setOrigin(0.5);

    this[valueKey] = this.add.text(x + w / 2, y + 38, '0', {
      fontFamily: 'Outfit, sans-serif', fontSize: '22px',
      fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);
  }

  // ── Small circular icon button ────────────────────────────────────────────
  makeIconButton(x, y, icon, callback) {
    const r = 24;
    const bg = this.add.graphics();
    bg.fillStyle(0x2d1b4e, 1);
    bg.fillCircle(x, y, r);

    const lbl = this.add.text(x, y + 1, icon, {
      fontFamily: 'Outfit, sans-serif', fontSize: '16px', color: '#c4b5fd',
    }).setOrigin(0.5);

    const hit = this.add.circle(x, y, r).setInteractive({ useHandCursor: true }).setAlpha(0.001);
    hit.on('pointerover',  () => { bg.clear(); bg.fillStyle(0x4c1d95, 1); bg.fillCircle(x, y, r); });
    hit.on('pointerout',   () => { bg.clear(); bg.fillStyle(0x2d1b4e, 1); bg.fillCircle(x, y, r); });
    hit.on('pointerdown',  () => { bg.clear(); bg.fillStyle(0x6d28d9, 1); bg.fillCircle(x, y, r); });
    hit.on('pointerup',    () => {
      bg.clear(); bg.fillStyle(0x2d1b4e, 1); bg.fillCircle(x, y, r);

      // ── AUDIO: button click ──────────────────────────────────────────────
      // this.sound.play('sfxButton', { volume: 0.7 });
      callback();
    });
  }

  // ── Tile rendering ────────────────────────────────────────────────────────

  /** Create a tile sprite at logical (row, col) with given value. */
  createTileSprite(row, col, value, animate = false) {
    const { CELL } = this.metrics;
    const { x, y } = this.cellPixel(row, col);
    const style    = TILE_STYLE[value] || TILE_STYLE[2048];

    const container = this.add.container(x, y);

    // Background rounded rect
    const bg = this.add.graphics();
    bg.fillStyle(style.bg, 1);
    bg.fillRoundedRect(-CELL / 2, -CELL / 2, CELL, CELL, 10);

    // Subtle inner highlight
    const shine = this.add.graphics();
    shine.fillStyle(0xffffff, 0.06);
    shine.fillRoundedRect(-CELL / 2 + 4, -CELL / 2 + 4, CELL - 8, CELL * 0.35, 6);

    const fontSize = value >= 1024 ? Math.floor(CELL * 0.28)
                   : value >= 128  ? Math.floor(CELL * 0.34)
                   :                 Math.floor(CELL * 0.42);

    const label = this.add.text(0, 1, value.toString(), {
      fontFamily: 'Outfit, sans-serif',
      fontSize: `${fontSize}px`,
      fontStyle: 'bold',
      color: style.text,
    }).setOrigin(0.5);

    container.add([bg, shine, label]);

    if (animate) {
      container.setScale(0);
      this.tweens.add({
        targets: container, scaleX: 1, scaleY: 1,
        duration: 160, ease: 'Back.Out',
      });
    }

    return container;
  }

  /** Remove the sprite at (row, col). */
  destroyTileSprite(row, col) {
    if (this.tileSprites[row][col]) {
      this.tileSprites[row][col].destroy();
      this.tileSprites[row][col] = null;
    }
  }

  /** Redraw every tile from gridData (used on resize / init). */
  redrawAllTiles() {
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        this.destroyTileSprite(r, c);
        if (this.gridData[r][c] !== 0)
          this.tileSprites[r][c] = this.createTileSprite(r, c, this.gridData[r][c]);
      }
  }

  // ── Spawn a new random tile (value 2 or 4) ────────────────────────────────
  spawnTile() {
    const empty = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        if (this.gridData[r][c] === 0) empty.push([r, c]);

    if (empty.length === 0) return;
    const [r, c] = Phaser.Utils.Array.GetRandom(empty);
    const value  = Math.random() < 0.9 ? 2 : 4;
    this.gridData[r][c] = value;
    this.tileSprites[r][c] = this.createTileSprite(r, c, value, true);
  }

  // ── Handle a move in a direction ─────────────────────────────────────────
  doMove(direction) {
    if (this.isAnimating || this.gameOver) return;

    const { newGrid, score, moved } = applyMove(this.gridData, direction);
    if (!moved) return;

    this.isAnimating = true;

    // ── AUDIO: play move sound ──────────────────────────────────────────────
    // this.sound.play('sfxMove', { volume: 0.5 });

    // Slide existing tile sprites to their new positions
    const SLIDE_MS = 90;
    let pending = 0;

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        // Find where this tile went in newGrid by diffing positions
        // Simple approach: if old value exists and position changed, tween it
        if (this.tileSprites[r][c]) {
          pending++;
          const sprite = this.tileSprites[r][c];
          // Find the new position for this tile value (best match)
          const { x: nx, y: ny } = this.cellPixel(r, c); // will update after
          this.tweens.add({
            targets: sprite, x: nx, y: ny,
            duration: SLIDE_MS, ease: 'Power2',
            onComplete: () => { pending--; if (pending === 0) this.afterMove(newGrid, score); },
          });
        }
      }
    }

    if (pending === 0) this.afterMove(newGrid, score);
  }

  /** Called after slide tweens finish — update grid and sprites. */
  afterMove(newGrid, score) {
    // Detect merges: cells that changed value upward
    const mergePositions = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        if (newGrid[r][c] !== 0 && newGrid[r][c] !== this.gridData[r][c])
          mergePositions.push([r, c]);

    // Commit new grid + rebuild sprites
    this.gridData = newGrid;
    this.redrawAllTiles();

    // Bounce-animate merged tiles
    if (mergePositions.length > 0) {
      // ── AUDIO: play merge sound ────────────────────────────────────────────
      // this.sound.play('sfxMerge', { volume: 0.7 });

      mergePositions.forEach(([r, c]) => {
        const s = this.tileSprites[r][c];
        if (!s) return;
        this.tweens.add({
          targets: s, scaleX: 1.18, scaleY: 1.18,
          duration: 100, ease: 'Power2',
          yoyo: true, onComplete: () => s.setScale(1),
        });
      });
    }

    // Update score
    this.score += score;
    if (this.score > this.highscore) {
      this.highscore = this.score;
      localStorage.setItem('2048_highscore', this.highscore.toString());
    }
    this.updateScoreDisplay();

    // Spawn next tile
    this.time.delayedCall(110, () => {
      this.spawnTile();
      this.isAnimating = false;
      this.checkGameState();
    });
  }

  // ── Update score text objects ─────────────────────────────────────────────
  updateScoreDisplay() {
    if (this.scoreText) this.scoreText.setText(this.score.toString());
    if (this.bestText)  this.bestText.setText(this.highscore.toString());
  }

  // ── Win / Lose detection ──────────────────────────────────────────────────
  checkGameState() {
    if (hasWon(this.gridData))    { this.showEndOverlay(true);  return; }
    if (!hasMoves(this.gridData)) { this.showEndOverlay(false); return; }
  }

  // ── Game-over / win overlay ───────────────────────────────────────────────
  showEndOverlay(won) {
    this.gameOver = true;

    // ── AUDIO: play win or lose sound ──────────────────────────────────────
    // this.sound.play(won ? 'sfxWin' : 'sfxLose', { volume: 1 });

    const { W, H, cx } = this.metrics;
    const cy = H / 2;

    const backdrop = this.add.rectangle(0, 0, W, H, 0x000000, 0.72).setOrigin(0);

    const pw = Math.min(W * 0.82, 340);
    const ph = 270;
    const panel = this.add.graphics();
    panel.fillStyle(0x13132b, 0.98);
    panel.fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 24);
    panel.lineStyle(1.5, won ? 0xf59e0b : 0xdc2626, 0.8);
    panel.strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 24);

    this.add.text(cx, cy - 90, won ? '🎉 YOU WIN!' : '💀 GAME OVER', {
      fontFamily: 'Outfit, sans-serif', fontSize: '26px',
      fontStyle: 'bold', color: won ? '#f59e0b' : '#ef4444',
    }).setOrigin(0.5);

    this.add.text(cx, cy - 48, `SCORE: ${this.score}`, {
      fontFamily: 'Outfit, sans-serif', fontSize: '18px', color: '#e2d9f3',
    }).setOrigin(0.5);

    // PLAY AGAIN button
    this.makeEndButton(cx, cy + 20, pw * 0.75, 52, '↺  PLAY AGAIN', 0x7c3aed, () => {
      this.scene.restart();
    });

    // EXIT button
    this.makeEndButton(cx, cy + 86, pw * 0.75, 52, '⏹  EXIT', 0x2d1b4e, () => {
      this.scene.start('HomeScene');
    });
  }

  makeEndButton(cx, cy, w, h, label, color, cb) {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 14);

    this.add.text(cx, cy, label, {
      fontFamily: 'Outfit, sans-serif', fontSize: '15px',
      fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);

    const hit = this.add.rectangle(cx, cy, w, h).setInteractive({ useHandCursor: true }).setAlpha(0.001);
    hit.on('pointerover',  () => { g.clear(); g.fillStyle(Phaser.Display.Color.ValueToColor(color).lighten(15).color, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 14); });
    hit.on('pointerout',   () => { g.clear(); g.fillStyle(color, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 14); });
    hit.on('pointerup', cb);
  }

  // ── Pause ─────────────────────────────────────────────────────────────────
  pauseGame() {
    this.scene.pause();
    this.scene.launch('PauseScene');
  }

  // ── Exit ──────────────────────────────────────────────────────────────────
  exitToMenu() {
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('HomeScene');
    });
  }

  // ── Keyboard controls ────────────────────────────────────────────────────
  setupKeyboard() {
    this.input.keyboard.on('keydown', (e) => {
      const map = {
        ArrowLeft: 'left',  KeyA: 'left',
        ArrowRight: 'right', KeyD: 'right',
        ArrowUp: 'up',      KeyW: 'up',
        ArrowDown: 'down',  KeyS: 'down',
      };
      if (map[e.code]) {
        e.preventDefault();
        this.doMove(map[e.code]);
      }
      if (e.code === 'Escape') this.pauseGame();
    });
  }

  // ── Touch / swipe controls ───────────────────────────────────────────────
  setupTouch() {
    let startX = 0, startY = 0;
    const MIN_SWIPE = 30;

    this.input.on('pointerdown', (p) => { startX = p.x; startY = p.y; });
    this.input.on('pointerup', (p) => {
      const dx = p.x - startX;
      const dy = p.y - startY;
      if (Math.abs(dx) < MIN_SWIPE && Math.abs(dy) < MIN_SWIPE) return;
      if (Math.abs(dx) > Math.abs(dy))
        this.doMove(dx > 0 ? 'right' : 'left');
      else
        this.doMove(dy > 0 ? 'down' : 'up');
    });
  }

  // ── Resize handler ────────────────────────────────────────────────────────
  handleResize() {
    this.buildLayout();
    this.updateScoreDisplay();
  }

  shutdown() {
    this.scale.off('resize', this.handleResize, this);
    this.input.keyboard.removeAllListeners();
  }
}
