const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // In production, restrict to your specific domain
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Temporary landing page
app.get('/', (req, res) => {
    res.render('index', { activeRooms: Object.keys(rooms).length });
});

// Rooms dictionary to keep track of active matches
// Structure: rooms[roomCode] = { hostId: socketId, joinerId: socketId }
const rooms = {};

// Helper to generate 6-digit code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Host requests a room
    socket.on('host_match', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { hostId: socket.id, joinerId: null };
        socket.join(roomCode);
        socket.emit('room_created', roomCode);
        console.log(`Room ${roomCode} created by ${socket.id}`);
    });

    // Joiner tries to join a specific room
    socket.on('join_match', (roomCode) => {
        if (rooms[roomCode]) {
            if (!rooms[roomCode].joinerId) {
                rooms[roomCode].joinerId = socket.id;
                socket.join(roomCode);
                
                // Notify both peers to start WebRTC
                socket.emit('join_success', roomCode);
                io.to(rooms[roomCode].hostId).emit('peer_joined', socket.id);
                console.log(`${socket.id} joined room ${roomCode}`);
            } else {
                socket.emit('join_error', 'Room is full.');
            }
        } else {
            socket.emit('join_error', 'Room not found.');
        }
    });

    // Joiner tries to quick join any available room
    socket.on('quick_join', () => {
        let joined = false;
        for (const [code, room] of Object.entries(rooms)) {
            if (!room.joinerId) {
                room.joinerId = socket.id;
                socket.join(code);
                
                // Notify both peers
                socket.emit('join_success', code);
                io.to(room.hostId).emit('peer_joined', socket.id);
                console.log(`${socket.id} quick-joined room ${code}`);
                joined = true;
                break;
            }
        }
        if (!joined) {
            socket.emit('join_error', 'No available matches found.');
        }
    });

    // WebRTC Signaling
    socket.on('signal', (data) => {
        // data: { roomCode, signalData, to (optional socketId) }
        socket.to(data.roomCode).emit('signal', {
            from: socket.id,
            signalData: data.signalData
        });
    });

    // Handle disconnects
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Find if user was in any room and clean up
        for (const [code, room] of Object.entries(rooms)) {
            if (room.hostId === socket.id || room.joinerId === socket.id) {
                // Notify the other peer
                socket.to(code).emit('peer_disconnected');
                delete rooms[code];
                console.log(`Room ${code} closed due to disconnect`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
