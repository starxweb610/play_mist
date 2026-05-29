class MenuScene extends Phaser.Scene {
    constructor() {
        super(CONSTANTS.SCENES.MENU);
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Title
        const titleText = this.add.text(width / 2, height * 0.2, 'TIC TAC TOE', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '64px',
            fill: CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '900',
            align: 'center'
        }).setOrigin(0.5);

        titleText.setShadow(0, 0, '#00f0ff', 15, true, true);

        // Buttons
        this.createButton(width / 2, height * 0.45, '1 PLAYER', () => {
            this.scene.start(CONSTANTS.SCENES.GAME, { mode: CONSTANTS.MODES.SINGLE_PLAYER });
        });

        this.createButton(width / 2, height * 0.6, '2 PLAYERS (LOCAL)', () => {
            this.scene.start(CONSTANTS.SCENES.GAME, { mode: CONSTANTS.MODES.LOCAL_MULTIPLAYER });
        });

        // Multiplayer Online
        // this.createButton(width / 2, height * 0.75, 'PLAY ONLINE', () => {
        //     this.scene.start(CONSTANTS.SCENES.ONLINE_MENU);
        // });
    }

    createButton(x, y, text, callback, disabled = false) {
        const width = 350;
        const height = 80;

        const container = this.add.container(x, y);

        const bg = this.add.graphics();
        bg.fillStyle(disabled ? 0x2a2a2a : CONSTANTS.COLORS.BUTTON_BG, 1);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 40);

        if (!disabled) {
            bg.lineStyle(2, CONSTANTS.COLORS.X_COLOR, 0.5);
            bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 40);
        }

        const buttonText = this.add.text(0, 0, text, {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '28px',
            fill: disabled ? '#555555' : CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '700'
        }).setOrigin(0.5);

        container.add([bg, buttonText]);

        if (!disabled) {
            container.setSize(width, height);
            container.setInteractive();

            container.on('pointerover', () => {
                bg.clear();
                bg.fillStyle(CONSTANTS.COLORS.BUTTON_HOVER, 1);
                bg.fillRoundedRect(-width / 2, -height / 2, width, height, 40);
                bg.lineStyle(2, CONSTANTS.COLORS.X_COLOR, 1);
                bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 40);
                this.tweens.add({
                    targets: container,
                    scaleX: 1.05,
                    scaleY: 1.05,
                    duration: 100
                });
            });

            container.on('pointerout', () => {
                bg.clear();
                bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
                bg.fillRoundedRect(-width / 2, -height / 2, width, height, 40);
                bg.lineStyle(2, CONSTANTS.COLORS.X_COLOR, 0.5);
                bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 40);
                this.tweens.add({
                    targets: container,
                    scaleX: 1,
                    scaleY: 1,
                    duration: 100
                });
            });

            container.on('pointerdown', () => {
                this.tweens.add({
                    targets: container,
                    scaleX: 0.95,
                    scaleY: 0.95,
                    duration: 50,
                    yoyo: true,
                    onComplete: callback
                });
            });
        }
    }
}
