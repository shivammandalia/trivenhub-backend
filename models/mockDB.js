const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const usersDB = [];
const listingsDB = [];
const credentialsDB = [];
const ordersDB = [];
const walletLedgerDB = [];
const withdrawalsDB = [];
const disputesDB = [];
const adminAuditDB = [];
const paymentsDB = [];
const notificationsDB = [];

const adminSettingsDB = {
  platformFeePercent: 0,
  cashbackPercent: 0
};

const databases = {
  users: usersDB,
  listings: listingsDB,
  credentials: credentialsDB,
  orders: ordersDB,
  walletLedger: walletLedgerDB,
  withdrawals: withdrawalsDB,
  disputes: disputesDB,
  adminAudit: adminAuditDB,
  payments: paymentsDB,
  notifications: notificationsDB,
  adminSettings: adminSettingsDB
};

const loadDB = (dbName) => {
  const filePath = path.join(__dirname, `../data/${dbName}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        databases[dbName].length = 0; // Clear existing array
        databases[dbName].push(...parsed);
      } else {
        Object.assign(databases[dbName], parsed);
      }
    } catch (err) {
      console.error(`Error reading ${dbName}.json (Corrupt JSON). Creating backup.`, err);
      try {
        fs.copyFileSync(filePath, `${filePath}.bak`);
        console.log(`Created backup ${filePath}.bak`);
      } catch (backupErr) {
        console.error('Failed to create backup:', backupErr);
      }
    }
  }
};

const saveDB = (dbName) => {
  const filePath = path.join(__dirname, `../data/${dbName}.json`);
  const tmpPath = `${filePath}.tmp`;
  try {
    // Atomic write: Write to .tmp first, then rename
    fs.writeFileSync(tmpPath, JSON.stringify(databases[dbName], null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`Error saving ${dbName}.json:`, err);
  }
};

const initDB = async () => {
  // Ensure data dir exists
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load all databases
  Object.keys(databases).forEach(dbName => loadDB(dbName));

  // Seed default admin if missing
  const adminExists = usersDB.some(u => u.phone === '9820539961');
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('Chiru@3739', 10);
    usersDB.push({
      id: 'admin_1',
      phone: '9820539961',
      password: hashedPassword,
      role: 'admin',
      name: 'System Admin',
      status: 'active',
      online: true,
      createdAt: new Date().toISOString()
    });
    saveDB('users');
  }

  // Seed wallets for testing
  usersDB.forEach(u => {
    if (!walletLedgerDB.find(w => w.userId === u.id && w.type === 'deposit' && w.amount === 10000)) {
      walletLedgerDB.push({
        id: `txn-seed-${u.id}`,
        userId: u.id,
        type: 'deposit',
        amount: 10000,
        status: 'completed',
        referenceType: 'deposit',
        referenceId: null,
        label: 'Initial Demo Deposit',
        createdAt: new Date().toISOString(),
        availableAt: new Date().toISOString()
      });
    }
  });
  saveDB('walletLedger');
};

initDB();

// Backward compatibility for existing saveUsersDB
const saveUsersDB = () => saveDB('users');

module.exports = { 
  usersDB, listingsDB, credentialsDB, ordersDB, walletLedgerDB, 
  withdrawalsDB, disputesDB, adminAuditDB, paymentsDB, notificationsDB, 
  adminSettingsDB, saveDB, saveUsersDB 
};
