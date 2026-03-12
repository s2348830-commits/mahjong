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
        
        // 部屋名を表示
        document.getElementById('room-name-display').innerText = state.roomName;

        const isHost = state.hostId === myPlayerId;
        
        // UIの出し分け
        document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
        document.getElementById('guest-view').style.display = isHost ? 'none' : 'block';
        
        // 現在のルールのテキスト表示
        const ruleText = state.maxPlayers === 4 ? '4人麻雀 (4麻)' : '3人麻雀 (3麻)';
        document.getElementById('current-rule-display').innerText = ruleText;
        
        // 自分がホストの場合、ラジオボタンの選択状態をサーバーと同期する
        if (isHost) {
            const radio = document.querySelector(`input[name="player-count"][value="${state.maxPlayers}"]`);
            if (radio) radio.checked = true;
        }

        // プレイヤー一覧の描画（ホストには王冠マークをつける）
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

connect();