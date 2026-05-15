const { ordersDB, listingsDB, credentialsDB, usersDB, walletLedgerDB, adminSettingsDB, saveDB } = require('../models/mockDB');
const { calculateWallet } = require('./walletController');

// Helper to recalculate stock
const recalculateStock = (listingId) => {
  const listing = listingsDB.find(l => l.id === listingId);
  if (!listing) return;
  if (listing.deliveryType === 'auto') {
    const availableCreds = credentialsDB.filter(c => c.listingId === listingId && c.status === 'available');
    listing.stock = availableCreds.length;
    if (listing.stock <= 0) {
      listing.status = 'out_of_stock';
    } else if (listing.status === 'out_of_stock') {
      listing.status = 'active';
    }
  }
};

const releaseEscrow = (order) => {
  // Update purchase_hold to completed
  const holdEntry = walletLedgerDB.find(e => e.referenceId === order.id && e.type === 'purchase_hold');
  if (holdEntry) {
    holdEntry.status = 'completed';
    holdEntry.updatedAt = new Date().toISOString();
  }

  // Calculate fees and cashback
  const { platformFeePercent, cashbackPercent } = adminSettingsDB;
  const platformFee = (order.amount * platformFeePercent) / 100;
  const sellerEarning = order.amount - platformFee;
  const cashback = (order.amount * cashbackPercent) / 100;

  const now = new Date();
  const availableAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours later

  // 1. Seller Earning
  walletLedgerDB.push({
    id: `txn-${Date.now()}-1`,
    userId: order.sellerId,
    type: 'seller_earning',
    amount: sellerEarning,
    status: 'completed',
    referenceType: 'order',
    referenceId: order.id,
    label: `Earning from ${order.productName}`,
    createdAt: now.toISOString(),
    availableAt: availableAt
  });

  // 2. Platform Fee
  if (platformFee > 0) {
    walletLedgerDB.push({
      id: `txn-${Date.now()}-2`,
      userId: 'admin_1', // System admin
      type: 'platform_fee',
      amount: platformFee,
      status: 'completed',
      referenceType: 'order',
      referenceId: order.id,
      label: `Fee from ${order.productName}`,
      createdAt: now.toISOString(),
      availableAt: now.toISOString()
    });
  }

  // 3. Cashback
  if (cashback > 0) {
    walletLedgerDB.push({
      id: `txn-${Date.now()}-3`,
      userId: order.buyerId,
      type: 'cashback',
      amount: cashback,
      status: 'completed',
      referenceType: 'order',
      referenceId: order.id,
      label: `Cashback for ${order.productName}`,
      createdAt: now.toISOString(),
      availableAt: now.toISOString()
    });
  }
  
  saveDB('walletLedger');
};

exports.createOrder = async (req, res) => {
  try {
    const { buyerId, buyerPhone, buyerName, productId, amount } = req.body;
    const amountFloat = parseFloat(amount);

    const listing = listingsDB.find(l => l.id === productId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Validate Status
    if (listing.status !== 'active') return res.status(400).json({ error: 'Listing is not active' });

    // Check Wallet Balance
    const wallet = calculateWallet(buyerId);
    if (wallet.totalBalance < amountFloat) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    let credentials = [];
    let initialStatus = 'new';
    let otp = null;

    if (listing.deliveryType === 'auto') {
      if (listing.stock <= 0) return res.status(400).json({ error: 'Out of stock' });
      
      const availableCreds = credentialsDB.filter(c => c.listingId === productId && c.status === 'available');
      if (availableCreds.length === 0) return res.status(400).json({ error: 'Out of stock' });
      
      availableCreds.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const cred = availableCreds[0];
      
      cred.status = 'sold';
      recalculateStock(productId);
      
      saveDB('credentials');
      saveDB('listings');
      
      credentials = [{ loginId: cred.loginId, password: cred.password }];
      initialStatus = 'completed'; // direct to completed
    } else {
      const seller = usersDB.find(u => u.id === listing.sellerId || u.phone === listing.sellerId);
      if (!seller || !seller.online) {
        return res.status(400).json({ error: 'Seller is offline' });
      }
      initialStatus = 'pending';
    }

    const orderId = `ord-${Date.now()}`;

    // Create Purchase Hold
    walletLedgerDB.push({
      id: `txn-${Date.now()}-hold`,
      userId: buyerId,
      type: 'purchase_hold',
      amount: -amountFloat, // Negative to hold funds
      status: 'locked',
      referenceType: 'order',
      referenceId: orderId,
      label: `Payment for ${listing.productName}`,
      createdAt: new Date().toISOString(),
      availableAt: new Date().toISOString()
    });
    saveDB('walletLedger');

    const order = {
      id: orderId,
      buyerId,
      buyerPhone,
      buyerName,
      sellerId: listing.sellerId,
      sellerName: listing.sellerName,
      productId: listing.id,
      productName: listing.productName,
      productImage: listing.productImage,
      amount: amountFloat,
      deliveryType: listing.deliveryType,
      status: initialStatus,
      credentials,
      otp,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    ordersDB.push(order);
    saveDB('orders');

    // If auto, it instantly completed, so release escrow immediately
    if (initialStatus === 'completed') {
      releaseEscrow(order);
    }

    res.status(201).json({ message: 'Order created', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getOrders = async (req, res) => {
  try {
    const { buyerId, sellerId } = req.query;
    let results = [...ordersDB];
    
    if (buyerId) results = results.filter(o => o.buyerId === buyerId || o.buyerPhone === buyerId);
    if (sellerId) results = results.filter(o => o.sellerId === sellerId);
    
    // Sort descending by date
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = ordersDB.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, requesterId, otp } = req.body;
    const order = ordersDB.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isSeller = requesterId === order.sellerId || requesterId === order.sellerName; // Mock fallback
    const isBuyer = requesterId === order.buyerId || requesterId === order.buyerPhone || requesterId === order.buyerName;
    
    // State transitions validations
    if (status === 'accepted') {
      if (!isSeller) return res.status(403).json({ error: 'Only seller can accept' });
      if (order.status !== 'pending') return res.status(400).json({ error: 'Order is not pending' });
    }
    else if (status === 'otp_requested') {
      if (!isSeller) return res.status(403).json({ error: 'Only seller can request OTP' });
      if (order.status !== 'accepted') return res.status(400).json({ error: 'Order must be accepted first' });
    }
    else if (status === 'otp_submitted') {
      if (!isBuyer) return res.status(403).json({ error: 'Only buyer can submit OTP' });
      if (order.status !== 'otp_requested') return res.status(400).json({ error: 'OTP not requested' });
      if (!otp) return res.status(400).json({ error: 'OTP is required' });
      
      order.otp = otp; // Store it. Backend validates that OTP exists and buyer submitted it.
    }
    else if (status === 'delivered') {
      if (!isSeller) return res.status(403).json({ error: 'Only seller can deliver' });
      if (order.status !== 'otp_submitted') {
         return res.status(400).json({ error: 'OTP must be submitted by buyer before delivery' });
      }
    }
    else if (status === 'completed') {
      if (!isBuyer) return res.status(403).json({ error: 'Only buyer can mark completed' });
      if (order.status !== 'delivered') return res.status(400).json({ error: 'Order must be delivered first' });
      
      // Release Escrow!
      releaseEscrow(order);
    }
    else if (status === 'disputed') {
      // Just change status to disputed. Purchase hold remains locked. Admin will resolve.
    }
    else if (status === 'refunded') {
      // Refund Escrow
      const holdEntry = walletLedgerDB.find(e => e.referenceId === order.id && e.type === 'purchase_hold');
      if (holdEntry && holdEntry.status === 'locked') {
        // Mark hold as completed (permanently deducted) so the refund entry balances it out
        holdEntry.status = 'completed'; 
        
        walletLedgerDB.push({
          id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-refund`,
          userId: order.buyerId,
          type: 'refund',
          amount: Math.abs(holdEntry.amount), // Return money to buyer
          status: 'completed',
          referenceType: 'order',
          referenceId: order.id,
          label: `Refund for ${order.productName}`,
          createdAt: new Date().toISOString(),
          availableAt: new Date().toISOString()
        });
        saveDB('walletLedger');
      }
    }
    else {
      return res.status(400).json({ error: 'Invalid status' });
    }

    order.status = status;
    order.updatedAt = new Date().toISOString();
    
    saveDB('orders');
    res.json({ message: 'Order status updated', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.addMessage = async (req, res) => {
  try {
    const { from, text, time } = req.body;
    const order = ordersDB.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (!order.messages) order.messages = [];
    order.messages.push({
      id: Date.now(),
      from,
      text,
      time: time || 'Now'
    });
    
    order.updatedAt = new Date().toISOString();
    saveDB('orders');
    res.json({ message: 'Message added', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
