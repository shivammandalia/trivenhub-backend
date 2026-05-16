require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { 
  User, Listing, Credential, Order, WalletLedger, 
  Withdrawal, Dispute, AdminAudit, Payment, Notification, AdminSetting 
} = require('../models');

const connectDB = async () => {
  try {
    const dbURI = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!dbURI) throw new Error("Database URI is missing in environment variables!");
    const conn = await mongoose.connect(dbURI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`Error connecting to MongoDB: ${err.message}`);
    process.exit(1);
  }
};

const getDataDir = () => {
  return process.env.DATA_DIR || path.join(__dirname, '../data');
};

const loadJSON = (dbName) => {
  const filePath = path.join(getDataDir(), `${dbName}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error(`Error reading ${dbName}.json`, err);
    }
  }
  return null;
};

const migrate = async () => {
  await connectDB();
  console.log('Starting Migration from JSON to MongoDB...');

  const collections = [
    { name: 'users', model: User },
    { name: 'listings', model: Listing },
    { name: 'credentials', model: Credential },
    { name: 'orders', model: Order },
    { name: 'walletLedger', model: WalletLedger },
    { name: 'withdrawals', model: Withdrawal },
    { name: 'disputes', model: Dispute },
    { name: 'adminAudit', model: AdminAudit },
    { name: 'payments', model: Payment },
    { name: 'notifications', model: Notification }
  ];

  for (const col of collections) {
    let data = loadJSON(col.name);
    if (data && Array.isArray(data) && data.length > 0) {
      
      // Fix validation errors based on schema differences
      if (col.name === 'users') {
        data = data.map(u => ({ ...u, name: u.name || 'Unknown User', password: u.password || 'legacy_no_password' }));
      }
      if (col.name === 'credentials') {
        data = data.map(c => ({ ...c, loginId: c.loginId || 'N/A' }));
      }
      if (col.name === 'adminAudit') {
        data = data.map(a => ({
          ...a,
          action: a.actionType || a.action || 'unknown',
          targetId: a.targetUserId || a.targetOrderId || 'none',
          details: { amount: a.amount, note: a.note }
        }));
      }
      if (col.name === 'payments') {
        data = data.map(p => ({
          ...p,
          id: p.id || p.orderId,
          orderId: p.orderId || p.id
        }));
      }

      console.log(`Migrating ${data.length} records into ${col.name}...`);
      try {
        await col.model.deleteMany({}); // Clear existing
        await col.model.insertMany(data);
        console.log(`✅ ${col.name} migrated successfully.`);
      } catch (err) {
        console.error(`❌ Error migrating ${col.name}:`, err.message);
      }
    } else {
      console.log(`⚠️ No data found for ${col.name}, skipping.`);
    }
  }

  const settings = loadJSON('adminSettings');
  if (settings && typeof settings === 'object') {
    console.log(`Migrating adminSettings...`);
    await AdminSetting.deleteMany({});
    await AdminSetting.create(settings);
    console.log(`✅ adminSettings migrated successfully.`);
  }

  console.log('Migration Complete.');
  process.exit(0);
};

migrate();
