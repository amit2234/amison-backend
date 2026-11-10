# 🎮 Backend Games Directory (`backend/games/`)

Yeh folder aapke Node.js backend ka dedicated Games folder hai, theek waise hi jaise `controllers/`, `models/`, `routes/`, aur `services/` hain.

## 📂 Structure:
```text
backend/
  ├── controllers/
  ├── models/
  ├── routes/
  ├── services/
  ├── sockets/
  ├── utils/
  └── games/                  <--- 🎮 AAPKE SABHI H5 GAMES YAHAN HAIN
        ├── galaxy_star/
        │     ├── index.html       (Main Game Page)
        │     ├── style.css        (Game styling & animations)
        │     ├── game.js          (Full Game Logic & Canvas Engine)
        │     ├── standalone.html  (1-file portable bundle)
        │     └── README.md
        │
        ├── greedy_miner/     (Naya game add karne ke liye)
        ├── lucky_wheel/      (Naya game add karne ke liye)
        └── teen_patti/       (Naya game add karne ke liye)
```

## 🚀 Express Server Serving:
Node.js Express server is folder ko directly static serve karta hai:
- `http://<YOUR_IP>:3000/games/galaxy_star/index.html`

Jab bhi aap apna Node backend download karenge, ye `games/` folder alag se saaf-suthra milega jise aap aasaani se edit, backup ya naye games add karne ke liye use kar sakte hain.
