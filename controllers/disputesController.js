const { disputesDB, ordersDB, usersDB, walletLedgerDB, adminSettingsDB, saveDB } = require('../models/mockDB');

// Helper to get user info
const getUserInfo = (userId) => {
  return usersDB.find(u => u.id === userId || u.phone === userId) || { name: 'Unknown', phone: userId };
};

exports.createDispute = async (req, res) => {
  try {
    const { orderId, raisedBy, reason, proofImage } = req.body;
    
    const order = ordersDB.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (order.status === 'completed' || order.status === 'refunded') {
      return res.status(400).json({ error: `Cannot dispute a ${order.status} order` });
    }

    if (order.status === 'disputed') {
      return res.status(400).json({ error: 'Order is already disputed' });
    }

    // Create dispute
    const dispute = {
      id: `disp-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      orderId: order.id,
      productName: order.productName,
      amount: order.amount,
      raisedBy,
      buyerId: order.buyerId,
      buyerName: getUserInfo(order.buyerId).name,
      sellerId: order.sellerId,
      sellerName: getUserInfo(order.sellerId).name,
      reason,
      proofImage: proofImage || null,
      status: 'open',
      resolution: null,
      adminNote: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null
    };

    disputesDB.push(dispute);

    // Update order status
    order.status = 'disputed';
    order.updatedAt = new Date().toISOString();

    saveDB('disputes');
    saveDB('orders');

    res.status(201).json({ message: 'Dispute raised successfully', dispute, order });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getDisputes = async (req, res) => {
  try {
    res.json(disputesDB.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getDisputeById = async (req, res) => {
  try {
    const dispute = disputesDB.find(d => d.id === req.params.id);
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
    
    const dispute = disputesDB.find(d => d.id === id);
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    
    if (dispute.status !== 'open') {
      return res.status(400).json({ error: `Dispute is already ${dispute.status}` });
    }

    const order = ordersDB.find(o => o.id === dispute.orderId);
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
      // Order status can be completed or partially_refunded. Let's use partially_refunded or completed.
      // Usually partial refund means the transaction is closed/completed with an adjustment.
      order.status = 'completed';
    }

    // Handle Escrow unlocking
    const holdEntry = walletLedgerDB.find(e => e.referenceId === order.id && e.type === 'purchase_hold');
    if (holdEntry && holdEntry.status === 'locked') {
      // Mark hold as completed (permanently deducted from buyer)
      holdEntry.status = 'completed';
    }

    const now = new Date();
    // 24-hour lock for seller earnings
    const availableAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // 1. REFUND BUYER
    if (refundAmount > 0) {
      walletLedgerDB.push({
        id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-refund`,
        userId: order.buyerId,
        type: 'refund',
        amount: refundAmount, // + amount returned to buyer
        status: 'completed',
        referenceType: 'order',
        referenceId: order.id,
        label: `Dispute Refund (${resolution}) - ${order.productName}`,
        createdAt: now.toISOString(),
        availableAt: now.toISOString()
      });
    }

    // 2. PAY SELLER (If they win or partial)
    const sellerAmount = orderAmount - refundAmount;
    if (sellerAmount > 0) {
      const { platformFeePercent, cashbackPercent } = adminSettingsDB;
      
      // Financial rules for partial/seller_win
      const platformFee = (sellerAmount * platformFeePercent) / 100;
      const sellerFinal = sellerAmount - platformFee;
      
      const buyerNetSpend = orderAmount - refundAmount;
      const cashback = (buyerNetSpend * cashbackPercent) / 100;

      // Seller earning
      if (sellerFinal > 0) {
        walletLedgerDB.push({
          id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-earning`,
          userId: order.sellerId,
          type: 'seller_earning',
          amount: sellerFinal,
          status: 'completed',
          referenceType: 'order',
          referenceId: order.id,
          label: `Order Earnings (${resolution}) - ${order.productName}`,
          createdAt: now.toISOString(),
          availableAt: availableAt // locked for 24h
        });
      }

      // Platform fee
      if (platformFee > 0) {
        walletLedgerDB.push({
          id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-fee`,
          userId: 'admin_1',
          type: 'platform_fee',
          amount: platformFee,
          status: 'completed',
          referenceType: 'order',
          referenceId: order.id,
          label: `Platform Fee (${resolution}) - ${order.productName}`,
          createdAt: now.toISOString(),
          availableAt: now.toISOString()
        });
      }

      // Cashback
      if (cashback > 0) {
        walletLedgerDB.push({
          id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}-cashback`,
          userId: order.buyerId,
          type: 'cashback',
          amount: cashback,
          status: 'completed',
          referenceType: 'order',
          referenceId: order.id,
          label: `Cashback (${resolution}) - ${order.productName}`,
          createdAt: now.toISOString(),
          availableAt: now.toISOString()
        });
      }
    }

    // Update Dispute
    dispute.status = 'resolved';
    dispute.resolution = resolution;
    dispute.adminNote = adminNote || '';
    dispute.resolvedAt = now.toISOString();

    saveDB('disputes');
    saveDB('orders');
    saveDB('walletLedger');

    res.json({ message: 'Dispute resolved successfully', dispute, order });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
