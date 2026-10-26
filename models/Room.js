const mongoose = require('mongoose');
const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  hostId: { type: String, required: true },
  title: { type: String, required: true }
}, { timestamps: true });
module.exports = mongoose.model('Room', roomSchema);
