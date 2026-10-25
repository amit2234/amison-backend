require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const userRoutes = require('./routes/userRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB and Redis
connectDB();
connectRedis();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
app.use('/api/users', userRoutes);

// Root / Health check route
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    app: 'Shona App Backend',
    database: 'MongoDB',
    cache: 'Redis',
    storage: 'Cloudinary',
    endpoints: {
      getProfile: 'GET /api/users/profile/:userId',
      saveProfile: 'POST /api/users/profile',
      checkCode: 'GET /api/users/check/:userCode',
    },
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚀 Shona Backend Server running on port ${PORT}`);
  console.log(`📡 MongoDB: Configured via MONGODB_URI`);
  console.log(`⚡ Redis: Configured via REDIS_URL`);
  console.log(`🖼️  Photos: Cloudinary CDN`);
  console.log(`===============================================`);
});