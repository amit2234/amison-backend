const { createClient } = require('redis');

const client = createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: true,
    rejectUnauthorized: false
  }
});

client.on('error', (err) => console.log('Redis Client Error', err));

const connectRedis = async () => {
  try {
    await client.connect();
    console.log('Connected to Redis successfully');
  } catch (error) {
    console.error('Could not connect to Redis', error);
  }
};

module.exports = { client, connectRedis };
