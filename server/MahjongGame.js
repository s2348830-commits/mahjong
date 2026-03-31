class MahjongGame {
    constructor(playerIds, room) {
        this.room = room;
        this.playerIds = playerIds;
        this.wall = this.generateWall();
        this.hands = {};
        this.discards = {};
        this.turnIndex = 0;
        
        // ★状態管理の拡張
        this.phase = 'DRAW'; // 'DRAW', 'ACTION_WAIT', 'FINISHED'
        this.lastDiscard = null; // { playerId, tile }
        this.actionResponses = {}; // 他家からのアクション応答
        this.winner = null;
        this.winningType = null; // 'TSUMO' | 'RON'

        playerIds.forEach(id => {
            this.hands[id] = [];
            this.discards[id] = [];
        });
    }

    generateWall() {
        const tiles = [];
        const suits = ['m', 'p', 's'];
        for (let suit of suits) {
            for (let i = 1; i <= 9; i++) {
                for(let j=0; j<4; j++) tiles.push(i + suit);
            }
        }
        return tiles.sort(() => Math.random() - 0.5);
    }

    start() {
        this.playerIds.forEach(id => {
            for (let i = 0; i < 13; i++) {
                this.hands[id].push(this.wall.pop());
            }
        });
        this.phase = 'DRAW';
        this.drawTile(this.playerIds[this.turnIndex]);
        this.room.broadcastState();
        this.triggerAILogic(this.playerIds[this.turnIndex]);
    }

    drawTile(playerId) {
        if (this.wall.length > 0) {
            this.hands[playerId].push(this.wall.pop());
        }
    }

    handlePlayerAction(playerId, action) {
        if (this.phase === 'FINISHED') return;

        if (this.phase === 'DRAW') {
            if (playerId !== this.playerIds[this.turnIndex]) return;

            if (action.type === 'DISCARD') {
                const tileIndex = action.payload.tileIndex;
                const tile = this.hands[playerId].splice(tileIndex, 1)[0];
                this.discards[playerId].push(tile);
                this.lastDiscard = { playerId, tile };
                
                // ★打牌されたら他家のアクション待ちフェーズへ
                this.phase = 'ACTION_WAIT';
                this.actionResponses = {};
                this.room.broadcastState();

                // AIにロン/パスを判断させる
                this.playerIds.forEach(id => {
                    if (id !== playerId) this.triggerAILogic(id);
                });

            } else if (action.type === 'TSUMO') {
                // ★ツモ上がりの処理
                this.phase = 'FINISHED';
                this.winner = playerId;
                this.winningType = 'TSUMO';
                this.room.broadcastState();
                setTimeout(() => this.room.endGame(), 5000);
            }
        } 
        else if (this.phase === 'ACTION_WAIT') {
            if (playerId === this.lastDiscard.playerId) return; // 捨てた本人は不可

            if (action.type === 'RON') {
                // ★ロン上がりの処理
                this.phase = 'FINISHED';
                this.winner = playerId;
                this.winningType = 'RON';
                this.hands[playerId].push(this.lastDiscard.tile); // 演出のため手牌に加える
                this.room.broadcastState();
                setTimeout(() => this.room.endGame(), 5000);
                
            } else if (action.type === 'PASS') {
                // パス処理
                this.actionResponses[playerId] = 'PASS';
                
                const allPassed = this.playerIds.every(id => 
                    id === this.lastDiscard.playerId || this.actionResponses[id] === 'PASS'
                );

                if (allPassed) {
                    this.phase = 'DRAW';
                    this.turnIndex = (this.turnIndex + 1) % this.playerIds.length;
                    this.drawTile(this.playerIds[this.turnIndex]);
                    this.room.broadcastState();
                    this.triggerAILogic(this.playerIds[this.turnIndex]);
                }
            }
        }
    }

    // ★AIロジックをフェーズ対応に拡張
    triggerAILogic(playerId) {
        const playerInfo = this.room.players.get(playerId);
        if (!playerInfo || !playerInfo.isAI) return;

        if (this.phase === 'DRAW' && playerId === this.playerIds[this.turnIndex]) {
            setTimeout(() => {
                if (this.phase !== 'DRAW') return;
                this.handlePlayerAction(playerId, { type: 'DISCARD', payload: { tileIndex: this.hands[playerId].length - 1 }});
            }, 1000);
        } else if (this.phase === 'ACTION_WAIT' && playerId !== this.lastDiscard.playerId) {
            setTimeout(() => {
                if (this.phase !== 'ACTION_WAIT') return;
                // AIは常にパスする
                this.handlePlayerAction(playerId, { type: 'PASS' });
            }, 800);
        }
    }

    getClientState(targetPlayerId) {
        const maskedHands = {};
        this.playerIds.forEach(id => {
            // 終局時は全員の手牌を公開する
            if (id === targetPlayerId || this.phase === 'FINISHED' || this.room.settings.openHands) {
                maskedHands[id] = this.hands[id];
            } else {
                maskedHands[id] = this.hands[id].map(() => 'back');
            }
        });

        // ★クライアントが押せるアクションを計算
        let allowedActions = [];
        if (this.phase === 'DRAW' && targetPlayerId === this.playerIds[this.turnIndex]) {
            allowedActions = ['TSUMO']; // 自分の番は「ツモ」ボタン
        } else if (this.phase === 'ACTION_WAIT' && targetPlayerId !== this.lastDiscard.playerId) {
            if (!this.actionResponses[targetPlayerId]) {
                allowedActions = ['RON', 'PASS']; // 他家の打牌後は「ロン」「パス」ボタン
            }
        }

        return {
            phase: this.phase,
            turnPlayerId: this.playerIds[this.turnIndex],
            wallCount: this.wall.length,
            hands: maskedHands,
            discards: this.discards,
            allowedActions: allowedActions,
            lastDiscard: this.lastDiscard,
            winner: this.winner,
            winningType: this.winningType
        };
    }
}
module.exports = MahjongGame;