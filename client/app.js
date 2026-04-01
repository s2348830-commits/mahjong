/**
 * 麻雀クライアントロジック (Enterprise Edition)
 */

const PHASE = {
    WAITING: 'waiting',
    LOBBY: 'lobby',
    DRAW: 'draw',
    ACTION_WAIT: 'action_wait',
    RESULT: 'result',
    FINAL_RESULT: 'final_result'
};

const state = {
    playerId: null,
    roomList: [],
    room: null,
    game: null,
    phase: PHASE.WAITING,
    
    selectedTileIndex: -1,
    dealAnimationStep: -1,
    currentWinningTiles: [],
    reachOptions: [],
    lastDiscardOrigin: { x: 0, y: 0 },
    hasDrawnThisTurn: true,
    
    cache: { hands: {}, discards: {}, melds: {} },
    resetCache: function() { this.cache = { hands: {}, discards: {}, melds: {} }; },
    effects: []
};

let prevState = null; 

function log(...args) {
    console.log('[Mahjong]', ...args);
}

function mapPhase(serverPhase) {
    switch (serverPhase) {
        case 'DRAW': return PHASE.DRAW;
        case 'ACTION_WAIT': return PHASE.ACTION_WAIT;
        case 'FINISHED': return PHASE.RESULT;
        default: return PHASE.WAITING;
    }
}

function dispatch(action) {
    try {
        switch (action.type) {
            case 'CONNECTED':
                state.playerId = action.payload.playerId;
                break;
            case 'SET_ROOM_LIST':
                state.roomList = action.payload;
                break;
            case 'UPDATE_ROOM_STATE':
                const serverState = action.payload;
                state.room = {
                    roomName: serverState.roomName,
                    hostId: serverState.hostId,
                    players: serverState.players,
                    settings: serverState.settings
                };
                
                if (serverState.status === 'LOBBY') {
                    state.phase = PHASE.LOBBY;
                    state.game = null;
                    state.dealAnimationStep = -1;
                    state.reachOptions = [];
                    state.currentWinningTiles = [];
                    state.hasDrawnThisTurn = true;
                    state.resetCache();
                    document.getElementById('final-result-overlay').style.display = 'none';
                    Renderer.stopTimer();
                } 
                else if (serverState.status === 'FINISHED_GAME') {
                    state.phase = PHASE.FINAL_RESULT;
                    state.game = serverState.game;
                    Renderer.stopTimer();
                }
                else if (serverState.status === 'PLAYING') {
                    if (state.phase === PHASE.LOBBY) {
                        state.dealAnimationStep = 4;
                        state.effects.push({ type: 'START_DEAL_ANIMATION' });
                    }
                    if (serverState.game) {
                        const newGame = Utils.deepFreeze(structuredClone(serverState.game));
                        
                        if (state.game) {
                            if (newGame.turnPlayerId !== state.game.turnPlayerId) {
                                state.hasDrawnThisTurn = false;
                            }
                            if (newGame.wallCount < state.game.wallCount) {
                                state.hasDrawnThisTurn = true;
                            }

                            if (newGame.phase === 'DRAW' || newGame.phase === 'ACTION_WAIT') {
                                newGame.players.forEach(p => {
                                    if (!state.game.riichiPlayers[p.id] && newGame.riichiPlayers[p.id]) {
                                        state.effects.push({ type: 'CUTIN', text: 'リーチ！', color: '#e74c3c' });
                                    }
                                });
                            }
                            if (newGame.phase === 'FINISHED' && state.game.phase !== 'FINISHED') {
                                if (newGame.winningType === 'RYUUKYOKU') state.effects.push({ type: 'CUTIN', text: '流局', color: '#bdc3c7' });
                                else if (newGame.winningType === 'TSUMO') state.effects.push({ type: 'CUTIN', text: 'ツモ！', color: '#f1c40f' });
                                else state.effects.push({ type: 'CUTIN', text: 'ロン！', color: '#f1c40f' });
                            }
                        }
                        
                        state.game = newGame;
                        state.phase = mapPhase(state.game.phase);
                    }
                }
                break;
            case 'SHOW_REACH_OPTIONS':
                state.reachOptions = action.payload.discards;
                break;
            case 'UPDATE_TENPAI_INFO':
                state.currentWinningTiles = action.payload.winningTiles;
                break;
            case 'SET_SELECTED_TILE':
                state.selectedTileIndex = action.payload;
                break;
            case 'SET_DEAL_ANIMATION':
                state.dealAnimationStep = action.payload;
                break;
            case 'SET_DISCARD_ORIGIN':
                state.lastDiscardOrigin = action.payload;
                break;
            case 'CLEAR_REACH_OPTIONS':
                state.reachOptions = [];
                break;
            case 'KICKED':
                state.phase = PHASE.WAITING;
                state.effects.push({ type: 'ALERT', message: 'キックされました。' });
                state.effects.push({ type: 'SEARCH_ROOMS' });
                break;
        }
        render(); 
    } catch (e) {
        log('Error in dispatch:', e);
    }
}

function render() {
    const phaseChanged = !prevState || prevState.phase !== state.phase;

    if (state.phase === PHASE.WAITING) {
        if (phaseChanged) UI.showScreen('home-screen');
        UI.renderRoomList(state.roomList);
    } 
    else if (state.phase === PHASE.LOBBY) {
        if (phaseChanged) UI.showScreen('room-screen');
        UI.renderLobby(state.room);
    } 
    else if (state.phase === PHASE.FINAL_RESULT) {
        if (phaseChanged) UI.showScreen('game-screen');
        if (state.game) {
            Renderer.renderFinalResult(state.game);
            Renderer.stopTimer();
        }
    }
    else { 
        if (phaseChanged) UI.showScreen('game-screen');
        if (state.game) {
            Renderer.renderGameInfo(state.game);
            Renderer.renderPlayers(state.game);
            Renderer.renderActionButtons(state.game);
            Renderer.renderResult(state.game);
            Renderer.updateLocalSelection();
            
            UI.renderReachModal(state.reachOptions);
            UI.renderWinningTilesDisplay(state.currentWinningTiles);

            const prevGame = prevState ? prevState.game : null;
            if (!prevGame || prevGame.turnPlayerId !== state.game.turnPlayerId || prevGame.phase !== state.game.phase || prevGame.lastDiscard?.tile !== state.game.lastDiscard?.tile) {
                if (state.game.phase === 'DRAW' || state.game.phase === 'ACTION_WAIT') {
                    Renderer.startTimer(state.room.settings.thinkTime);
                } else {
                    Renderer.stopTimer();
                }
            }
        }
    }

    processEffects();
    prevState = { ...state, game: state.game }; 
}

function processEffects() {
    while (state.effects.length > 0) {
        const effect = state.effects.shift();
        switch (effect.type) {
            case 'START_DEAL_ANIMATION':
                UI.startDealAnimation();
                break;
            case 'ALERT':
                alert(effect.message);
                break;
            case 'SEARCH_ROOMS':
                Network.sendAction('SEARCH_ROOMS');
                break;
            case 'CUTIN':
                UI.showCutin(effect.text, effect.color);
                break;
            case 'TRIGGER_DISCARD_ANIMATION':
                Renderer.triggerDiscardAnimation(effect.game);
                break;
        }
    }
}

const Utils = {
    tilesImage: new Image(),
    TILE_SPRITE_MAP: {
        '1m':[0,0], '2m':[1,0], '3m':[2,0], '4m':[3,0], '5m':[4,0], '6m':[5,0], '7m':[6,0], '8m':[7,0], '9m':[8,0], '0m':[9,0], 
        '1s':[0,1], '2s':[1,1], '3s':[2,1], '4s':[3,1], '5s':[4,1], '6s':[5,1], '7s':[6,1], '8s':[7,1], '9s':[8,1], '0s':[9,1], 
        '1p':[0,2], '2p':[1,2], '3p':[2,2], '4p':[3,2], '5p':[4,2], '6p':[5,2], '7p':[6,2], '8p':[7,2], '9p':[8,2], '0p':[9,2], 
        '1z':[0,3], '2z':[1,3], '3z':[2,3], '4z':[3,3], '5z':[4,3], '6z':[5,3], '7z':[6,3], 'back':[7,3]
    },
    X_PERCENTAGES: [1.6, 12.5, 23.2, 34.0, 44.8, 55.6, 66.4, 77.2, 88.0, 98.7],
    Y_PERCENTAGES: [4.8, 28.2, 51.7, 75.1],

    init() { this.tilesImage.src = 'tiles.png'; },

    deepFreeze(obj) {
        if (obj === null || typeof obj !== "object") return obj;
        const propNames = Object.getOwnPropertyNames(obj);
        for (const name of propNames) {
            const value = obj[name];
            if (value && typeof value === "object") {
                Utils.deepFreeze(value);
            }
        }
        return Object.freeze(obj);
    },

    generateCacheKey(arr) {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return '';
        if (typeof arr[0] === 'object') {
            return arr.map(obj => Object.values(obj).join(':')).join(',');
        }
        return arr.join(',');
    },

    getDoraTiles(indicators) {
        if (!indicators) return [];
        return indicators.map(ind => {
            const norm = ind.replace('0', '5');
            const suit = norm[1];
            const num = parseInt(norm[0]);
            if (suit === 'z') {
                if (num <= 4) return (num % 4 + 1) + 'z';
                return ((num - 5 + 1) % 3 + 5) + 'z';
            }
            return (num % 9 + 1) + suit;
        });
    },

    isDora(tileCode, doraTiles) {
        if (!tileCode || tileCode === 'back') return false;
        if (tileCode[0] === '0') return true; 
        const norm = tileCode.replace('0', '5');
        return doraTiles.includes(norm);
    },

    createTileElement(tileCode, isSmall = false, isDora = false, isForbidden = false) {
        const tileDiv = document.createElement('div');
        tileDiv.className = `tile ${isSmall ? 'small' : ''}`;
        
        if (isDora) tileDiv.classList.add('dora-glow');
        if (isForbidden) tileDiv.classList.add('forbidden-tile');

        if (tileCode) {
            tileDiv.dataset.normCode = tileCode.replace('0', '5');
            const spriteInfo = this.TILE_SPRITE_MAP[tileCode];
            if (spriteInfo) tileDiv.style.backgroundPosition = `${this.X_PERCENTAGES[spriteInfo[0]]}% ${this.Y_PERCENTAGES[spriteInfo[1]]}%`;
        }
        return tileDiv;
    },

    formatPointDisplay(yakuData) {
        if (!yakuData) return '';
        const p = yakuData.point;
        if (!p) return `<br><span style="font-size:1.5rem; color:#fff;">${yakuData.yaku.join('<br>')}</span>`;
        const detail = p.isTsumo ? (p.dealerPay === 0 ? `(ALL ${p.nonDealerPay})` : `(${p.dealerPay} / ${p.nonDealerPay})`) : '';
        if (yakuData.han === 0) return `<br><span style="font-size:1.5rem; color:#fff;">${yakuData.yaku.join('<br>')}</span>`;
        if (yakuData.han >= 13) return `<br><span style="font-size:1.5rem; color:#fff;">役満 : ${p.total}点 ${detail}<br>${yakuData.yaku.join(', ')}</span>`;
        return `<br><span style="font-size:1.5rem; color:#fff;">${yakuData.han}翻 ${yakuData.fu}符 : ${p.total}点 ${detail}<br>${yakuData.yaku.join(', ')}</span>`;
    }
};

const Network = {
    ws: null,
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}`);
        
        this.ws.onopen = () => {
            if (state.playerId) {
                this.sendAction('REJOIN', { playerId: state.playerId });
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (e) {
                log('Invalid message', e);
            }
        };
        
        this.ws.onclose = () => {
            log('Connection lost. Reconnecting in 3 seconds...');
            setTimeout(() => this.connect(), 3000);
        };
    },
    sendAction(type, payload = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, payload }));
        }
    },
    handleMessage(data) {
        switch (data.type) {
            case 'CONNECTED': dispatch({ type: 'CONNECTED', payload: data.payload }); break;
            case 'ROOM_LIST': dispatch({ type: 'SET_ROOM_LIST', payload: data.payload }); break;
            case 'ROOM_STATE': dispatch({ type: 'UPDATE_ROOM_STATE', payload: data.payload }); break;
            case 'REACH_OPTIONS': dispatch({ type: 'SHOW_REACH_OPTIONS', payload: data.payload }); break;
            case 'TENPAI_INFO': dispatch({ type: 'UPDATE_TENPAI_INFO', payload: data.payload }); break;
            case 'KICKED': dispatch({ type: 'KICKED' }); break;
        }
    }
};

const Renderer = {
    // 【修正】タイマーをオレンジ色のカウントダウンテキストに変更
    startTimer(timeStr) {
        this.stopTimer();
        const display = document.getElementById('action-timer-display');
        if (!display) return;

        let totalSeconds = 15;
        if (timeStr) {
            let parts = timeStr.split('+');
            if (parts.length === 2) totalSeconds = parseInt(parts[0]) + parseInt(parts[1]);
            else totalSeconds = parseInt(timeStr) || 15;
        }
        totalSeconds += 2; // サーバー猶予

        display.style.display = 'block';
        display.innerText = totalSeconds;
        display.style.color = '#ff9800'; // オレンジ色

        this.timerInterval = setInterval(() => {
            totalSeconds--;
            if (totalSeconds < 0) totalSeconds = 0;
            display.innerText = totalSeconds;
            
            if (totalSeconds <= 5) {
                display.style.color = '#e74c3c'; // 残りわずかで赤色に
            }
            if (totalSeconds <= 0) {
                this.stopTimer();
            }
        }, 1000);
    },

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        const display = document.getElementById('action-timer-display');
        if (display) display.style.display = 'none';
    },

    renderGameInfo(game) {
        const phaseText = game.phase === 'DRAW' ? 'ツモ・打牌' : (game.phase === 'ACTION_WAIT' ? 'アクション待機中...' : '終局');
        const gameInfoEl = document.getElementById('game-info');
        let html = `<div style="color:#f1c40f;">${game.roundInfo} | 残り山: ${game.wallCount} | 供託: ${game.kyoutaku * 1000} | ${phaseText}</div>`;
        gameInfoEl.innerHTML = html;

        const doraArea = document.getElementById('dora-area');
        const doraIndicatorsEl = document.getElementById('dora-indicators');
        if (doraArea && doraIndicatorsEl) {
            if (game.doraIndicators?.length > 0) {
                doraArea.style.display = 'flex';
                doraIndicatorsEl.innerHTML = '';
                game.doraIndicators.forEach(tile => { 
                    doraIndicatorsEl.appendChild(Utils.createTileElement(tile, true)); 
                });
            } else {
                doraArea.style.display = 'none';
            }
        }
    },

    renderActionButtons(game) {
        const actionArea = document.getElementById('action-buttons');
        if (state.phase !== PHASE.RESULT && state.phase !== PHASE.FINAL_RESULT && game.allowedActions?.length > 0 && state.dealAnimationStep === -1) {
            actionArea.style.display = 'flex';
            
            ['TSUMO', 'RON', 'PON', 'CHI', 'RIICHI', 'PASS', 'KYUUSHU', 'KITA'].forEach(action => {
                const btn = document.getElementById(`btn-${action.toLowerCase()}`);
                if (btn) btn.style.display = game.allowedActions.includes(action) ? 'block' : 'none';
            });
            
            const kanBtn = document.getElementById('btn-kan');
            if (kanBtn) {
                const canKan = game.allowedActions.includes('ANKAN') || game.allowedActions.includes('KAKAN') || game.allowedActions.includes('MINKAN');
                kanBtn.style.display = canKan ? 'block' : 'none';
            }
        } else {
            actionArea.style.display = 'none';
        }
    },

    renderResult(game) {
        const resultOverlay = document.getElementById('result-overlay');
        if (state.phase === PHASE.RESULT) {
            resultOverlay.style.display = 'flex';
            let resultHtml = "";
            if (game.winningType === 'RYUUKYOKU') {
                resultHtml = `流局<br>${Utils.formatPointDisplay(game.winningYaku?.[0])}`;
            } else if (game.winningType === 'RON_MULTI') {
                resultHtml = game.winner.map((w, i) => `<div>${w}<br>ロン！${Utils.formatPointDisplay(game.winningYaku?.[i])}</div>`).join('<hr style="border-color:#f1c40f; margin: 20px 0;">');
            } else {
                const winText = game.winningType === 'TSUMO' ? 'ツモ！' : 'ロン！';
                resultHtml = `${game.winner[0]}<br>${winText}${Utils.formatPointDisplay(game.winningYaku?.[0])}`;
            }
            document.getElementById('result-text').innerHTML = resultHtml;
        } else {
            resultOverlay.style.display = 'none';
        }
    },

    renderFinalResult(game) {
        const overlay = document.getElementById('final-result-overlay');
        if (state.phase === PHASE.FINAL_RESULT) {
            overlay.style.display = 'flex';
            document.getElementById('result-overlay').style.display = 'none'; 
            
            document.getElementById('final-result-reason').innerText = game.endReason || 'ゲーム終了';
            
            if (game.finalResults) {
                const rankHtml = game.finalResults.map(r => `
                    <div style="font-size: 1.5rem; margin: 15px 0; color: #fff; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 5px;">
                        <span style="color:#f1c40f; font-weight:bold;">${r.rank}位</span>
                        <span style="flex-grow: 1; text-align: left; margin-left: 20px;">${r.id === state.playerId ? '🏆 You' : r.id}</span>
                        <span style="text-align: right;">${r.points} 点</span>
                    </div>
                `).join('');
                document.getElementById('final-result-ranking').innerHTML = rankHtml;
            }
        } else {
            overlay.style.display = 'none';
        }
    },

    renderPlayers(game) {
        const pIds = game.players.map(p => p.id);
        const numPlayers = pIds.length;
        const myIndex = pIds.indexOf(state.playerId) >= 0 ? pIds.indexOf(state.playerId) : 0;
        const posMap = numPlayers === 3 ? ['bottom', 'right', 'left'] : ['bottom', 'right', 'top', 'left'];

        ['bottom', 'right', 'top', 'left'].forEach(pos => {
            document.getElementById(`area-${pos}`).style.display = 'none';
            document.getElementById(`discard-${pos}`).style.display = 'none';
        });

        pIds.forEach((pid, idx) => {
            let relIdx = (idx - myIndex + numPlayers) % numPlayers;
            let pos = posMap[relIdx];
            document.getElementById(`area-${pos}`).style.display = 'flex';
            document.getElementById(`discard-${pos}`).style.display = 'flex';
            
            this.renderPlayerInfo(pid, pos, game);
            this.renderHand(pid, pos, game);
            this.renderMelds(pid, pos, game);
            this.renderDiscards(pid, pos, game);
        });
    },

    renderPlayerInfo(pid, pos, game) {
        const nameEl = document.getElementById(`name-${pos}`);
        if (!nameEl) return;
        const isTurn = (game.turnPlayerId === pid && game.phase === 'DRAW');
        const isRiichi = game.riichiPlayers?.[pid];
        
        const pts = game.players?.find(p => p.id === pid)?.points || 0;
        const dispName = pid === state.playerId ? 'You' : pid;
        
        nameEl.style.display = 'block';
        nameEl.innerHTML = `${isRiichi ? '<span style="color:#e74c3c; background:#fff; padding:0 4px; border-radius:3px;">立直</span> ' : ''}${dispName} ${isTurn ? '👈' : ''}<br><span style="font-size:0.8rem; color:#bdc3c7;">${pts}点</span>`;
        nameEl.style.color = isTurn ? '#f1c40f' : '#fff';
        nameEl.style.boxShadow = isTurn ? '0 0 10px rgba(241,196,15,0.5)' : 'none';
    },

    renderHand(pid, pos, game) {
        const rawHand = game.hands?.[pid] || [];
        const isMyTurn = (game.turnPlayerId === pid && game.phase === 'DRAW');
        
        const handCacheKey = Utils.generateCacheKey(rawHand) + state.dealAnimationStep;
        if (state.cache.hands[pid] === handCacheKey && state.dealAnimationStep === -1) return;
        state.cache.hands[pid] = handCacheKey;

        const handDiv = document.getElementById(`hand-${pos}`);
        handDiv.innerHTML = '';
        let displayHand = rawHand.map((t, i) => ({ tileCode: t, originalIndex: i, isTsumo: false }));

        if (pid === state.playerId || game.phase === 'FINISHED' || game.phase === 'FINAL_RESULT' || (state.room && state.room.settings && state.room.settings.openHands)) {
            let tsumoTile = null;
            if (isMyTurn && displayHand.length % 3 === 2 && state.dealAnimationStep === -1 && state.hasDrawnThisTurn) {
                tsumoTile = displayHand.pop();
                tsumoTile.isTsumo = true;
            }
            displayHand.sort((a, b) => {
                if (a.tileCode === 'back' || b.tileCode === 'back') return 0;
                let tA = a.tileCode[0] === '0' ? '5' + a.tileCode[1] : a.tileCode;
                let tB = b.tileCode[0] === '0' ? '5' + b.tileCode[1] : b.tileCode;
                const suits = { m: 0, p: 1, s: 2, z: 3 }; 
                return (suits[tA.slice(-1)] - suits[tB.slice(-1)]) || (parseInt(tA) - parseInt(tB));
            });
            if (tsumoTile) displayHand.push(tsumoTile);
        }

        if (state.dealAnimationStep !== -1) displayHand = displayHand.slice(0, state.dealAnimationStep);

        const doraTiles = Utils.getDoraTiles(game.doraIndicators);
        const forbidden = game.forbiddenDiscards || [];

        displayHand.forEach((item) => {
            const isDora = Utils.isDora(item.tileCode, doraTiles);
            const normCode = item.tileCode !== 'back' ? item.tileCode.replace('0', '5') : '';
            const isForbidden = isMyTurn && forbidden.includes(normCode);

            const tileDiv = Utils.createTileElement(item.tileCode, pos !== 'bottom', isDora, isForbidden);
            tileDiv.dataset.pid = pid; tileDiv.dataset.index = item.originalIndex;
            if (item.isTsumo) { tileDiv.style.marginLeft = '10px'; tileDiv.style.transform = 'translateY(-8px)'; }
            handDiv.appendChild(tileDiv);
        });
    },

    // 【修正】鳴きエリア(meld)に「北抜き」の牌（4z）を配置するよう追加
    renderMelds(pid, pos, game) {
        const melds = game.melds?.[pid] || [];
        const kitaCount = game.kitaPlayers?.[pid] || 0;
        
        const meldsCacheKey = Utils.generateCacheKey(melds) + '-kita-' + kitaCount;
        if (state.cache.melds[pid] === meldsCacheKey) return;
        state.cache.melds[pid] = meldsCacheKey;

        const meldDiv = document.getElementById(`meld-${pos}`);
        meldDiv.innerHTML = '';
        const doraTiles = Utils.getDoraTiles(game.doraIndicators);

        // 北抜きの表示（左下配置に対応）
        if (kitaCount > 0) {
            for(let i = 0; i < kitaCount; i++) {
                const isDora = Utils.isDora('4z', doraTiles);
                meldDiv.appendChild(Utils.createTileElement('4z', pos !== 'bottom', isDora));
            }
            const space = document.createElement('div'); space.style.width = '5px';
            meldDiv.appendChild(space);
        }

        melds.forEach(m => {
            const count = m.type === 'kantsu' ? 4 : 3;
            for(let i=0; i<count; i++) {
                let t = m.tile;
                if (!m.isOpen && (i === 0 || i === count - 1)) t = 'back';
                if (m.type === 'shuntsu' && m.tiles) t = m.tiles[i];
                
                const isDora = Utils.isDora(t, doraTiles);
                meldDiv.appendChild(Utils.createTileElement(t, pos !== 'bottom', isDora));
            }
            const space = document.createElement('div'); space.style.width = '5px';
            meldDiv.appendChild(space);
        });
    },

    renderDiscards(pid, pos, game) {
        const discards = game.discards?.[pid] || [];
        const discardCacheKey = Utils.generateCacheKey(discards);
        if (state.cache.discards[pid] === discardCacheKey) return;
        
        const prevCount = state.cache.discards[pid] ? state.cache.discards[pid].split(',').length : 0;
        state.cache.discards[pid] = discardCacheKey;

        const discardDiv = document.getElementById(`discard-${pos}`);
        discardDiv.innerHTML = '';
        const doraTiles = Utils.getDoraTiles(game.doraIndicators);

        discards.forEach((tileCode, dIdx) => {
            const isDora = Utils.isDora(tileCode, doraTiles);
            const dTile = Utils.createTileElement(tileCode, true, isDora);
            
            if (dIdx === discards.length - 1 && discards.length > prevCount) {
                dTile.classList.add('new-discard'); dTile.dataset.pid = pid;
            }
            discardDiv.appendChild(dTile);
        });

        if (discards.length > prevCount) {
            state.effects.push({ type: 'TRIGGER_DISCARD_ANIMATION', game: game });
        }
    },

    updateLocalSelection() {
        if (!state.game) return;
        let selectedNormCode = null;
        const myHandDiv = document.getElementById(`hand-bottom`);
        if (myHandDiv) {
            Array.from(myHandDiv.children).forEach(tile => {
                if (parseInt(tile.dataset.index) === state.selectedTileIndex) {
                    tile.classList.add('selected-tile');
                    selectedNormCode = tile.dataset.normCode;
                } else tile.classList.remove('selected-tile');
            });
        }
        document.querySelectorAll('.tile').forEach(t => {
            if (t.dataset.normCode && t.dataset.normCode !== 'back' && t.dataset.normCode === selectedNormCode) {
                t.style.filter = 'brightness(1.5) drop-shadow(0 0 8px rgba(241, 196, 15, 1))';
            } else t.style.filter = '';
        });
    },

    triggerDiscardAnimation(game) {
        const newDiscards = Array.from(document.querySelectorAll('.new-discard'));
        newDiscards.forEach(el => {
            el.classList.remove('new-discard');
            
            const targetRect = el.getBoundingClientRect();
            const pid = el.dataset.pid;
            let startX = targetRect.left, startY = targetRect.top;

            if (pid === state.playerId && state.lastDiscardOrigin.x !== 0) {
                startX = state.lastDiscardOrigin.x; 
                startY = state.lastDiscardOrigin.y;
                state.lastDiscardOrigin = { x: 0, y: 0 }; 
            } else {
                const pIds = game.players.map(p => p.id);
                const relIdx = (pIds.indexOf(pid) - pIds.indexOf(state.playerId) + pIds.length) % pIds.length;
                const pos = (pIds.length === 3 ? ['bottom', 'right', 'left'] : ['bottom', 'right', 'top', 'left'])[relIdx];
                const areaEl = document.getElementById(`area-${pos}`);
                if (areaEl) {
                    const areaRect = areaEl.getBoundingClientRect();
                    startX = areaRect.left + areaRect.width / 2; 
                    startY = areaRect.top + areaRect.height / 2;
                }
            }
            
            const deltaX = startX - targetRect.left;
            const deltaY = startY - targetRect.top;
            
            el.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.5)`;
            el.style.transition = 'none';
            void el.offsetWidth; 

            requestAnimationFrame(() => {
                el.style.transform = 'translate(0, 0) scale(1)';
                el.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
            });
        });
    }
};

const UI = {
    initEvents() {
        document.getElementById('mahjong-table').addEventListener('click', (e) => {
            const tileEl = e.target.closest('.tile');
            if (tileEl) {
                if (tileEl.classList.contains('forbidden-tile')) return;

                const pid = tileEl.dataset.pid;
                const index = parseInt(tileEl.dataset.index);
                const game = state.game;
                const isMyTurnAndCanDiscard = (game?.phase === 'DRAW' && game?.turnPlayerId === state.playerId && state.dealAnimationStep === -1);
                const isRiichi = game?.riichiPlayers?.[state.playerId];
                
                if (pid === state.playerId && isMyTurnAndCanDiscard && !isRiichi) {
                    if (state.selectedTileIndex === index) {
                        const rect = tileEl.getBoundingClientRect();
                        state.lastDiscardOrigin = { x: rect.left, y: rect.top };
                        Network.sendAction('DISCARD', { tileIndex: index });
                        dispatch({ type: 'SET_SELECTED_TILE', payload: -1 });
                    } else {
                        dispatch({ type: 'SET_SELECTED_TILE', payload: index });
                    }
                }
            } else if (!e.target.closest('#action-buttons')) {
                if (state.selectedTileIndex !== -1) {
                    dispatch({ type: 'SET_SELECTED_TILE', payload: -1 });
                }
            }
        });
    },

    renderReachModal(discards) {
        const modal = document.getElementById('reach-modal');
        if (!discards || discards.length === 0) {
            modal.style.display = 'none';
            return;
        }
        
        modal.style.display = 'flex';
        const handDiv = document.getElementById('reach-hand');
        handDiv.innerHTML = '';
        
        state.game.hands[state.playerId].forEach((tileCode, idx) => {
            const tileDiv = Utils.createTileElement(tileCode);
            if (discards.find(d => d.index === idx)) {
                tileDiv.classList.add('reachable-tile');
                tileDiv.onclick = () => {
                    Network.sendAction('DO_RIICHI', { tileIndex: idx });
                    dispatch({ type: 'CLEAR_REACH_OPTIONS' });
                    dispatch({ type: 'SET_SELECTED_TILE', payload: -1 });
                };
            } else tileDiv.classList.add('disabled-tile');
            handDiv.appendChild(tileDiv);
        });
    },

    showChiModal(options) {
        const modal = document.getElementById('chi-modal');
        modal.style.display = 'flex';
        const container = document.getElementById('chi-options');
        container.innerHTML = '';
        
        const doraTiles = Utils.getDoraTiles(state.game.doraIndicators);

        options.forEach((opt, idx) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'hand reachable-tile';
            optDiv.style.padding = '10px';
            optDiv.style.background = 'rgba(0,0,0,0.4)';
            optDiv.onclick = () => {
                Network.sendAction('CHI', { tiles: opt });
                modal.style.display = 'none';
            };
            opt.forEach(tile => optDiv.appendChild(Utils.createTileElement(tile, false, Utils.isDora(tile, doraTiles))));
            container.appendChild(optDiv);
        });
    },

    showKanModal(options) {
        const modal = document.getElementById('kan-modal');
        modal.style.display = 'flex';
        const container = document.getElementById('kan-options');
        container.innerHTML = '';
        
        const doraTiles = Utils.getDoraTiles(state.game.doraIndicators);

        const createOpt = (tile, typeName) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'hand reachable-tile';
            optDiv.style.padding = '10px';
            optDiv.style.background = 'rgba(0,0,0,0.4)';
            optDiv.style.display = 'flex';
            optDiv.style.flexDirection = 'column';
            optDiv.style.alignItems = 'center';
            optDiv.onclick = () => {
                Network.sendAction(typeName, { tile: tile });
                modal.style.display = 'none';
            };
            
            const text = document.createElement('span');
            text.innerText = typeName === 'ANKAN' ? '暗槓' : '加槓';
            text.style.color = '#fff';
            text.style.marginBottom = '5px';
            optDiv.appendChild(text);

            const tilesDiv = document.createElement('div');
            tilesDiv.className = 'hand';
            for(let i=0; i<4; i++) tilesDiv.appendChild(Utils.createTileElement(tile, false, Utils.isDora(tile, doraTiles)));
            optDiv.appendChild(tilesDiv);
            
            return optDiv;
        };

        if(options.ankan) options.ankan.forEach(t => container.appendChild(createOpt(t, 'ANKAN')));
        if(options.kakan) options.kakan.forEach(t => container.appendChild(createOpt(t, 'KAKAN')));
    },

    updateWinningTilesDisplay(winningTiles) {
        const container = document.getElementById('winning-tiles-container');
        const list = document.getElementById('winning-tiles-list');
        list.innerHTML = '';
        if (winningTiles && winningTiles.length > 0) {
            container.style.display = 'block';
            const order = { 'm': 1, 'p': 2, 's': 3, 'z': 4 };
            let sorted = [...winningTiles].sort((a, b) => {
                const normA = a.replace('0', '5');
                const normB = b.replace('0', '5');
                if (order[normA[1]] !== order[normB[1]]) return order[normA[1]] - order[normB[1]];
                return parseInt(normA[0]) - parseInt(normB[0]);
            });
            sorted.forEach(tileCode => { list.appendChild(Utils.createTileElement(tileCode, true)); });
        } else container.style.display = 'none';
    },

    renderLobby(room) {
        document.getElementById('room-name-display').innerText = room.roomName;
        const isHost = room.hostId === state.playerId;
        document.getElementById('settings-fieldset').disabled = !isHost;
        document.getElementById('host-only-buttons').style.display = isHost ? 'block' : 'none';
        document.getElementById('guest-badge').style.display = isHost ? 'none' : 'inline';
        
        const settings = room.settings;
        if (settings) {
            const updateRadioUI = (name, value) => {
                const hiddenInput = document.querySelector(`input[name="${name}"]`);
                if (hiddenInput) hiddenInput.value = value;
                
                const group = hiddenInput ? hiddenInput.closest('.setting-button-group') : null;
                if (group) {
                    group.querySelectorAll('.hex-button').forEach(btn => {
                        const onclickStr = btn.getAttribute('onclick') || '';
                        let isMatch = false;
                        if (typeof value === 'string') {
                            isMatch = onclickStr.includes(`'${value}'`) || onclickStr.includes(`"${value}"`);
                        } else {
                            isMatch = onclickStr.includes(`, ${value})`) || onclickStr.includes(`,${value})`);
                        }
                        
                        if (isMatch) {
                            btn.classList.add('selected');
                        } else {
                            btn.classList.remove('selected');
                        }
                    });
                }
            };

            updateRadioUI('mode', settings.mode);
            updateRadioUI('length', settings.length);
            updateRadioUI('thinkTime', settings.thinkTime);
            updateRadioUI('advanced', settings.advanced);
            updateRadioUI('tobi', settings.tobi);
            updateRadioUI('localYaku', settings.localYaku);
            updateRadioUI('akaDora', settings.akaDora);
            updateRadioUI('kuitan', settings.kuitan);
            updateRadioUI('cpuLevel', settings.cpuLevel);
            updateRadioUI('openHands', settings.openHands);

            const startPointsInput = document.getElementById('startPoints');
            if (startPointsInput) startPointsInput.value = settings.startPoints;
            const targetPointsInput = document.getElementById('targetPoints');
            if (targetPointsInput) targetPointsInput.value = settings.targetPoints;

            document.getElementById('advanced-settings').style.display = settings.advanced ? 'block' : 'none';
        }

        document.getElementById('player-list').innerHTML = room.players.map(p => {
            const hostIcon = p.id === room.hostId ? '👑 ' : '';
            const readyText = p.isReady ? '<span style="color:#2ecc71;">(準備完了)</span>' : '(準備中)';
            const kickBtn = (isHost && p.id !== state.playerId) ? `<span class="kick-btn" onclick="kickPlayer('${p.id}')">✖</span>` : '';
            return `<li style="margin-bottom: 10px; display: flex; align-items: center;">${kickBtn}${hostIcon}Player: ${p.id} <span style="margin-left: 10px;">${readyText}</span></li>`;
        }).join('');
    },

    renderRoomList(rooms) {
        document.getElementById('room-list').innerHTML = rooms.map(r => `<li>${r.name} (${r.currentPlayers}/${r.maxPlayers}) <button onclick="joinRoom('${r.id}')">参加</button></li>`).join('');
    },

    startDealAnimation() {
        const sequence = [4, 8, 12, 14];
        let stepIndex = 0;
        const interval = setInterval(() => {
            stepIndex++;
            if (stepIndex >= sequence.length) {
                clearInterval(interval);
                dispatch({ type: 'SET_DEAL_ANIMATION', payload: -1 });
            } else {
                dispatch({ type: 'SET_DEAL_ANIMATION', payload: sequence[stepIndex] });
            }
        }, 400);
    },

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
        document.getElementById(screenId).style.display = 'block';
    },

    showCutin(text, color) {
        const cutin = document.createElement('div');
        cutin.style.position = 'fixed';
        cutin.style.top = '50%'; cutin.style.left = '50%';
        cutin.style.transform = 'translate(-50%, -50%) scale(0)';
        cutin.style.fontSize = '4rem'; cutin.style.fontWeight = 'bold';
        cutin.style.color = color;
        cutin.style.textShadow = '0 0 10px #000, 0 0 20px #000';
        cutin.style.zIndex = '9999'; cutin.style.pointerEvents = 'none';
        cutin.innerText = text;
        cutin.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-in-out';
        document.body.appendChild(cutin);

        requestAnimationFrame(() => {
            cutin.style.transform = 'translate(-50%, -50%) scale(1)';
            setTimeout(() => {
                cutin.style.transform = 'translate(-50%, -50%) scale(1.5)';
                cutin.style.opacity = '0';
                setTimeout(() => cutin.remove(), 400);
            }, 1200);
        });
    },

    createRoom() { Network.sendAction('CREATE_ROOM', { roomName: "テスト部屋", maxPlayers: 4 }); },
    searchRooms() { Network.sendAction('SEARCH_ROOMS'); },
    joinRoom(roomId) { Network.sendAction('JOIN_ROOM', { roomId }); },
    toggleReady() { Network.sendAction('TOGGLE_READY'); },
    
    sendGameAction(type) { 
        if (type === 'CANCEL_REACH') { dispatch({ type: 'CLEAR_REACH_OPTIONS' }); return; }
        
        if (type === 'CHI') {
            const opts = state.game.chiOptions;
            if (opts && opts.length === 1) {
                Network.sendAction('CHI', { tiles: opts[0] });
            } else if (opts && opts.length > 1) {
                this.showChiModal(opts);
            }
            return;
        }

        if (type === 'KAN') {
            const opts = state.game.kanOptions;
            if (state.game.phase === 'DRAW') {
                const totalOpts = (opts.ankan ? opts.ankan.length : 0) + (opts.kakan ? opts.kakan.length : 0);
                if (totalOpts === 1) {
                    if (opts.ankan && opts.ankan.length === 1) Network.sendAction('ANKAN', { tile: opts.ankan[0] });
                    else if (opts.kakan && opts.kakan.length === 1) Network.sendAction('KAKAN', { tile: opts.kakan[0] });
                } else if (totalOpts > 1) {
                    this.showKanModal(opts);
                }
            } else if (state.game.phase === 'ACTION_WAIT') {
                Network.sendAction('MINKAN');
            }
            return;
        }

        Network.sendAction(type); 
    },

    kickPlayer(targetId) { if (confirm(`キックしますか？`)) Network.sendAction('KICK_PLAYER', { targetId }); },
    addBot() { Network.sendAction('ADD_BOT'); },
    
    changeSettingRadio(name, value) {
        const el = document.querySelector(`input[name="${name}"]`);
        if (el) { 
            el.value = value; 
            this.syncSettings(); 
        }
    },
    
    syncSettings() {
        const isAdvanced = document.querySelector('input[name="advanced"]').value === 'true';
        document.getElementById('advanced-settings').style.display = isAdvanced ? 'block' : 'none';
        const newSettings = {
            mode: parseInt(document.querySelector('input[name="mode"]').value),
            length: document.querySelector('input[name="length"]').value,
            thinkTime: document.querySelector('input[name="thinkTime"]').value,
            advanced: isAdvanced,
            startPoints: parseInt(document.getElementById('startPoints').value) || 25000,
            targetPoints: parseInt(document.getElementById('targetPoints').value) || 30000,
            tobi: document.querySelector('input[name="tobi"]').value === 'true',
            localYaku: document.querySelector('input[name="localYaku"]').value === 'true',
            akaDora: parseInt(document.querySelector('input[name="akaDora"]').value),
            kuitan: document.querySelector('input[name="kuitan"]').value === 'true',
            cpuLevel: document.querySelector('input[name="cpuLevel"]').value,
            openHands: document.querySelector('input[name="openHands"]').value === 'true'
        };
        Network.sendAction('CHANGE_SETTINGS', newSettings);
    }
};

window.createRoom = () => UI.createRoom();
window.searchRooms = () => UI.searchRooms();
window.joinRoom = (id) => UI.joinRoom(id);
window.toggleReady = () => UI.toggleReady();
window.sendGameAction = (type) => UI.sendGameAction(type);
window.kickPlayer = (id) => UI.kickPlayer(id);
window.addBot = () => UI.addBot();
window.changeSettingRadio = (name, value) => UI.changeSettingRadio(name, value);
window.syncSettings = () => UI.syncSettings();

Utils.init();
UI.initEvents();
Network.connect();