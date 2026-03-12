const MahjongGame = require('./MahjongGame');

class Room {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.maxPlayers = 4; // デフォルトは4麻
        this.hostId = null;  // ホストのプレイヤーID
        this.players = new Map();
        this.status = 'LOBBY';
        this.game = null;
    }

    join(playerId, ws) {
        // 部屋が満員の場合は参加させない
        if (this.players.size >= this.maxPlayers && !this.players.has(playerId)) return;

        // 最初の参加者をホストに設定
        if (this.players.size === 0) {
            this.hostId = playerId;
        }

        if (this.players.has(playerId)) {
            const player = this.players.get(playerId);
            clearTimeout(player.disconnectTimeout);
            player.ws = ws;
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
            // ホストのみルール変更可能
            else if (action.type === 'CHANGE_RULE' && playerId === this.hostId) {
                // 3麻か4麻かを設定（すでに入室している人数より少なくはできないよう制限）
                const newMax = action.payload.maxPlayers;
                if (newMax >= this.players.size && (newMax === 3 || newMax === 4)) {
                    this.maxPlayers = newMax;
                    // ルールが変わったら全員の準備状態をリセットする
                    this.players.forEach(p => p.isReady = false);
                    this.broadcastState();
                }
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
        // (省略: 前回のコードと同じ)
        // ※もしホストが切断した場合は、他のプレイヤーにホスト権限を移譲する処理を追加するとより実用的です。
    }

    broadcastState() {
        this.players.forEach((playerInfo, pId) => {
            if (!playerInfo.ws || playerInfo.ws.readyState !== 1) return;

            const state = {
                roomId: this.id,
                roomName: this.name,
                hostId: this.hostId,      // ホスト情報をクライアントに送る
                maxPlayers: this.maxPlayers, // 現在のルール(3 or 4)
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