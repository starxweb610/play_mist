class PauseScene extends Phaser.Scene {
    constructor() {
        super(CONSTANTS.SCENES.PAUSE);
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Semi-transparent background overlay
        const bg = this.add.graphics();
        bg.fillStyle(0x000000, 0.8);
        bg.fillRect(0, 0, width, height);

        // Pause Panel
        const panel = this.add.graphics();
        panel.fillStyle(CONSTANTS.COLORS.PANEL_BG, 1);
        panel.fillRoundedRect(width / 2 - 150, height / 2 - 200, 300, 400, 20);
        panel.lineStyle(2, CONSTANTS.COLORS.GRID, 1);
        panel.strokeRoundedRect(width / 2 - 150, height / 2 - 200, 300, 400, 20);

        this.add.text(width / 2, height / 2 - 140, 'PAUSED', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '48px',
            fill: CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '900'
        }).setOrigin(0.5);

        // Buttons
        this.createButton(width / 2, height / 2 - 40, 'RESUME', () => {
            this.scene.resume(CONSTANTS.SCENES.GAME);
            this.scene.stop();
        });

        this.createButton(width / 2, height / 2 + 40, 'RESTART', () => {
            const gameScene = this.scene.get(CONSTANTS.SCENES.GAME);
            const currentMode = gameScene.mode;
            this.scene.stop(CONSTANTS.SCENES.GAME);
            this.scene.start(CONSTANTS.SCENES.GAME, { mode: currentMode });
            this.scene.stop();
        });

        this.createButton(width / 2, height / 2 + 120, 'MAIN MENU', () => {
            this.scene.stop(CONSTANTS.SCENES.GAME);
            this.scene.start(CONSTANTS.SCENES.MENU);
            this.scene.stop();
        });
    }

    createButton(x, y, text, callback) {
        const width = 220;
        const height = 50;

        const container = this.add.container(x, y);

        const bg = this.add.graphics();
        bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 25);

        const buttonText = this.add.text(0, 0, text, {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '20px',
            fill: CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '700'
        }).setOrigin(0.5);

        container.add([bg, buttonText]);
        container.setSize(width, height);
        container.setInteractive();

        container.on('pointerover', () => {
            bg.clear();
            bg.fillStyle(CONSTANTS.COLORS.BUTTON_HOVER, 1);
            bg.fillRoundedRect(-width / 2, -height / 2, width, height, 25);
        });

        container.on('pointerout', () => {
            bg.clear();
            bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
            bg.fillRoundedRect(-width / 2, -height / 2, width, height, 25);
        });

        container.on('pointerdown', callback);
    }
}
