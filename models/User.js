const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => Math.floor(100000000 + Math.random() * 900000000).toString(),
    },
    name: {
      type: String,
      required: true,
      trim: true,
      default: 'Sona',
    },
    dob: {
      type: String,
      default: '2000-01-01',
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      default: 'Male',
    },
    country: {
      type: String,
      default: 'India',
    },
    email: {
      type: String,
      default: 'Sona@gmail.com',
    },
    photoUrl: {
      type: String,
      default: '',
    },
    level: {
      type: Number,
      default: 0,
    },
    updatedAtTimestamp: {
      type: Number,
      default: () => Date.now(),
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', UserSchema);
