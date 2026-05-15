const { walletLedgerDB, adminSettingsDB } = require('./models/mockDB');
const walletController = require('./controllers/walletController');
const adminController = require('./controllers/adminController');

// Mock req and res
const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

const runWithdrawalTests = async () => {
  console.log('--- WITHDRAWAL TESTS ---\n');
  const sellerId = 'seller_1';
  const buyerId = 'buyer_1';

  // Seed Data: Give seller 1300 in earnings that are available NOW
  walletLedgerDB.push({
    id: `txn-seed-1`,
    userId: sellerId,
    type: 'seller_earning',
    amount: 300,
    status: 'completed',
    referenceType: 'order',
    createdAt: new Date().toISOString(),
    availableAt: new Date(Date.now() - 1000).toISOString() // Past
  });

  console.log('1. Seller has ₹300 withdrawable → withdraw ₹300 fails');
  let req = { body: { userId: sellerId, amount: 300, upiId: 'sel@upi' } };
  let res = mockRes();
  await walletController.withdrawRequest(req, res);
  console.log(`Status: ${res.statusCode}, Error: ${res.data?.error} (Expected 400 - Min ₹500)`);

  // Seed Data: Give seller another 700 available NOW
  walletLedgerDB.push({
    id: `txn-seed-2`,
    userId: sellerId,
    type: 'seller_earning',
    amount: 700,
    status: 'completed',
    referenceType: 'order',
    createdAt: new Date().toISOString(),
    availableAt: new Date(Date.now() - 1000).toISOString() // Past
  });

  const wallet = walletController.calculateWallet(sellerId);
  console.log(`Seller Withdrawable Balance: ₹${wallet.withdrawableBalance} (Expected 1000)`);

  console.log('\n2. Seller has ₹1000 withdrawable → request ₹600 succeeds');
  req = { body: { userId: sellerId, amount: 600, upiId: 'sel@upi' } };
  res = mockRes();
  await walletController.withdrawRequest(req, res);
  console.log(`Status: ${res.statusCode}, Pending Request ID: ${res.data?.entry?.id}`);
  const reqId = res.data?.entry?.id;
  console.log(`Withdrawable after request: ₹${walletController.calculateWallet(sellerId).withdrawableBalance} (Expected 400)`);

  console.log('\n3. Admin approves → ledger marks completed');
  req = { params: { id: reqId } };
  res = mockRes();
  await adminController.approveWithdrawal(req, res);
  console.log(`Status: ${res.statusCode}, Request Status: ${res.data?.entry?.status}`);
  console.log(`Withdrawable after approve: ₹${walletController.calculateWallet(sellerId).withdrawableBalance} (Expected 400 - permanently deducted)`);

  console.log('\n4. Same request approve again → blocked');
  req = { params: { id: reqId } };
  res = mockRes();
  await adminController.approveWithdrawal(req, res);
  console.log(`Status: ${res.statusCode}, Error: ${res.data?.error} (Expected 400)`);

  console.log('\n5. Reject request → no deduction (balance restores)');
  // Create another request for 500 (since min is 500)
  // Wait, does seller have 500? Withdrawable is 400!
  // Give seller 500 more
  walletLedgerDB.push({
    id: `txn-seed-5`,
    userId: sellerId,
    type: 'seller_earning',
    amount: 500,
    status: 'completed',
    referenceType: 'order',
    createdAt: new Date().toISOString(),
    availableAt: new Date(Date.now() - 1000).toISOString()
  });
  
  req = { body: { userId: sellerId, amount: 500, upiId: 'sel@upi' } };
  res = mockRes();
  await walletController.withdrawRequest(req, res);
  if (res.statusCode !== 201) console.log('Withdraw request failed:', res.data?.error);
  const rejectReqId = res.data?.entry?.id;
  console.log(`Withdrawable before reject: ₹${walletController.calculateWallet(sellerId).withdrawableBalance} (Expected 400)`);

  req = { params: { id: rejectReqId }, body: { reason: 'Invalid UPI' } };
  res = mockRes();
  await adminController.rejectWithdrawal(req, res);
  console.log(`Status: ${res.statusCode}, Error: ${res.data?.error}, Request Status: ${res.data?.entry?.status}`);
  console.log(`Withdrawable after reject: ₹${walletController.calculateWallet(sellerId).withdrawableBalance} (Expected 900)`);

  console.log('\n6. Cashback withdrawal attempt → blocked');
  // Give buyer 1000 cashback
  walletLedgerDB.push({
    id: `txn-seed-3`,
    userId: buyerId,
    type: 'cashback',
    amount: 1000,
    status: 'completed',
    referenceType: 'order',
    createdAt: new Date().toISOString(),
    availableAt: new Date().toISOString()
  });
  console.log(`Buyer Total Balance: ₹${walletController.calculateWallet(buyerId).totalBalance}`);
  console.log(`Buyer Withdrawable: ₹${walletController.calculateWallet(buyerId).withdrawableBalance} (Expected 0)`);
  
  req = { body: { userId: buyerId, amount: 600, upiId: 'buy@upi' } };
  res = mockRes();
  await walletController.withdrawRequest(req, res);
  console.log(`Status: ${res.statusCode}, Error: ${res.data?.error} (Expected 400 - Insufficient withdrawable)`);
};

runWithdrawalTests();
