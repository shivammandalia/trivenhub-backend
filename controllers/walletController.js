const { walletLedgerDB, usersDB, adminSettingsDB, saveDB } = require('../models/mockDB');

// Helper to calculate a user's wallet dynamically
const calculateWallet = (userId) => {
  const entries = walletLedgerDB.filter(entry => entry.userId === userId || entry.userId === usersDB.find(u => u.phone === userId)?.id);

  let totalBalance = 0;
  let deposits = 0;
  let earnings = 0;
  let cashback = 0;
  let onHold = 0;
  let withdrawableBalance = 0;

  const now = new Date();

  entries.forEach(entry => {
    // Aggregation logic
    if (entry.status === 'completed') {
      if (entry.type === 'deposit') deposits += entry.amount;
      if (entry.type === 'seller_earning') earnings += entry.amount;
      if (entry.type === 'cashback') cashback += entry.amount;
      if (entry.type === 'refund') deposits += entry.amount; // refunds return as spendable

      // Add to total balance for all completed entries (deposits are positive, fees are negative)
      totalBalance += entry.amount;

      // Withdrawable logic (earnings only, after availableAt, minus withdrawals)
      if (entry.type === 'seller_earning') {
        const availableAt = new Date(entry.availableAt);
        if (now >= availableAt) {
          withdrawableBalance += entry.amount;
        }
      } else if (entry.type === 'withdrawal') {
        // Withdrawals deduct from withdrawableBalance since they pull from earnings
        withdrawableBalance += entry.amount; // entry.amount is negative
      }
    } else if (entry.status === 'locked') {
      onHold += Math.abs(entry.amount);
      totalBalance += entry.amount; // Still reduces spendable balance
    } else if (entry.status === 'pending') {
      if (entry.type === 'withdrawal') {
        totalBalance += entry.amount;
        withdrawableBalance += entry.amount;
      }
    }
  });

  return {
    totalBalance,
    deposits,
    earnings,
    cashback,
    onHold,
    withdrawableBalance: Math.max(0, withdrawableBalance)
  };
};

exports.calculateWallet = calculateWallet;

exports.getWallet = async (req, res) => {
  try {
    const { userId } = req.params;
    const wallet = calculateWallet(userId);
    res.json(wallet);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const { userId } = req.params;
    const entries = walletLedgerDB.filter(entry => entry.userId === userId || entry.userId === usersDB.find(u => u.phone === userId)?.id);
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deposit = async (req, res) => {
  try {
    const { userId, amount, label } = req.body;
    if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const entry = {
      id: `txn-${Date.now()}`,
      userId,
      type: 'deposit',
      amount: parseFloat(amount),
      status: 'completed',
      referenceType: 'deposit',
      referenceId: null,
      label: label || 'Deposit',
      createdAt: new Date().toISOString(),
      availableAt: new Date().toISOString()
    };

    walletLedgerDB.push(entry);
    saveDB('walletLedger');
    res.status(201).json({ message: 'Deposit successful', entry, wallet: calculateWallet(userId) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.withdrawRequest = async (req, res) => {
  try {
    const { userId, amount, upiId } = req.body;
    const withdrawAmount = parseFloat(amount);
    
    if (withdrawAmount < 500) return res.status(400).json({ error: 'Minimum withdrawal is ₹500' });
    if (!upiId) return res.status(400).json({ error: 'UPI ID is required' });

    const wallet = calculateWallet(userId);
    if (wallet.withdrawableBalance < withdrawAmount) {
      return res.status(400).json({ error: 'Insufficient withdrawable balance' });
    }

    const entry = {
      id: `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      userId,
      type: 'withdrawal',
      amount: -withdrawAmount, // negative
      status: 'pending', // Admins approve withdrawals
      referenceType: 'withdrawal',
      referenceId: null,
      label: 'Withdrawal Request',
      meta: { upiId },
      createdAt: new Date().toISOString(),
      availableAt: new Date().toISOString()
    };

    walletLedgerDB.push(entry);
    saveDB('walletLedger');
    res.status(201).json({ message: 'Withdrawal requested successfully', entry, wallet: calculateWallet(userId) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.adminAdjust = async (req, res) => {
  try {
    const { userId, amount, reason, isPenalty } = req.body;
    
    const entry = {
      id: `txn-${Date.now()}`,
      userId,
      type: isPenalty ? 'penalty' : 'manual_adjustment',
      amount: parseFloat(amount),
      status: 'completed',
      referenceType: 'admin',
      referenceId: null,
      label: reason || 'Admin Adjustment',
      createdAt: new Date().toISOString(),
      availableAt: new Date().toISOString()
    };

    walletLedgerDB.push(entry);
    saveDB('walletLedger');
    res.status(201).json({ message: 'Adjustment successful', entry, wallet: calculateWallet(userId) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
