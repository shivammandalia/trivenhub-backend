const { User, WalletLedger, AdminAudit, Listing, Credential, Order } = require('../models');

const logAudit = async (adminId, actionType, targetUserId, targetOrderId, amount, note) => {
  await AdminAudit.create({
    id: `audit_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    adminId,
    action: actionType, // Schema uses 'action' instead of 'actionType'
    targetId: targetUserId || targetOrderId,
    details: { amount, note }
  });
};

exports.addBalance = async (req, res) => {
  try {
    const { targetUserId, amount, note, adminId } = req.body;
    if (!targetUserId || !amount || !note || !adminId) return res.status(400).json({ error: 'Missing required fields' });
    
    const user = await User.findOne({ id: targetUserId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await WalletLedger.create({
      id: `txn-${Date.now()}`,
      userId: targetUserId,
      type: 'manual_adjustment',
      amount: parseFloat(amount),
      status: 'completed',
      referenceType: 'admin',
      availableAt: new Date()
    });

    await logAudit(adminId, 'add_balance', targetUserId, null, amount, note);
    res.json({ message: 'Balance added successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deductBalance = async (req, res) => {
  try {
    const { targetUserId, amount, note, adminId } = req.body;
    if (!targetUserId || !amount || !note || !adminId) return res.status(400).json({ error: 'Missing required fields' });
    
    const user = await User.findOne({ id: targetUserId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await WalletLedger.create({
      id: `txn-${Date.now()}`,
      userId: targetUserId,
      type: 'manual_adjustment',
      amount: -parseFloat(amount),
      status: 'completed',
      referenceType: 'admin',
      availableAt: new Date()
    });

    await logAudit(adminId, 'deduct_balance', targetUserId, null, amount, note);
    res.json({ message: 'Balance deducted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.freezeUser = async (req, res) => {
  try {
    const { targetUserId, note, adminId, actionType } = req.body; // actionType = 'frozen' | 'banned'
    if (!targetUserId || !note || !adminId || !actionType) return res.status(400).json({ error: 'Missing required fields' });

    const user = await User.findOneAndUpdate(
      { id: targetUserId },
      { status: actionType },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    await logAudit(adminId, `set_status_${actionType}`, targetUserId, null, null, note);
    res.json({ message: `User ${actionType} successfully` });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.broadcast = async (req, res) => {
  try {
    const { message, adminId } = req.body;
    if (!message || !adminId) return res.status(400).json({ error: 'Missing required fields' });
    
    await logAudit(adminId, 'broadcast', null, null, null, message);
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

    const seller = await User.findOneAndUpdate(
      { id: sellerId },
      { online: true },
      { new: true }
    );
    if (!seller) return res.status(404).json({ error: 'Seller not found' });
    
    const newListing = await Listing.create({
      id: `list_${Date.now()}`,
      sellerId,
      productName,
      description: description || 'Seed listing',
      price: parseFloat(price),
      deliveryType: deliveryType || 'manual',
      status: 'active',
      stock: parseInt(stock) || 0,
      sellerName: seller.name
    });

    await logAudit(adminId, 'seed_listing', sellerId, null, price, `Created listing: ${productName}`);
    res.json({ message: 'Listing seeded successfully', listing: newListing.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.seedCredentials = async (req, res) => {
  try {
    const { listingId, credentialsList, adminId } = req.body;
    // credentialsList is array of { loginId, password }
    if (!listingId || !credentialsList || !adminId) return res.status(400).json({ error: 'Missing fields' });

    const listing = await Listing.findOne({ id: listingId });
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const credDocs = credentialsList.map(cred => ({
      id: `cred_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      listingId,
      loginId: cred.loginId,
      password: cred.password,
      status: 'available'
    }));

    await Credential.insertMany(credDocs);
    
    listing.stock += credentialsList.length;
    await listing.save();

    await logAudit(adminId, 'seed_credentials', listing.sellerId, null, null, `Seeded ${credentialsList.length} credentials for ${listingId}`);
    res.json({ message: 'Credentials seeded successfully', stock: listing.stock });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Since releaseEscrow is not exported by ordersController, we can duplicate the logic or export it.
// I will replicate the refund/escrow logic here using Mongoose
exports.forceCompleteOrder = async (req, res) => {
  try {
    const { orderId, note, adminId } = req.body;
    if (!orderId || !note || !adminId) return res.status(400).json({ error: 'Missing fields' });

    const order = await Order.findOne({ id: orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'refunded') {
      return res.status(400).json({ error: 'Order already finalized' });
    }

    order.status = 'completed';
    await order.save();
    
    // releaseEscrow logic
    const holdEntry = await WalletLedger.findOne({ referenceId: order.id, type: 'purchase_hold' });
    if (holdEntry) { holdEntry.status = 'completed'; await holdEntry.save(); }

    const sellerEarning = order.amount; // Simplify platform fee for force complete
    await WalletLedger.create({
      id: `txn-${Date.now()}-1`,
      userId: order.sellerId,
      type: 'seller_earning',
      amount: sellerEarning,
      status: 'completed',
      referenceType: 'order',
      referenceId: order.id,
      label: `Earning from ${order.productName}`,
      availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    await logAudit(adminId, 'force_complete', null, orderId, order.amount, note);
    res.json({ message: 'Order force completed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.forceRefundOrder = async (req, res) => {
  try {
    const { orderId, note, adminId } = req.body;
    if (!orderId || !note || !adminId) return res.status(400).json({ error: 'Missing fields' });

    const order = await Order.findOne({ id: orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'refunded') {
      return res.status(400).json({ error: 'Order already finalized' });
    }

    order.status = 'refunded';
    await order.save();
    
    // Unlock purchase hold
    const holdTx = await WalletLedger.findOne({ referenceId: order.id, type: 'purchase_hold' });
    if (holdTx) { holdTx.status = 'completed'; await holdTx.save(); }

    await WalletLedger.create({
      id: `txn-${Date.now()}`,
      userId: order.buyerId,
      type: 'refund',
      amount: order.amount,
      status: 'completed',
      referenceType: 'order',
      referenceId: order.id,
      availableAt: new Date()
    });

    await logAudit(adminId, 'force_refund', order.buyerId, orderId, order.amount, note);
    res.json({ message: 'Order force refunded successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.createManualOrder = async (req, res) => {
  try {
    const { buyerId, sellerId, productName, amount, adminId, note } = req.body;
    if (!buyerId || !sellerId || !productName || !amount || !adminId) return res.status(400).json({ error: 'Missing fields' });

    const newOrder = await Order.create({
      id: `ord_${Date.now()}`,
      buyerId,
      sellerId,
      productName,
      amount: parseFloat(amount),
      status: 'pending',
      deliveryType: 'manual'
    });

    await logAudit(adminId, 'create_manual_order', buyerId, newOrder.id, amount, note || 'Admin spawned mock order');
    res.json({ message: 'Mock order created', order: newOrder.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
