let ws;
let myPlayerId = null;

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

// UI遷移
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
}

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
    }
}

// アクション送信系
function createRoom() { sendAction('CREATE_ROOM', { roomName: "テスト部屋", maxPlayers: 4 }); }
function searchRooms() { sendAction('SEARCH_ROOMS'); }
function joinRoom(roomId) { sendAction('JOIN_ROOM', { roomId }); }
function toggleReady() { sendAction('TOGGLE_READY'); }
function discardTile(index) { sendAction('DISCARD', { tileIndex: index }); }

// 描画系
function renderRoomList(rooms) {
    const list = document.getElementById('room-list');
    list.innerHTML = rooms.map(r => `<li>${r.name} (${r.currentPlayers}/${r.maxPlayers}) <button onclick="joinRoom('${r.id}')">参加</button></li>`).join('');
}

function changeRule(maxPlayers) {
    sendAction('CHANGE_RULE', { maxPlayers: parseInt(maxPlayers) });
}

// --- updateRoomState関数を以下のように書き換える ---
function updateRoomState(state) {
    if (state.status === 'LOBBY') {
        showScreen('room-screen');
        
        document.getElementById('room-name-display').innerText = state.roomName;
        const isHost = state.hostId === myPlayerId;
        
        document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
        document.getElementById('guest-view').style.display = isHost ? 'none' : 'block';
        
        const ruleText = state.maxPlayers === 4 ? '4人麻雀 (4麻)' : '3人麻雀 (3麻)';
        document.getElementById('current-rule-display').innerText = ruleText;
        
        // --- 修正箇所：ホストのラジオボタン制御 ---
        if (isHost) {
            const radio3 = document.querySelector(`input[name="player-count"][value="3"]`);
            const radio4 = document.querySelector(`input[name="player-count"][value="4"]`);
            
            // サーバーの現在の設定を反映
            if (state.maxPlayers === 3) radio3.checked = true;
            if (state.maxPlayers === 4) radio4.checked = true;

            // ★ 部屋に4人いる場合は「3麻」を無効化（disabled）する
            if (state.players.length >= 4) {
                radio3.disabled = true;
                radio3.parentElement.style.color = "#888"; // 文字色をグレーにして押せない感を出す
                radio3.parentElement.title = "すでに4人入室しているため3麻に変更できません";
            } else {
                radio3.disabled = false;
                radio3.parentElement.style.color = "#fff";
                radio3.parentElement.title = "";
            }
        }
        // ----------------------------------------

        document.getElementById('player-list').innerHTML = state.players.map(p => {
            const hostIcon = p.id === state.hostId ? '👑 ' : '';
            const readyText = p.isReady ? '<span style="color:#2ecc71;">(準備完了)</span>' : '(準備中)';
            return `<li>${hostIcon}Player: ${p.id} ${readyText}</li>`;
        }).join('');

    } else if (state.status === 'PLAYING') {
        showScreen('game-screen');
        renderGame(state.game);
    }
}

function renderGame(game) {
    const isMyTurn = game.turnPlayerId === myPlayerId;
    document.getElementById('game-info').innerHTML = `
        残り山牌: ${game.wallCount} <br>
        <span class="${isMyTurn ? 'turn-indicator' : ''}">
            ${isMyTurn ? 'あなたの番です' : '相手の番です...'}
        </span>
    `;

    // 自分の手牌描画
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
function kickPlayer(targetId) {
    if (confirm(`${targetId} をキックしますか？`)) {
        sendAction('KICK_PLAYER', { targetId });
    }
}

function addBot() {
    sendAction('ADD_BOT');
}

// --- handleServerMessage 関数に KICKED を追加 ---
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
        // ★追加: 自分がキックされた場合の処理
        case 'KICKED':
            alert('ホストによって部屋からキックされました。');
            showScreen('home-screen');
            searchRooms(); // 部屋一覧を更新しておく
            break;
    }
}

// --- updateRoomState 関数の該当部分を修正 ---
function updateRoomState(state) {
    if (state.status === 'LOBBY') {
        showScreen('room-screen');
        
        document.getElementById('room-name-display').innerText = state.roomName;
        const isHost = state.hostId === myPlayerId;
        
        document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
        document.getElementById('guest-view').style.display = isHost ? 'none' : 'block';
        
        const ruleText = state.maxPlayers === 4 ? '4人麻雀 (4麻)' : '3人麻雀 (3麻)';
        document.getElementById('current-rule-display').innerText = ruleText;
        
        if (isHost) {
            const radio3 = document.querySelector(`input[name="player-count"][value="3"]`);
            const radio4 = document.querySelector(`input[name="player-count"][value="4"]`);
            
            if (state.maxPlayers === 3) radio3.checked = true;
            if (state.maxPlayers === 4) radio4.checked = true;

            if (state.players.length >= 4) {
                radio3.disabled = true;
                radio3.parentElement.style.color = "#888";
            } else {
                radio3.disabled = false;
                radio3.parentElement.style.color = "#fff";
            }

            // ★追加: 部屋が満員の場合はBot追加ボタンを押せなくする
            const botBtn = document.getElementById('add-bot-btn');
            if (botBtn) {
                botBtn.disabled = state.players.length >= state.maxPlayers;
                botBtn.style.opacity = botBtn.disabled ? "0.5" : "1";
            }
        }

        // ★修正: プレイヤー一覧の描画（キックボタンとBot表示を追加）
        document.getElementById('player-list').innerHTML = state.players.map(p => {
            const hostIcon = p.id === state.hostId ? '👑 ' : '';
            const isBot = p.isAI ? '<span class="bot-label">[CPU]</span> ' : '';
            const readyText = p.isReady ? '<span style="color:#2ecc71;">(準備完了)</span>' : '(準備中)';
            
            // 自分がホストで、かつ相手が自分自身ではない場合に「✖」ボタンを表示
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
connect();