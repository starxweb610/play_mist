class HostScene extends Phaser.Scene {
    constructor() {
        super(CONSTANTS.SCENES.HOST_SCENE);
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        this.add.text(width / 2, height * 0.2, 'HOSTING', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '48px',
            fill: CONSTANTS.COLORS.X_COLOR_STR,
            fontWeight: '900'
        }).setOrigin(0.5);

        this.statusText = this.add.text(width / 2, height * 0.35, 'Connecting to server...', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '24px',
            fill: CONSTANTS.COLORS.TEXT_MUTED,
            fontWeight: '400'
        }).setOrigin(0.5);

        this.codeText = this.add.text(width / 2, height * 0.5, '------', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '80px',
            fill: CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '900',
            letterSpacing: '10px'
        }).setOrigin(0.5);

        this.add.text(width / 2, height * 0.65, 'Share this code with your friend', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '18px',
            fill: CONSTANTS.COLORS.TEXT_MUTED,
            fontWeight: '400'
        }).setOrigin(0.5);

        // Cancel Button
        this.createButton(width / 2, height * 0.85, 'CANCEL', () => {
            window.webRTCManager.reset();
            this.scene.start(CONSTANTS.SCENES.ONLINE_MENU);
        });

        this.setupWebRTC();
    }

    setupWebRTC() {
        const rtc = window.webRTCManager;

        rtc.onRoomCreated = (code) => {
            this.statusText.setText('Waiting for player to join...');
            this.codeText.setText(code);
        };

        rtc.onPeerJoined = () => {
            this.statusText.setText('Player joined! Connecting P2P...');
            this.statusText.setColor(CONSTANTS.COLORS.O_COLOR_STR);
        };

        rtc.onDataChannelOpen = () => {
            this.scene.start(CONSTANTS.SCENES.GAME, { 
                mode: CONSTANTS.MODES.ONLINE_MULTIPLAYER,
                isHost: true
            });
        };

        rtc.onJoinError = (err) => {
            this.statusText.setText('Error: ' + err);
            this.statusText.setColor('#ff0000');
        };

        rtc.hostMatch();
    }

    createButton(x, y, text, callback) {
        const width = 250;
        const height = 60;
        const container = this.add.container(x, y);

        const bg = this.add.graphics();
        bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 30);
        bg.lineStyle(2, CONSTANTS.COLORS.TEXT_MUTED, 0.5);
        bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 30);

        const buttonText = this.add.text(0, 0, text, {
            fontFamily: CONSTANTS.FONTS.MAIN, fontSize: '22px', fill: CONSTANTS.COLORS.TEXT_MUTED, fontWeight: '700'
        }).setOrigin(0.5);

        container.add([bg, buttonText]);
        container.setSize(width, height);
        container.setInteractive();
        container.on('pointerdown', callback);
    }
}
