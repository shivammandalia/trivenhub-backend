const express = require('express');
const router = express.Router();
const ordersController = require('../controllers/ordersController');

router.post('/', ordersController.createOrder);
router.get('/', ordersController.getOrders);
router.get('/:id', ordersController.getOrderById);
router.put('/:id/status', ordersController.updateOrderStatus);
router.put('/:id/message', ordersController.addMessage);

module.exports = router;
