const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    authProvider: { type: String, enum: ['google', 'guest'], required: true },
    googleId: { type: String, unique: true, sparse: true },
    interests: [{ type: String }],
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    friendRequests: [{
        from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        status: { type: String, enum: ['pending'], default: 'pending' }
    }],
    isOnline: { type: Boolean, default: false },
    currentSocketId: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
