const { User } = require('../models');

// Helper to remove password
const sanitizeUser = (u) => {
  if (u.toObject) u = u.toObject();
  const { password, _id, __v, ...rest } = u;
  return rest;
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({});
    res.json(users.map(sanitizeUser));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'pending', 'banned', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const user = await User.findOneAndUpdate(
      { id: req.params.id },
      { status },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    return res.json({ message: 'Status updated successfully', user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!['customer', 'seller', 'vendor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await User.findOneAndUpdate(
      { id: req.params.id },
      { role },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    return res.json({ message: 'Role updated successfully', user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.banUser = async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { id: req.params.id },
      { status: 'banned' },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    return res.json({ message: 'User banned successfully', user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateOnline = async (req, res) => {
  try {
    const { online } = req.body;
    const user = await User.findOneAndUpdate(
      { id: req.params.id },
      { online: !!online },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    return res.json({ message: 'Online status updated', user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.syncUser = async (req, res) => {
  try {
    const { id, name, phone, role, status } = req.body;
    if (!phone && !id) return res.status(400).json({ error: 'Phone or ID required for sync' });

    let user;
    if (phone) {
      user = await User.findOne({ phone });
    }
    if (!user && id) {
      user = await User.findOne({ id });
    }

    if (user) {
      // Update missing fields
      let updated = false;
      if (name && !user.name) { user.name = name; updated = true; }
      if (role && user.role === 'customer') { user.role = role; updated = true; }
      if (status && !user.status) { user.status = status; updated = true; }
      
      // Force online status on login/sync
      if (!user.online) {
        user.online = true;
        updated = true;
      }
      
      if (updated) {
        await user.save();
      }
      return res.json({ message: 'User synced successfully', user: sanitizeUser(user) });
    }

    // 3. Create safe fallback user if doesn't exist
    const newId = id || `usr_${Math.random().toString(36).substring(2, 10)}`;
    const newUser = await User.create({
      id: newId,
      phone: phone || '',
      password: '', // Auto-synced users don't have backend passwords set via this route
      name: name || 'User',
      role: role || 'customer',
      status: status || 'active',
      online: true
    });
    
    return res.json({ message: 'User created successfully', user: sanitizeUser(newUser) });

  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
