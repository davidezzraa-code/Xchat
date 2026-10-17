const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Retrieve MongoDB URI from Render environment variables
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("FATAL ERROR: MONGO_URI environment variable is missing on Render!");
    process.exit(1);
}

// Connect to MongoDB with error catch logs
mongoose.connect(MONGO_URI)
    .then(() => console.log("SUCCESS: Connected to MongoDB Atlas smoothly!"))
    .catch((err) => {
        console.error("FATAL DATABASE ERROR:", err.message);
        process.exit(1);
    });

// --- AUTHENTICATION API ENDPOINTS ---
app.post('/api/auth/guest', async (req, res) => {
    try {
        const guestName = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
        const newUser = await User.create({ username: guestName, authProvider: 'guest' });
        res.json({ success: true, user: newUser });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/auth/google-mock', async (req, res) => {
    try {
        const { googleId, name } = req.body;
        let user = await User.findOne({ googleId });
        if (!user) {
            user = await User.create({ username: name, googleId, authProvider: 'google' });
        }
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- REAL-TIME CHAT & MATCHING CORE ---
let globalMatchQueue = [];

io.on('connection', (socket) => {
    let authenticatedUserId = null;
    console.log(`Socket connected: ${socket.id}`);

    socket.on('set_active_user', async (userId) => {
        try {
            authenticatedUserId = userId;
            await User.findByIdAndUpdate(userId, { isOnline: true, currentSocketId: socket.id });
            socket.emit('system_ready', { msg: "Authenticated securely." });
        } catch (err) {
            console.error("Error setting active user:", err.message);
        }
    });

    // 1v1 Interest-Based Matchmaking Mechanism
    socket.on('start_matchmaking', async ({ userId, interests }) => {
        try {
            const cleanInterests = interests.map(i => i.trim().toLowerCase()).filter(i => i.length > 0);
            await User.findByIdAndUpdate(userId, { interests: cleanInterests });

            // Check queue for matching interest tags
            const matchIndex = globalMatchQueue.findIndex(item => 
                item.userId !== userId && item.interests.some(i => cleanInterests.includes(i))
            );

            if (matchIndex !== -1) {
                const partner = globalMatchQueue.splice(matchIndex, 1)[0];
                const roomName = `room_${userId}_${partner.userId}`;

                socket.join(roomName);
                io.to(partner.socketId).emit('force_join_room', { roomName, partnerId: userId });
                io.to(roomName).emit('match_success', { roomName, p1: userId, p2: partner.userId });
            } else {
                // If no matching tags, add this user to the queue
                globalMatchQueue = globalMatchQueue.filter(item => item.userId !== userId);
                globalMatchQueue.push({ userId, socketId: socket.id, interests: cleanInterests });
                socket.emit('waiting_for_match', "Scanning networks for matches...");
            }
        } catch (err) {
            console.error("Matchmaking error:", err.message);
        }
    });

    socket.on('join_assigned_room', (roomName) => {
        socket.join(roomName);
        console.log(`Socket ${socket.id} joined room: ${roomName}`);
    });

    socket.on('send_stranger_msg', ({ roomName, text, type }) => {
        socket.to(roomName).emit('receive_stranger_msg', { text, type });
    });

    // Persistent Friends System Framework
    socket.on('send_friend_request', async ({ fromId, toId }) => {
        try {
            const target = await User.findById(toId);
            if (target) {
                await User.findByIdAndUpdate(toId, { \$addToSet: { friendRequests: { from: fromId } } });
                if (target.currentSocketId) {
                    io.to(target.currentSocketId).emit('incoming_friend_request', { fromId });
                }
            }
        } catch (err) {
            console.error("Friend request error:", err.message);
        }
    });

    socket.on('respond_friend_request', async ({ userId, requesterId, accept }) => {
        try {
            if (accept) {
                // Fixed Clean Mongoose Operators (addToSet and pull)
                await User.findByIdAndUpdate(userId, { 
                    \(addToSet: { friends: requesterId },\)pull: { friendRequests: { from: requesterId } }
                });
                await User.findByIdAndUpdate(requesterId, { \$addToSet: { friends: userId } });
                
                const u1 = await User.findById(userId);
                const u2 = await User.findById(requesterId);
                if (u1 && u1.currentSocketId) io.to(u1.currentSocketId).emit('refresh_friends');
                if (u2 && u2.currentSocketId) io.to(u2.currentSocketId).emit('refresh_friends');
            } else {
                await User.findByIdAndUpdate(userId, { \$pull: { friendRequests: { from: requesterId } } });
            }
        } catch (err) {
            console.error("Friend response error:", err.message);
        }
    });

    socket.on('disconnect', async () => {
        globalMatchQueue = globalMatchQueue.filter(item => item.socketId !== socket.id);
        if (authenticatedUserId) {
            try {
                await User.findByIdAndUpdate(authenticatedUserId, { isOnline: false, currentSocketId: null });
            } catch (err) {
                console.error("Disconnect cleanup error:", err.message);
            }
        }
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SUCCESS: XChat engine running smoothly on port ${PORT}`));
