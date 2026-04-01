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

// 【修正】存在しないメソッド（MahjongGame.testYaku()）の呼び出しを削除し、サーバークラッシュを防止

wss.on('connection', (ws) => {
    let playerId = Math.random().toString(36).substr(2, 9);
    let currentRoomId = null;

    ws.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId } }));

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'REJOIN':
                // 【追加】再接続処理: 通信切断やリロードからの復帰に対応
                const oldPlayerId = data.payload.playerId;
                let foundRoom = false;
                for (const room of roomManager.rooms.values()) {
                    if (room.players.has(oldPlayerId)) {
                        playerId = oldPlayerId; // 以前のIDを引き継ぐ
                        currentRoomId = room.id;
                        room.join(playerId, ws); // 古いセッションを上書きし、AI状態を解除
                        foundRoom = true;
                        break;
                    }
                }
                // 部屋が見つからなかった場合は新しいIDとして再接続させる
                if (!foundRoom) {
                    ws.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId } }));
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
    console.log(`Server listening on port ${PORT}`);
});