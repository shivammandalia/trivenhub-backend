const express = require('express');
const router = express.Router();
const adminOperationsController = require('../controllers/adminOperationsController');

router.post('/add-balance', adminOperationsController.addBalance);
router.post('/deduct-balance', adminOperationsController.deductBalance);
router.post('/freeze-user', adminOperationsController.freezeUser);
router.post('/broadcast', adminOperationsController.broadcast);

router.post('/force-complete', adminOperationsController.forceCompleteOrder);
router.post('/force-refund', adminOperationsController.forceRefundOrder);
router.post('/create-order', adminOperationsController.createManualOrder);

router.post('/seed/listing', adminOperationsController.seedListing);
router.post('/seed/credentials', adminOperationsController.seedCredentials);

module.exports = router;
