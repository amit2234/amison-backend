const { createClient } = require('redis');
const client = createClient({ url: process.env.REDIS_URL, socket: { tls: true, rejectUnauthorized: false } });
const connectRedis = async () => { try { await client.connect(); console.log('Redis Connected'); } catch (e) { console.error(e); } };
module.exports = { client, connectRedis };
