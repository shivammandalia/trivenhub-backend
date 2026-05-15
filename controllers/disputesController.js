const { Dispute, Order, User, WalletLedger, AdminSetting } = require('../models');

// Helper to get user info
const getUserInfo = async (userId) => {
  const u = await User.findOne({ $or: [{ id: userId }, { phone: userId }] });
  return u ? { name: u.name, phone: u.phone } : { name: 'Unknown', phone: userId };
};

exports.createDispute = async (req, res) => {
  try {
    const { orderId, raisedBy, reason, proofImage } = req.body;
    
    const order = await Order.findOne({ id: orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (order.status === 'completed' || order.status === 'refunded') {
      return res.status(400).json({ error: `Cannot dispute a ${order.status} order` });
    }

    if (order.status === 'disputed') {
      return res.status(400).json({ error: 'Order is already disputed' });
    }

    const buyerInfo = await getUserInfo(order.buyerId);
    const sellerInfo = await getUserInfo(order.sellerId);

    // Create dispute
    const dispute = await Dispute.create({
      id: `disp-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      orderId: order.id,
      raisedBy,
      reason,
      status: 'open'
    });

    // Update order status
    order.status = 'disputed';
    await order.save();

    res.status(201).json({ message: 'Dispute raised successfully', dispute: dispute.toObject(), order: order.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getDisputes = async (req, res) => {
  try {
    // Return all disputes
    const disputes = await Dispute.find({}).sort({ createdAt: -1 });
    
    // The mockDB dispute had a lot of extra fields not strictly in schema, 
    // let's fetch order details to enrich it like before
    const enriched = [];
    for(const d of disputes) {
      const order = await Order.findOne({ id: d.orderId });
      let extra = {};
      if (order) {
        extra = {
          productName: order.productName,
          amount: order.amount,
          buyerId: order.buyerId,
          buyerName: order.buyerName || 'Unknown',
          sellerId: order.sellerId,
          sellerName: order.sellerName || 'Unknown',
        };
      }
      enriched.push({ ...d.toObject(), ...extra });
    }

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getDisputeById = async (req, res) => {
  try {
    const dispute = await Dispute.findOne({ id: req.params.id });
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    res.json(dispute);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.resolveDispute = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution, adminNote, buyerRefundAmount } = req.body;
    
    const dispute = await Dispute.findOne({ id });
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    
    if (dispute.status !== 'open') {
      return res.status(400).json({ error: `Dispute is already ${dispute.status}` });
    }

    const order = await Order.findOne({ id: dispute.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Validate resolution types
    if (!['buyer_win', 'seller_win', 'partial'].includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution type' });
    }

    const orderAmount = order.amount;
    let refundAmount = 0;

    if (resolution === 'buyer_win') {
      refundAmount = orderAmount;
      order.status = 'refunded';
    } else if (resolution === 'seller_win') {
      refundAmount = 0;
      order.status = 'completed';
    } else if (resolution === 'partial') {
      refundAmount = parseFloat(buyerRefundAmount);
      if (isNaN(refundAmount) || refundAmount < 0 || refundAmount > orderAmount) {
        return res.status(400).json({ error: 'Invalid buyerRefundAmount' });
      }
      order.status = 'completed';
    }

    // Handle Escrow unlocking
    const holdEntry = await WalletLedger.findOne({ referenceId: order.id, type: 'purchase_hold' });
    if (holdEntry && holdEntry.status === 'locked') {
      holdEntry.status = 'completed';
      await holdEntry.save();
    }

    const now = new Date();
    // 24-hour lock for seller earnings
    const availableAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // 1. REFUND BUYER
    if (refundAmount > 0) {
      await WalletLedger.create({
        id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-refund`,
        userId: order.buyerId,
        type: 'refund',
        amount: refundAmount, // + amount returned to buyer
        status: 'completed',
        referenceType: 'order',
        referenceId: order.id,
        label: `Dispute Refund (${resolution}) - ${order.productName}`,
        availableAt: now
      });
    }

    // 2. PAY SELLER (If they win or partial)
    const sellerAmount = orderAmount - refundAmount;
    if (sellerAmount > 0) {
      const adminSettingsDB = await AdminSetting.findOne({}) || { platformFeePercent: 0, cashbackPercent: 0 };
      const { platformFeePercent, cashbackPercent } = adminSettingsDB;
      
      const platformFee = (sellerAmount * platformFeePercent) / 100;
      const sellerFinal = sellerAmount - platformFee;
      
      const buyerNetSpend = orderAmount - refundAmount;
      const cashback = (buyerNetSpend * cashbackPercent) / 100;

      // Seller earning
      if (sellerFinal > 0) {
        await WalletLedger.create({
          id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-earning`,
          userId: order.sellerId,
          type: 'seller_earning',
          amount: sellerFinal,
          status: 'completed',
          referenceType: 'order',
          referenceId: order.id,
          label: `Order Earnings (${resolution}) - ${order.productName}`,
          availableAt: availableAt // locked for 24h
        });
      }

      // Platform fee
      if (platformFee > 0) {
        await WalletLedger.create({
          id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-fee`,
          userId: 'admin_1',
          type: 'platform_fee',
          amount: platformFee,
          status: 'completed',
          referenceType: 'order',
          referenceId: order.id,
          label: `Platform Fee (${resolution}) - ${order.productName}`,
          availableAt: now
        });
      }

      // Cashback
      if (cashback > 0) {
        await WalletLedger.create({
          id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-cashback`,
          userId: order.buyerId,
          type: 'cashback',
          amount: cashback,
          status: 'completed',
          referenceType: 'order',
          referenceId: order.id,
          label: `Cashback (${resolution}) - ${order.productName}`,
          availableAt: now
        });
      }
    }

    // Update Dispute
    dispute.status = 'resolved';
    dispute.resolution = resolution;
    // dispute.adminNote = adminNote || ''; // Not in schema, ignore or put in resolution
    await dispute.save();
    
    await order.save();

    res.json({ message: 'Dispute resolved successfully', dispute: dispute.toObject(), order: order.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
