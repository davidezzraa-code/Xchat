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

// Connect to MongoDB (Replace with your actual string or process.env configuration on Render)
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/xchat";
mongoose.connect(MONGO_URI).then(() => console.log("MongoDB Connected"));

// --- AUTHENTICATION API ENDPOINTS ---
app.post('/api/auth/guest', async (req, res) => {
    const guestName = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
    const newUser = await User.create({ username: guestName, authProvider: 'guest' });
    res.json({ success: true, user: newUser });
});

app.post('/api/auth/google-mock', async (req, res) => {
    // In production, integrate official Google OAuth passport strategies here.
    const { googleId, name } = req.body;
    let user = await User.findOne({ googleId });
    if (!user) {
        user = await User.create({ username: name, googleId, authProvider: 'google' });
    }
    res.json({ success: true, user });
});

// --- REAL-TIME CHAT & MATCHING CORE ---
let globalMatchQueue = [];

io.on('connection', (socket) => {
    let authenticatedUserId = null;

    socket.on('set_active_user', async (userId) => {
        authenticatedUserId = userId;
        await User.findByIdAndUpdate(userId, { isOnline: true, currentSocketId: socket.id });
        socket.emit('system_ready', { msg: "Authenticated securely." });
    });

    // 1v1 Interest-Based Matchmaking Mechanism
    socket.on('start_matchmaking', async ({ userId, interests }) => {
        // Save fresh interest tokens to database
        const cleanInterests = interests.map(i => i.trim().toLowerCase()).filter(i => i.length > 0);
        await User.findByIdAndUpdate(userId, { interests: cleanInterests });

        // Check if a partner with intersecting nodes exists in queue
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
            // No direct interest match found; fall back to an open, global queue item
            globalMatchQueue.push({ userId, socketId: socket.id, interests: cleanInterests });
            socket.emit('waiting_for_match', "Scanning networks for matches...");
        }
    });

    socket.on('join_assigned_room', (roomName) => {
        socket.join(roomName);
    });

    socket.on('send_stranger_msg', ({ roomName, text, type }) => {
        socket.to(roomName).emit('receive_stranger_msg', { text, type });
    });

    // Persistent Friends System Framework
    socket.on('send_friend_request', async ({ fromId, toId }) => {
        const target = await User.findById(toId);
        if (target) {
            await User.findByIdAndUpdate(toId, { \$addToSet: { friendRequests: { from: fromId } } });
            if (target.currentSocketId) {
                io.to(target.currentSocketId).emit('incoming_friend_request', { fromId });
            }
        }
    });

    socket.on('respond_friend_request', async ({ userId, requesterId, accept }) => {
        if (accept) {
            await User.findByIdAndUpdate(userId, { 
                \(addToSet: { friends: requesterId },\)pull: { friendRequests: { from: requesterId } }
            });
            await User.findByIdAndUpdate(requesterId, { \$addToSet: { friends: userId } });
            
            // Notify both clients to redraw friend UI panels
            const u1 = await User.findById(userId);
            const u2 = await User.findById(requesterId);
            if(u1.currentSocketId) io.to(u1.currentSocketId).emit('refresh_friends');
            if(u2.currentSocketId) io.to(u2.currentSocketId).emit('refresh_friends');
        } else {
            await User.findByIdAndUpdate(userId, { \$pull: { friendRequests: { from: requesterId } } });
        }
    });

    socket.on('disconnect', async () => {
        globalMatchQueue = globalMatchQueue.filter(item => item.socketId !== socket.id);
        if (authenticatedUserId) {
            await User.findByIdAndUpdate(authenticatedUserId, { isOnline: false, currentSocketId: null });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`XChat active on port ${PORT}`));
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/xchat";
 
