require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Redis = require('ioredis');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

const io = new Server(server, { cors: { origin: '*' } });

// Redis Setup
let redis = null;
if (process.env.REDIS_URI) {
  redis = new Redis(process.env.REDIS_URI);
}

// MongoDB Setup
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Atlas Connected'))
  .catch(err => console.error('MongoDB Error:', err));

io.on('connection', (socket) => {
  socket.on('join_user', (userId) => socket.join(`user:${userId}`));
});

const userRoutes = require('./routes/userRoutes')(io, redis);
app.use('/api/users', userRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Amison Backend' }));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
