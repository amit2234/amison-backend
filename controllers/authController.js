const User = require('../models/User');
exports.loginUser = async (req, res) => {
  try {
    let user = await User.findOne({ userId: req.body.userId });
    if (!user) user = await User.create(req.body);
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
};
