const MahjongGame = require('./MahjongGame');

class Room {
    constructor(id, name, maxPlayers = 4) {
        this.id = id;
        this.name = name;
        this.hostId = null;
        this.players = new Map();
        this.status = 'LOBBY';
        this.game = null;

        this.settings = {
            mode: maxPlayers,              
            length: 'east',       
            thinkTime: '5+10',    
            advanced: false,      
            startPoints: 25000,
            targetPoints: 30000,
            tobi: true,           
            localYaku: false,     
            akaDora: 3,           
            kuitan: true,         
            cpuLevel: 'normal',   
            openHands: false      
        };
        this.maxPlayers = this.settings.mode; 
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
            else if (action.type === 'CHANGE_SETTINGS' && playerId === this.hostId) {
                const newSettings = action.payload;
                
                // 【修正】現在部屋にいる人数よりも少ないモード（4人いるのに3人麻雀など）への変更はブロックする
                if (newSettings.mode < this.players.size) return;

                this.settings = { ...this.settings, ...newSettings };
                this.maxPlayers = this.settings.mode; 
                
                // 人数が減った場合、すでに全員の準備が完了していればゲームを開始する
                this.checkStartGame();
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
            }
        }
    }

    handleGameEnd(results, reason) {
        this.status = 'FINISHED_GAME';
        if (this.game) {
            this.game.finalResults = results;
            this.game.endReason = reason;
        }
        this.broadcastState();
        
        setTimeout(() => {
            this.endGame();
        }, 15000);
    }

    endGame() {
        this.status = 'LOBBY';
        this.game = null;
        this.players.forEach(p => p.isReady = false); 
        this.broadcastState();
    }

    handleDisconnect(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            if (this.status === 'PLAYING' || this.status === 'FINISHED_GAME') {
                player.disconnectTimeout = setTimeout(() => {
                    player.isAI = true;
                    this.broadcastState();
                    if (this.game && this.game.triggerAILogic) {
                        this.game.triggerAILogic(playerId);
                    }
                }, 60000);
            } else {
                this.players.delete(playerId);
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
                settings: this.settings, 
                status: this.status,
                players: Array.from(this.players.entries()).map(([id, p]) => ({
                    id, isReady: p.isReady, isAI: p.isAI
                }))
            };

            if ((this.status === 'PLAYING' || this.status === 'FINISHED_GAME') && this.game) {
                state.game = this.game.getClientState(pId);
            }
            playerInfo.ws.send(JSON.stringify({ type: 'ROOM_STATE', payload: state }));
        });
    }
}

module.exports = Room;