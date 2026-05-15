const { walletLedgerDB, usersDB, ordersDB, listingsDB, disputesDB } = require('../models/mockDB');
const { calculateWallet } = require('./walletController');

// Helper to get user info by ID
const getUserInfo = (userId) => {
  return usersDB.find(u => u.id === userId || u.phone === userId) || { name: 'Unknown', phone: userId };
};

exports.getWithdrawals = async (req, res) => {
  try {
    const withdrawals = walletLedgerDB
      .filter(entry => entry.type === 'withdrawal')
      .map(entry => {
        const user = getUserInfo(entry.userId);
        return {
          ...entry,
          userName: user.name,
          userPhone: user.phone,
          availableBalance: calculateWallet(entry.userId).withdrawableBalance // show balance at time of query
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(withdrawals);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    
    const entry = walletLedgerDB.find(e => e.id === id && e.type === 'withdrawal');
    if (!entry) return res.status(404).json({ error: 'Withdrawal request not found' });
    
    if (entry.status !== 'pending') {
      return res.status(400).json({ error: `Withdrawal is already ${entry.status}` });
    }

    // Mark as completed. (Since it's completed, calculateWallet will now permanently deduct it from withdrawableBalance)
    entry.status = 'completed';
    entry.updatedAt = new Date().toISOString();

    res.json({ message: 'Withdrawal approved successfully', entry });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const entry = walletLedgerDB.find(e => e.id === id && e.type === 'withdrawal');
    if (!entry) return res.status(404).json({ error: 'Withdrawal request not found' });
    
    if (entry.status !== 'pending') {
      return res.status(400).json({ error: `Withdrawal is already ${entry.status}` });
    }

    // Mark as rejected. calculateWallet will ignore rejected entries, returning funds to user's available balance
    entry.status = 'rejected';
    entry.meta = { ...entry.meta, rejectReason: reason || 'Rejected by Admin' };
    entry.updatedAt = new Date().toISOString();

    res.json({ message: 'Withdrawal rejected successfully', entry });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
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
      
      walletExposure: usersDB.reduce((acc, u) => acc + calculateWallet(u.id).totalBalance, 0),
      cashbackIssued: walletLedgerDB.filter(e => e.type === 'cashback' && e.status === 'completed').reduce((acc, e) => acc + e.amount, 0)
    };

    const riskAlerts = [];

    // 1. High dispute seller & 3. Seller delay risk
    const sellers = usersDB.filter(u => ['seller', 'vendor'].includes(u.role));
    for (const seller of sellers) {
      const sellerOrders = ordersDB.filter(o => o.sellerId === seller.id);
      
      // Dispute Risk (At least 5 orders)
      if (sellerOrders.length >= 5) {
        const disputesAgainst = disputesDB.filter(d => d.sellerId === seller.id).length;
        const disputeRate = disputesAgainst / sellerOrders.length;
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

      // Delay Risk (At least 5 manual orders)
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
      if (openDisputes.some(d => d.sellerId === w.userId || d.buyerId === w.userId)) {
        const user = getUserInfo(w.userId);
        riskAlerts.push({
          type: 'Wallet Freeze Needed',
          userId: user.id,
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
