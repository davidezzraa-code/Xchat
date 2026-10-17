    socket.on('send_friend_request', async ({ fromId, toId }) => {
        try {
            const target = await User.findById(toId);
            if (target) {
                target.friendRequests.push({ from: fromId });
                await target.save();
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
            const user = await User.findById(userId);
            const requester = await User.findById(requesterId);
            if (!user || !requester) return;

            user.friendRequests = user.friendRequests.filter(req => req.from.toString() !== requesterId);

            if (accept) {
                if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
                if (!requester.friends.includes(userId)) requester.friends.push(userId);
                
                await user.save();
                await requester.save();
                
                if (user.currentSocketId) io.to(user.currentSocketId).emit('refresh_friends');
                if (requester.currentSocketId) io.to(requester.currentSocketId).emit('refresh_friends');
            } else {
                await user.save();
            }
        } catch (err) {
            console.error("Friend response error:", err.message);
        }
    });
