const Redis = require('ioredis');

let redisClient = null;

const connectRedis = () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        if (times > 3) {
          console.warn('[Redis] Max retries reached. Running without Redis cache.');
          return null; // Stop retrying, allow server to run with direct DB
        }
        return Math.min(times * 1000, 3000);
      },
      lazyConnect: true,
    });

    redisClient.connect().then(() => {
      console.log(`[Redis] Connected successfully to Redis server at ${redisUrl}`);
    }).catch(err => {
      console.warn(`[Redis] Connection warning: ${err.message}. Backend will query MongoDB directly.`);
    });

    redisClient.on('error', (err) => {
      // Prevent crash on connection drop
    });

  } catch (error) {
    console.warn(`[Redis] Initialization warning: ${error.message}.`);
  }

  return redisClient;
};

const getRedisClient = () => redisClient;

module.exports = { connectRedis, getRedisClient };
