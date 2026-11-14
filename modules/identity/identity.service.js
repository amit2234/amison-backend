const Room = require('../../models/Room');
const User = require('../../models/User');
const SequenceCounter = require('./SequenceCounter.model');
const {
    ROOM_ID_KEY,
    ROOM_ID_START,
    ROOM_STEP_MIN,
    ROOM_STEP_MAX,
    USER_ID_KEY,
    USER_ID_START,
    USER_STEP_MIN,
    USER_STEP_MAX
} = require('./identity.constants');

function randomStep(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Ensures the atomic counter document exists in MongoDB without race conditions.
 * Uses $setOnInsert so parallel cold-starts never overwrite an active counter.
 */
async function ensureCounterInitialized(key, startSeed, resolveMaxExistingFn) {
    const existing = await SequenceCounter.findById(key).lean();
    if (existing && typeof existing.seq === 'number') {
        return existing.seq;
    }

    let maxExisting = 0;
    try {
        maxExisting = Number(await resolveMaxExistingFn()) || 0;
    } catch (_) {
        maxExisting = 0;
    }

    const initialSeq = Math.max(startSeed, maxExisting);
    await SequenceCounter.updateOne(
        { _id: key },
        { $setOnInsert: { seq: initialSeq, updatedAt: new Date() } },
        { upsert: true }
    );
    return initialSeq;
}

async function resolveMaxFiveDigitRoomId() {
    // Only scan numeric displayRoomIds in 10000..99999 so legacy 6-digit test rooms
    // don't push the 5-digit 10000+ sequence into 6 digits prematurely.
    const docs = await Room.find({
        displayRoomId: { $regex: /^[1-9]\d{4}$/ }
    }).select('displayRoomId').lean();

    let maxVal = 0;
    for (const d of docs) {
        const n = Number(d.displayRoomId);
        if (Number.isInteger(n) && n >= ROOM_ID_START && n <= 99999 && n > maxVal) {
            maxVal = n;
        }
    }
    return maxVal;
}

async function resolveMaxUserNumericId() {
    const topUser = await User.findOne({
        numericId: { $gte: USER_ID_START }
    }).sort({ numericId: -1 }).select('numericId').lean();

    return topUser && typeof topUser.numericId === 'number' ? topUser.numericId : 0;
}

const identityService = {
    /**
     * Generates a strictly unique Room Display ID:
     * Starts from 10000 (5-digit) and increments atomically by +10 to +25.
     */
    async getNextRoomDisplayId() {
        await ensureCounterInitialized(ROOM_ID_KEY, ROOM_ID_START, resolveMaxFiveDigitRoomId);

        for (let attempt = 0; attempt < 40; attempt++) {
            const step = randomStep(ROOM_STEP_MIN, ROOM_STEP_MAX);
            const updated = await SequenceCounter.findOneAndUpdate(
                { _id: ROOM_ID_KEY },
                { $inc: { seq: step }, $set: { updatedAt: new Date() } },
                { new: true }
            ).lean();

            const candidateNum = Number(updated?.seq || (ROOM_ID_START + step));
            const candidateStr = String(candidateNum);

            const conflict = await Room.exists({ displayRoomId: candidateStr });
            if (!conflict) {
                return candidateStr;
            }
        }

        throw new Error('Failed to allocate unique Room Display ID after atomic retries');
    },

    /**
     * Generates a strictly unique User Numeric ID:
     * Starts from 120110109 (9-digit) and increments atomically by +25 to +45.
     */
    async getNextUserNumericId() {
        await ensureCounterInitialized(USER_ID_KEY, USER_ID_START, resolveMaxUserNumericId);

        for (let attempt = 0; attempt < 40; attempt++) {
            const step = randomStep(USER_STEP_MIN, USER_STEP_MAX);
            const updated = await SequenceCounter.findOneAndUpdate(
                { _id: USER_ID_KEY },
                { $inc: { seq: step }, $set: { updatedAt: new Date() } },
                { new: true }
            ).lean();

            const candidateNum = Number(updated?.seq || (USER_ID_START + step));
            const conflict = await User.exists({ numericId: candidateNum });
            if (!conflict) {
                return candidateNum;
            }
        }

        throw new Error('Failed to allocate unique User numericId after atomic retries');
    },

    /**
     * Wraps new User creation with E11000 duplicate-key retry safety on numericId.
     */
    async createUserWithUniqueId(buildUserDocFn) {
        let lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const numericId = await this.getNextUserNumericId();
            try {
                const userDoc = await buildUserDocFn(numericId);
                return userDoc;
            } catch (err) {
                const isNumericDup = err?.code === 11000 && err?.keyPattern?.numericId;
                if (!isNumericDup) throw err;
                lastErr = err;
            }
        }
        throw lastErr || new Error('Duplicate numericId retry limit exceeded');
    },

    /**
     * Wraps new Room creation with E11000 duplicate-key retry safety on displayRoomId.
     */
    async createRoomWithUniqueDisplayId(buildRoomDocFn) {
        let lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const displayRoomId = await this.getNextRoomDisplayId();
            try {
                const roomDoc = await buildRoomDocFn(displayRoomId);
                return roomDoc;
            } catch (err) {
                const isDisplayDup = err?.code === 11000 && err?.keyPattern?.displayRoomId;
                if (!isDisplayDup) throw err;
                lastErr = err;
            }
        }
        throw lastErr || new Error('Duplicate displayRoomId retry limit exceeded');
    },

    /**
     * Validates and checks uniqueness before Backend Admin updates a Room's displayRoomId.
     * Never modifies roomId or ownerUid.
     */
    async validateAdminRoomDisplayId(newDisplayRoomId, targetOwnerUid) {
        const clean = String(newDisplayRoomId || '').trim();
        if (!/^\d{5,9}$/.test(clean) || Number(clean) < ROOM_ID_START) {
            throw new Error(`Display Room ID must be a 5+ digit number starting from ${ROOM_ID_START}`);
        }
        const conflict = await Room.findOne({
            displayRoomId: clean,
            ownerUid: { $ne: String(targetOwnerUid || '').trim() }
        }).select('_id ownerUid').lean();
        if (conflict) {
            throw new Error(`Display Room ID ${clean} is already assigned to another room`);
        }
        return clean;
    },

    /**
     * Validates and checks uniqueness before Backend Admin updates a User's numericId.
     * Never modifies uid.
     */
    async validateAdminUserNumericId(newNumericId, targetUid) {
        const cleanNum = Number(newNumericId);
        if (!Number.isInteger(cleanNum) || cleanNum < 100000000) {
            throw new Error('User numericId must be a valid 9+ digit integer');
        }
        const conflict = await User.findOne({
            numericId: cleanNum,
            uid: { $ne: String(targetUid || '').trim() }
        }).select('_id uid').lean();
        if (conflict) {
            throw new Error(`User numericId ${cleanNum} is already assigned to another user`);
        }
        return cleanNum;
    }
};

module.exports = identityService;