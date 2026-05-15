const { Order, Listing, Credential, User, WalletLedger, AdminSetting } = require('../models');
const { calculateWallet } = require('./walletController'); // Wait, calculateWallet uses mockDB. I need to make calculateWallet async or duplicate logic here.
// Actually, calculateWallet is imported from walletController, let me define an async version here or use DB aggregation.

// Helper to recalculate stock
const recalculateStock = async (listingId) => {
  const listing = await Listing.findOne({ id: listingId });
  if (!listing) return;
  if (listing.deliveryType === 'auto') {
    const availableCount = await Credential.countDocuments({ listingId, status: 'available' });
    listing.stock = availableCount;
    if (listing.stock <= 0) {
      listing.status = 'out_of_stock';
    } else if (listing.status === 'out_of_stock') {
      listing.status = 'active';
    }
    await listing.save();
  }
};

const releaseEscrow = async (order) => {
  // Update purchase_hold to completed
  const holdEntry = await WalletLedger.findOne({ referenceId: order.id, type: 'purchase_hold' });
  if (holdEntry) {
    holdEntry.status = 'completed';
    await holdEntry.save();
  }

  // Calculate fees and cashback
  const adminSettings = await AdminSetting.findOne({}) || { platformFeePercent: 0, cashbackPercent: 0 };
  const { platformFeePercent, cashbackPercent } = adminSettings;
  const platformFee = (order.amount * platformFeePercent) / 100;
  const sellerEarning = order.amount - platformFee;
  const cashback = (order.amount * cashbackPercent) / 100;

  const now = new Date();
  const availableAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours later

  // 1. Seller Earning
  await WalletLedger.create({
    id: `txn-${Date.now()}-1`,
    userId: order.sellerId,
    type: 'seller_earning',
    amount: sellerEarning,
    status: 'completed',
    referenceType: 'order',
    referenceId: order.id,
    label: `Earning from ${order.productName}`,
    availableAt: availableAt
  });

  // 2. Platform Fee
  if (platformFee > 0) {
    await WalletLedger.create({
      id: `txn-${Date.now()}-2`,
      userId: 'admin_1', // System admin
      type: 'platform_fee',
      amount: platformFee,
      status: 'completed',
      referenceType: 'order',
      referenceId: order.id,
      label: `Fee from ${order.productName}`,
      availableAt: now
    });
  }

  // 3. Cashback
  if (cashback > 0) {
    await WalletLedger.create({
      id: `txn-${Date.now()}-3`,
      userId: order.buyerId,
      type: 'cashback',
      amount: cashback,
      status: 'completed',
      referenceType: 'order',
      referenceId: order.id,
      label: `Cashback for ${order.productName}`,
      availableAt: now
    });
  }
};

exports.createOrder = async (req, res) => {
  try {
    const { buyerId, buyerPhone, buyerName, productId, amount } = req.body;
    const amountFloat = parseFloat(amount);

    const listing = await Listing.findOne({ id: productId });
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Validate Status
    if (listing.status !== 'active') return res.status(400).json({ error: 'Listing is not active' });

    // Check Wallet Balance directly using Mongoose Aggregation
    const ledger = await WalletLedger.find({ userId: buyerId, status: 'completed' });
    const holdLedger = await WalletLedger.find({ userId: buyerId, status: 'locked' });
    
    let deposits = 0, earnings = 0, cashback = 0, withdrawals = 0, holds = 0;
    
    ledger.forEach(t => {
      if (t.type === 'deposit') deposits += t.amount;
      if (t.type === 'seller_earning') earnings += t.amount;
      if (t.type === 'cashback') cashback += t.amount;
      if (t.type === 'withdrawal') withdrawals += Math.abs(t.amount);
      if (t.type === 'refund') deposits += t.amount;
    });
    holdLedger.forEach(t => {
      if (t.type === 'purchase_hold') holds += Math.abs(t.amount);
      if (t.type === 'withdrawal_hold') holds += Math.abs(t.amount);
    });

    const totalBalance = (deposits + earnings + cashback) - (withdrawals + holds);

    if (totalBalance < amountFloat) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    let credentials = [];
    let initialStatus = 'new';
    let otp = null;

    if (listing.deliveryType === 'auto') {
      if (listing.stock <= 0) return res.status(400).json({ error: 'Out of stock' });
      
      const availableCred = await Credential.findOne({ listingId: productId, status: 'available' }).sort({ createdAt: 1 });
      if (!availableCred) return res.status(400).json({ error: 'Out of stock' });
      
      availableCred.status = 'sold';
      await availableCred.save();
      await recalculateStock(productId);
      
      credentials = [{ loginId: availableCred.loginId, password: availableCred.password }];
      initialStatus = 'completed'; // direct to completed
    } else {
      const seller = await User.findOne({ $or: [{ id: listing.sellerId }, { phone: listing.sellerId }] });
      if (!seller || !seller.online) {
        return res.status(400).json({ error: 'Seller is offline' });
      }
      initialStatus = 'pending';
    }

    const orderId = `ord-${Date.now()}`;

    // Create Purchase Hold
    await WalletLedger.create({
      id: `txn-${Date.now()}-hold`,
      userId: buyerId,
      type: 'purchase_hold',
      amount: -amountFloat, // Negative to hold funds
      status: 'locked',
      referenceType: 'order',
      referenceId: orderId,
      label: `Payment for ${listing.productName}`,
      availableAt: new Date()
    });

    const newOrder = await Order.create({
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
      messages: []
    });

    // If auto, it instantly completed, so release escrow immediately
    if (initialStatus === 'completed') {
      await releaseEscrow(newOrder);
    }

    res.status(201).json({ message: 'Order created', order: newOrder.toObject() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getOrders = async (req, res) => {
  try {
    const { buyerId, sellerId } = req.query;
    const query = {};
    if (buyerId) query.$or = [{ buyerId }, { buyerPhone: buyerId }];
    if (sellerId) query.sellerId = sellerId;
    
    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ id: req.params.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, requesterId, otp } = req.body;
    const order = await Order.findOne({ id: req.params.id });
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
      
      order.otp = otp; // Store it
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
      await releaseEscrow(order);
    }
    else if (status === 'disputed') {
      // Just change status to disputed. Purchase hold remains locked. Admin will resolve.
    }
    else if (status === 'refunded') {
      // Refund Escrow
      const holdEntry = await WalletLedger.findOne({ referenceId: order.id, type: 'purchase_hold' });
      if (holdEntry && holdEntry.status === 'locked') {
        holdEntry.status = 'completed'; 
        await holdEntry.save();
        
        await WalletLedger.create({
          id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-refund`,
          userId: order.buyerId,
          type: 'refund',
          amount: Math.abs(holdEntry.amount), // Return money to buyer
          status: 'completed',
          referenceType: 'order',
          referenceId: order.id,
          label: `Refund for ${order.productName}`,
          availableAt: new Date()
        });
      }
    }
    else {
      return res.status(400).json({ error: 'Invalid status' });
    }

    order.status = status;
    await order.save();
    
    res.json({ message: 'Order status updated', order: order.toObject() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.addMessage = async (req, res) => {
  try {
    const { from, text, time } = req.body;
    const order = await Order.findOne({ id: req.params.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    order.messages.push({
      id: Date.now() + '-' + Math.floor(Math.random() * 1000000),
      from,
      text,
      time: time || 'Now'
    });
    
    await order.save();
    res.json({ message: 'Message added', order: order.toObject() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
