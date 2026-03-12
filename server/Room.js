const MahjongGame = require('./MahjongGame');

class Room {
    constructor(id, name, maxPlayers) {
        this.id = id;
        this.name = name;
        this.maxPlayers = maxPlayers; // 3 or 4
        this.players = new Map(); // id -> { ws, isReady, isAI, disconnectTimeout }
        this.status = 'LOBBY'; // LOBBY, PLAYING
        this.game = null;
    }

    join(playerId, ws) {
        if (this.players.size >= this.maxPlayers && !this.players.has(playerId)) return;

        // 復帰処理
        if (this.players.has(playerId)) {
            const player = this.players.get(playerId);
            clearTimeout(player.disconnectTimeout); // 60秒タイマー解除
            player.ws = ws; // コネクション更新
            player.isAI = false;
        } else {
            this.players.set(playerId, { ws, isReady: false, isAI: false, disconnectTimeout: null });
        }
        
        this.broadcastState();
    }

    handleAction(playerId, action) {
        const player = this.players.get(playerId);
        if (!player) return;

        if (this.status === 'LOBBY') {
            if (action.type === 'TOGGLE_READY') {
                player.isReady = !player.isReady;
                this.checkStartGame();
                this.broadcastState();
            }
        } else if (this.status === 'PLAYING') {
            this.game.handlePlayerAction(playerId, action);
        }
    }

    checkStartGame() {
        if (this.players.size === this.maxPlayers) {
            const allReady = Array.from(this.players.values()).every(p => p.isReady);
            if (allReady) {
                this.status = 'PLAYING';
                this.game = new MahjongGame(Array.from(this.players.keys()), this);
                this.game.start();
            }
        }
    }

    handleDisconnect(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            if (this.status === 'PLAYING') {
                // 60秒タイマー開始
                player.disconnectTimeout = setTimeout(() => {
                    player.isAI = true; // AIに交代
                    this.broadcastState();
                    this.game.triggerAILogic(playerId); // もし自分の番ならAIが打つ
                }, 60000);
            } else {
                this.players.delete(playerId);
            }
            this.broadcastState();
        }
    }

    // サーバー権威: クライアントごとに隠匿情報（他家の手牌など）を伏せて送信
    broadcastState() {
        this.players.forEach((playerInfo, pId) => {
            if (!playerInfo.ws || playerInfo.ws.readyState !== 1) return;

            const state = {
                roomId: this.id,
                status: this.status,
                players: Array.from(this.players.entries()).map(([id, p]) => ({
                    id, isReady: p.isReady, isAI: p.isAI
                }))
            };

            if (this.status === 'PLAYING' && this.game) {
                state.game = this.game.getClientState(pId);
            }

            playerInfo.ws.send(JSON.stringify({ type: 'ROOM_STATE', payload: state }));
        });
    }
}
module.exports = Room;