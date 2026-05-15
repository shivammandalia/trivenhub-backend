const express = require('express');
const router = express.Router();
const disputesController = require('../controllers/disputesController');

router.post('/', disputesController.createDispute);
router.get('/', disputesController.getDisputes);
router.get('/:id', disputesController.getDisputeById);
router.put('/:id/resolve', disputesController.resolveDispute);

module.exports = router;
