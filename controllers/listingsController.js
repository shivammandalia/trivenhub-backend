const { Listing, Credential, User } = require('../models');

// Helper to recalculate stock
const recalculateStock = async (listingId) => {
  const listing = await Listing.findOne({ id: listingId });
  if (!listing) return;
  if (listing.deliveryType === 'auto') {
    const availableCount = await Credential.countDocuments({ listingId, status: 'available' });
    listing.stock = availableCount;
    if (listing.stock <= 0) {
      listing.status = 'out_of_stock';
    } else if (listing.status === 'out_of_stock') {
      listing.status = 'active'; // automatically reactivate if stock is added and it was out of stock
    }
    await listing.save();
  }
};

exports.getListings = async (req, res) => {
  try {
    const listings = await Listing.find({});
    // Need to attach seller online status
    const result = [];
    for (const listing of listings) {
      const seller = await User.findOne({ 
        $or: [{ id: listing.sellerId }, { phone: listing.sellerId }] 
      }) || {};
      const sellerOnline = !!seller.online;
      
      let show = false;
      if (listing.deliveryType === 'manual') {
        show = sellerOnline && listing.status === 'active';
      } else if (listing.deliveryType === 'auto') {
        show = listing.stock > 0 && listing.status === 'active';
      }
      
      if (show) {
        result.push({ ...listing.toObject(), sellerOnline });
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getListingById = async (req, res) => {
  try {
    const listing = await Listing.findOne({ id: req.params.id });
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    
    const seller = await User.findOne({ 
      $or: [{ id: listing.sellerId }, { phone: listing.sellerId }] 
    }) || {};
    
    res.json({ ...listing.toObject(), sellerOnline: !!seller.online });
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

    const newListing = new Listing({
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
      rating: 5.0
    });

    await newListing.save();

    if (normalizedDeliveryType === 'auto' && credentials) {
      const credDocs = credentials.map(cred => ({
        id: `cred_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        listingId: newListing.id,
        loginId: cred.loginId,
        password: cred.password,
        status: 'available'
      }));
      await Credential.insertMany(credDocs);
      await recalculateStock(newListing.id);
    }

    res.status(201).json({ message: 'Listing created', listing: newListing.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateListing = async (req, res) => {
  try {
    const { productName, price, credentials, stock, deliveryType, type, category, status } = req.body;
    
    const updateData = {};
    if (productName) updateData.productName = productName;
    if (price) updateData.price = parseFloat(price);
    if (stock !== undefined) updateData.stock = parseInt(stock, 10);
    if (deliveryType) updateData.deliveryType = deliveryType.toString().toLowerCase();
    if (type) updateData.duration = type;
    if (category) updateData.category = category;
    if (status) updateData.status = status;

    const listing = await Listing.findOneAndUpdate(
      { id: req.params.id },
      updateData,
      { new: true }
    );

    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    
    res.json({ message: 'Listing updated', listing: listing.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteListing = async (req, res) => {
  try {
    const listing = await Listing.findOneAndDelete({ id: req.params.id });
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    await Credential.deleteMany({ listingId: req.params.id });

    res.json({ message: 'Listing deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.pauseListing = async (req, res) => {
  try {
    const listing = await Listing.findOneAndUpdate(
      { id: req.params.id },
      { status: 'paused' },
      { new: true }
    );
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json({ message: 'Listing paused', listing: listing.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.activateListing = async (req, res) => {
  try {
    const listing = await Listing.findOneAndUpdate(
      { id: req.params.id },
      { status: 'active' },
      { new: true }
    );
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json({ message: 'Listing activated', listing: listing.toObject() });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Credentials
exports.getCredentials = async (req, res) => {
  try {
    const creds = await Credential.find({ listingId: req.params.id });
    res.json(creds);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.addCredential = async (req, res) => {
  try {
    const { loginId, password } = req.body;
    const newCred = await Credential.create({
      id: `cred_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      listingId: req.params.id,
      loginId,
      password,
      status: 'available'
    });
    
    await recalculateStock(req.params.id);
    
    const listing = await Listing.findOne({ id: req.params.id });
    res.status(201).json({ message: 'Credential added', credential: newCred.toObject(), stock: listing?.stock });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteCredential = async (req, res) => {
  try {
    const { id, credentialId } = req.params;
    const cred = await Credential.findOneAndDelete({ id: credentialId, listingId: id });
    if (!cred) return res.status(404).json({ error: 'Credential not found' });

    await recalculateStock(id);
    
    const listing = await Listing.findOne({ id });
    res.json({ message: 'Credential deleted', stock: listing?.stock });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
