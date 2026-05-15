const { usersDB, walletLedgerDB, adminAuditDB, listingsDB, credentialsDB, ordersDB, saveDB } = require('../models/mockDB');
const uuidv4 = () => Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

const logAudit = (adminId, actionType, targetUserId, targetOrderId, amount, note) => {
  adminAuditDB.push({
    id: uuidv4(),
    adminId,
    actionType,
    targetUserId,
    targetOrderId,
    amount,
    note,
    createdAt: new Date().toISOString()
  });
  saveDB('adminAudit');
};

exports.addBalance = async (req, res) => {
  try {
    const { targetUserId, amount, note, adminId } = req.body;
    if (!targetUserId || !amount || !note || !adminId) return res.status(400).json({ error: 'Missing required fields' });
    
    const user = usersDB.find(u => u.id === targetUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    walletLedgerDB.push({
      id: uuidv4(),
      userId: targetUserId,
      type: 'manual_adjustment',
      amount: parseFloat(amount),
      status: 'completed',
      referenceType: 'admin',
      createdAt: new Date().toISOString(),
      availableAt: new Date().toISOString()
    });
    saveDB('walletLedger');

    logAudit(adminId, 'add_balance', targetUserId, null, amount, note);
    res.json({ message: 'Balance added successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deductBalance = async (req, res) => {
  try {
    const { targetUserId, amount, note, adminId } = req.body;
    if (!targetUserId || !amount || !note || !adminId) return res.status(400).json({ error: 'Missing required fields' });
    
    const user = usersDB.find(u => u.id === targetUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    walletLedgerDB.push({
      id: uuidv4(),
      userId: targetUserId,
      type: 'manual_adjustment',
      amount: -parseFloat(amount),
      status: 'completed',
      referenceType: 'admin',
      createdAt: new Date().toISOString(),
      availableAt: new Date().toISOString()
    });
    saveDB('walletLedger');

    logAudit(adminId, 'deduct_balance', targetUserId, null, amount, note);
    res.json({ message: 'Balance deducted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.freezeUser = async (req, res) => {
  try {
    const { targetUserId, note, adminId, actionType } = req.body; // actionType = 'frozen' | 'banned'
    if (!targetUserId || !note || !adminId || !actionType) return res.status(400).json({ error: 'Missing required fields' });

    const user = usersDB.find(u => u.id === targetUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.status = actionType;
    saveDB('users');
    logAudit(adminId, `set_status_${actionType}`, targetUserId, null, null, note);
    res.json({ message: `User ${actionType} successfully` });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.broadcast = async (req, res) => {
  try {
    const { message, adminId } = req.body;
    if (!message || !adminId) return res.status(400).json({ error: 'Missing required fields' });
    
    // In a real app we'd broadcast to a notificationsDB or via Socket.io
    // For mock, we'll just audit it.
    logAudit(adminId, 'broadcast', null, null, null, message);
    res.json({ message: 'Broadcast sent successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── SEED DATA ROUTES ──

exports.seedListing = async (req, res) => {
  try {
    const { sellerId, productName, description, price, deliveryType, stock, adminId } = req.body;
    if (!sellerId || !productName || !price) return res.status(400).json({ error: 'Missing fields' });

    const seller = usersDB.find(u => u.id === sellerId);
    if (!seller) return res.status(404).json({ error: 'Seller not found' });
    
    // Auto mark online
    seller.online = true;
    saveDB('users');

    const newListing = {
      id: uuidv4(),
      sellerId,
      productName,
      description: description || 'Seed listing',
      price: parseFloat(price),
      deliveryType: deliveryType || 'manual',
      status: 'active',
      stock: parseInt(stock) || 0,
      createdAt: new Date().toISOString()
    };
    listingsDB.push(newListing);
    saveDB('listings');

    logAudit(adminId, 'seed_listing', sellerId, null, price, `Created listing: ${productName}`);
    res.json({ message: 'Listing seeded successfully', listing: newListing });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.seedCredentials = async (req, res) => {
  try {
    const { listingId, credentialsList, adminId } = req.body;
    // credentialsList is array of { loginId, password }
    if (!listingId || !credentialsList || !adminId) return res.status(400).json({ error: 'Missing fields' });

    const listing = listingsDB.find(l => l.id === listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    credentialsList.forEach(cred => {
      credentialsDB.push({
        id: uuidv4(),
        listingId,
        loginId: cred.loginId,
        password: cred.password,
        status: 'available',
        createdAt: new Date().toISOString()
      });
    });

    listing.stock += credentialsList.length;
    saveDB('credentials');
    saveDB('listings');

    logAudit(adminId, 'seed_credentials', listing.sellerId, null, null, `Seeded ${credentialsList.length} credentials for ${listingId}`);
    res.json({ message: 'Credentials seeded successfully', stock: listing.stock });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

const { releaseEscrow } = require('./ordersController');

exports.forceCompleteOrder = async (req, res) => {
  try {
    const { orderId, note, adminId } = req.body;
    if (!orderId || !note || !adminId) return res.status(400).json({ error: 'Missing fields' });

    const order = ordersDB.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'refunded') {
      return res.status(400).json({ error: 'Order already finalized' });
    }

    order.status = 'completed';
    saveDB('orders');
    await releaseEscrow(order); // This triggers saveDB('walletLedger') internally

    logAudit(adminId, 'force_complete', null, orderId, order.amount, note);
    res.json({ message: 'Order force completed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.forceRefundOrder = async (req, res) => {
  try {
    const { orderId, note, adminId } = req.body;
    if (!orderId || !note || !adminId) return res.status(400).json({ error: 'Missing fields' });

    const order = ordersDB.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'refunded') {
      return res.status(400).json({ error: 'Order already finalized' });
    }

    order.status = 'refunded';
    saveDB('orders');
    
    // Unlock purchase hold
    const holdTx = walletLedgerDB.find(e => e.referenceId === order.id && e.type === 'purchase_hold');
    if (holdTx) holdTx.status = 'completed';

    walletLedgerDB.push({
      id: uuidv4(),
      userId: order.buyerId,
      type: 'refund',
      amount: order.amount,
      status: 'completed',
      referenceType: 'order',
      referenceId: order.id,
      createdAt: new Date().toISOString(),
      availableAt: new Date().toISOString()
    });
    saveDB('walletLedger');

    logAudit(adminId, 'force_refund', order.buyerId, orderId, order.amount, note);
    res.json({ message: 'Order force refunded successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.createManualOrder = async (req, res) => {
  try {
    const { buyerId, sellerId, productName, amount, adminId, note } = req.body;
    if (!buyerId || !sellerId || !productName || !amount || !adminId) return res.status(400).json({ error: 'Missing fields' });

    const newOrder = {
      id: uuidv4(),
      buyerId,
      sellerId,
      productName,
      amount: parseFloat(amount),
      status: 'pending',
      deliveryType: 'manual',
      createdAt: new Date().toISOString()
    };
    ordersDB.push(newOrder);
    saveDB('orders');

    logAudit(adminId, 'create_manual_order', buyerId, newOrder.id, amount, note || 'Admin spawned mock order');
    res.json({ message: 'Mock order created', order: newOrder });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
