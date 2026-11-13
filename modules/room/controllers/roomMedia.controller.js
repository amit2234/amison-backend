const { uploadBufferToCloudinary } = require('../../../services/cloudinaryService');

/**
 * Room Media Controller
 * Handles Cover Photo & In-Room Chat Media uploads cleanly isolated from WebSocket & stage logic.
 */
const roomMediaController = {
    async uploadChatMedia(req, res) {
        try {
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({ success: false, error: 'Missing mediaFile in request' });
            }
            const result = await uploadBufferToCloudinary(
                req.file.buffer,
                'amison/room_chats',
                'auto',
                { filename: req.file.originalname || `chat_${Date.now()}` }
            );
            return res.json({
                success: true,
                mediaUrl: result.secure_url,
                publicId: result.public_id
            });
        } catch (e) {
            console.error('[RoomMedia] uploadChatMedia error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    },

    async uploadCover(req, res) {
        try {
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({ success: false, error: 'Missing mediaFile in request' });
            }
            const result = await uploadBufferToCloudinary(
                req.file.buffer,
                'amison/rooms',
                'auto',
                { filename: req.file.originalname || `room_${Date.now()}` }
            );
            return res.json({
                success: true,
                mediaUrl: result.secure_url,
                publicId: result.public_id
            });
        } catch (e) {
            console.error('[RoomMedia] uploadCover error:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }
};

module.exports = roomMediaController;
