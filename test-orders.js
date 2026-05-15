const http = require('http');

const API_BASE = 'http://localhost:5000/api';

const fetchApi = (method, path, body = null) => {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: `/api${path}`,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (e) => resolve({ status: 0, error: e.message }));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

const runTests = async () => {
  console.log('--- STARTING TESTS ---\n');

  // Create a seller
  const sellerId = 'admin_1';
  const buyerId = 'test_buyer_1';

  // --- PREP: Add an Auto Listing with 2 credentials ---
  const autoListingRes = await fetchApi('POST', '/listings', {
    sellerId,
    sellerName: 'Test Seller',
    productName: 'Auto Prod',
    productImage: 'img.jpg',
    duration: '1m',
    price: 10,
    description: 'test',
    deliveryType: 'auto',
    credentials: [{ loginId: 'u1', password: 'p1' }, { loginId: 'u2', password: 'p2' }]
  });
  const autoListId = autoListingRes.data.listing.id;

  // --- PREP: Add a Manual Listing ---
  // Ensure seller is online
  await fetchApi('PUT', `/users/${sellerId}/online`, { online: true });
  const manualListingRes = await fetchApi('POST', '/listings', {
    sellerId,
    sellerName: 'Test Seller',
    productName: 'Manual Prod',
    productImage: 'img.jpg',
    duration: '1m',
    price: 15,
    description: 'test',
    deliveryType: 'manual',
    stock: 10
  });
  const manualListId = manualListingRes.data.listing.id;

  console.log('--- PHASE 1: AUTO ORDER EDGE TEST ---');
  const autoOrders = await Promise.all([
    fetchApi('POST', '/orders', { buyerId, productId: autoListId, amount: 10 }),
    fetchApi('POST', '/orders', { buyerId, productId: autoListId, amount: 10 }),
    fetchApi('POST', '/orders', { buyerId, productId: autoListId, amount: 10 })
  ]);
  console.log('Order 1:', autoOrders[0].status, autoOrders[0].data);
  console.log('Order 2:', autoOrders[1].status, autoOrders[1].data);
  console.log('Order 3:', autoOrders[2].status, autoOrders[2].data);
  // Expected: Two 201s, one 400 (Out of stock)

  console.log('\n--- PHASE 2 & 3: MANUAL ORDER VALIDATION & CHEATING ---');
  // Create Manual Order
  const manualOrderRes = await fetchApi('POST', '/orders', { buyerId, productId: manualListId, amount: 15 });
  console.log('Created Manual Order Response:', manualOrderRes.status, manualOrderRes.data);
  const mOrderId = manualOrderRes.data.order.id;

  // Buyer tries to skip OTP and mark received (pending -> completed)
  let cheat1 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'completed', requesterId: buyerId });
  console.log('Buyer skip to completed:', cheat1.status, cheat1.data); // Expected 400

  // Buyer tries seller actions (pending -> accepted)
  let cheat2 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'accepted', requesterId: buyerId });
  console.log('Buyer tries to accept:', cheat2.status, cheat2.data); // Expected 403

  // Seller properly accepts
  let valid1 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'accepted', requesterId: sellerId });
  console.log('Seller accepts:', valid1.status);

  // Seller tries to deliver without OTP
  let cheat3 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'delivered', requesterId: sellerId });
  console.log('Seller deliver without OTP requested:', cheat3.status, cheat3.data); // Expected 400

  // Seller requests OTP
  let valid2 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'otp_requested', requesterId: sellerId });
  console.log('Seller requests OTP:', valid2.status);

  // Seller delivers without buyer submitting OTP
  let cheat4 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'delivered', requesterId: sellerId });
  console.log('Seller deliver before OTP submitted:', cheat4.status, cheat4.data); // Expected 400

  // Buyer submits valid OTP
  let valid3 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'otp_submitted', otp: '123456', requesterId: buyerId });
  console.log('Buyer submits OTP:', valid3.status);

  // Seller delivers
  let valid4 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'delivered', requesterId: sellerId });
  console.log('Seller delivers:', valid4.status);

  // Seller tries buyer action (delivered -> completed)
  let cheat5 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'completed', requesterId: sellerId });
  console.log('Seller tries to mark completed:', cheat5.status, cheat5.data); // Expected 403

  // Buyer completes
  let valid5 = await fetchApi('PUT', `/orders/${mOrderId}/status`, { status: 'completed', requesterId: buyerId });
  console.log('Buyer completes:', valid5.status);

};

runTests();
