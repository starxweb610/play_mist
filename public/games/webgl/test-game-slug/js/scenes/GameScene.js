class GameScene extends Phaser.Scene {
    constructor() {
        super(CONSTANTS.SCENES.GAME);
    }

    init(data) {
        this.mode = data.mode || CONSTANTS.MODES.SINGLE_PLAYER;
        this.isHost = data.isHost !== undefined ? data.isHost : true;
        
        if (this.mode === CONSTANTS.MODES.ONLINE_MULTIPLAYER) {
            this.localPlayer = this.isHost ? CONSTANTS.PLAYER.X : CONSTANTS.PLAYER.O;
        } else {
            this.localPlayer = CONSTANTS.PLAYER.X; // In other modes, local is always X or controls both
        }

        this.board = Array(9).fill(null);
        this.currentPlayer = CONSTANTS.PLAYER.X; // X always starts
        this.humanPlayer = CONSTANTS.PLAYER.X;
        this.aiPlayer = CONSTANTS.PLAYER.O;
        this.gameOver = false;
        this.cells = [];
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Top UI
        this.createTopUI(width);

        // Draw Grid
        this.createGrid(width, height);

        // Bottom UI (Pause Button)
        this.createBottomUI(width, height);

        // Turn Indicator
        this.updateTurnIndicator();

        if (this.mode === CONSTANTS.MODES.ONLINE_MULTIPLAYER) {
            window.webRTCManager.onDataReceived = (data) => {
                if (data.type === 'move') {
                    const cell = this.cells[data.index];
                    this.makeMove(data.index, cell.x, cell.y, true); // true = remote move
                } else if (data.type === 'restart') {
                    this.scene.restart({ mode: this.mode, isHost: this.isHost });
                }
            };

            window.webRTCManager.onPeerDisconnected = () => {
                this.gameOver = true;
                this.turnIndicator.setText('PEER DISCONNECTED');
                this.turnIndicator.setColor('#ff0000');
                this.time.delayedCall(2000, () => {
                    window.webRTCManager.reset();
                    this.scene.start(CONSTANTS.SCENES.ONLINE_MENU);
                });
            };
        }
    }

    createTopUI(width) {
        // Mode Text
        let modeString = '';
        if (this.mode === CONSTANTS.MODES.SINGLE_PLAYER) modeString = 'VS BOT';
        else if (this.mode === CONSTANTS.MODES.LOCAL_MULTIPLAYER) modeString = 'LOCAL 2P';
        else modeString = 'ONLINE';

        this.add.text(width / 2, 60, modeString, {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '18px',
            fill: CONSTANTS.COLORS.TEXT_MUTED,
            fontWeight: '700'
        }).setOrigin(0.5);

        // Player names based on online mode
        let playerXString = 'Player X';
        let playerOString = 'Player O';
        
        if (this.mode === CONSTANTS.MODES.SINGLE_PLAYER) {
            playerOString = 'Bot O';
        } else if (this.mode === CONSTANTS.MODES.ONLINE_MULTIPLAYER) {
            playerXString = this.isHost ? 'You (X)' : 'Opponent (X)';
            playerOString = this.isHost ? 'Opponent (O)' : 'You (O)';
        }

        // Player X Score
        this.playerXText = this.add.text(40, 60, playerXString, {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '24px',
            fill: CONSTANTS.COLORS.X_COLOR_STR,
            fontWeight: '700'
        });

        // Player O Score
        this.playerOText = this.add.text(width - 40, 60, playerOString, {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '24px',
            fill: CONSTANTS.COLORS.O_COLOR_STR,
            fontWeight: '700'
        }).setOrigin(1, 0);
        
        // Turn indicator label
        this.turnIndicator = this.add.text(width / 2, 120, 'X TURN', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '32px',
            fill: CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '900'
        }).setOrigin(0.5);
    }

    createGrid(width, height) {
        const gridSize = 360;
        const cellSize = gridSize / 3;
        const startX = (width - gridSize) / 2;
        const startY = (height - gridSize) / 2;

        const graphics = this.add.graphics();
        graphics.lineStyle(4, CONSTANTS.COLORS.GRID, 1);

        // Vertical lines
        graphics.beginPath();
        graphics.moveTo(startX + cellSize, startY);
        graphics.lineTo(startX + cellSize, startY + gridSize);
        graphics.moveTo(startX + cellSize * 2, startY);
        graphics.lineTo(startX + cellSize * 2, startY + gridSize);
        
        // Horizontal lines
        graphics.moveTo(startX, startY + cellSize);
        graphics.lineTo(startX + gridSize, startY + cellSize);
        graphics.moveTo(startX, startY + cellSize * 2);
        graphics.lineTo(startX + gridSize, startY + cellSize * 2);
        graphics.strokePath();

        // Create interactive cells
        for (let i = 0; i < 9; i++) {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const x = startX + col * cellSize + cellSize / 2;
            const y = startY + row * cellSize + cellSize / 2;

            const zone = this.add.zone(x, y, cellSize, cellSize).setInteractive();
            zone.cellIndex = i;

            zone.on('pointerdown', () => this.handleCellClick(i, x, y));

            this.cells.push({ zone, x, y, symbol: null });
        }
    }

    createBottomUI(width, height) {
        const pauseBtn = this.add.container(width / 2, height - 80);
        
        const bg = this.add.graphics();
        bg.fillStyle(CONSTANTS.COLORS.BUTTON_BG, 1);
        bg.fillRoundedRect(-75, -25, 150, 50, 25);
        
        const txt = this.add.text(0, 0, 'PAUSE', {
            fontFamily: CONSTANTS.FONTS.MAIN,
            fontSize: '20px',
            fill: CONSTANTS.COLORS.TEXT_LIGHT,
            fontWeight: '700'
        }).setOrigin(0.5);

        pauseBtn.add([bg, txt]);
        pauseBtn.setSize(150, 50);
        pauseBtn.setInteractive();
        pauseBtn.on('pointerdown', () => {
            this.scene.pause();
            this.scene.launch(CONSTANTS.SCENES.PAUSE);
        });
    }

    updateTurnIndicator() {
        if (this.gameOver) return;
        this.turnIndicator.setText(`${this.currentPlayer} TURN`);
        this.turnIndicator.setColor(this.currentPlayer === CONSTANTS.PLAYER.X ? '#00f0ff' : '#ff0055');
    }

    handleCellClick(index, x, y) {
        if (this.gameOver || this.board[index] !== null) return;

        // In single player, ignore input if it's bot's turn
        if (this.mode === CONSTANTS.MODES.SINGLE_PLAYER && this.currentPlayer === this.aiPlayer) return;

        // In online multiplayer, ignore input if it's not local player's turn
        if (this.mode === CONSTANTS.MODES.ONLINE_MULTIPLAYER && this.currentPlayer !== this.localPlayer) return;

        this.makeMove(index, x, y, false);
    }

    makeMove(index, x, y, isRemote = false) {
        this.board[index] = this.currentPlayer;
        this.drawSymbol(this.currentPlayer, x, y);
        
        // Disable zone
        this.cells[index].zone.disableInteractive();

        // Broadcast move
        if (this.mode === CONSTANTS.MODES.ONLINE_MULTIPLAYER && !isRemote) {
            window.webRTCManager.sendData({ type: 'move', index: index });
        }

        this.checkGameEnd();

        if (!this.gameOver) {
            this.currentPlayer = this.currentPlayer === CONSTANTS.PLAYER.X ? CONSTANTS.PLAYER.O : CONSTANTS.PLAYER.X;
            this.updateTurnIndicator();

            if (this.mode === CONSTANTS.MODES.SINGLE_PLAYER && this.currentPlayer === this.aiPlayer) {
                // Bot's turn
                this.time.delayedCall(500, this.botMove, [], this);
            }
        }
    }

    botMove() {
        if (this.gameOver) return;
        const move = BotLogic.getBestMove(this.board, this.aiPlayer, this.humanPlayer);
        if (move !== -1) {
            const cell = this.cells[move];
            this.makeMove(move, cell.x, cell.y);
        }
    }

    drawSymbol(player, x, y) {
        const graphics = this.add.graphics();
        const size = 40;

        if (player === CONSTANTS.PLAYER.X) {
            graphics.lineStyle(8, CONSTANTS.COLORS.X_COLOR, 1);
            graphics.beginPath();
            graphics.moveTo(x - size, y - size);
            graphics.lineTo(x + size, y + size);
            graphics.moveTo(x + size, y - size);
            graphics.lineTo(x - size, y + size);
            graphics.strokePath();

            // Glow effect
            graphics.lineStyle(16, CONSTANTS.COLORS.X_COLOR, 0.2);
            graphics.beginPath();
            graphics.moveTo(x - size, y - size);
            graphics.lineTo(x + size, y + size);
            graphics.moveTo(x + size, y - size);
            graphics.lineTo(x - size, y + size);
            graphics.strokePath();

        } else {
            graphics.lineStyle(8, CONSTANTS.COLORS.O_COLOR, 1);
            graphics.strokeCircle(x, y, size + 10);
            
            // Glow effect
            graphics.lineStyle(16, CONSTANTS.COLORS.O_COLOR, 0.2);
            graphics.strokeCircle(x, y, size + 10);
        }

        // Add pop animation
        this.tweens.add({
            targets: graphics,
            scaleX: { from: 0.5, to: 1 },
            scaleY: { from: 0.5, to: 1 },
            alpha: { from: 0, to: 1 },
            ease: 'Back.easeOut',
            duration: 300
        });
    }

    checkGameEnd() {
        const winner = BotLogic.checkWinner(this.board);
        if (winner) {
            this.gameOver = true;
            this.turnIndicator.setText('');
            this.time.delayedCall(800, () => {
                this.scene.pause();
                this.scene.launch(CONSTANTS.SCENES.GAME_OVER, { result: winner, mode: this.mode, isHost: this.isHost });
            });
        } else if (BotLogic.isTie(this.board)) {
            this.gameOver = true;
            this.turnIndicator.setText('');
            this.time.delayedCall(800, () => {
                this.scene.pause();
                this.scene.launch(CONSTANTS.SCENES.GAME_OVER, { result: 'DRAW', mode: this.mode, isHost: this.isHost });
            });
        }
    }
}
