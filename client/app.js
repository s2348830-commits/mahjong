let ws;
let myPlayerId = null;
let currentPlayers = [];
let selectedTileIndex = -1;
let dealAnimationStep = -1;
let currentRoomStatus = 'LOBBY';
let lastGameState = null;
let previousDiscardsCount = {};
let lastDiscardOrigin = { x: 0, y: 0 };
let currentWinningTiles = []; 

const tilesImage = new Image();
tilesImage.src = 'tiles.png';

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onmessage = (event) => { handleServerMessage(JSON.parse(event.data)); };
}

function sendAction(type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type, payload })); }
}

function deselectTile(event) {
    if (event.target.classList.contains('tile') || event.target.closest('#action-buttons')) return;
    selectedTileIndex = -1;
    if (lastGameState) renderGame(lastGameState);
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'CONNECTED': myPlayerId = data.payload.playerId; break;
        case 'ROOM_LIST': renderRoomList(data.payload); break;
        case 'ROOM_STATE': updateRoomState(data.payload); break;
        case 'REACH_OPTIONS': showReachModal(data.payload.discards); break;
        case 'TENPAI_INFO': 
            currentWinningTiles = data.payload.winningTiles; 
            updateWinningTilesDisplay();
            break;
        case 'KICKED': alert('キックされました。'); showScreen('home-screen'); searchRooms(); break;
    }
}

function showReachModal(discards) {
    const modal = document.getElementById('reach-modal');
    modal.style.display = 'flex';
    const handDiv = document.getElementById('reach-hand');
    handDiv.innerHTML = '';
    
    const myHand = lastGameState.hands[myPlayerId];
    
    myHand.forEach((tileCode, idx) => {
        const tileDiv = createTileElement(tileCode);
        const reachableInfo = discards.find(d => d.index === idx);
        
        if (reachableInfo) {
            tileDiv.classList.add('reachable-tile');
            tileDiv.onclick = () => {
                sendAction('DO_RIICHI', { tileIndex: idx });
                modal.style.display = 'none';
            };
        } else {
            tileDiv.classList.add('disabled-tile');
        }
        handDiv.appendChild(tileDiv);
    });
}

function updateWinningTilesDisplay() {
    const container = document.getElementById('winning-tiles-container');
    const list = document.getElementById('winning-tiles-list');
    list.innerHTML = '';
    
    if (currentWinningTiles && currentWinningTiles.length > 0) {
        container.style.display = 'block';
        const order = { 'm': 1, 'p': 2, 's': 3, 'z': 4 };
        let sorted = [...currentWinningTiles].sort((a, b) => {
            if (order[a[1]] !== order[b[1]]) return order[a[1]] - order[b[1]];
            return parseInt(a[0]) - parseInt(b[0]);
        });
        
        sorted.forEach(tileCode => {
            list.appendChild(createTileElement(tileCode, true)); 
        });
    } else {
        container.style.display = 'none';
    }
}

function updateRoomState(state) {
    if (state.players) currentPlayers = state.players.map(p => p.id);

    if (currentRoomStatus === 'LOBBY' && state.status === 'PLAYING') {
        currentRoomStatus = 'PLAYING';
        document.getElementById('loading-screen').style.display = 'flex';
        
        if (tilesImage.complete) {
            setTimeout(startDeal, 800);
        } else {
            tilesImage.onload = startDeal;
        }
    } else if (state.status === 'LOBBY') {
        currentRoomStatus = 'LOBBY';
        dealAnimationStep = -1;
        previousDiscardsCount = {};
        lastGameState = null;
        currentWinningTiles = []; 
        updateWinningTilesDisplay();
    } else {
        currentRoomStatus = state.status;
    }

    function startDeal() {
        document.getElementById('loading-screen').style.display = 'none';
        dealAnimationStep = 4;
        animateDealing();
    }

    if (state.status === 'LOBBY') {
        showScreen('room-screen');
        document.getElementById('room-name-display').innerText = state.roomName;
        const isHost = state.hostId === myPlayerId;
        const fieldset = document.getElementById('settings-fieldset');
        fieldset.disabled = !isHost;
        document.getElementById('host-only-buttons').style.display = isHost ? 'block' : 'none';
        document.getElementById('guest-badge').style.display = isHost ? 'none' : 'inline';
        
        if (state.settings) {
            const s = state.settings;
            const setRadio = (name, value) => {
                const hiddenInput = document.querySelector(`input[name="${name}"]`);
                if (hiddenInput) hiddenInput.value = value;
                document.querySelectorAll(`button[onclick^="changeSettingRadio('${name}'"]`).forEach(btn => {
                    btn.classList.remove('selected'); btn.classList.add('unselected');
                });
                const targetBtn = document.querySelector(`button[onclick="changeSettingRadio('${name}', ${typeof value === 'string' ? `'${value}'` : value})"]`);
                if (targetBtn) targetBtn.classList.add('selected');
            };
            setRadio('mode', s.mode); setRadio('length', s.length); setRadio('thinkTime', s.thinkTime); setRadio('advanced', s.advanced);
            document.getElementById('startPoints').value = s.startPoints; document.getElementById('targetPoints').value = s.targetPoints;
            setRadio('tobi', s.tobi); setRadio('localYaku', s.localYaku); setRadio('akaDora', s.akaDora);
            setRadio('kuitan', s.kuitan); setRadio('cpuLevel', s.cpuLevel); setRadio('openHands', s.openHands);
            document.getElementById('advanced-settings').style.display = s.advanced ? 'block' : 'none';
        }

        document.getElementById('player-list').innerHTML = state.players.map(p => {
            const hostIcon = p.id === state.hostId ? '👑 ' : '';
            const readyText = p.isReady ? '<span style="color:#2ecc71;">(準備完了)</span>' : '(準備中)';
            const kickBtn = (isHost && p.id !== myPlayerId) ? `<span class="kick-btn" onclick="kickPlayer('${p.id}')">✖</span>` : '';
            return `<li style="margin-bottom: 10px; display: flex; align-items: center;">${kickBtn}${hostIcon}Player: ${p.id} <span style="margin-left: 10px;">${readyText}</span></li>`;
        }).join('');
    } else if (state.status === 'PLAYING') {
        showScreen('game-screen');
        renderGame(state.game);
    }
}

const TILE_SPRITE_MAP = {
    '1m':[0,0], '2m':[1,0], '3m':[2,0], '4m':[3,0], '5m':[4,0], '6m':[5,0], '7m':[6,0], '8m':[7,0], '9m':[8,0], '0m':[9,0], 
    '1s':[0,1], '2s':[1,1], '3s':[2,1], '4s':[3,1], '5s':[4,1], '6s':[5,1], '7s':[6,1], '8s':[7,1], '9s':[8,1], '0s':[9,1], 
    '1p':[0,2], '2p':[1,2], '3p':[2,2], '4p':[3,2], '5p':[4,2], '6p':[5,2], '7p':[6,2], '8p':[7,2], '9p':[8,2], '0p':[9,2], 
    '1z':[0,3], '2z':[1,3], '3z':[2,3], '4z':[3,3], '5z':[4,3], '6z':[5,3], '7z':[6,3], 'back':[7,3]
};
const X_PERCENTAGES = [1.6, 12.5, 23.2, 34.0, 44.8, 55.6, 66.4, 77.2, 88.0, 98.7];
const Y_PERCENTAGES = [4.8, 28.2, 51.7, 75.1];

function createTileElement(tileCode, isSmall = false) {
    const tileDiv = document.createElement('div');
    tileDiv.className = `tile ${isSmall ? 'small' : ''}`;
    const spriteInfo = TILE_SPRITE_MAP[tileCode];
    if (spriteInfo) tileDiv.style.backgroundPosition = `${X_PERCENTAGES[spriteInfo[0]]}% ${Y_PERCENTAGES[spriteInfo[1]]}%`;
    return tileDiv;
}

function renderGame(game) {
    lastGameState = game;
    let phaseText = game.phase === 'DRAW' ? 'ツモ・打牌' : (game.phase === 'ACTION_WAIT' ? 'アクション待機中...' : '終局');
    document.getElementById('game-info').innerHTML = `<div style="color:#f1c40f;">残り山: ${game.wallCount} | ${phaseText}</div>`;

    const numPlayers = currentPlayers.length;
    const myIndex = currentPlayers.indexOf(myPlayerId);
    const posMap = numPlayers === 3 ? ['bottom', 'right', 'left'] : ['bottom', 'right', 'top', 'left'];

    const actionArea = document.getElementById('action-buttons');
    const btnTsumo = document.getElementById('btn-tsumo');
    const btnRon = document.getElementById('btn-ron');
    const btnPon = document.getElementById('btn-pon'); 
    const btnKan = document.getElementById('btn-kan'); // ★追加
    const btnRiichi = document.getElementById('btn-riichi');
    const btnPass = document.getElementById('btn-pass');
    const resultOverlay = document.getElementById('result-overlay');

    if (game.phase === 'FINISHED') {
        actionArea.style.display = 'none';
        resultOverlay.style.display = 'flex';
        const winText = game.winningType === 'TSUMO' ? 'ツモ！' : 'ロン！';
        let yakuDisplay = game.winningYaku ? `<br><span style="font-size:2rem; color:#fff;">${game.winningYaku.han}翻: ${game.winningYaku.yaku.join(', ')}</span>` : '';
        document.getElementById('result-text').innerHTML = `${game.winner}<br>${winText}${yakuDisplay}`;
    } else {
        resultOverlay.style.display = 'none';
        if (game.allowedActions && game.allowedActions.length > 0 && dealAnimationStep === -1) {
            actionArea.style.display = 'flex';
            btnTsumo.style.display = game.allowedActions.includes('TSUMO') ? 'block' : 'none';
            btnRon.style.display = game.allowedActions.includes('RON') ? 'block' : 'none';
            btnPon.style.display = game.allowedActions.includes('PON') ? 'block' : 'none'; 
            btnKan.style.display = game.allowedActions.includes('KAN') ? 'block' : 'none'; // ★追加
            btnRiichi.style.display = game.allowedActions.includes('RIICHI') ? 'block' : 'none';
            btnPass.style.display = game.allowedActions.includes('PASS') ? 'block' : 'none';
        } else {
            actionArea.style.display = 'none';
        }
    }

    const isMyTurnAndCanDiscard = (game.phase === 'DRAW' && game.turnPlayerId === myPlayerId && dealAnimationStep === -1);
    if (!isMyTurnAndCanDiscard) selectedTileIndex = -1;

    ['bottom', 'right', 'top', 'left'].forEach(pos => {
        document.getElementById(`area-${pos}`).style.display = 'none';
        document.getElementById(`discard-${pos}`).style.display = 'none';
    });

    currentPlayers.forEach((pid, idx) => {
        let relIdx = (idx - myIndex + numPlayers) % numPlayers;
        let pos = posMap[relIdx];
        document.getElementById(`area-${pos}`).style.display = 'flex';
        document.getElementById(`discard-${pos}`).style.display = 'flex';
        const isTurn = (game.turnPlayerId === pid && game.phase === 'DRAW');
        const isRiichi = game.riichiPlayers && game.riichiPlayers[pid]; 

        const nameEl = document.getElementById(`name-${pos}`);
        if (nameEl) {
            nameEl.style.display = 'block';
            let riichiLabel = isRiichi ? '<span style="color:#e74c3c; background:#fff; padding:0 4px; border-radius:3px;">立直</span> ' : '';
            if (pid === myPlayerId) {
                nameEl.innerHTML = `${riichiLabel}You ${isTurn ? '👈' : ''}`;
            } else {
                nameEl.innerHTML = `${riichiLabel}${pid} ${isTurn ? '👈' : ''}`;
            }
            nameEl.style.color = isTurn ? '#f1c40f' : '#fff';
        }

        const handDiv = document.getElementById(`hand-${pos}`);
        handDiv.innerHTML = '';
        const rawHand = game.hands[pid] || [];
        let displayRawHand = (dealAnimationStep !== -1) ? rawHand.slice(0, dealAnimationStep) : rawHand;
        
        let displayHand = [];
        if (pid === myPlayerId || game.phase === 'FINISHED') {
            displayHand = displayRawHand.map((t, i) => ({ tileCode: t, originalIndex: i })).sort((a, b) => {
                if (a.tileCode === 'back' || b.tileCode === 'back') return 0;
                const suits = { m: 0, p: 1, s: 2, z: 3 }; 
                const sA = a.tileCode.slice(-1); const sB = b.tileCode.slice(-1);
                return (suits[sA] - suits[sB]) || (parseInt(a.tileCode) - parseInt(b.tileCode));
            });
        } else {
            displayHand = displayRawHand.map(t => ({ tileCode: t, originalIndex: -1 }));
        }

        displayHand.forEach((item) => {
            const tileDiv = createTileElement(item.tileCode, pos !== 'bottom');
            if (pid === myPlayerId && selectedTileIndex === item.originalIndex) {
                tileDiv.classList.add('selected-tile');
            }
            if (pid === myPlayerId && isMyTurnAndCanDiscard && !isRiichi) {
                tileDiv.onclick = (e) => {
                    e.stopPropagation();
                    if (selectedTileIndex === item.originalIndex) {
                        const rect = tileDiv.getBoundingClientRect();
                        lastDiscardOrigin = { x: rect.left, y: rect.top };
                        discardTile(item.originalIndex);
                        selectedTileIndex = -1;
                    } else {
                        selectedTileIndex = item.originalIndex;
                        renderGame(game);
                    }
                };
            }
            handDiv.appendChild(tileDiv);
        });

        const meldDiv = document.getElementById(`meld-${pos}`);
        meldDiv.innerHTML = '';
        if (game.melds && game.melds[pid]) {
            game.melds[pid].forEach(m => {
                // ★変更: カンの描画処理 (4枚)
                if (m.type === 'koutsu') {
                    for(let i=0; i<3; i++) meldDiv.appendChild(createTileElement(m.tile, pos !== 'bottom'));
                } else if (m.type === 'kantsu') {
                    for(let i=0; i<4; i++) {
                        let t = m.tile;
                        if (!m.isOpen && (i === 0 || i === 3)) t = 'back'; // 暗槓は両端を裏にする
                        meldDiv.appendChild(createTileElement(t, pos !== 'bottom'));
                    }
                }
                const space = document.createElement('div');
                space.style.width = '5px';
                meldDiv.appendChild(space);
            });
        }

        const discardDiv = document.getElementById(`discard-${pos}`);
        discardDiv.innerHTML = '';
        const currentDiscards = game.discards[pid] || [];
        currentDiscards.forEach((tileCode, dIdx) => {
            const dTile = createTileElement(tileCode, true);
            if (dIdx === currentDiscards.length - 1 && currentDiscards.length > (previousDiscardsCount[pid] || 0)) {
                dTile.classList.add('new-discard');
                dTile.dataset.pid = pid;
            }
            discardDiv.appendChild(dTile);
        });
        previousDiscardsCount[pid] = currentDiscards.length;
    });

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.querySelectorAll('.new-discard').forEach(el => {
                el.classList.remove('new-discard');
                const targetRect = el.getBoundingClientRect();
                const pid = el.dataset.pid;
                let startX = targetRect.left, startY = targetRect.top;

                if (pid === myPlayerId && lastDiscardOrigin.x !== 0) {
                    startX = lastDiscardOrigin.x; startY = lastDiscardOrigin.y;
                    lastDiscardOrigin = { x: 0, y: 0 };
                } else {
                    const relIdx = (currentPlayers.indexOf(pid) - currentPlayers.indexOf(myPlayerId) + currentPlayers.length) % currentPlayers.length;
                    const pos = (numPlayers === 3 ? ['bottom', 'right', 'left'] : ['bottom', 'right', 'top', 'left'])[relIdx];
                    const areaEl = document.getElementById(`area-${pos}`);
                    if (areaEl) {
                        const areaRect = areaEl.getBoundingClientRect();
                        startX = areaRect.left + areaRect.width / 2;
                        startY = areaRect.top + areaRect.height / 2;
                    }
                }
                const deltaX = startX - targetRect.left, deltaY = startY - targetRect.top;
                el.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.5)`;
                el.style.transition = 'none';
                requestAnimationFrame(() => {
                    el.style.transform = 'translate(0, 0) scale(1)';
                    el.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
                });
            });
        });
    });
}

function animateDealing() {
    const sequence = [4, 8, 12, 14];
    let stepIndex = 0;
    const interval = setInterval(() => {
        stepIndex++;
        if (stepIndex >= sequence.length) {
            clearInterval(interval);
            dealAnimationStep = -1;
        } else {
            dealAnimationStep = sequence[stepIndex];
        }
        if (lastGameState) renderGame(lastGameState);
    }, 400);
}

function createRoom() { sendAction('CREATE_ROOM', { roomName: "テスト部屋", maxPlayers: 4 }); }
function searchRooms() { sendAction('SEARCH_ROOMS'); }
function joinRoom(roomId) { sendAction('JOIN_ROOM', { roomId }); }
function toggleReady() { sendAction('TOGGLE_READY'); }
function discardTile(index) { sendAction('DISCARD', { tileIndex: index }); }
function sendGameAction(actionType) { sendAction(actionType); }
function kickPlayer(targetId) { if (confirm(`キックしますか？`)) sendAction('KICK_PLAYER', { targetId }); }
function addBot() { sendAction('ADD_BOT'); }
function changeSettingRadio(name, value) {
    const el = document.querySelector(`input[name="${name}"]`);
    if (el) { el.value = value; syncSettings(); }
}
function syncSettings() {
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
    sendAction('CHANGE_SETTINGS', newSettings);
}
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
}
function renderRoomList(rooms) {
    document.getElementById('room-list').innerHTML = rooms.map(r => `<li>${r.name} (${r.currentPlayers}/${r.maxPlayers}) <button onclick="joinRoom('${r.id}')">参加</button></li>`).join('');
}

connect();