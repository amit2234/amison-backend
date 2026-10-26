const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String },
  photoUrl: { type: String },
  gender: { type: String },
  dob: { type: String },
  coins: { type: Number, default: 0 },
  diamonds: { type: Number, default: 0 }
}, { timestamps: true });
module.exports = mongoose.model('User', userSchema);
