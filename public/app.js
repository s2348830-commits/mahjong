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

function updateRoomState(state) {
    if (state.status === 'LOBBY') {
        showScreen('room-screen');
        document.getElementById('player-list').innerHTML = state.players.map(p => 
            `<li>Player: ${p.id} ${p.isReady ? '(準備完了)' : '(準備中)'}</li>`
        ).join('');
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