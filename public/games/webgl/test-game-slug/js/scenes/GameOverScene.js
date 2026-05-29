class GameOverScene extends Phaser.Scene {
    constructor() {
        super(CONSTANTS.SCENES.GAME_OVER);
    }

    init(data) {
        this.result = data.result; // 'X', 'O', or 'DRAW'
        this.mode = data.mode;
        this.isHost = data.isHost;
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Semi-transparent background overlay
        const bg = this.add.graphics();
        bg.fillStyle(0x000000, 0.85);
        bg.fillRect(0, 0, width, height);

        // Result Text
        let resultString = '';
        let resultColor = CONSTANTS.COLORS.TEXT_LIGHT;

        if (this.result === 'DRAW') {
            resultString = 'IT\'S A DRAW!';
        } else {
            resultString = `${this.result} WINS!`;
            resultColor = this.result === CONSTANTS.PLAYER.X ? CONSTANTS.COLORS.X_COLOR_STR : CONSTANTS.COLORS.O_COLOR_STR;
        }

        const titleText = this.add.text(width / 2, height / 2 - 100, resultString, {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '56px',
            fill: resultColor,
            fontWeight: '900'
        }).setOrigin(0.5);

        if (this.result !== 'DRAW') {
            titleText.setShadow(0, 0, resultColor, 20, true, true);
        }

        // Play Again Button
        this.createButton(width / 2, height / 2 + 50, 'PLAY AGAIN', () => {
            if (this.mode === CONSTANTS.MODES.ONLINE_MULTIPLAYER) {
                window.webRTCManager.sendData({ type: 'restart' });
            }
            this.scene.stop(CONSTANTS.SCENES.GAME);
            this.scene.start(CONSTANTS.SCENES.GAME, { mode: this.mode, isHost: this.isHost });
            this.scene.stop();
        });

        // Main Menu Button
        this.createButton(width / 2, height / 2 + 130, 'MAIN MENU', () => {
            this.scene.stop(CONSTANTS.SCENES.GAME);
            this.scene.start(CONSTANTS.SCENES.MENU);
            this.scene.stop();
        });
        
        // Pop-in animation for title
        titleText.setScale(0.5);
        titleText.setAlpha(0);
        this.tweens.add({
            targets: titleText,
            scale: 1,
            alpha: 1,
            ease: 'Back.easeOut',
            duration: 500
        });
    }

    createButton(x, y, text, callback) {
        const width = 250;
        const height = 60;

        const container = this.add.container(x, y);

        const bg = this.add.graphics();
        bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 30);

        const buttonText = this.add.text(0, 0, text, {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '22px',
            fill: CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '700'
        }).setOrigin(0.5);

        container.add([bg, buttonText]);
        container.setSize(width, height);
        container.setInteractive();

        container.on('pointerover', () => {
            bg.clear();
            bg.fillStyle(CONSTANTS.COLORS.BUTTON_HOVER, 1);
            bg.fillRoundedRect(-width / 2, -height / 2, width, height, 30);
        });

        container.on('pointerout', () => {
            bg.clear();
            bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
            bg.fillRoundedRect(-width / 2, -height / 2, width, height, 30);
        });

        container.on('pointerdown', callback);
    }
}
