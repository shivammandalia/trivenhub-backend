const { usersDB, walletLedgerDB, paymentsDB, saveDB } = require('../models/mockDB');
const uuidv4 = () => Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

const getCashfreeHeaders = () => {
  return {
    'x-client-id': process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    'x-api-version': '2023-08-01',
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
};

const getBaseUrl = () => {
  return process.env.CASHFREE_ENV === 'PROD' 
    ? 'https://api.cashfree.com/pg' 
    : 'https://sandbox.cashfree.com/pg';
};

exports.createOrder = async (req, res) => {
  try {
    const { userId, amount } = req.body;
    
    if (!userId || !amount || amount < 10) {
      return res.status(400).json({ error: 'Invalid user or amount (minimum ₹10)' });
    }

    const user = usersDB.find(u => u.id === userId || u.phone === userId);
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found. Please login again to sync your account', 
        needsSync: true 
      });
    }

    // Generate unique order ID
    // Note: since we removed uuid dependency previously, I will use a custom ID generator
    const orderId = `cf_ord_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`;

    const orderPayload = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: user.id,
        customer_phone: user.phone || '9999999999',
        customer_name: user.name || 'User'
      }
    };

    const response = await fetch(`${getBaseUrl()}/orders`, {
      method: 'POST',
      headers: getCashfreeHeaders(),
      body: JSON.stringify(orderPayload)
    });

    const data = await response.json();

    // Log response safely
    console.log('Cashfree Create Order Response:', { 
      order_id: data.order_id, 
      order_status: data.order_status, 
      payment_session_id: data.payment_session_id ? '[REDACTED_SESSION_ID]' : undefined,
      message: data.message,
      code: data.code
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'Payment gateway error', details: data });
    }

    if (!data.payment_session_id) {
      return res.status(500).json({ error: 'Cashfree did not return payment_session_id', details: data });
    }

    // Save order intent to DB
    paymentsDB.push({
      orderId,
      userId,
      amount,
      status: 'pending',
      paymentSessionId: data.payment_session_id,
      createdAt: new Date().toISOString()
    });
    saveDB('payments');

    res.json({
      success: true,
      orderId,
      paymentSessionId: data.payment_session_id,
      environment: process.env.CASHFREE_ENV === 'PROD' ? 'production' : 'sandbox'
    });

  } catch (error) {
    console.error('Create Order Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    // Find the order in paymentsDB
    const paymentRecord = paymentsDB.find(p => p.orderId === orderId);
    if (!paymentRecord) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    if (paymentRecord.status === 'SUCCESS') {
      return res.status(400).json({ error: 'Payment already verified and credited' });
    }

    // Verify order status with Cashfree
    const response = await fetch(`${getBaseUrl()}/orders/${orderId}`, {
      method: 'GET',
      headers: getCashfreeHeaders()
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Cashfree Verify Order Error:', data);
      return res.status(500).json({ error: 'Failed to fetch order status from gateway' });
    }

    if (data.order_status === 'PAID') {
      // Credit wallet
      const txId = `dep_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
      walletLedgerDB.push({
        id: txId,
        userId: paymentRecord.userId,
        type: 'deposit',
        amount: paymentRecord.amount,
        status: 'completed',
        referenceType: 'payment',
        referenceId: orderId,
        createdAt: new Date().toISOString(),
        availableAt: new Date().toISOString()
      });

      // Update payment record
      paymentRecord.status = 'SUCCESS';
      paymentRecord.txId = txId;

      saveDB('walletLedger');
      saveDB('payments');

      return res.json({ message: 'Payment verified successfully. Wallet updated.', status: 'SUCCESS' });
    } else {
      paymentRecord.status = data.order_status; // FAILED, PENDING, etc
      saveDB('payments');
      return res.json({ message: `Payment is ${data.order_status}`, status: data.order_status });
    }

  } catch (error) {
    console.error('Verify Payment Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
