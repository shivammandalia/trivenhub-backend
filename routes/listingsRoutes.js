const express = require('express');
const router = express.Router();
const listingsController = require('../controllers/listingsController');

// GET /api/listings
router.get('/', listingsController.getListings);

// GET /api/listings/:id
router.get('/:id', listingsController.getListingById);

// POST /api/listings
router.post('/', listingsController.createListing);

// PUT /api/listings/:id
router.put('/:id', listingsController.updateListing);

// DELETE /api/listings/:id
router.delete('/:id', listingsController.deleteListing);

// PUT /api/listings/:id/pause
router.put('/:id/pause', listingsController.pauseListing);

// PUT /api/listings/:id/activate
router.put('/:id/activate', listingsController.activateListing);

// Credentials
router.get('/:id/credentials', listingsController.getCredentials);
router.post('/:id/credentials', listingsController.addCredential);
router.delete('/:id/credentials/:credentialId', listingsController.deleteCredential);

module.exports = router;
