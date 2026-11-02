const LevelConfig = require('../models/LevelConfig');
const LevelRule = require('../models/LevelRule');

// Local in-memory cache fallback for instant 0ms access
let memoryLevelCache = null;
let memoryRulesCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

class LevelService {
    /**
     * Invalidate cached level tiers and rules
     */
    static invalidateCache() {
        memoryLevelCache = null;
        memoryRulesCache = null;
        lastCacheTime = 0;
        console.log('🧹 [LevelService] In-memory level cache purged');
    }

    /**
     * Get all levels grouped by category { USER: [...], ROOM: [...], CP: [...], SM: [...] }
     */
    static async getAllLevels(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && memoryLevelCache && (now - lastCacheTime < CACHE_TTL_MS)) {
            return memoryLevelCache;
        }

        try {
            const allItems = await LevelConfig.find({ isActive: true }).sort({ levelNumber: 1 }).lean();
            
            // If completely empty, auto-seed default tiers
            if (!allItems || allItems.length === 0) {
                console.log('🌱 [LevelService] No level tiers found. Auto-seeding initial defaults...');
                await this.seedDefaults();
                const reloaded = await LevelConfig.find({ isActive: true }).sort({ levelNumber: 1 }).lean();
                return this.groupLevelsByCategory(reloaded);
            }

            const grouped = this.groupLevelsByCategory(allItems);
            memoryLevelCache = grouped;
            lastCacheTime = now;
            return grouped;
        } catch (err) {
            console.error('❌ [LevelService] Failed to load levels:', err.message);
            return memoryLevelCache || { USER: [], ROOM: [], CP: [], SM: [] };
        }
    }

    static groupLevelsByCategory(items) {
        const result = {
            USER: [],
            ROOM: [],
            CP: [],
            SM: []
        };
        for (const item of items) {
            const cat = item.category ? item.category.toUpperCase() : 'USER';
            if (!result[cat]) result[cat] = [];
            result[cat].push(item);
        }
        return result;
    }

    /**
     * Get levels for a specific category
     */
    static async getLevelsByCategory(category) {
        const cleanCat = (category || 'USER').toUpperCase();
        const all = await this.getAllLevels();
        return all[cleanCat] || [];
    }

    /**
     * Upsert a level configuration
     */
    static async upsertLevel(data, adminUser = 'admin') {
        const category = (data.category || 'USER').toUpperCase();
        const levelNumber = parseInt(data.levelNumber, 10);
        if (isNaN(levelNumber) || levelNumber < 0) {
            throw new Error('Valid levelNumber >= 0 is required');
        }

        const xpRequired = parseInt(data.xpRequired, 10);
        if (isNaN(xpRequired) || xpRequired < 0) {
            throw new Error('Valid xpRequired >= 0 is required');
        }

        const levelId = `${category}_${levelNumber}`;

        const updatePayload = {
            levelId,
            category,
            levelNumber,
            index: data.index || (levelNumber + 1),
            xpRequired,
            iconUrl: data.iconUrl || '',
            cloudinaryPublicId: data.cloudinaryPublicId || '',
            badgeColor: data.badgeColor || '#8B5CF6',
            isActive: data.isActive !== undefined ? data.isActive : true,
            updatedBy: adminUser
        };

        if (category === 'ROOM' && data.roomPerks) {
            updatePayload.roomPerks = {
                adminCount: parseInt(data.roomPerks.adminCount || 3, 10),
                coAdminCount: parseInt(data.roomPerks.coAdminCount || 0, 10),
                passwordEnabled: !!data.roomPerks.passwordEnabled,
                gamesEnabled: !!data.roomPerks.gamesEnabled,
                rewardType: data.roomPerks.rewardType || 'None',
                rewardUrl: data.roomPerks.rewardUrl || ''
            };
        }

        const updated = await LevelConfig.findOneAndUpdate(
            { levelId },
            { $set: updatePayload },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        this.invalidateCache();
        return updated;
    }

    /**
     * Delete a level tier
     */
    static async deleteLevel(levelId) {
        const result = await LevelConfig.findOneAndDelete({ levelId });
        this.invalidateCache();
        return result;
    }

    /**
     * Get global level conversion rules
     */
    static async getRules() {
        if (memoryRulesCache) return memoryRulesCache;
        let rules = await LevelRule.findOne({ ruleKey: 'GLOBAL_LEVEL_RULES' }).lean();
        if (!rules) {
            rules = await LevelRule.create({ ruleKey: 'GLOBAL_LEVEL_RULES' });
        }
        memoryRulesCache = rules;
        return rules;
    }

    /**
     * Update global level rules
     */
    static async updateRules(data) {
        const updateData = {};
        if (data.userXpPerCoinSpent !== undefined) updateData.userXpPerCoinSpent = Number(data.userXpPerCoinSpent);
        if (data.userXpPerCoinReceived !== undefined) updateData.userXpPerCoinReceived = Number(data.userXpPerCoinReceived);
        if (data.roomXpPerCoinSpent !== undefined) updateData.roomXpPerCoinSpent = Number(data.roomXpPerCoinSpent);
        if (data.cpXpPerCoinSent !== undefined) updateData.cpXpPerCoinSent = Number(data.cpXpPerCoinSent);
        if (data.dailyXpCap !== undefined) updateData.dailyXpCap = Number(data.dailyXpCap);
        if (data.isLiveEnabled !== undefined) updateData.isLiveEnabled = !!data.isLiveEnabled;

        const updated = await LevelRule.findOneAndUpdate(
            { ruleKey: 'GLOBAL_LEVEL_RULES' },
            { $set: updateData },
            { upsert: true, new: true }
        );
        memoryRulesCache = updated;
        return updated;
    }

    /**
     * Auto-seed default initial levels for instant usability
     */
    static async seedDefaults() {
        const initialUserXp = [
            0, 500, 1500, 3500, 7500, 15000, 30000, 60000, 120000, 250000,
            500000, 1000000, 2000000, 4000000, 8000000, 15000000, 30000000, 60000000, 120000000, 250000000
        ];

        const initialRoomXp = [
            0, 100000, 300000, 700000, 1500000, 3000000, 6000000, 12000000, 25000000, 50000000
        ];

        const initialCpXp = [
            0, 10000, 30000, 70000, 150000, 300000, 600000, 1200000, 2500000, 5000000
        ];

        const initialSmXp = [
            0, 20000, 60000, 140000, 300000, 600000, 1200000, 2500000, 5000000, 10000000
        ];

        const operations = [];

        // Seed USER levels 1 to 20
        initialUserXp.forEach((xp, i) => {
            const lvl = i + 1;
            operations.push({
                updateOne: {
                    filter: { levelId: `USER_${lvl}` },
                    update: {
                        $setOnInsert: {
                            levelId: `USER_${lvl}`,
                            category: 'USER',
                            levelNumber: lvl,
                            index: lvl,
                            xpRequired: xp,
                            badgeColor: '#8B5CF6',
                            isActive: true
                        }
                    },
                    upsert: true
                }
            });
        });

        // Seed ROOM levels 1 to 10
        initialRoomXp.forEach((xp, i) => {
            const lvl = i + 1;
            operations.push({
                updateOne: {
                    filter: { levelId: `ROOM_${lvl}` },
                    update: {
                        $setOnInsert: {
                            levelId: `ROOM_${lvl}`,
                            category: 'ROOM',
                            levelNumber: lvl,
                            index: lvl,
                            xpRequired: xp,
                            roomPerks: {
                                adminCount: Math.min(10, 3 + Math.floor(lvl / 2)),
                                coAdminCount: Math.floor(lvl / 3),
                                passwordEnabled: lvl >= 3,
                                gamesEnabled: lvl >= 2,
                                rewardType: lvl >= 5 ? 'Frame' : 'None'
                            },
                            isActive: true
                        }
                    },
                    upsert: true
                }
            });
        });

        // Seed CP levels 1 to 10
        initialCpXp.forEach((xp, i) => {
            const lvl = i + 1;
            operations.push({
                updateOne: {
                    filter: { levelId: `CP_${lvl}` },
                    update: {
                        $setOnInsert: {
                            levelId: `CP_${lvl}`,
                            category: 'CP',
                            levelNumber: lvl,
                            index: lvl,
                            xpRequired: xp,
                            badgeColor: '#EC4899',
                            isActive: true
                        }
                    },
                    upsert: true
                }
            });
        });

        // Seed SM levels 1 to 10
        initialSmXp.forEach((xp, i) => {
            const lvl = i + 1;
            operations.push({
                updateOne: {
                    filter: { levelId: `SM_${lvl}` },
                    update: {
                        $setOnInsert: {
                            levelId: `SM_${lvl}`,
                            category: 'SM',
                            levelNumber: lvl,
                            index: lvl,
                            xpRequired: xp,
                            badgeColor: '#F59E0B',
                            isActive: true
                        }
                    },
                    upsert: true
                }
            });
        });

        if (operations.length > 0) {
            await LevelConfig.bulkWrite(operations);
        }
        await this.getRules();
        this.invalidateCache();
        console.log('✅ [LevelService] Default levels successfully initialized in MongoDB');
    }

    /**
     * Binary Search level from current XP
     */
    static calculateLevelFromXp(xp, category = 'USER') {
        const cat = category.toUpperCase();
        const tiers = (memoryLevelCache && memoryLevelCache[cat]) ? memoryLevelCache[cat] : [];
        if (!tiers || tiers.length === 0) {
            return { levelNumber: 1, currentXp: xp, nextLevelXp: 1000, progress: 0 };
        }

        let current = tiers[0];
        let next = null;

        for (let i = 0; i < tiers.length; i++) {
            if (xp >= tiers[i].xpRequired) {
                current = tiers[i];
                next = tiers[i + 1] || null;
            } else {
                break;
            }
        }

        const prevXp = current.xpRequired;
        const targetXp = next ? next.xpRequired : current.xpRequired;
        const progress = next && targetXp > prevXp ? Math.min(1.0, (xp - prevXp) / (targetXp - prevXp)) : 1.0;

        return {
            levelNumber: current.levelNumber,
            iconUrl: current.iconUrl,
            currentXp: xp,
            nextLevelXp: targetXp,
            progress: progress,
            roomPerks: current.roomPerks || null
        };
    }
}

module.exports = LevelService;