/**
 * Identity Sequence Constants
 * Centralized rules for 100% Backend-generated Room Display IDs and User Numeric IDs.
 */
module.exports = {
    // Room Display ID: 5-digit starting from 10000, +10 to +25 per new room
    ROOM_ID_KEY: 'room_display_id',
    ROOM_ID_START: 10000,
    ROOM_STEP_MIN: 10,
    ROOM_STEP_MAX: 25,

    // User Numeric ID: 9-digit starting from 120110109, +25 to +45 per new user
    USER_ID_KEY: 'user_numeric_id',
    USER_ID_START: 120110109,
    USER_STEP_MIN: 25,
    USER_STEP_MAX: 45
};