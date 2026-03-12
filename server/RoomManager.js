const Room = require('./Room');

class RoomManager {
    constructor() {
        this.rooms = new Map();
    }

    createRoom(name, maxPlayers) {
        const roomId = Math.random().toString(36).substr(2, 6);
        const room = new Room(roomId, name, maxPlayers);
        this.rooms.set(roomId, room);
        return room;
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    getRooms() {
        return Array.from(this.rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            currentPlayers: r.players.size,
            maxPlayers: r.maxPlayers,
            status: r.status
        }));
    }
}
module.exports = RoomManager;