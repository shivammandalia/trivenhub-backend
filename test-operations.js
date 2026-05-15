const { usersDB, walletLedgerDB, listingsDB, credentialsDB, ordersDB, adminAuditDB } = require('./models/mockDB');
const adminOperationsController = require('./controllers/adminOperationsController');

const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

const runOperationsTests = async () => {
  console.log('--- ADMIN OPERATIONS & SEED DATA TESTS ---\n');

  // Set up mock DB
  usersDB.push({ id: 'admin_test', role: 'admin' });
  usersDB.push({ id: 'vendor_1', role: 'vendor', status: 'active', online: false });
  usersDB.push({ id: 'buyer_1', role: 'customer' });

  let req, res;

  // 1. Add Balance
  console.log('1. Testing Add Balance...');
  req = { body: { targetUserId: 'buyer_1', amount: 5000, note: 'Promo credit', adminId: 'admin_test' } };
  res = mockRes();
  await adminOperationsController.addBalance(req, res);
  const ledgerEntry = walletLedgerDB.find(e => e.userId === 'buyer_1' && e.type === 'manual_adjustment');
  console.log(`Balance added: ₹${ledgerEntry.amount}. Audit Logs: ${adminAuditDB.length}`);

  // 2. Freeze User
  console.log('\n2. Testing Freeze User...');
  req = { body: { targetUserId: 'buyer_1', actionType: 'frozen', note: 'Suspicious activity', adminId: 'admin_test' } };
  res = mockRes();
  await adminOperationsController.freezeUser(req, res);
  const user = usersDB.find(u => u.id === 'buyer_1');
  console.log(`User status: ${user.status}`);

  // 3. Seed Listing
  console.log('\n3. Testing Seed Listing...');
  req = { body: { sellerId: 'vendor_1', productName: 'Premium Accounts', price: 100, stock: 0, adminId: 'admin_test' } };
  res = mockRes();
  await adminOperationsController.seedListing(req, res);
  const vendor = usersDB.find(u => u.id === 'vendor_1');
  const listingId = res.data.listing.id;
  console.log(`Vendor online status: ${vendor.online}. Listing created: ${res.data.listing.productName}`);

  // 4. Seed Credentials
  console.log('\n4. Testing Seed Credentials...');
  const credentialsList = [
    { loginId: 'acc1@test.com', password: 'p1' },
    { loginId: 'acc2@test.com', password: 'p2' }
  ];
  req = { body: { listingId, credentialsList, adminId: 'admin_test' } };
  res = mockRes();
  await adminOperationsController.seedCredentials(req, res);
  const listing = listingsDB.find(l => l.id === listingId);
  const credentialsCount = credentialsDB.filter(c => c.listingId === listingId).length;
  console.log(`Listing stock updated to: ${listing.stock}. Credentials in DB: ${credentialsCount}`);

  // 5. Create Mock Order
  console.log('\n5. Testing Mock Order Creation...');
  req = { body: { buyerId: 'buyer_1', sellerId: 'vendor_1', productName: 'Premium Accounts', amount: 100, adminId: 'admin_test', note: 'Test order' } };
  res = mockRes();
  await adminOperationsController.createManualOrder(req, res);
  const orderId = res.data.order.id;
  console.log(`Order created with ID: ${orderId}, Status: ${res.data.order.status}`);

  // 6. Force Complete Order
  console.log('\n6. Testing Force Complete Order...');
  req = { body: { orderId, note: 'User received it offline', adminId: 'admin_test' } };
  res = mockRes();
  await adminOperationsController.forceCompleteOrder(req, res);
  const order = ordersDB.find(o => o.id === orderId);
  console.log(`Order status is now: ${order.status}`);

  // 7. Verify Audit Log
  console.log('\n7. Checking Audit Logs...');
  adminAuditDB.forEach(a => {
    console.log(`[${a.createdAt}] ${a.actionType} - Target: ${a.targetUserId || a.targetOrderId} - Note: ${a.note}`);
  });
  console.log('\nTesting Complete!');
};

runOperationsTests();
