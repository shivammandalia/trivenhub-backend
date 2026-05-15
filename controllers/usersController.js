const { usersDB, saveUsersDB } = require('../models/mockDB');

// Helper to remove password
const sanitizeUser = (u) => {
  const { password, ...rest } = u;
  return rest;
};

exports.getUsers = async (req, res) => {
  try {
    res.json(usersDB.map(sanitizeUser));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = usersDB.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const user = usersDB.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (['active', 'pending', 'banned', 'rejected'].includes(status)) {
      user.status = status;
      saveUsersDB();
      return res.json({ message: 'Status updated successfully', user: sanitizeUser(user) });
    }
    return res.status(400).json({ error: 'Invalid status' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const { role } = req.body;
    const user = usersDB.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (['customer', 'seller', 'vendor', 'admin'].includes(role)) {
      user.role = role;
      saveUsersDB();
      return res.json({ message: 'Role updated successfully', user: sanitizeUser(user) });
    }
    return res.status(400).json({ error: 'Invalid role' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.banUser = async (req, res) => {
  try {
    const user = usersDB.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.status = 'banned';
    saveUsersDB();
    return res.json({ message: 'User banned successfully', user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateOnline = async (req, res) => {
  try {
    const { online } = req.body;
    const user = usersDB.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    user.online = !!online;
    saveUsersDB();
    return res.json({ message: 'Online status updated', user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.syncUser = async (req, res) => {
  try {
    const { id, name, phone, role, status } = req.body;
    if (!phone && !id) return res.status(400).json({ error: 'Phone or ID required for sync' });

    // 1. Try finding by Phone first (prevents duplicates)
    let user = usersDB.find(u => u.phone === phone);
    
    // 2. Try finding by ID if phone not found
    if (!user && id) {
      user = usersDB.find(u => u.id === id);
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
      
      if (updated) saveUsersDB();
      return res.json({ message: 'User synced successfully', user: sanitizeUser(user) });
    }

    // 3. Create safe fallback user if doesn't exist
    const newId = id || `usr_${Math.random().toString(36).substring(2, 10)}`;
    const newUser = {
      id: newId,
      phone: phone || '',
      password: '', // Auto-synced users don't have backend passwords set via this route
      name: name || 'User',
      role: role || 'customer',
      status: status || 'active',
      online: true,
      createdAt: new Date().toISOString()
    };
    
    usersDB.push(newUser);
    saveUsersDB();
    return res.json({ message: 'User created successfully', user: sanitizeUser(newUser) });

  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
