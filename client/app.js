let ws;
let myPlayerId = null;

// ==========================================
// 1. 通信・初期設定
// ==========================================
function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };
}

function sendAction(type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

// ==========================================
// 2. サーバーからのメッセージ処理
// ==========================================
function handleServerMessage(data) {
    switch (data.type) {
        case 'CONNECTED':
            myPlayerId = data.payload.playerId;
            break;
        case 'ROOM_LIST':
            renderRoomList(data.payload);
            break;
        case 'ROOM_STATE':
            updateRoomState(data.payload);
            break;
        case 'KICKED':
            alert('ホストによって部屋からキックされました。');
            showScreen('home-screen');
            searchRooms();
            break;
    }
}

// ==========================================
// 3. ユーザーアクション（送信系）
// ==========================================
function createRoom() { sendAction('CREATE_ROOM', { roomName: "テスト部屋", maxPlayers: 4 }); }
function searchRooms() { sendAction('SEARCH_ROOMS'); }
function joinRoom(roomId) { sendAction('JOIN_ROOM', { roomId }); }
function toggleReady() { sendAction('TOGGLE_READY'); }
function discardTile(index) { sendAction('DISCARD', { tileIndex: index }); }

function kickPlayer(targetId) {
    if (confirm(`${targetId} をキックしますか？`)) {
        sendAction('KICK_PLAYER', { targetId });
    }
}
function addBot() { sendAction('ADD_BOT'); }

function changeSettingRadio(name, value) {
    const hiddenInput = document.querySelector(`input[name="${name}"]`);
    if (hiddenInput) {
        hiddenInput.value = value;
        syncSettings();
    }
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

// ==========================================
// 4. UI 描画系
// ==========================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
}

function renderRoomList(rooms) {
    const list = document.getElementById('room-list');
    list.innerHTML = rooms.map(r => `<li>${r.name} (${r.currentPlayers}/${r.maxPlayers}) <button onclick="joinRoom('${r.id}')">参加</button></li>`).join('');
}

const SETTING_LABELS = {
    mode: { 4: '四人麻雀', 3: '三人麻雀' },
    length: { 'one': '一局戦', 'east': '東風戦', 'south': '半荘戦', 'cpu': 'CPU戦' },
    bool: { true: '有効', false: '無効' },
    akaDora: { 0: '赤無し', 3: '赤ドラ3', 4: '赤ドラ4' },
    cpuLevel: { 'easy': '簡単', 'normal': '普通' }
};

function updateRoomState(state) {
    if (state.status === 'LOBBY') {
        showScreen('room-screen');
        document.getElementById('room-name-display').innerText = state.roomName;
        
        const isHost = state.hostId === myPlayerId;
        document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
        document.getElementById('guest-view').style.display = isHost ? 'none' : 'block';
        
        if (isHost && state.settings) {
            const s = state.settings;
            const setRadio = (name, value) => {
                const hiddenInput = document.querySelector(`input[name="${name}"]`);
                if (hiddenInput) hiddenInput.value = value;
                
                const allButtons = document.querySelectorAll(`button[onclick^="changeSettingRadio('${name}'"]`);
                allButtons.forEach(btn => {
                    btn.classList.remove('selected');
                    btn.classList.add('unselected');
                });
                
                const valStr = typeof value === 'string' ? `'${value}'` : value;
                const targetBtn = document.querySelector(`button[onclick="changeSettingRadio('${name}', ${valStr})"]`);
                if (targetBtn) {
                    targetBtn.classList.remove('unselected');
                    targetBtn.classList.add('selected');
                }
            };
            
            setRadio('mode', s.mode); setRadio('length', s.length); setRadio('thinkTime', s.thinkTime); setRadio('advanced', s.advanced);
            document.getElementById('startPoints').value = s.startPoints; document.getElementById('targetPoints').value = s.targetPoints;
            setRadio('tobi', s.tobi); setRadio('localYaku', s.localYaku); setRadio('akaDora', s.akaDora);
            setRadio('kuitan', s.kuitan); setRadio('cpuLevel', s.cpuLevel); setRadio('openHands', s.openHands);

            document.getElementById('advanced-settings').style.display = s.advanced ? 'block' : 'none';

            const button3 = document.querySelector(`button[onclick="changeSettingRadio('mode', 3)"]`);
            if (button3) {
                if (state.players.length >= 4) {
                    button3.disabled = true; button3.style.opacity = "0.5"; button3.title = "すでに4人入室しているため3麻に変更できません";
                } else {
                    button3.disabled = false; button3.style.opacity = "1"; button3.title = "";
                }
            }

            const botBtn = document.getElementById('add-bot-btn');
            if (botBtn) {
                botBtn.disabled = state.players.length >= s.mode;
                botBtn.style.opacity = botBtn.disabled ? "0.5" : "1";
            }
        } else if (!isHost && state.settings) {
            const s = state.settings;
            let html = `
                <tr><td class="label">モード</td><td class="value">${SETTING_LABELS.mode[s.mode]}</td></tr>
                <tr><td class="label">局数</td><td class="value">${SETTING_LABELS.length[s.length]}</td></tr>
                <tr><td class="label">思考時間</td><td class="value">${s.thinkTime}秒</td></tr>
            `;
            if (s.advanced) {
                html += `
                    <tr><td class="label">配給原点</td><td class="value">${s.startPoints}</td></tr>
                    <tr><td class="label">1位必要点数</td><td class="value">${s.targetPoints}</td></tr>
                    <tr><td class="label">飛び</td><td class="value">${SETTING_LABELS.bool[s.tobi]}</td></tr>
                    <tr><td class="label">ローカル役</td><td class="value">${SETTING_LABELS.bool[s.localYaku]}</td></tr>
                    <tr><td class="label">赤ドラ</td><td class="value">${SETTING_LABELS.akaDora[s.akaDora]}</td></tr>
                    <tr><td class="label">食い断</td><td class="value">${SETTING_LABELS.bool[s.kuitan]}</td></tr>
                    <tr><td class="label">CPU</td><td class="value">${SETTING_LABELS.cpuLevel[s.cpuLevel]}</td></tr>
                    <tr><td class="label">手牌表示</td><td class="value">${SETTING_LABELS.bool[s.openHands]}</td></tr>
                `;
            }
            document.getElementById('guest-settings-table').innerHTML = html;
        }

        document.getElementById('player-list').innerHTML = state.players.map(p => {
            const hostIcon = p.id === state.hostId ? '👑 ' : '';
            const isBot = p.isAI ? '<span class="bot-label">[CPU]</span> ' : '';
            const readyText = p.isReady ? '<span style="color:#2ecc71;">(準備完了)</span>' : '(準備中)';
            let kickBtn = '';
            if (isHost && p.id !== myPlayerId) {
                kickBtn = `<span class="kick-btn" title="キックする" onclick="kickPlayer('${p.id}')">✖</span>`;
            }
            return `<li style="margin-bottom: 10px; display: flex; align-items: center;">${kickBtn}${hostIcon}${isBot}Player: ${p.id} <span style="margin-left: 10px;">${readyText}</span></li>`;
        }).join('');

    } else if (state.status === 'PLAYING') {
        showScreen('game-screen');
        renderGame(state.game);
    }
}

// ==========================================
// 5. ゲーム画面描画（スプライト対応）
// ==========================================

// 画像上の位置（列、行）を定義
const TILE_SPRITE_MAP = {
    // 萬子 (1行目: Y=0)
    '1m': [0, 0], '2m': [1, 0], '3m': [2, 0], '4m': [3, 0], '5m': [4, 0],
    '6m': [5, 0], '7m': [6, 0], '8m': [7, 0], '9m': [8, 0], '0m': [9, 0], 
    // 索子 (2行目: Y=1)
    '1s': [0, 1], '2s': [1, 1], '3s': [2, 1], '4s': [3, 1], '5s': [4, 1],
    '6s': [5, 1], '7s': [6, 1], '8s': [7, 1], '9s': [8, 1], '0s': [9, 1], 
    // 筒子 (3行目: Y=2)
    '1p': [0, 2], '2p': [1, 2], '3p': [2, 2], '4p': [3, 2], '5p': [4, 2],
    '6p': [5, 2], '7p': [6, 2], '8p': [7, 2], '9p': [8, 2], '0p': [9, 2], 
    // 字牌と裏面 (4行目: Y=3)
    '1z': [0, 3], '2z': [1, 3], '3z': [2, 3], '4z': [3, 3], // 東南西北
    '5z': [4, 3], '6z': [5, 3], '7z': [6, 3],               // 白發中
    'back': [7, 3]                                          // オレンジ色の裏面
};

// ★画像の余白をカットし、牌だけを綺麗に表示するための完璧な調整値
const X_PERCENTAGES = [1.6, 12.5, 23.2, 34.0, 44.8, 55.6, 66.4, 77.2, 88.0, 98.7];
const Y_PERCENTAGES = [4.8, 28.2, 51.7, 75.1];

function renderGame(game) {
    const isMyTurn = game.turnPlayerId === myPlayerId;
    document.getElementById('game-info').innerHTML = `
        残り山牌: <span style="font-weight:bold;color:#f1c40f;">${game.wallCount}</span> <br>
        <span class="${isMyTurn ? 'turn-indicator' : ''}">
            ${isMyTurn ? '★ あなたの番です' : '相手の番です...'}
        </span>
    `;

    const handDiv = document.getElementById('my-hand');
    handDiv.innerHTML = '';
    
    // 手牌の理牌（ソート: 萬子→筒子→索子→字牌）
    const myRawHand = game.hands[myPlayerId] || [];
    const myHand = myRawHand.sort((a, b) => {
        if (a === 'back' || b === 'back') return 0;
        const suitOrder = { m: 0, p: 1, s: 2, z: 3 }; 
        const suitA = a.slice(-1); const suitB = b.slice(-1);
        const numA = parseInt(a); const numB = parseInt(b);
        if (suitOrder[suitA] !== suitOrder[suitB]) return suitOrder[suitA] - suitOrder[suitB];
        return numA - numB;
    });
    
    myHand.forEach((tileCode, index) => {
        const tileDiv = document.createElement('div');
        tileDiv.className = 'tile';
        
        // 座標マッピングから切り抜き位置を計算
        const spriteInfo = TILE_SPRITE_MAP[tileCode];
        if (spriteInfo) {
            const [col, row] = spriteInfo;
            const xPos = X_PERCENTAGES[col]; 
            const yPos = Y_PERCENTAGES[row];
            
            tileDiv.style.backgroundPosition = `${xPos}% ${yPos}%`;
        }
        
        if (isMyTurn && tileCode !== 'back') {
            tileDiv.onclick = () => {
                if (confirm(`この牌を捨てますか？`)) {
                    discardTile(index);
                }
            };
        }
        handDiv.appendChild(tileDiv);
    });
}

connect();