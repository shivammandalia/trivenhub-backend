const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { usersDB, saveUsersDB } = require('../models/mockDB');

exports.register = async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;

    // Check if user exists
    const existingUser = usersDB.find(u => u.phone === phone);
    if (existingUser) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Determine status
    let status = 'active';
    if (role === 'reseller' || role === 'seller') {
      status = 'pending';
    }

    // Save user
    const newUser = {
      id: `u_${Date.now()}`,
      name,
      phone,
      password: hashedPassword,
      role: role === 'reseller' ? 'seller' : (role || 'customer'),
      status,
      createdAt: new Date().toISOString()
    };
    
    usersDB.push(newUser);
    saveUsersDB();

    // Return success without password
    const { password: _, ...userData } = newUser;
    
    res.status(201).json({
      message: 'Account created successfully',
      user: userData
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    // Find user
    const user = usersDB.find(u => u.phone === phone);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, role: user.role, status: user.status },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
