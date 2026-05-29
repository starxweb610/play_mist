class BotLogic {
    static getBestMove(board, aiPlayer, humanPlayer) {
        let bestScore = -Infinity;
        let move = -1;

        for (let i = 0; i < 9; i++) {
            if (board[i] === null) {
                board[i] = aiPlayer;
                let score = this.minimax(board, 0, false, aiPlayer, humanPlayer);
                board[i] = null;
                if (score > bestScore) {
                    bestScore = score;
                    move = i;
                }
            }
        }
        return move;
    }

    static minimax(board, depth, isMaximizing, aiPlayer, humanPlayer) {
        let result = this.checkWinner(board);
        if (result === aiPlayer) return 10 - depth;
        if (result === humanPlayer) return depth - 10;
        if (this.isTie(board)) return 0;

        if (isMaximizing) {
            let bestScore = -Infinity;
            for (let i = 0; i < 9; i++) {
                if (board[i] === null) {
                    board[i] = aiPlayer;
                    let score = this.minimax(board, depth + 1, false, aiPlayer, humanPlayer);
                    board[i] = null;
                    bestScore = Math.max(score, bestScore);
                }
            }
            return bestScore;
        } else {
            let bestScore = Infinity;
            for (let i = 0; i < 9; i++) {
                if (board[i] === null) {
                    board[i] = humanPlayer;
                    let score = this.minimax(board, depth + 1, true, aiPlayer, humanPlayer);
                    board[i] = null;
                    bestScore = Math.min(score, bestScore);
                }
            }
            return bestScore;
        }
    }

    static checkWinner(board) {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
            [0, 4, 8], [2, 4, 6]             // diagonals
        ];

        for (let i = 0; i < winPatterns.length; i++) {
            const [a, b, c] = winPatterns[i];
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                return board[a];
            }
        }
        return null;
    }

    static isTie(board) {
        return board.every(cell => cell !== null) && this.checkWinner(board) === null;
    }
}

window.BotLogic = BotLogic;
