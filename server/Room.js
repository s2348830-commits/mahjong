const MahjongGame = require('./MahjongGame');

class Room {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.hostId = null;
        this.players = new Map();
        this.status = 'LOBBY';
        this.game = null;

        // ★追加: ルームの全設定を管理するオブジェクト
        this.settings = {
            mode: 4,              // 4: 4人麻雀, 3: 3人麻雀
            length: 'east',       // 'one':一局, 'east':東風, 'south':半荘, 'cpu':CPU
            thinkTime: '5+10',    // '3+5', '5+10', '5+20', '60+0', '300+0'
            advanced: false,      // 詳細設定の有効/無効
            startPoints: 25000,
            targetPoints: 30000,
            tobi: true,           // 飛び
            localYaku: false,     // ローカル役
            akaDora: 3,           // 0, 3, 4
            kuitan: true,         // 食い断
            cpuLevel: 'normal',   // 'easy', 'normal'
            openHands: false      // 手牌表示
        };
        this.maxPlayers = this.settings.mode; // 互換性のため保持
    }

    join(playerId, ws) {
        if (this.players.size >= this.maxPlayers && !this.players.has(playerId)) return;
        if (this.players.size === 0) this.hostId = playerId;

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
            // ★変更: 新しい設定変更処理
            else if (action.type === 'CHANGE_SETTINGS' && playerId === this.hostId) {
                const newSettings = action.payload;
                
                // 4人いるのに3麻に変更しようとした場合はブロック
                if (newSettings.mode < this.players.size) return;

                // 設定を上書き
                this.settings = { ...this.settings, ...newSettings };
                this.maxPlayers = this.settings.mode; // 内部の最大人数も更新
                
                // 設定が変わったら全員の準備を解除
                //this.players.forEach(p => p.isReady = false);
                this.broadcastState();
            }
            else if (action.type === 'KICK_PLAYER' && playerId === this.hostId) {
                const targetId = action.payload.targetId;
                if (targetId !== this.hostId && this.players.has(targetId)) {
                    const targetPlayer = this.players.get(targetId);
                    if (!targetPlayer.isAI && targetPlayer.ws) {
                        targetPlayer.ws.send(JSON.stringify({ type: 'KICKED' }));
                    }
                    this.players.delete(targetId);
                    this.broadcastState();
                }
            }
            else if (action.type === 'ADD_BOT' && playerId === this.hostId) {
                if (this.players.size < this.maxPlayers) {
                    const botId = 'Bot_' + Math.floor(Math.random() * 10000);
                    this.players.set(botId, { ws: null, isReady: true, isAI: true, disconnectTimeout: null });
                    this.broadcastState();
                    this.checkStartGame();
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
        const player = this.players.get(playerId);
        if (player) {
            if (this.status === 'PLAYING') {
                // 対局中の切断：60秒後にAIへ交代
                player.disconnectTimeout = setTimeout(() => {
                    player.isAI = true;
                    this.broadcastState();
                    if (this.game && this.game.triggerAILogic) {
                        this.game.triggerAILogic(playerId);
                    }
                }, 60000);
            } else {
                // ロビーでの切断：部屋から完全に削除
                this.players.delete(playerId);
                
                // もし抜けたのがホストだった場合、残っている誰かにホスト権限を移譲する
                if (playerId === this.hostId && this.players.size > 0) {
                    this.hostId = Array.from(this.players.keys())[0];
                }
            }
            this.broadcastState();
        }
    }

    broadcastState() {
        this.players.forEach((playerInfo, pId) => {
            if (!playerInfo.ws || playerInfo.ws.readyState !== 1) return;

            const state = {
                roomId: this.id,
                roomName: this.name,
                hostId: this.hostId,
                settings: this.settings, // ★全設定を送信
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