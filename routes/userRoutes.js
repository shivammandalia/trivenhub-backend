const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');

// GET /api/users
router.get('/', usersController.getUsers);

// POST /api/users/sync
router.post('/sync', usersController.syncUser);

// GET /api/users/:id
router.get('/:id', usersController.getUserById);

// PUT /api/users/:id/status
router.put('/:id/status', usersController.updateStatus);

// PUT /api/users/:id/role
router.put('/:id/role', usersController.updateRole);

// PUT /api/users/:id/ban
router.put('/:id/ban', usersController.banUser);

// PUT /api/users/:id/online
router.put('/:id/online', usersController.updateOnline);

module.exports = router;
