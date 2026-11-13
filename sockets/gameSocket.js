const WebSocket = require('ws');
const galaxyGameEngine = require('../services/galaxyGameEngine');
const Wallet = require('../models/Wallet');
const User = require('../models/User');

let globalGameWss = null;

function setupGameSocket(server) {
    const wss = new WebSocket.Server({ noServer: true });
    globalGameWss = wss;

    wss.on('connection', async (ws, req) => {
        let authUser = null;
        try {
            const urlObj = new URL(req.url, 'http://localhost');
            const token = urlObj.searchParams.get('token') || '';
            const uid = urlObj.searchParams.get('uid') || '';

            if (uid) {
                const u = await User.findOne({ uid }).lean();
                const w = await Wallet.findOne({ uid }).lean();
                authUser = {
                    uid,
                    numericId: u?.numericId || w?.numericId || 100000,
                    name: u?.name || 'Player',
                    avatar: u?.avatar || '',
                    coins: w?.coins || 0
                };
            }
        } catch (_) {}

        galaxyGameEngine.connectedClients.add(ws);
        console.log(`🎮 [GameSocket] Client connected to Galaxy Star live table. (Total: ${galaxyGameEngine.connectedClients.size})`);

        // Send initial instant state snapshot
        const snapshot = galaxyGameEngine.getSnapshotState(authUser?.uid);
        ws.send(JSON.stringify({
            event: 'INIT_SYNC',
            ...snapshot,
            user: authUser
        }));

        ws.on('message', async (raw) => {
            try {
                const data = JSON.parse(raw.toString());

                if (data.action === 'PING') {
                    ws.send(JSON.stringify({ event: 'PONG', timestamp: Date.now() }));
                    return;
                }

                if (data.action === 'BET') {
                    const { planetId, amount, txId } = data;
                    if (!authUser) {
                        ws.send(JSON.stringify({ event: 'ERROR', message: 'Unauthorized. Token required.' }));
                        return;
                    }

                    try {
                        const result = await galaxyGameEngine.placeBet({
                            uid: authUser.uid,
                            numericId: authUser.numericId,
                            userName: authUser.name,
                            userAvatar: authUser.avatar,
                            planetId,
                            amount,
                            txId
                        });

                        ws.send(JSON.stringify({
                            event: 'BET_SUCCESS',
                            ...result
                        }));
                    } catch (betErr) {
                        ws.send(JSON.stringify({
                            event: 'BET_FAILED',
                            message: betErr.message,
                            planetId
                        }));
                    }
                }
            } catch (err) {
                ws.send(JSON.stringify({ event: 'ERROR', message: err.message }));
            }
        });

        ws.on('close', () => {
            galaxyGameEngine.connectedClients.delete(ws);
        });

        ws.on('error', () => {
            galaxyGameEngine.connectedClients.delete(ws);
        });
    });

    return wss;
}

module.exports = setupGameSocket;
