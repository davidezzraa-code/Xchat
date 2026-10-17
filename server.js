const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // Allows incoming connections from frontend
});

// Trackers for current users
let waitingQueue = null; // Holds the socket ID of a stranger looking for a match
const activeMatches = new Map(); // Maps socket.id -> stranger's socket.id
const onlineUsers = new Map(); // Maps socket.id -> User Metadata (Name, etc.)

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 1. USER INITIALIZATION (Google / Guest Auth Register)
    socket.on('register_user', (userData) => {
        onlineUsers.set(socket.id, {
            id: socket.id,
            name: userData.name,
            isGuest: userData.isGuest
        });
    });

    // 2. MATCHMAKING ENGINE (1v1 Pair Routing)
    socket.on('find_match', () => {
        // Clear previous match if existing
        breakMatch(socket.id);

        if (waitingQueue && waitingQueue !== socket.id) {
            // Match found! Pair up the current socket with the waiting socket
            const peerId = waitingQueue;
            waitingQueue = null;

            activeMatches.set(socket.id, peerId);
            activeMatches.set(peerId, socket.id);

            const userMeta = onlineUsers.get(socket.id) || { name: 'Stranger' };
            const peerMeta = onlineUsers.get(peerId) || { name: 'Stranger' };

            // Inform both users that they are connected
            io.to(socket.id).emit('matched', { peerId: peerId, name: peerMeta.name });
            io.to(peerId).emit('matched', { peerId: socket.id, name: userMeta.name });
            console.log(`Matched Pair: ${socket.id} ⇄ ${peerId}`);
        } else {
            // Queue is empty, put this socket on standby
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
            // Forward request directly to the current matched stranger
            io.to(peerId).emit('incoming_friend_request', {
                fromId: socket.id,
                name: senderMeta.name
            });
        }
    });

    socket.on('respond_friend_request', (data) => {
        // data.targetId = who sent the request, data.status = 'accept' or 'deny'
        const deciderMeta = onlineUsers.get(socket.id) || { name: 'Stranger' };
        
        if (data.status === 'accept') {
            // Inform sender they are now friends, pass details to mount Friend Chat Box
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
        console.log(`User disconnected: ${socket.id}`);
        if (waitingQueue === socket.id) waitingQueue = null;
        breakMatch(socket.id);
        onlineUsers.delete(socket.id);
    });
});

// Helper function to break a match pair safely if someone skips or leaves
function breakMatch(socketId) {
    const peerId = activeMatches.get(socketId);
    if (peerId) {
        activeMatches.delete(socketId);
        activeMatches.delete(peerId);
        io.to(peerId).emit('peer_disconnected', { message: "Stranger skipped or left the chat." });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Realtime Chat server running smoothly on port ${PORT}`);
});
