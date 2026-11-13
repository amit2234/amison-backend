# 🌌 Galaxy Star H5 Arcade Game (Node.js Static & API Hosted)

## 📌 Overview
Yeh Galaxy Star H5 Web Game ka complete production code hai jo Node.js Express server ke through dynamically host aur serve hota hai:
- **Serving Path:** `http://<YOUR_SERVER_HOST>:3000/games/galaxy_star/index.html`
- **Resolution:** Responsive portrait 720x1030 aspect ratio (fits all mobile screens)
- **Engine:** HTML5 Canvas + Web Audio API + Real-time JS Bridge

## 🚀 How It Works with Android App
1. **Zero APK Footprint:** Android app ke andar koi game file bundle karne ki zaroorat nahi hoti.
2. **Instant Updates:** Jab bhi game ka code, rules, planet multiplier, ya graphics change karne hon, sirf is folder me files update karein. Sabhi users ke live rooms me bina kisi APK update ke naya version turant chalne lagega!
3. **JSBridge Integration:**
   - `window.AmisonBridge.closePage()`: Game ko room ke andar dismiss karta hai.
   - `window.AmisonBridge.openRechargeSheet()`: Coins kam hone par user ka wallet popup kholta hai.
   - `window.AmisonBridge.placeBet(planet, coins)`: Server par authoritative bet place karta hai.

## 🛠️ Testing Locally
Node.js server start karein:
```bash
cd backend
npm start
```
Browser me open karein:
`http://localhost:3000/games/galaxy_star/index.html`
