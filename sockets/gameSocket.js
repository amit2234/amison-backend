const WebSocket = require('ws');
const galaxyGameEngine = require('../services/galaxyGameEngine');
const Wallet = require('../models/Wallet');
const { verifyWebSocketConnection } = require('../middleware/authMiddleware');

let globalGameWss = null;

function setupGameSocket(server) {
    const wss = new WebSocket.Server({ noServer: true });
    globalGameWss = wss;

    wss.on('connection', (ws, req) => {
        let authUser = null;
        ws._verifiedUid = '';

        ws._authPromise = verifyWebSocketConnection(req, { requireMongoUser: true })
            .then(async ({ verifiedUid, userDoc }) => {
                ws._verifiedUid = verifiedUid;
                const w = await Wallet.findOne({ uid: verifiedUid }).lean();
                authUser = {
                    uid: verifiedUid,
                    numericId: userDoc?.numericId || w?.numericId || 100000,
                    name: userDoc?.name || 'Player',
                    avatar: userDoc?.avatarUrl || '',
                    coins: w?.coins || userDoc?.coins || 0
                };

                galaxyGameEngine.connectedClients.add(ws);
                console.log(`🎮 [GameSocket] Verified client ${verifiedUid} connected to Galaxy Star. (Total: ${galaxyGameEngine.connectedClients.size})`);

                const snapshot = galaxyGameEngine.getSnapshotState(authUser.uid);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        event: 'INIT_SYNC',
                        ...snapshot,
                        user: authUser
                    }));
                }
                return verifiedUid;
            })
            .catch((authErr) => {
                console.warn('🎮 [GameSocket] Rejected unauthorized socket:', authErr?.message || authErr);
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ event: 'ERROR', message: 'Unauthorized. Valid Firebase token required.' }));
                    }
                    ws.close(4001, 'Unauthorized');
                } catch (_) {}
                return '';
            });

        ws.on('message', async (raw) => {
            try {
                if (ws._authPromise) {
                    await ws._authPromise;
                }
                if (!ws._verifiedUid || !authUser) {
                    try { ws.close(4001, 'Unauthorized'); } catch (_) {}
                    return;
                }

                const data = JSON.parse(raw.toString());

                if (data.action === 'PING') {
                    ws.send(JSON.stringify({ event: 'PONG', timestamp: Date.now() }));
                    return;
                }

                if (data.action === 'BET') {
                    const { planetId, amount, txId } = data;

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
