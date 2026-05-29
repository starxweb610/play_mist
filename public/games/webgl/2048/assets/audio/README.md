# Audio Assets — Placeholder Guide

Place your audio files here and uncomment the corresponding lines in the code.

## Required Audio (uncomment in BootScene.js + scene files)

| Key | File | Where to uncomment | Description |
|-----|------|--------------------|-------------|
| `bgMusic`  | `background.mp3` | `BootScene.js` preload + `HomeScene.js` / `GameScene.js` create | Looping ambient background music |
| `sfxMove`  | `move.wav`       | `BootScene.js` preload + `GameScene.js` `doMove()` | Short swoosh on every valid slide |
| `sfxMerge` | `merge.wav`      | `BootScene.js` preload + `GameScene.js` `afterMove()` | Satisfying "pop" on tile merge |
| `sfxWin`   | `win.mp3`        | `BootScene.js` preload + `GameScene.js` `showEndOverlay()` | Fanfare when 2048 tile is reached |
| `sfxLose`  | `lose.mp3`       | `BootScene.js` preload + `GameScene.js` `showEndOverlay()` | Plays when no moves remain |
| `sfxButton`| `button.wav`     | `BootScene.js` preload + button handlers in all scenes | Short click / tick on button press |

## Recommended Formats

- **MP3** for music (good compression, wide support)
- **WAV** or **OGG** for short sound effects (low latency)
- Phaser 3 supports: `mp3`, `ogg`, `wav`, `m4a`, `webm`

## Quick-start: loading an audio file

In `BootScene.js` → `preload()`:
```js
this.load.audio('sfxMove', 'assets/audio/move.wav');
```

Playing it in a scene:
```js
this.sound.play('sfxMove', { volume: 0.6 });
```

Playing looping music:
```js
this.bgMusic = this.sound.add('bgMusic', { loop: true, volume: 0.4 });
this.bgMusic.play();
```
