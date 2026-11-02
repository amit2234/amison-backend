const LevelService = require('../services/levelService');
const { uploadMediaStream } = require('../services/cloudinaryService');

class LevelController {
    /**
     * Get all levels across 4 categories (USER, ROOM, CP, SM)
     * GET /api/levels/all
     */
    static async getAllLevels(req, res) {
        try {
            const refresh = req.query.refresh === 'true';
            const levels = await LevelService.getAllLevels(refresh);
            const rules = await LevelService.getRules();
            return res.json({
                success: true,
                data: levels,
                rules
            });
        } catch (err) {
            console.error('❌ [LevelController] getAllLevels error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Get levels for a specific category
     * GET /api/levels?category=USER
     */
    static async getLevelsByCategory(req, res) {
        try {
            const category = req.query.category || 'USER';
            const levels = await LevelService.getLevelsByCategory(category);
            return res.json({
                success: true,
                category: category.toUpperCase(),
                count: levels.length,
                data: levels
            });
        } catch (err) {
            console.error('❌ [LevelController] getLevelsByCategory error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Get global XP conversion rules
     * GET /api/levels/rules
     */
    static async getLevelRules(req, res) {
        try {
            const rules = await LevelService.getRules();
            return res.json({
                success: true,
                data: rules
            });
        } catch (err) {
            console.error('❌ [LevelController] getLevelRules error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Upsert (Add / Edit) a level tier
     * POST /api/newop/levels/upsert
     */
    static async upsertLevel(req, res) {
        try {
            const body = req.body || {};
            let iconUrl = body.iconUrl || '';
            let cloudinaryPublicId = body.cloudinaryPublicId || '';

            // Handle optional image file upload directly through multipart
            if (req.files && (req.files.iconFile || req.files.image)) {
                const file = (req.files.iconFile && req.files.iconFile[0]) || (req.files.image && req.files.image[0]);
                if (file) {
                    const uploadRes = await uploadMediaStream(file.buffer, {
                        folder: 'amison/level_badges',
                        public_id: `level_${body.category || 'user'}_${body.levelNumber}_${Date.now()}`
                    });
                    iconUrl = uploadRes.secure_url;
                    cloudinaryPublicId = uploadRes.public_id;
                }
            }

            const roomPerks = typeof body.roomPerks === 'string'
                ? JSON.parse(body.roomPerks)
                : (body.roomPerks || {
                    adminCount: body.adminCount,
                    coAdminCount: body.coAdminCount,
                    passwordEnabled: body.passwordEnabled,
                    gamesEnabled: body.gamesEnabled,
                    rewardType: body.rewardType,
                    rewardUrl: body.rewardUrl
                });

            const levelData = {
                category: body.category,
                levelNumber: body.levelNumber,
                index: body.index,
                xpRequired: body.xpRequired,
                iconUrl,
                cloudinaryPublicId,
                badgeColor: body.badgeColor,
                roomPerks,
                isActive: body.isActive !== undefined ? (body.isActive === 'true' || body.isActive === true) : true
            };

            const updated = await LevelService.upsertLevel(levelData, req.adminUser ? req.adminUser.uid : 'admin');
            return res.json({
                success: true,
                message: `Level ${updated.levelId} saved successfully`,
                data: updated
            });
        } catch (err) {
            console.error('❌ [LevelController] upsertLevel error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * Delete a level tier
     * DELETE /api/newop/levels/delete/:id or POST /api/newop/levels/delete
     */
    static async deleteLevel(req, res) {
        try {
            const levelId = req.params.id || req.body.levelId || `${req.body.category}_${req.body.levelNumber}`;
            if (!levelId) {
                return res.status(400).json({ success: false, error: 'levelId is required' });
            }
            const deleted = await LevelService.deleteLevel(levelId);
            return res.json({
                success: true,
                message: `Level ${levelId} deleted successfully`,
                data: deleted
            });
        } catch (err) {
            console.error('❌ [LevelController] deleteLevel error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Update global XP conversion rules
     * POST /api/newop/levels/rules
     */
    static async updateRules(req, res) {
        try {
            const updated = await LevelService.updateRules(req.body);
            return res.json({
                success: true,
                message: 'Level rules updated successfully',
                data: updated
            });
        } catch (err) {
            console.error('❌ [LevelController] updateRules error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        }
    }

    /**
     * Seed default initial level tiers
     * POST /api/newop/levels/seed-defaults
     */
    static async seedDefaults(req, res) {
        try {
            await LevelService.seedDefaults();
            const allLevels = await LevelService.getAllLevels(true);
            return res.json({
                success: true,
                message: 'Default levels seeded successfully',
                data: allLevels
            });
        } catch (err) {
            console.error('❌ [LevelController] seedDefaults error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    /**
     * Calculate current level from XP
     * POST /api/levels/calculate
     */
    static async calculateLevel(req, res) {
        try {
            const xp = Number(req.body.xp || 0);
            const category = req.body.category || 'USER';
            const result = LevelService.calculateLevelFromXp(xp, category);
            return res.json({
                success: true,
                data: result
            });
        } catch (err) {
            console.error('❌ [LevelController] calculateLevel error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
}

module.exports = LevelController;