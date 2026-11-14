const mongoose = require('mongoose');

/**
 * SequenceCounter Model (sequence_counters collection)
 * Provides MongoDB atomic $inc counters so concurrent room/user creations
 * NEVER receive duplicate IDs.
 */
const sequenceCounterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, required: true },
    updatedAt: { type: Date, default: Date.now }
}, {
    collection: 'sequence_counters',
    versionKey: false
});

const SequenceCounter = mongoose.models.SequenceCounter
    || mongoose.model('SequenceCounter', sequenceCounterSchema);

module.exports = SequenceCounter;