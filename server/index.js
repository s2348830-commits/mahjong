const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const RoomManager = require('./RoomManager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../client')));

const roomManager = new RoomManager();

wss.on('connection', (ws) => {
    let playerId = Math.random().toString(36).substr(2, 9); // 簡易ID
    let currentRoomId = null;

    ws.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId } }));

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch (data.type) {
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
                
                // ★修正: 部屋の人数が0人になったら部屋そのものを削除する
                if (roomObj.players.size === 0) {
                    roomManager.rooms.delete(currentRoomId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});