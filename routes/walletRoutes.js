const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');

router.get('/:userId', walletController.getWallet);
router.get('/:userId/transactions', walletController.getTransactions);
router.post('/deposit', walletController.deposit);
router.post('/withdraw-request', walletController.withdrawRequest);
router.post('/admin-adjust', walletController.adminAdjust);

router.post('/admin-settings', (req, res) => {
  const { adminSettingsDB, saveDB } = require('../models/mockDB');
  const { platformFeePercent, cashbackPercent } = req.body;
  if (platformFeePercent !== undefined) adminSettingsDB.platformFeePercent = platformFeePercent;
  if (cashbackPercent !== undefined) adminSettingsDB.cashbackPercent = cashbackPercent;
  saveDB('adminSettings');
  res.json(adminSettingsDB);
});

module.exports = router;
