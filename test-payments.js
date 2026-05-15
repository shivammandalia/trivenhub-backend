const { usersDB, walletLedgerDB, paymentsDB } = require('./models/mockDB');
const paymentsController = require('./controllers/paymentsController');

const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

// Mock fetch globally
global.fetch = async (url, options) => {
  console.log(`[MOCK FETCH] ${options.method} ${url}`);
  
  if (url.includes('/orders') && options.method === 'POST') {
    const body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        payment_session_id: `session_${Math.random().toString(36).substring(7)}`,
        order_id: body.order_id
      })
    };
  }

  if (url.includes('/orders/') && options.method === 'GET') {
    // Simulate successful order check
    return {
      ok: true,
      json: async () => ({ order_status: 'PAID' })
    };
  }
};

const runPaymentTests = async () => {
  console.log('--- CASHFREE PAYMENTS TESTS ---\n');

  // Setup mock user
  usersDB.push({ id: 'buyer_cashfree', phone: '9998887776', name: 'CF Tester' });

  let req, res;
  let orderId;

  // 1. Test Minimum Amount Block
  console.log('1. Testing Minimum Amount...');
  req = { body: { userId: 'buyer_cashfree', amount: 5 } };
  res = mockRes();
  await paymentsController.createOrder(req, res);
  console.log(`Result for ₹5 deposit: ${res.statusCode} - ${res.data.error}`);

  // 2. Create Order Success
  console.log('\n2. Testing Create Order (₹100)...');
  req = { body: { userId: 'buyer_cashfree', amount: 100 } };
  res = mockRes();
  await paymentsController.createOrder(req, res);
  orderId = res.data.orderId;
  console.log(`Created Order ID: ${orderId}, Session: ${res.data.paymentSessionId}`);
  console.log(`PaymentsDB Length: ${paymentsDB.length}, Status: ${paymentsDB[0].status}`);

  // 3. Verify Payment Success
  console.log('\n3. Testing Verify Payment...');
  req = { body: { orderId } };
  res = mockRes();
  await paymentsController.verifyPayment(req, res);
  const ledgerEntry = walletLedgerDB.find(e => e.referenceId === orderId);
  console.log(`Verification Response: ${res.data.message}`);
  console.log(`Wallet Ledger Deposit Found: ${ledgerEntry ? 'Yes' : 'No'} (₹${ledgerEntry?.amount})`);

  // 4. Duplicate Verification Prevention
  console.log('\n4. Testing Duplicate Verification...');
  req = { body: { orderId } };
  res = mockRes();
  await paymentsController.verifyPayment(req, res);
  console.log(`Duplicate Attempt Result: ${res.statusCode} - ${res.data.error}`);

  console.log('\nTesting Complete!');
};

runPaymentTests();
