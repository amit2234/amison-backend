# Amison Backend Deployment Guide (Mobile-Only Friendly)

Ye backend **Node.js, Express, Socket.IO, MongoDB, aur Upstash Redis** par bana hai jo 100+ concurrent users par zero lag, atomic seat locking, aur fast gifting handle karega.

## Steps to Deploy on Render.com (Free & Mobile Friendly):
1. Apne mobile browser par **[render.com](https://render.com)** par jao aur GitHub/Google se login karo.
2. Is project ko GitHub par push karo ya Render ke **New -> Web Service** me zip upload / GitHub repo connect karo.
3. Environment Variables (Secrets) me ye add karo:
   - `MONGO_URI`: `mongodb+srv://diablo:Diablo2234@amison.bgzqeqm.mongodb.net/amison_db?retryWrites=true&w=majority`
   - `REDIS_URL`: `redis://default:gQAAAAAAA56XAAIgcDI0MWNhYzRkZTc4NDU0Yjg5OWFjMDhiNGMyMGZhNzMyNA@vital-rooster-237207.upstash.io:6379`
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Click **Create Web Service**. Ek URL mil jayega (jaise `https://amison-backend.onrender.com`). Us URL ko apne Android app me connect kar lena!
