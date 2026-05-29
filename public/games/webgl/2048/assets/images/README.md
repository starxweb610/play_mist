# Image Assets — Placeholder Guide

Place your image files here. The game will automatically use them if present;
otherwise it renders stylised fallbacks so development continues uninterrupted.

## Required Images

| File | Usage | Recommended Size / Notes |
|------|-------|--------------------------|
| `bg.jpg` | Home screen background | 1080 × 1920 px, JPEG or WebP. Dark, atmospheric. |
| `logo.png` | Game logo shown 150 px from top | Transparent PNG, ~400 × 160 px. |

## Optional / Future Images

| Key (in code) | File | Notes |
|---------------|------|-------|
| `tileBg`      | `tile_bg.png` | Custom tile background texture overlay. |
| `gridBg`      | `grid_bg.png` | Texture for the grid board. |
| `btnStart`    | `btn_start.png` | Replace the programmatic Start button. |
| `iconPause`   | `icon_pause.png` | Replace the ⏸ pause icon button. |
| `iconExit`    | `icon_exit.png` | Replace the ✕ exit icon button. |

## How to add an image

1. Drop the file into this `assets/images/` folder.
2. In `BootScene.js`, the `preload()` method already loads `bg` and `logo`.
   For any new image, add a line like:
   ```js
   this.load.image('myKey', 'assets/images/myfile.png');
   ```
3. Reference the key with `this.add.image(...)` in the relevant scene.
