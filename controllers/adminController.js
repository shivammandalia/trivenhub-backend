const { WalletLedger, User, Order, Listing, Dispute } = require('../models');
const { calculateWallet } = require('./walletController');

// Helper to get user info by ID
const getUserInfo = async (userId) => {
  const u = await User.findOne({ $or: [{ id: userId }, { phone: userId }] });
  return u ? { name: u.name, phone: u.phone, id: u.id } : { name: 'Unknown', phone: userId, id: userId };
};

exports.getWithdrawals = async (req, res) => {
  try {
    const entries = await WalletLedger.find({ type: 'withdrawal' }).sort({ createdAt: -1 });
    
    const withdrawals = await Promise.all(entries.map(async (entry) => {
      const user = await getUserInfo(entry.userId);
      const wallet = await calculateWallet(entry.userId);
      return {
        ...entry.toObject(),
        userName: user.name,
        userPhone: user.phone,
        availableBalance: wallet.withdrawableBalance // show balance at time of query
      };
    }));

    res.json(withdrawals);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    
    const entry = await WalletLedger.findOne({ id, type: 'withdrawal' });
    if (!entry) return res.status(404).json({ error: 'Withdrawal request not found' });
    
    if (entry.status !== 'pending') {
      return res.status(400).json({ error: `Withdrawal is already ${entry.status}` });
    }

    entry.status = 'completed';
    await entry.save();

    res.json({ message: 'Withdrawal approved successfully', entry: entry.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const entry = await WalletLedger.findOne({ id, type: 'withdrawal' });
    if (!entry) return res.status(404).json({ error: 'Withdrawal request not found' });
    
    if (entry.status !== 'pending') {
      return res.status(400).json({ error: `Withdrawal is already ${entry.status}` });
    }

    // Since we didn't specify meta in schema, we can add to label or define it
    // Wait, Mongoose allows mixed types if defined, or we can just append to label
    entry.status = 'rejected';
    entry.label = `${entry.label} - Rejected: ${reason || 'Admin'}`;
    await entry.save();

    res.json({ message: 'Withdrawal rejected successfully', entry: entry.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    // For exact logic parity, we will fetch data into memory as done before.
    const usersDB = await User.find({});
    const ordersDB = await Order.find({});
    const walletLedgerDB = await WalletLedger.find({});
    const disputesDB = await Dispute.find({});
    const listingsDB = await Listing.find({});

    let walletExposure = 0;
    for (const u of usersDB) {
       const w = await calculateWallet(u.id);
       walletExposure += w.totalBalance;
    }

    const data = {
      totalUsers: usersDB.length,
      totalCustomers: usersDB.filter(u => u.role === 'customer').length,
      totalResellers: usersDB.filter(u => u.role === 'reseller').length,
      totalVendors: usersDB.filter(u => u.role === 'vendor').length,
      activeSellers: usersDB.filter(u => u.role === 'seller' && u.status === 'active').length,
      pendingResellers: usersDB.filter(u => u.role === 'reseller' && u.status === 'pending').length,
      
      totalOrders: ordersDB.length,
      ordersToday: ordersDB.filter(o => {
        const today = new Date().setHours(0,0,0,0);
        return new Date(o.createdAt) >= today;
      }).length,
      completedOrders: ordersDB.filter(o => o.status === 'completed').length,
      disputedOrders: ordersDB.filter(o => o.status === 'disputed').length,
      failedOrders: ordersDB.filter(o => ['cancelled', 'refunded'].includes(o.status)).length,

      totalGMV: ordersDB.filter(o => ['completed', 'accepted', 'delivered', 'otp_requested', 'otp_submitted'].includes(o.status)).reduce((acc, o) => acc + o.amount, 0),
      
      platformRevenue: walletLedgerDB.filter(e => e.type === 'platform_fee' && e.status === 'completed').reduce((acc, e) => acc + e.amount, 0),
      openDisputes: disputesDB.filter(d => d.status === 'open').length,
      pendingWithdrawals: walletLedgerDB.filter(e => e.type === 'withdrawal' && e.status === 'pending').length,
      
      walletExposure,
      cashbackIssued: walletLedgerDB.filter(e => e.type === 'cashback' && e.status === 'completed').reduce((acc, e) => acc + e.amount, 0)
    };

    const riskAlerts = [];

    // 1. High dispute seller & 3. Seller delay risk
    const sellers = usersDB.filter(u => ['seller', 'vendor'].includes(u.role));
    for (const seller of sellers) {
      const sellerOrders = ordersDB.filter(o => o.sellerId === seller.id);
      
      if (sellerOrders.length >= 5) {
        const disputesAgainst = disputesDB.filter(d => d.sellerId === seller.id).length; // Note: disputesDB schema does not have sellerId, it uses orderId. Wait, mockDB logic had d.sellerId...
        // Actually disputeSchema in mongoose didn't have sellerId. I'll just skip this check or use order's seller.
        const orderIds = sellerOrders.map(o => o.id);
        const disputesAgainstCount = disputesDB.filter(d => orderIds.includes(d.orderId)).length;
        const disputeRate = disputesAgainstCount / sellerOrders.length;
        if (disputeRate > 0.2) {
          riskAlerts.push({
            type: 'High Dispute Seller',
            userId: seller.id,
            userName: seller.name,
            severity: disputeRate > 0.3 ? 'high' : 'medium',
            message: `Dispute rate ${(disputeRate * 100).toFixed(0)}% across ${sellerOrders.length} orders.`,
            action: 'Review Listings'
          });
        }
      }

      const manualOrders = sellerOrders.filter(o => o.deliveryType === 'manual');
      if (manualOrders.length >= 5) {
        const failedManual = manualOrders.filter(o => ['cancelled', 'refunded'].includes(o.status)).length;
        if (failedManual >= 2) {
          riskAlerts.push({
            type: 'Seller Delay Risk',
            userId: seller.id,
            userName: seller.name,
            severity: failedManual >= 4 ? 'high' : 'medium',
            message: `${failedManual} failed/delayed manual orders.`,
            action: 'Warn Seller'
          });
        }
      }
    }

    // 2. High refund buyer
    for (const user of usersDB) {
      const buyerOrders = ordersDB.filter(o => o.buyerId === user.id);
      if (buyerOrders.length >= 5) {
        const refundsOrDisputes = buyerOrders.filter(o => ['refunded', 'disputed'].includes(o.status)).length;
        const rate = refundsOrDisputes / buyerOrders.length;
        if (rate > 0.2) {
          riskAlerts.push({
            type: 'High Refund Buyer',
            userId: user.id,
            userName: user.name,
            severity: rate > 0.3 ? 'high' : 'medium',
            message: `Refund/Dispute rate ${(rate * 100).toFixed(0)}% across ${buyerOrders.length} orders.`,
            action: 'Review Account'
          });
        }
      }
    }

    // 4. Wallet freeze needed (No minimums)
    const openDisputes = disputesDB.filter(d => d.status === 'open');
    const pendingWiths = walletLedgerDB.filter(e => e.type === 'withdrawal' && e.status === 'pending');
    for (const w of pendingWiths) {
      // Find user orders to see if they are in open disputes
      const userOrders = ordersDB.filter(o => o.buyerId === w.userId || o.sellerId === w.userId).map(o => o.id);
      if (openDisputes.some(d => userOrders.includes(d.orderId))) {
        const user = usersDB.find(u => u.id === w.userId) || { name: 'Unknown' };
        riskAlerts.push({
          type: 'Wallet Freeze Needed',
          userId: w.userId,
          userName: user.name,
          severity: 'high',
          message: `User has an open dispute AND a pending withdrawal request.`,
          action: 'Freeze Wallet'
        });
      }
    }

    // 5. Low stock alert
    const autoListings = listingsDB.filter(l => l.deliveryType === 'auto' && l.status === 'active');
    for (const listing of autoListings) {
      const currentStock = listing.stock || 0;
      if (currentStock <= 2) {
        let severity = 'low';
        if (currentStock === 1) severity = 'medium';
        if (currentStock === 0) severity = 'high';
        
        riskAlerts.push({
          type: 'Low Stock Alert',
          listingId: listing.id,
          listingName: listing.productName,
          severity,
          message: `Stock level critical: ${currentStock} remaining.`,
          action: 'Notify Seller'
        });
      }
    }

    res.json({ ...data, riskAlerts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
