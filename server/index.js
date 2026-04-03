const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const RoomManager = require('./RoomManager');
const MahjongGame = require('./MahjongGame'); 

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../client')));

const roomManager = new RoomManager();

wss.on('connection', (ws) => {
    let playerId = Math.random().toString(36).substr(2, 9);
    let currentRoomId = null;

    // 初回接続時にランダムなIDを付与
    ws.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId } }));

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'REJOIN':
                const oldPlayerId = data.payload.playerId;
                let foundRoom = false;
                for (const room of roomManager.rooms.values()) {
                    if (room.players.has(oldPlayerId)) {
                        playerId = oldPlayerId; // 以前のIDを引き継ぐ
                        currentRoomId = room.id;
                        room.join(playerId, ws);
                        foundRoom = true;
                        // 復帰成功をクライアントに通知し、古いIDを再適用させる
                        ws.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId: oldPlayerId, isRejoin: true } }));
                        break;
                    }
                }
                if (!foundRoom) {
                    // 部屋が見つからなかった場合は復帰失敗を通知
                    ws.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId, isRejoin: false } }));
                }
                break;
            case 'CREATE_ROOM':
                const room = roomManager.createRoom(data.payload.roomName, data.payload.maxPlayers);
                currentRoomId = room.id;
                room.join(playerId, ws);
                break;
            case 'SEARCH_ROOMS':
                ws.send(JSON.stringify({ type: 'ROOM_LIST', payload: roomManager.getRooms() }));
                break;
            case 'JOIN_ROOM':
                const targetRoom = roomManager.getRoom(data.payload.roomId);
                if (targetRoom) {
                    currentRoomId = targetRoom.id;
                    targetRoom.join(playerId, ws);
                }
                break;
            default:
                if (currentRoomId) {
                    const roomObj = roomManager.getRoom(currentRoomId);
                    if (roomObj) roomObj.handleAction(playerId, data);
                }
        }
    });

    ws.on('close', () => {
        if (currentRoomId) {
            const roomObj = roomManager.getRoom(currentRoomId);
            if (roomObj) {
                roomObj.handleDisconnect(playerId);
                
                if (roomObj.players.size === 0) {
                    roomManager.rooms.delete(currentRoomId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});