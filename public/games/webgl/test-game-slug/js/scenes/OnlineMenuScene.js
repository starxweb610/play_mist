class OnlineMenuScene extends Phaser.Scene {
    constructor() {
        super(CONSTANTS.SCENES.ONLINE_MENU);
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Title
        const titleText = this.add.text(width / 2, height * 0.2, 'ONLINE', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '64px',
            fill: CONSTANTS.COLORS.X_COLOR_STR,
            fontWeight: '900',
            align: 'center'
        }).setOrigin(0.5);

        titleText.setShadow(0, 0, CONSTANTS.COLORS.X_COLOR_STR, 15, true, true);

        // Buttons
        this.createButton(width / 2, height * 0.45, 'HOST A MATCH', () => {
            this.scene.start(CONSTANTS.SCENES.HOST_SCENE);
        });

        this.createButton(width / 2, height * 0.6, 'JOIN A MATCH', () => {
            this.scene.start(CONSTANTS.SCENES.JOIN_SCENE);
        });
        
        // Back Button
        this.createButton(width / 2, height * 0.85, 'BACK', () => {
            this.scene.start(CONSTANTS.SCENES.MENU);
        }, true);
    }

    createButton(x, y, text, callback, isBack = false) {
        const width = 350;
        const height = 80;

        const container = this.add.container(x, y);

        const bg = this.add.graphics();
        bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 40);
        
        bg.lineStyle(2, isBack ? CONSTANTS.COLORS.TEXT_MUTED : CONSTANTS.COLORS.X_COLOR, 0.5);
        bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 40);

        const buttonText = this.add.text(0, 0, text, {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '28px',
            fill: isBack ? CONSTANTS.COLORS.TEXT_MUTED : CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '700'
        }).setOrigin(0.5);

        container.add([bg, buttonText]);

        container.setSize(width, height);
        container.setInteractive();

        container.on('pointerover', () => {
            bg.clear();
            bg.fillStyle(CONSTANTS.COLORS.BUTTON_HOVER, 1);
            bg.fillRoundedRect(-width / 2, -height / 2, width, height, 40);
            bg.lineStyle(2, isBack ? CONSTANTS.COLORS.TEXT_MUTED : CONSTANTS.COLORS.X_COLOR, 1);
            bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 40);
            this.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 100 });
        });

        container.on('pointerout', () => {
            bg.clear();
            bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
            bg.fillRoundedRect(-width / 2, -height / 2, width, height, 40);
            bg.lineStyle(2, isBack ? CONSTANTS.COLORS.TEXT_MUTED : CONSTANTS.COLORS.X_COLOR, 0.5);
            bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 40);
            this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 100 });
        });

        container.on('pointerdown', () => {
            this.tweens.add({
                targets: container,
                scaleX: 0.95, scaleY: 0.95, duration: 50, yoyo: true,
                onComplete: callback
            });
        });
    }
}
