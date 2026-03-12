let ws;
let myPlayerId = null;
let currentPlayers = []; // ★部屋にいる全プレイヤーのIDリスト（席順計算用）

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
        case 'KICKED':
            alert('ホストによってキックされました。'); showScreen('home-screen'); searchRooms(); break;
    }
}

// UIアクション系
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

// 辞書
const SETTING_LABELS = { mode: {4:'四人麻雀', 3:'三人麻雀'}, length: {'one':'一局戦', 'east':'東風戦', 'south':'半荘戦', 'cpu':'CPU戦'}, bool: {true:'有効', false:'無効'}, akaDora: {0:'赤無し', 3:'赤ドラ3', 4:'赤ドラ4'}, cpuLevel: {'easy':'簡単', 'normal':'普通'} };

function updateRoomState(state) {
    // 常に最新のプレイヤーリストを保存（席順の基準）
    if (state.players) {
        currentPlayers = state.players.map(p => p.id);
    }

    if (state.status === 'LOBBY') {
        showScreen('room-screen');
        document.getElementById('room-name-display').innerText = state.roomName;
        const isHost = state.hostId === myPlayerId;
        document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
        document.getElementById('guest-view').style.display = isHost ? 'none' : 'block';
        
        // (ロビーの設定同期処理・プレイヤーリスト描画処理は省略せず維持)
        if (isHost && state.settings) {
            const s = state.settings;
            const setRadio = (name, value) => {
                const hiddenInput = document.querySelector(`input[name="${name}"]`);
                if (hiddenInput) hiddenInput.value = value;
                document.querySelectorAll(`button[onclick^="changeSettingRadio('${name}'"]`).forEach(btn => {
                    btn.classList.remove('selected'); btn.classList.add('unselected');
                });
                const valStr = typeof value === 'string' ? `'${value}'` : value;
                const targetBtn = document.querySelector(`button[onclick="changeSettingRadio('${name}', ${valStr})"]`);
                if (targetBtn) { targetBtn.classList.remove('unselected'); targetBtn.classList.add('selected'); }
            };
            setRadio('mode', s.mode); setRadio('length', s.length); setRadio('thinkTime', s.thinkTime); setRadio('advanced', s.advanced);
            document.getElementById('startPoints').value = s.startPoints; document.getElementById('targetPoints').value = s.targetPoints;
            setRadio('tobi', s.tobi); setRadio('localYaku', s.localYaku); setRadio('akaDora', s.akaDora);
            setRadio('kuitan', s.kuitan); setRadio('cpuLevel', s.cpuLevel); setRadio('openHands', s.openHands);

            document.getElementById('advanced-settings').style.display = s.advanced ? 'block' : 'none';
            const button3 = document.querySelector(`button[onclick="changeSettingRadio('mode', 3)"]`);
            if (button3) {
                if (state.players.length >= 4) { button3.disabled = true; button3.style.opacity = "0.5"; } 
                else { button3.disabled = false; button3.style.opacity = "1"; }
            }
            const botBtn = document.getElementById('add-bot-btn');
            if (botBtn) { botBtn.disabled = state.players.length >= s.mode; botBtn.style.opacity = botBtn.disabled ? "0.5" : "1"; }
        } else if (!isHost && state.settings) {
            // ... ゲスト用テーブル ...
        }

        document.getElementById('player-list').innerHTML = state.players.map(p => {
            const hostIcon = p.id === state.hostId ? '👑 ' : '';
            const isBot = p.isAI ? '<span class="bot-label">[CPU]</span> ' : '';
            const readyText = p.isReady ? '<span style="color:#2ecc71;">(準備完了)</span>' : '(準備中)';
            const kickBtn = (isHost && p.id !== myPlayerId) ? `<span class="kick-btn" onclick="kickPlayer('${p.id}')">✖</span>` : '';
            return `<li style="margin-bottom: 10px; display: flex; align-items: center;">${kickBtn}${hostIcon}${isBot}Player: ${p.id} <span style="margin-left: 10px;">${readyText}</span></li>`;
        }).join('');

    } else if (state.status === 'PLAYING') {
        showScreen('game-screen');
        renderGame(state.game);
    }
}

// ==========================================
// ★ 卓の描画（相対位置計算、河の描画対応）
// ==========================================
const TILE_SPRITE_MAP = {
    '1m':[0,0], '2m':[1,0], '3m':[2,0], '4m':[3,0], '5m':[4,0], '6m':[5,0], '7m':[6,0], '8m':[7,0], '9m':[8,0], '0m':[9,0], 
    '1s':[0,1], '2s':[1,1], '3s':[2,1], '4s':[3,1], '5s':[4,1], '6s':[5,1], '7s':[6,1], '8s':[7,1], '9s':[8,1], '0s':[9,1], 
    '1p':[0,2], '2p':[1,2], '3p':[2,2], '4p':[3,2], '5p':[4,2], '6p':[5,2], '7p':[6,2], '8p':[7,2], '9p':[8,2], '0p':[9,2], 
    '1z':[0,3], '2z':[1,3], '3z':[2,3], '4z':[3,3], '5z':[4,3], '6z':[5,3], '7z':[6,3], 'back':[7,3]
};
const X_PERCENTAGES = [1.6, 12.5, 23.2, 34.0, 44.8, 55.6, 66.4, 77.2, 88.0, 98.7];
const Y_PERCENTAGES = [4.8, 28.2, 51.7, 75.1];

// 牌のエレメントを生成する共通関数
function createTileElement(tileCode, isSmall = false, isJustDropped = false) {
    const tileDiv = document.createElement('div');
    tileDiv.className = `tile ${isSmall ? 'small' : ''}`;
    if (isJustDropped) tileDiv.classList.add('dropped'); // アニメーション付与

    const spriteInfo = TILE_SPRITE_MAP[tileCode];
    if (spriteInfo) {
        tileDiv.style.backgroundPosition = `${X_PERCENTAGES[spriteInfo[0]]}% ${Y_PERCENTAGES[spriteInfo[1]]}%`;
    }
    return tileDiv;
}

function renderGame(game) {
    // 画面左上の情報
    document.getElementById('game-info').innerHTML = `
        <div style="color:#f1c40f;">残り山: ${game.wallCount}</div>
        <div style="font-size:0.8rem; margin-top:5px;">現在: Player ${game.turnPlayerId}</div>
    `;

    // 相対的な位置の計算（自分が常にbottomになるようにする）
    const numPlayers = currentPlayers.length;
    const myIndex = currentPlayers.indexOf(myPlayerId);
    // 3麻なら上家（top）を詰める
    const posMap = numPlayers === 3 ? ['bottom', 'right', 'left'] : ['bottom', 'right', 'top', 'left'];

    // 一旦すべて非表示にリセット
    ['bottom', 'right', 'top', 'left'].forEach(pos => {
        document.getElementById(`area-${pos}`).style.display = 'none';
        document.getElementById(`discard-${pos}`).style.display = 'none';
    });

    // 各プレイヤーごとに手牌と河を描画
    currentPlayers.forEach((pid, idx) => {
        // 自分を基準にした位置（0=bottom, 1=right...）
        let relIdx = (idx - myIndex + numPlayers) % numPlayers;
        let pos = posMap[relIdx];

        // エリアを表示
        document.getElementById(`area-${pos}`).style.display = 'flex';
        document.getElementById(`discard-${pos}`).style.display = 'flex';

        const isTurn = (game.turnPlayerId === pid);

        // --- 名前の表示 ---
        const nameEl = document.getElementById(`name-${pos}`);
        nameEl.innerHTML = `${pid} ${isTurn ? '<span style="color:#f1c40f;">👈</span>' : ''}`;
        nameEl.style.color = isTurn ? '#f1c40f' : '#fff';

        // --- 手牌の描画 ---
        const handDiv = document.getElementById(`hand-${pos}`);
        handDiv.innerHTML = '';
        const rawHand = game.hands[pid] || [];
        
        let displayHand = [];
        if (pid === myPlayerId) {
            // 自分：ソートしてもサーバー側のindexが狂わないように記憶させる
            displayHand = rawHand.map((t, i) => ({ tileCode: t, originalIndex: i })).sort((a, b) => {
                if (a.tileCode === 'back' || b.tileCode === 'back') return 0;
                const suits = { m: 0, p: 1, s: 2, z: 3 }; 
                const sA = a.tileCode.slice(-1); const sB = b.tileCode.slice(-1);
                if (suits[sA] !== suits[sB]) return suits[sA] - suits[sB];
                return parseInt(a.tileCode) - parseInt(b.tileCode);
            });
        } else {
            // 相手：サーバーから伏せられて('back')送られてくるものをそのまま表示
            displayHand = rawHand.map(t => ({ tileCode: t, originalIndex: -1 }));
        }

        displayHand.forEach((item) => {
            const isSmall = (pos !== 'bottom'); // 相手の手牌は少し小さく表示
            const tileDiv = createTileElement(item.tileCode, isSmall);
            
            // 自分の番の時だけクリックして打牌可能
            if (pid === myPlayerId && isTurn && item.tileCode !== 'back') {
                tileDiv.onclick = () => {
                    // 打牌
                    discardTile(item.originalIndex);
                };
            }
            handDiv.appendChild(tileDiv);
        });

        // --- 河（捨て牌）の描画 ---
        const discardDiv = document.getElementById(`discard-${pos}`);
        discardDiv.innerHTML = '';
        const discards = game.discards[pid] || [];
        
        discards.forEach((tileCode, dIdx) => {
            // 捨てられたばかりの牌（配列の最後）ならアニメーションを付ける
            const isJustDropped = (dIdx === discards.length - 1 && !isTurn); 
            const dTile = createTileElement(tileCode, true, isJustDropped);
            discardDiv.appendChild(dTile);
        });
    });
}

connect();