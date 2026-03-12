class MahjongGame {
    constructor(playerIds, room) {
        this.room = room;
        this.playerIds = playerIds;
        this.wall = this.generateWall();
        this.hands = {};
        this.discards = {};
        this.turnIndex = 0;
        
        playerIds.forEach(id => {
            this.hands[id] = [];
            this.discards[id] = [];
        });
    }

    generateWall() {
        // 簡易的な牌山生成（実際は萬子、筒子、索子、字牌を生成しシャッフル）
        const tiles = [];
        const suits = ['m', 'p', 's'];
        for (let suit of suits) {
            for (let i = 1; i <= 9; i++) {
                for(let j=0; j<4; j++) tiles.push(i + suit);
            }
        }
        // 字牌など追加...
        return tiles.sort(() => Math.random() - 0.5); // シャッフル
    }

    start() {
        // 配牌
        this.playerIds.forEach(id => {
            for (let i = 0; i < 13; i++) {
                this.hands[id].push(this.wall.pop());
            }
        });
        // 起家ツモ
        this.drawTile(this.playerIds[this.turnIndex]);
        this.room.broadcastState();
    }

    drawTile(playerId) {
        if (this.wall.length > 0) {
            this.hands[playerId].push(this.wall.pop());
        }
    }

    handlePlayerAction(playerId, action) {
        if (playerId !== this.playerIds[this.turnIndex]) return; // 手番チェック（権威サーバー）

        if (action.type === 'DISCARD') {
            const tileIndex = action.payload.tileIndex;
            const tile = this.hands[playerId].splice(tileIndex, 1)[0];
            this.discards[playerId].push(tile);
            
            // 次のターンへ
            this.turnIndex = (this.turnIndex + 1) % this.playerIds.length;
            this.drawTile(this.playerIds[this.turnIndex]);
            
            this.room.broadcastState();
            
            // 次の人がAIなら自動で打たせる
            this.triggerAILogic(this.playerIds[this.turnIndex]);
        }
        // TODO: 鳴き(CALL)、リーチ(RIICHI)、和了(WIN) のステートマシン分岐をここに実装
    }

    triggerAILogic(playerId) {
        const playerInfo = this.room.players.get(playerId);
        if (playerInfo && playerInfo.isAI) {
            setTimeout(() => {
                // AIロジック：ツモ切り（一番右の牌を捨てる）
                this.handlePlayerAction(playerId, { 
                    type: 'DISCARD', 
                    payload: { tileIndex: this.hands[playerId].length - 1 } 
                });
            }, 1000); // 1秒遅延
        }
    }

    getClientState(targetPlayerId) {
        // 他家の手牌を伏せる
        const maskedHands = {};
        this.playerIds.forEach(id => {
            if (id === targetPlayerId) {
                maskedHands[id] = this.hands[id]; // 自分には見せる
            } else {
                maskedHands[id] = this.hands[id].map(() => 'back'); // 他家は裏向き
            }
        });

        return {
            turnPlayerId: this.playerIds[this.turnIndex],
            wallCount: this.wall.length,
            hands: maskedHands,
            discards: this.discards
        };
    }
}
module.exports = MahjongGame;