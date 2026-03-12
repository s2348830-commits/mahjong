let ws;
let myPlayerId = null;
let currentPlayers = [];

// ★アニメーション・状態管理用の変数
let lastDiscardOrigin = { x: 0, y: 0 };
let previousDiscardsCount = {};
let currentRoomStatus = 'LOBBY';
let dealAnimationStep = -1; // -1はアニメーション無し（全表示）
let lastGameState = null;

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onmessage = (event) => { handleServerMessage(JSON.parse(event.data)); };
}

function sendAction(type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type, payload })); }
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'CONNECTED': myPlayerId = data.payload.playerId; break;
        case 'ROOM_LIST': renderRoomList(data.payload); break;
        case 'ROOM_STATE': updateRoomState(data.payload); break;
        case 'KICKED': alert('キックされました。'); showScreen('home-screen'); searchRooms(); break;
    }
}

// アクション系
function createRoom() { sendAction('CREATE_ROOM', { roomName: "テスト部屋", maxPlayers: 4 }); }
function searchRooms() { sendAction('SEARCH_ROOMS'); }
function joinRoom(roomId) { sendAction('JOIN_ROOM', { roomId }); }
function toggleReady() { sendAction('TOGGLE_READY'); }
function discardTile(index) { sendAction('DISCARD', { tileIndex: index }); }
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

// ★追加: 4枚ずつ配牌するアニメーション
function animateDealing() {
    const sequence = [4, 8, 12, 14]; // 配牌の枚数推移
    let stepIndex = 0;
    
    const interval = setInterval(() => {
        stepIndex++;
        if (stepIndex >= sequence.length) {
            clearInterval(interval);
            dealAnimationStep = -1; // アニメーション終了（全表示）
        } else {
            dealAnimationStep = sequence[stepIndex];
        }
        if (lastGameState) renderGame(lastGameState);
    }, 400); // 0.4秒ごとに4枚ずつドサッ！と増える
}

function updateRoomState(state) {
    if (state.players) currentPlayers = state.players.map(p => p.id);

    // ★追加: ロビーからPLAYINGに切り替わった瞬間を検知して配牌アニメ開始
    if (currentRoomStatus === 'LOBBY' && state.status === 'PLAYING') {
        currentRoomStatus = 'PLAYING';
        dealAnimationStep = 4; // 最初は4枚から
        animateDealing();
    } else {
        currentRoomStatus = state.status;
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
                if (targetBtn) { targetBtn.classList.remove('unselected'); targetBtn.classList.add('selected'); }
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
    lastGameState = game; // アニメーション用に記憶
    document.getElementById('game-info').innerHTML = `
        <div style="color:#f1c40f;">残り山: ${game.wallCount}</div>
        <div style="font-size:0.8rem; margin-top:5px;">現在: Player ${game.turnPlayerId}</div>
    `;

    const numPlayers = currentPlayers.length;
    const myIndex = currentPlayers.indexOf(myPlayerId);
    const posMap = numPlayers === 3 ? ['bottom', 'right', 'left'] : ['bottom', 'right', 'top', 'left'];

    ['bottom', 'right', 'top', 'left'].forEach(pos => {
        document.getElementById(`area-${pos}`).style.display = 'none';
        document.getElementById(`discard-${pos}`).style.display = 'none';
    });

    currentPlayers.forEach((pid, idx) => {
        let relIdx = (idx - myIndex + numPlayers) % numPlayers;
        let pos = posMap[relIdx];

        document.getElementById(`area-${pos}`).style.display = 'flex';
        document.getElementById(`discard-${pos}`).style.display = 'flex';
        const isTurn = (game.turnPlayerId === pid);

        const nameEl = document.getElementById(`name-${pos}`);
        nameEl.innerHTML = `${pid} ${isTurn ? '<span style="color:#f1c40f;">👈</span>' : ''}`;
        nameEl.style.color = isTurn ? '#f1c40f' : '#fff';

        const handDiv = document.getElementById(`hand-${pos}`);
        handDiv.innerHTML = '';
        
        // ★修正: 配牌アニメーション中は枚数を制限する
        const rawHand = game.hands[pid] || [];
        let displayRawHand = rawHand;
        if (dealAnimationStep !== -1) {
            displayRawHand = rawHand.slice(0, dealAnimationStep);
        }
        
        let displayHand = [];
        if (pid === myPlayerId) {
            displayHand = displayRawHand.map((t, i) => ({ tileCode: t, originalIndex: i })).sort((a, b) => {
                if (a.tileCode === 'back' || b.tileCode === 'back') return 0;
                const suits = { m: 0, p: 1, s: 2, z: 3 }; 
                const sA = a.tileCode.slice(-1); const sB = b.tileCode.slice(-1);
                if (suits[sA] !== suits[sB]) return suits[sA] - suits[sB];
                return parseInt(a.tileCode) - parseInt(b.tileCode);
            });
        } else {
            displayHand = displayRawHand.map(t => ({ tileCode: t, originalIndex: -1 }));
        }

        displayHand.forEach((item) => {
            const tileDiv = createTileElement(item.tileCode, pos !== 'bottom');
            
            // アニメーション中でなく、自分の番なら打牌可能
            if (pid === myPlayerId && isTurn && item.tileCode !== 'back' && dealAnimationStep === -1) {
                tileDiv.onclick = () => {
                    if (confirm(`この牌を捨てますか？`)) {
                        const rect = tileDiv.getBoundingClientRect();
                        lastDiscardOrigin = { x: rect.left, y: rect.top };
                        discardTile(item.originalIndex);
                    }
                };
            }
            handDiv.appendChild(tileDiv);
        });

        const discardDiv = document.getElementById(`discard-${pos}`);
        discardDiv.innerHTML = '';
        const discards = game.discards[pid] || [];
        const prevCount = previousDiscardsCount[pid] || 0;
        
        discards.forEach((tileCode, dIdx) => {
            const isNew = (dIdx === discards.length - 1 && discards.length > prevCount);
            const dTile = createTileElement(tileCode, true);
            
            if (isNew) {
                dTile.classList.add('new-discard');
                dTile.dataset.pid = pid;
            }
            discardDiv.appendChild(dTile);
        });
        previousDiscardsCount[pid] = discards.length;
    });

    // ★修正: アニメーションの描画タイミングをずらし、確実に「相手のエリア」から飛ばす
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.querySelectorAll('.new-discard').forEach(el => {
                el.classList.remove('new-discard');
                const targetRect = el.getBoundingClientRect();
                const pid = el.dataset.pid;
                
                let startX = targetRect.left;
                let startY = targetRect.top;

                // 自分の打牌ならクリックした手牌の位置から
                if (pid === myPlayerId && lastDiscardOrigin.x !== 0) {
                    startX = lastDiscardOrigin.x;
                    startY = lastDiscardOrigin.y;
                    lastDiscardOrigin = { x: 0, y: 0 };
                } 
                // 相手の打牌なら、その人の「プレイヤーエリア」の中央から
                else {
                    const relIdx = (currentPlayers.indexOf(pid) - currentPlayers.indexOf(myPlayerId) + currentPlayers.length) % currentPlayers.length;
                    const posMap = currentPlayers.length === 3 ? ['bottom', 'right', 'left'] : ['bottom', 'right', 'top', 'left'];
                    const pos = posMap[relIdx];
                    
                    const areaEl = document.getElementById(`area-${pos}`);
                    if (areaEl) {
                        const areaRect = areaEl.getBoundingClientRect();
                        startX = areaRect.left + areaRect.width / 2 - targetRect.width / 2;
                        startY = areaRect.top + areaRect.height / 2 - targetRect.height / 2;
                    }
                }

                const deltaX = startX - targetRect.left;
                const deltaY = startY - targetRect.top;
                
                // 元の位置にワープ
                el.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.5)`;
                el.style.transition = 'none';

                // 次のフレームで河へ移動アニメーション
                requestAnimationFrame(() => {
                    el.style.transform = 'translate(0, 0) scale(1)';
                    el.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
                });
            });
        });
    });
}

connect();