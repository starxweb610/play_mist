class JoinScene extends Phaser.Scene {
    constructor() {
        super(CONSTANTS.SCENES.JOIN_SCENE);
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        this.add.text(width / 2, height * 0.15, 'JOIN MATCH', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '48px',
            fill: CONSTANTS.COLORS.O_COLOR_STR,
            fontWeight: '900'
        }).setOrigin(0.5);

        this.statusText = this.add.text(width / 2, height * 0.25, 'Enter a 6-digit code or Quick Join', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '20px',
            fill: CONSTANTS.COLORS.TEXT_MUTED,
            fontWeight: '400',
            align: 'center'
        }).setOrigin(0.5);

        // Input field overlay using DOM Element (requires DOM container in config, which we might not have enabled)
        // Alternatively, use a simple prompt for now, or just an HTML overlay manually created.
        // Let's create an HTML input overlay manually because Phaser DOM requires modifying game config.
        this.createHTMLInput(width, height);

        // Join Button
        this.joinBtn = this.createButton(width / 2, height * 0.5, 'JOIN WITH CODE', () => {
            const code = this.inputElement.value;
            if (code && code.length === 6) {
                this.statusText.setText('Connecting...');
                this.statusText.setColor(CONSTANTS.COLORS.TEXT_LIGHT);
                window.webRTCManager.joinMatch(code);
            } else {
                this.statusText.setText('Please enter a valid 6-digit code');
                this.statusText.setColor('#ff0000');
            }
        });

        this.add.text(width / 2, height * 0.6, '- OR -', {
            fontFamily: CONSTANTS.FONTS.MAIN, fontSize: '18px', fill: CONSTANTS.COLORS.TEXT_MUTED
        }).setOrigin(0.5);

        // Quick Join Button
        this.createButton(width / 2, height * 0.7, 'QUICK JOIN', () => {
            this.statusText.setText('Searching for matches...');
            this.statusText.setColor(CONSTANTS.COLORS.TEXT_LIGHT);
            window.webRTCManager.quickJoin();
        });

        // Cancel Button
        this.createButton(width / 2, height * 0.85, 'BACK', () => {
            this.removeHTMLInput();
            window.webRTCManager.reset();
            this.scene.start(CONSTANTS.SCENES.ONLINE_MENU);
        });

        this.setupWebRTC();
    }

    createHTMLInput(width, height) {
        // Calculate position based on canvas bounds to properly overlay the HTML input
        const canvas = this.game.canvas;
        const rect = canvas.getBoundingClientRect();
        
        // Logical coordinates from Phaser
        const logicalY = height * 0.35;
        
        // Scale to physical screen coordinates
        const scaleY = rect.height / height;
        const scaleX = rect.width / width;
        
        const physicalY = rect.top + (logicalY * scaleY);
        const physicalWidth = 250 * scaleX;
        const physicalHeight = 60 * scaleY;
        const physicalLeft = rect.left + (width / 2 * scaleX) - (physicalWidth / 2);

        this.inputElement = document.createElement('input');
        this.inputElement.type = 'number';
        this.inputElement.maxLength = 6;
        this.inputElement.placeholder = '000000';
        this.inputElement.style.position = 'absolute';
        this.inputElement.style.left = `${physicalLeft}px`;
        this.inputElement.style.top = `${physicalY}px`;
        this.inputElement.style.width = `${physicalWidth}px`;
        this.inputElement.style.height = `${physicalHeight}px`;
        this.inputElement.style.fontSize = `${32 * scaleY}px`;
        this.inputElement.style.textAlign = 'center';
        this.inputElement.style.backgroundColor = '#1a1c29';
        this.inputElement.style.color = '#ffffff';
        this.inputElement.style.border = '2px solid #2a2d43';
        this.inputElement.style.borderRadius = `${15 * scaleY}px`;
        this.inputElement.style.outline = 'none';
        this.inputElement.style.fontFamily = "'Outfit', sans-serif";
        this.inputElement.style.letterSpacing = '5px';
        this.inputElement.id = 'phaser-overlay-input';

        // Limit to 6 digits visually
        this.inputElement.oninput = (e) => {
            if (e.target.value.length > 6) {
                e.target.value = e.target.value.slice(0, 6);
            }
        };

        document.body.appendChild(this.inputElement);

        // Add resize listener to reposition input
        this.resizeListener = () => this.repositionInput(width, height);
        window.addEventListener('resize', this.resizeListener);
    }

    repositionInput(width, height) {
        if (!this.inputElement) return;
        const canvas = this.game.canvas;
        const rect = canvas.getBoundingClientRect();
        const logicalY = height * 0.35;
        const scaleY = rect.height / height;
        const scaleX = rect.width / width;
        
        const physicalY = rect.top + (logicalY * scaleY);
        const physicalWidth = 250 * scaleX;
        const physicalHeight = 60 * scaleY;
        const physicalLeft = rect.left + (width / 2 * scaleX) - (physicalWidth / 2);

        this.inputElement.style.left = `${physicalLeft}px`;
        this.inputElement.style.top = `${physicalY}px`;
        this.inputElement.style.width = `${physicalWidth}px`;
        this.inputElement.style.height = `${physicalHeight}px`;
        this.inputElement.style.fontSize = `${32 * scaleY}px`;
        this.inputElement.style.borderRadius = `${15 * scaleY}px`;
    }

    removeHTMLInput() {
        if (this.inputElement) {
            this.inputElement.remove();
            this.inputElement = null;
        }
        if (this.resizeListener) {
            window.removeEventListener('resize', this.resizeListener);
        }
    }

    setupWebRTC() {
        const rtc = window.webRTCManager;

        rtc.onJoinSuccess = (code) => {
            this.statusText.setText('Joined room! Connecting P2P...');
            this.statusText.setColor(CONSTANTS.COLORS.X_COLOR_STR);
            this.inputElement.disabled = true;
        };

        rtc.onJoinError = (err) => {
            this.statusText.setText(err);
            this.statusText.setColor('#ff0000');
            this.inputElement.disabled = false;
        };

        rtc.onDataChannelOpen = () => {
            this.removeHTMLInput();
            this.scene.start(CONSTANTS.SCENES.GAME, { 
                mode: CONSTANTS.MODES.ONLINE_MULTIPLAYER,
                isHost: false
            });
        };
    }

    createButton(x, y, text, callback) {
        const width = 300;
        const height = 60;
        const container = this.add.container(x, y);

        const bg = this.add.graphics();
        bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 30);
        bg.lineStyle(2, CONSTANTS.COLORS.TEXT_MUTED, 0.5);
        bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 30);

        const buttonText = this.add.text(0, 0, text, {
            fontFamily: CONSTANTS.FONTS.MAIN, fontSize: '22px', fill: CONSTANTS.COLORS.TEXT_LIGHT, fontWeight: '700'
        }).setOrigin(0.5);

        container.add([bg, buttonText]);
        container.setSize(width, height);
        container.setInteractive();
        container.on('pointerdown', callback);
        return container;
    }
}
