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
            searchRooms(); // 部屋一覧を更新
            break;
    }
}

// ==========================================
// 3. ユーザーアクション（送信系）
// ==========================================
function createRoom() { 
    sendAction('CREATE_ROOM', { roomName: "テスト部屋", maxPlayers: 4 }); 
}
function searchRooms() { sendAction('SEARCH_ROOMS'); }
function joinRoom(roomId) { sendAction('JOIN_ROOM', { roomId }); }
function toggleReady() { sendAction('TOGGLE_READY'); }
function discardTile(index) { sendAction('DISCARD', { tileIndex: index }); }

// キックとBot追加
function kickPlayer(targetId) {
    if (confirm(`${targetId} をキックしますか？`)) {
        sendAction('KICK_PLAYER', { targetId });
    }
}
function addBot() { sendAction('ADD_BOT'); }

// --- 設定関連のアクション ---

// ボタンがクリックされた時に隠しinputの値を書き換えて送信をトリガーする
function changeSettingRadio(name, value) {
    const hiddenInput = document.querySelector(`input[name="${name}"]`);
    if (hiddenInput) {
        hiddenInput.value = value;
        syncSettings();
    }
}

// フォームの値をすべて取得してサーバーに同期する（ホストのみ）
function syncSettings() {
    // 隠しinputから値を取得（文字列として取得されるため、真偽値に変換）
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

// ゲスト用に設定値を日本語に変換する辞書
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
        
        // --- ホスト用UIの更新 ---
        if (isHost && state.settings) {
            const s = state.settings;
            
            // サーバーからの設定をUIのボタンと隠しinputに反映する関数
            const setRadio = (name, value) => {
                // 隠しinputの値を更新
                const hiddenInput = document.querySelector(`input[name="${name}"]`);
                if (hiddenInput) hiddenInput.value = value;
                
                // 対象グループのすべてのボタンの選択状態をリセット
                const allButtons = document.querySelectorAll(`button[onclick^="changeSettingRadio('${name}'"]`);
                allButtons.forEach(btn => {
                    btn.classList.remove('selected');
                    btn.classList.add('unselected');
                });
                
                // 該当する値のボタンだけを選択状態（オレンジ）にする
                const valStr = typeof value === 'string' ? `'${value}'` : value;
                const targetBtn = document.querySelector(`button[onclick="changeSettingRadio('${name}', ${valStr})"]`);
                if (targetBtn) {
                    targetBtn.classList.remove('unselected');
                    targetBtn.classList.add('selected');
                }
            };
            
            setRadio('mode', s.mode);
            setRadio('length', s.length);
            setRadio('thinkTime', s.thinkTime);
            setRadio('advanced', s.advanced);
            
            document.getElementById('startPoints').value = s.startPoints;
            document.getElementById('targetPoints').value = s.targetPoints;
            
            setRadio('tobi', s.tobi);
            setRadio('localYaku', s.localYaku);
            setRadio('akaDora', s.akaDora);
            setRadio('kuitan', s.kuitan);
            setRadio('cpuLevel', s.cpuLevel);
            setRadio('openHands', s.openHands);

            // 詳細設定の表示制御
            document.getElementById('advanced-settings').style.display = s.advanced ? 'block' : 'none';

            // 人数制限による3麻のブロック処理
            const button3 = document.querySelector(`button[onclick="changeSettingRadio('mode', 3)"]`);
            if (button3) {
                if (state.players.length >= 4) {
                    button3.disabled = true;
                    button3.style.opacity = "0.5";
                    button3.title = "すでに4人入室しているため3麻に変更できません";
                } else {
                    button3.disabled = false;
                    button3.style.opacity = "1";
                    button3.title = "";
                }
            }

            // Bot追加ボタンの制限
            const botBtn = document.getElementById('add-bot-btn');
            if (botBtn) {
                botBtn.disabled = state.players.length >= s.mode;
                botBtn.style.opacity = botBtn.disabled ? "0.5" : "1";
            }
        } 
        // --- ゲスト用UIの更新 ---
        else if (!isHost && state.settings) {
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

        // --- プレイヤー一覧の描画 ---
        document.getElementById('player-list').innerHTML = state.players.map(p => {
            const hostIcon = p.id === state.hostId ? '👑 ' : '';
            const isBot = p.isAI ? '<span class="bot-label">[CPU]</span> ' : '';
            const readyText = p.isReady ? '<span style="color:#2ecc71;">(準備完了)</span>' : '(準備中)';
            
            let kickBtn = '';
            if (isHost && p.id !== myPlayerId) {
                kickBtn = `<span class="kick-btn" title="キックする" onclick="kickPlayer('${p.id}')">✖</span>`;
            }

            return `<li style="margin-bottom: 10px; display: flex; align-items: center;">
                        ${kickBtn}${hostIcon}${isBot}Player: ${p.id} <span style="margin-left: 10px;">${readyText}</span>
                    </li>`;
        }).join('');

    } else if (state.status === 'PLAYING') {
        showScreen('game-screen');
        renderGame(state.game);
    }
}

// ==========================================
// 5. ゲーム画面描画
// ==========================================
function renderGame(game) {
    const isMyTurn = game.turnPlayerId === myPlayerId;
    document.getElementById('game-info').innerHTML = `
        残り山牌: ${game.wallCount} <br>
        <span class="${isMyTurn ? 'turn-indicator' : ''}">
            ${isMyTurn ? 'あなたの番です' : '相手の番です...'}
        </span>
    `;

    const handDiv = document.getElementById('my-hand');
    handDiv.innerHTML = '';
    const myHand = game.hands[myPlayerId] || [];
    
    myHand.forEach((tile, index) => {
        const tileDiv = document.createElement('div');
        tileDiv.className = `tile ${tile === 'back' ? 'back' : ''}`;
        tileDiv.innerText = tile;
        if (isMyTurn && tile !== 'back') {
            tileDiv.onclick = () => discardTile(index);
        }
        handDiv.appendChild(tileDiv);
    });
}

// 起動時に接続
connect();