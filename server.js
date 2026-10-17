const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // Core Node module for file paths

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// 🔥 FIX: Tell Express to serve your index.html file when someone opens the site
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Trackers for current users
let waitingQueue = null; 
const activeMatches = new Map(); 
const onlineUsers = new Map(); 

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 1. USER INITIALIZATION
    socket.on('register_user', (userData) => {
        onlineUsers.set(socket.id, {
            id: socket.id,
            name: userData.name
        });
    });

    // 2. MATCHMAKING ENGINE
    socket.on('find_match', () => {
        breakMatch(socket.id);

        if (waitingQueue && waitingQueue !== socket.id) {
            const peerId = waitingQueue;
            waitingQueue = null;

            activeMatches.set(socket.id, peerId);
            activeMatches.set(peerId, socket.id);

            const userMeta = onlineUsers.get(socket.id) || { name: 'Stranger' };
            const peerMeta = onlineUsers.get(peerId) || { name: 'Stranger' };

            io.to(socket.id).emit('matched', { peerId: peerId, name: peerMeta.name });
            io.to(peerId).emit('matched', { peerId: socket.id, name: userMeta.name });
        } else {
            waitingQueue = socket.id;
            io.to(socket.id).emit('waiting', { message: "Searching for a stranger..." });
        }
    });

    // 3. LIVE STRANGER CHAT MESSAGING
    socket.on('send_message', (data) => {
        const peerId = activeMatches.get(socket.id);
        if (peerId) {
            io.to(peerId).emit('receive_message', { text: data.text });
        }
    });

    // 4. FRIEND REQUEST SYSTEMS
    socket.on('send_friend_request', () => {
        const peerId = activeMatches.get(socket.id);
        const senderMeta = onlineUsers.get(socket.id) || { name: 'Stranger' };
        if (peerId) {
            io.to(peerId).emit('incoming_friend_request', {
                fromId: socket.id,
                name: senderMeta.name
            });
        }
    });

    socket.on('respond_friend_request', (data) => {
        const deciderMeta = onlineUsers.get(socket.id) || { name: 'Stranger' };
        if (data.status === 'accept') {
            io.to(data.targetId).emit('friend_request_accepted', {
                friendId: socket.id,
                name: deciderMeta.name
            });
        } else {
            io.to(data.targetId).emit('friend_request_denied', { fromName: deciderMeta.name });
        }
    });

    // 5. CLEANUP ON DISCONNECT
    socket.on('disconnect', () => {
        if (waitingQueue === socket.id) waitingQueue = null;
        breakMatch(socket.id);
        onlineUsers.delete(socket.id);
    });
});

function breakMatch(socketId) {
    const peerId = activeMatches.get(socketId);
    if (peerId) {
        activeMatches.delete(socketId);
        activeMatches.delete(peerId);
        io.to(peerId).emit('peer_disconnected');
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
