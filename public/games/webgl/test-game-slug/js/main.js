window.onload = function() {
    const config = {
        type: Phaser.WEBGL,
        parent: 'game-container',
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
            width: 540,
            height: 960 // Portrait orientation aspect ratio 9:16
        },
        backgroundColor: CONSTANTS.COLORS.BACKGROUND,
        scene: [
            BootScene,
            MenuScene,
            OnlineMenuScene,
            HostScene,
            JoinScene,
            GameScene,
            PauseScene,
            GameOverScene
        ],
        // Adding visual aesthetics config
        render: {
            antialias: true,
            pixelArt: false,
            roundPixels: true
        }
    };

    const game = new Phaser.Game(config);
};
