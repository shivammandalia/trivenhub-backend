const { listingsDB, credentialsDB, usersDB, saveDB } = require('../models/mockDB');

// Helper to recalculate stock
const recalculateStock = (listingId) => {
  const listing = listingsDB.find(l => l.id === listingId);
  if (!listing) return;
  if (listing.deliveryType === 'auto') {
    const availableCreds = credentialsDB.filter(c => c.listingId === listingId && c.status === 'available');
    listing.stock = availableCreds.length;
    if (listing.stock <= 0) {
      listing.status = 'out_of_stock';
    } else if (listing.status === 'out_of_stock') {
      listing.status = 'active'; // automatically reactivate if stock is added and it was out of stock
    }
  }
};

exports.getListings = async (req, res) => {
  try {
    // Dynamic filtering based on seller online status
    const result = listingsDB.map(listing => {
      const seller = usersDB.find(u => u.id === listing.sellerId || u.phone === listing.sellerId) || {};
      const sellerOnline = !!seller.online;
      return { ...listing, sellerOnline };
    }).filter(listing => {
      // Manual listings: show only if sellerOnline = true AND status = active
      if (listing.deliveryType === 'manual') {
        return listing.sellerOnline && listing.status === 'active';
      }
      // Auto listings: show if stock > 0 AND status = active
      if (listing.deliveryType === 'auto') {
        return listing.stock > 0 && listing.status === 'active';
      }
      return false; // Default hide
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getListingById = async (req, res) => {
  try {
    const listing = listingsDB.find(l => l.id === req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    
    const seller = usersDB.find(u => u.id === listing.sellerId || u.phone === listing.sellerId) || {};
    res.json({ ...listing, sellerOnline: !!seller.online });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.createListing = async (req, res) => {
  try {
    const { sellerId, sellerName, productName, productImage, duration, price, description, deliveryType, stock, credentials } = req.body;

    if (!productName || !price || !duration || !deliveryType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const normalizedDeliveryType = deliveryType.toString().toLowerCase();

    if (normalizedDeliveryType === 'auto' && (!credentials || credentials.length === 0)) {
      return res.status(400).json({ error: 'Auto listing must have at least 1 credential pair' });
    }

    const newListing = {
      id: `list_${Date.now()}`,
      sellerId,
      sellerName,
      productName,
      productImage,
      duration,
      price: parseFloat(price),
      description,
      deliveryType: normalizedDeliveryType,
      stock: normalizedDeliveryType === 'auto' ? credentials.length : (stock || 999),
      status: 'active',
      rating: 5.0,
      createdAt: new Date().toISOString()
    };

    listingsDB.push(newListing);
    saveDB('listings');

    if (normalizedDeliveryType === 'auto' && credentials) {
      credentials.forEach(cred => {
        credentialsDB.push({
          id: `cred_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          listingId: newListing.id,
          loginId: cred.loginId,
          password: cred.password,
          status: 'available',
          createdAt: new Date().toISOString()
        });
      });
      recalculateStock(newListing.id);
      saveDB('credentials');
      saveDB('listings');
    }

    res.status(201).json({ message: 'Listing created', listing: newListing });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateListing = async (req, res) => {
  try {
    const { productName, price, credentials, stock, deliveryType, type, category, status } = req.body;
    const listing = listingsDB.find(l => l.id === req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    
    if (productName) listing.productName = productName;
    if (price) listing.price = parseFloat(price);
    if (credentials) listing.credentials = credentials;
    if (stock !== undefined) listing.stock = parseInt(stock, 10);
    if (deliveryType) listing.deliveryType = deliveryType.toString().toLowerCase();
    if (type) listing.duration = type;
    if (category) listing.category = category;
    if (status) listing.status = status;
    
    listing.updatedAt = new Date().toISOString();
    saveDB('listings');
    res.json({ message: 'Listing updated', listing });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteListing = async (req, res) => {
  try {
    const index = listingsDB.findIndex(l => l.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Listing not found' });

    listingsDB.splice(index, 1);
    saveDB('listings');
    // Also remove credentials
    const credsToRemove = credentialsDB.filter(c => c.listingId === req.params.id);
    credsToRemove.forEach(c => {
      const idx = credentialsDB.findIndex(cdb => cdb.id === c.id);
      if (idx !== -1) credentialsDB.splice(idx, 1);
    });
    saveDB('credentials');

    res.json({ message: 'Listing deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.pauseListing = async (req, res) => {
  try {
    const listing = listingsDB.find(l => l.id === req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    listing.status = 'paused';
    saveDB('listings');
    res.json({ message: 'Listing paused', listing });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.activateListing = async (req, res) => {
  try {
    const listing = listingsDB.find(l => l.id === req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    listing.status = 'active';
    saveDB('listings');
    res.json({ message: 'Listing activated', listing });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Credentials
exports.getCredentials = async (req, res) => {
  try {
    const creds = credentialsDB.filter(c => c.listingId === req.params.id);
    res.json(creds);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.addCredential = async (req, res) => {
  try {
    const { loginId, password } = req.body;
    const newCred = {
      id: `cred_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      listingId: req.params.id,
      loginId,
      password,
      status: 'available',
      createdAt: new Date().toISOString()
    };
    credentialsDB.push(newCred);
    recalculateStock(req.params.id);
    saveDB('credentials');
    saveDB('listings');
    
    const listing = listingsDB.find(l => l.id === req.params.id);
    res.status(201).json({ message: 'Credential added', credential: newCred, stock: listing?.stock });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteCredential = async (req, res) => {
  try {
    const { id, credentialId } = req.params;
    const index = credentialsDB.findIndex(c => c.id === credentialId && c.listingId === id);
    if (index === -1) return res.status(404).json({ error: 'Credential not found' });

    credentialsDB.splice(index, 1);
    recalculateStock(id);
    saveDB('credentials');
    saveDB('listings');
    
    const listing = listingsDB.find(l => l.id === id);
    res.json({ message: 'Credential deleted', stock: listing?.stock });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
