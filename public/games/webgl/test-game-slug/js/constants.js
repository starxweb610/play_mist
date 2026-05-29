const CONSTANTS = {
    COLORS: {
        BACKGROUND: 0x0d0e15,
        GRID: 0x2a2d43,
        X_COLOR: 0x00f0ff, // Neon Cyan
        O_COLOR: 0xff0055, // Neon Pink
        X_COLOR_STR: '#00f0ff',
        O_COLOR_STR: '#ff0055',
        TEXT_LIGHT: '#ffffff',
        TEXT_MUTED: '#888c9e',
        BUTTON_BG: 0x1a1c29,
        BUTTON_HOVER: 0x2a2d43,
        PANEL_BG: 0x12141f,
        GLOW_X: 0x00f0ff,
        GLOW_O: 0xff0055
    },
    FONTS: {
        MAIN: '"Outfit", sans-serif'
    },
    MODES: {
        SINGLE_PLAYER: 'SINGLE_PLAYER',
        LOCAL_MULTIPLAYER: 'LOCAL_MULTIPLAYER',
        ONLINE_MULTIPLAYER: 'ONLINE_MULTIPLAYER'
    },
    SCENES: {
        BOOT: 'BootScene',
        MENU: 'MenuScene',
        ONLINE_MENU: 'OnlineMenuScene',
        HOST_SCENE: 'HostScene',
        JOIN_SCENE: 'JoinScene',
        GAME: 'GameScene',
        PAUSE: 'PauseScene',
        GAME_OVER: 'GameOverScene'
    },
    PLAYER: {
        X: 'X',
        O: 'O'
    }
};

window.CONSTANTS = CONSTANTS;
