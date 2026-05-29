class BootScene extends Phaser.Scene {
    constructor() {
        super(CONSTANTS.SCENES.BOOT);
    }

    preload() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Loading Text
        const loadingText = this.add.text(width / 2, height / 2 - 50, 'LOADING...', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '32px',
            fill: CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '900',
            letterSpacing: '4px'
        });
        loadingText.setOrigin(0.5, 0.5);

        // Progress Box
        const progressBox = this.add.graphics();
        progressBox.fillStyle(CONSTANTS.COLORS.PANEL_BG, 1);
        progressBox.fillRoundedRect(width / 2 - 160, height / 2, 320, 30, 15);

        // Progress Bar
        const progressBar = this.add.graphics();

        this.load.on('progress', (value) => {
            progressBar.clear();
            progressBar.fillStyle(CONSTANTS.COLORS.X_COLOR, 1);
            progressBar.fillRoundedRect(width / 2 - 155, height / 2 + 5, 310 * value, 20, 10);
        });

        this.load.on('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
            this.scene.start(CONSTANTS.SCENES.MENU);
        });

        // We can generate placeholders for X and O directly in Phaser using graphics, 
        // so no external images are required right now.
        // But let's load any dummy asset if needed to show progress bar.
        
        // Add fake delay to show loading screen for at least a bit
        for (let i = 0; i < 50; i++) {
            // Generating small dummy textures
            const g = this.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0xffffff, 1);
            g.fillRect(0,0,2,2);
            g.generateTexture('dummy'+i, 2, 2);
        }
    }

    create() {
        // Initialization code if needed after preload
    }
}
