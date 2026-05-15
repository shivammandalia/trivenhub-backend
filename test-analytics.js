const { usersDB, ordersDB, disputesDB, walletLedgerDB, listingsDB } = require('./models/mockDB');
const adminController = require('./controllers/adminController');

const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

const runAnalyticsTests = async () => {
  console.log('--- ADMIN ANALYTICS TESTS ---\n');

  // Clear mockDB arrays for a clean slate in the test (except admin_1 in usersDB)
  // Clear mockDB arrays for a clean slate in the test
  usersDB.splice(0, usersDB.length);
  ordersDB.splice(0, ordersDB.length);
  disputesDB.splice(0, disputesDB.length);
  walletLedgerDB.splice(0, walletLedgerDB.length);
  listingsDB.splice(0, listingsDB.length);

  // Add 1 seller and 1 buyer
  usersDB.push({ id: 'seller_risk', role: 'seller', name: 'Risky Seller', status: 'active' });
  usersDB.push({ id: 'buyer_risk', role: 'customer', name: 'Risky Buyer', status: 'active' });

  // Add orders to trigger High Dispute Seller (5 orders, >20% dispute) -> 2 disputes out of 5 = 40%
  for (let i = 0; i < 5; i++) {
    ordersDB.push({ id: `ord-s-${i}`, sellerId: 'seller_risk', buyerId: 'test', status: 'completed', amount: 100, deliveryType: 'manual', createdAt: new Date().toISOString() });
  }
  disputesDB.push({ id: 'disp-1', sellerId: 'seller_risk', status: 'open' });
  disputesDB.push({ id: 'disp-2', sellerId: 'seller_risk', status: 'open' });

  // Delay Risk: Seller has 2 cancelled manual orders
  ordersDB.push({ id: `ord-s-cancel-1`, sellerId: 'seller_risk', buyerId: 'test', status: 'cancelled', deliveryType: 'manual', createdAt: new Date().toISOString() });
  ordersDB.push({ id: `ord-s-cancel-2`, sellerId: 'seller_risk', buyerId: 'test', status: 'cancelled', deliveryType: 'manual', createdAt: new Date().toISOString() });

  // Buyer Refund Risk: 5 orders, 2 refunded
  for (let i = 0; i < 5; i++) {
    ordersDB.push({ id: `ord-b-${i}`, buyerId: 'buyer_risk', status: i < 2 ? 'refunded' : 'completed', amount: 50, createdAt: new Date().toISOString() });
  }

  // Wallet Freeze Needed: seller_risk has open disputes and now we add a pending withdrawal
  walletLedgerDB.push({ id: 'with-1', userId: 'seller_risk', type: 'withdrawal', status: 'pending', amount: -500 });

  // Low stock alert: Auto listing with stock 1
  listingsDB.push({ id: 'list-1', productName: 'Low Stock Auto', deliveryType: 'auto', status: 'active', stock: 1 });

  let req = {};
  let res = mockRes();
  
  await adminController.getAnalytics(req, res);
  
  if (res.statusCode === 500) {
    console.error('Server Error:', res.data);
    return;
  }

  console.log(`Global KPIs:`);
  console.log(`Users: ${res.data.totalUsers}, Active Sellers: ${res.data.activeSellers}`);
  console.log(`Orders: ${res.data.totalOrders}, GMV: ₹${res.data.totalGMV}`);
  console.log(`Pending Withdrawals: ${res.data.pendingWithdrawals}, Open Disputes: ${res.data.openDisputes}\n`);

  console.log(`Risk Alerts Found: ${res.data.riskAlerts.length}`);
  res.data.riskAlerts.forEach(a => {
    console.log(`[${a.severity.toUpperCase()}] ${a.type}: ${a.message} (Action: ${a.action})`);
  });
};

runAnalyticsTests();
