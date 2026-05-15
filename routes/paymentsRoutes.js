const express = require('express');
const router = express.Router();
const paymentsController = require('../controllers/paymentsController');

router.post('/create-order', paymentsController.createOrder);
router.post('/verify', paymentsController.verifyPayment);

module.exports = router;
