const { disputesDB, ordersDB, walletLedgerDB, adminSettingsDB } = require('./models/mockDB');
const disputesController = require('./controllers/disputesController');
const walletController = require('./controllers/walletController');
const ordersController = require('./controllers/ordersController');

const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

const runDisputeTests = async () => {
  console.log('--- DISPUTE + REFUND TESTS ---\n');
  const buyerId = 'buyer_disp';
  const sellerId = 'seller_disp';

  // Seed Admin Settings
  adminSettingsDB.platformFeePercent = 10;
  adminSettingsDB.cashbackPercent = 5;

  // Initial balance for buyer to buy things
  walletLedgerDB.push({
    id: `txn-init`,
    userId: buyerId,
    type: 'deposit',
    amount: 10000,
    status: 'completed',
    referenceType: 'deposit',
    createdAt: new Date().toISOString(),
    availableAt: new Date().toISOString()
  });

  // Helper to create an order and a dispute
  const createDisputedOrder = async (orderId, amount) => {
    // Manually push order
    const order = {
      id: orderId,
      buyerId,
      sellerId,
      productName: `Product ${orderId}`,
      amount,
      status: 'pending',
      deliveryType: 'manual',
      createdAt: new Date().toISOString()
    };
    ordersDB.push(order);

    // Lock funds for order (purchase hold)
    walletLedgerDB.push({
      id: `txn-hold-${orderId}`,
      userId: buyerId,
      type: 'purchase_hold',
      amount: -amount,
      status: 'locked',
      referenceType: 'order',
      referenceId: orderId,
      createdAt: new Date().toISOString(),
      availableAt: new Date().toISOString()
    });

    // Create dispute
    const req = { body: { orderId, raisedBy: 'buyer', reason: 'Defective' } };
    const res = mockRes();
    await disputesController.createDispute(req, res);
    return res.data.dispute.id;
  };

  const checkBalances = (logPrefix) => {
    const bw = walletController.calculateWallet(buyerId);
    const sw = walletController.calculateWallet(sellerId);
    const aw = walletController.calculateWallet('admin_1');
    console.log(`${logPrefix} -> Buyer: ₹${bw.totalBalance} (Hold: ₹${bw.onHold}, CB: ₹${bw.cashback}) | Seller: ₹${sw.earnings} | Admin: ₹${aw.totalBalance}`);
  };

  console.log('1. Buyer Wins (Full Refund)');
  checkBalances('Init');
  let dispId = await createDisputedOrder('ord-1', 1000); // Buyer: 9000 total, 1000 onHold
  checkBalances('After order');
  
  let req = { params: { id: dispId }, body: { resolution: 'buyer_win' } };
  let res = mockRes();
  await disputesController.resolveDispute(req, res);
  checkBalances('After buyer_win'); // Buyer: 10000 total, 0 onHold. Seller: 0. Admin: 0.
  
  console.log('\n2. Double Resolution Block');
  res = mockRes();
  await disputesController.resolveDispute(req, res);
  console.log(`Status: ${res.statusCode}, Error: ${res.data.error}`);

  console.log('\n3. Seller Wins (Full Payout)');
  dispId = await createDisputedOrder('ord-2', 1000); // Buyer: 9000, 1000 onHold
  checkBalances('After order 2');
  
  req = { params: { id: dispId }, body: { resolution: 'seller_win' } };
  res = mockRes();
  await disputesController.resolveDispute(req, res);
  checkBalances('After seller_win'); 
  // Buyer: 9000 total, 0 onHold, +50 cashback = 9050? Wait, cashback is added to totalBalance? 
  // calculateWallet logic: totalBalance += cashback. So Buyer total = 9050.
  // Seller: 1000 - 100 (10%) = 900 earnings.
  // Admin: 100 fee.

  console.log('\n4. Partial Settlement (Custom Refund)');
  dispId = await createDisputedOrder('ord-3', 1000); // Buyer drops 1000 hold.
  checkBalances('After order 3');

  // Buyer refund 400. Seller keeps 600.
  // Fee on 600 = 60. Seller gets 540.
  // Buyer net spend = 1000 - 400 = 600. CB on 600 = 30.
  // Buyer refund + CB = 400 + 30 = 430 added back.
  req = { params: { id: dispId }, body: { resolution: 'partial', buyerRefundAmount: 400 } };
  res = mockRes();
  await disputesController.resolveDispute(req, res);
  checkBalances('After partial');

  console.log('\nValidation Check (Partial):');
  const dRes = res.data.dispute;
  const oRes = res.data.order;
  console.log(`Dispute Status: ${dRes.status}, Order Status: ${oRes.status}`);
  console.log('Testing done!');
};

runDisputeTests();
