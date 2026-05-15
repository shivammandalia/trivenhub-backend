const http = require('http');

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

const runWalletTests = async () => {
  console.log('--- WALLET ESCROW TESTS ---\n');

  const buyerId = 'test_buyer_wallet';
  const sellerId = 'admin_1'; // Use admin as seller for online status bypass

  console.log('1. Deposit ₹1000');
  const depRes = await fetchApi('POST', '/wallet/deposit', { userId: buyerId, amount: 1000 });
  console.log(`Deposit status: ${depRes.status}, Balance: ₹${depRes.data.wallet.totalBalance}`);

  console.log('\n--- PREP LISTINGS ---');
  // Auto Listing
  const autoListingRes = await fetchApi('POST', '/listings', {
    sellerId, sellerName: 'Test Seller', productName: 'Auto Escrow Prod',
    duration: '1m', price: 300, deliveryType: 'auto',
    credentials: [{ loginId: 'u1', password: 'p1' }]
  });
  const autoListId = autoListingRes.data.listing.id;

  // Manual Listing
  const manualListingRes = await fetchApi('POST', '/listings', {
    sellerId, sellerName: 'Test Seller', productName: 'Manual Escrow Prod',
    duration: '1m', price: 400, deliveryType: 'manual', stock: 10
  });
  const manualListId = manualListingRes.data.listing.id;

  console.log('\n2. Buy ₹300 auto product');
  const autoBuy = await fetchApi('POST', '/orders', { buyerId, productId: autoListId, amount: 300 });
  console.log(`Order status: ${autoBuy.status}`);

  console.log('\n3. Confirm buyer balance reduces');
  const bWalletAfterAuto = await fetchApi('GET', `/wallet/${buyerId}`);
  console.log(`Buyer Balance: ₹${bWalletAfterAuto.data.totalBalance} (Expected 700)`);

  console.log('\n4. Confirm seller earning created (Auto completes instantly)');
  const sWalletAuto = await fetchApi('GET', `/wallet/${sellerId}`);
  console.log(`Seller Earnings: ₹${sWalletAuto.data.earnings} (Expected 300)`);

  console.log('\n5. Confirm seller earning not withdrawable before 24h');
  console.log(`Seller Withdrawable: ₹${sWalletAuto.data.withdrawableBalance} (Expected 0)`);

  console.log('\n6. Try withdraw ₹100 -> fail');
  const w1 = await fetchApi('POST', '/wallet/withdraw', { userId: sellerId, amount: 100 });
  console.log(`Withdraw 100 status: ${w1.status} (Expected 400 - Min 500)`);

  console.log('\n7. Try withdraw cashback -> fail');
  const w2 = await fetchApi('POST', '/wallet/withdraw', { userId: buyerId, amount: 600 });
  // Buyer has 700 total balance, but withdrawable should be 0 because it's from deposit, not earnings! Wait, deposit is not withdrawable?
  // Let's see: The prompt said "Only earnings are withdrawable". So buyer's withdrawable should be 0.
  console.log(`Withdraw 600 status: ${w2.status} (Expected 400)`);

  console.log('\n8. Refund order -> buyer gets money back');
  // Place manual order, then refund it
  const manualBuy = await fetchApi('POST', '/orders', { buyerId, productId: manualListId, amount: 400 });
  console.log(`Manual Order: ${manualBuy.status}, Buyer Balance after buy: ₹${(await fetchApi('GET', `/wallet/${buyerId}`)).data.totalBalance} (Expected 300)`);
  
  // Refund it
  const refundReq = await fetchApi('PUT', `/orders/${manualBuy.data.order.id}/status`, { status: 'refunded', requesterId: buyerId });
  console.log(`Refund status: ${refundReq.status}`);
  const bWalletAfterRefund = await fetchApi('GET', `/wallet/${buyerId}`);
  console.log(`Buyer Balance after refund: ₹${bWalletAfterRefund.data.totalBalance} (Expected 700)`);

  console.log('\n9. Try double refund -> fail');
  const doubleRefund = await fetchApi('PUT', `/orders/${manualBuy.data.order.id}/status`, { status: 'refunded', requesterId: buyerId });
  // Wait, if it's already refunded, updateOrderStatus might not stop it unless we check. But releaseEscrow handles idempotency by checking `status === 'locked'`.
  // Let's check buyer balance anyway
  const bWalletDoubleRefund = await fetchApi('GET', `/wallet/${buyerId}`);
  console.log(`Buyer Balance after 2nd refund attempt: ₹${bWalletDoubleRefund.data.totalBalance} (Expected 700)`);

  console.log('\n10. Set platform fee 5% and cashback 1%');
  await fetchApi('POST', '/wallet/admin-settings', { platformFeePercent: 5, cashbackPercent: 1 });
  console.log('Settings updated.');

  console.log('\n11. Place order (Auto, 300)');
  // We need another auto listing since the first one is out of stock
  const autoListingRes2 = await fetchApi('POST', '/listings', {
    sellerId, sellerName: 'Test Seller', productName: 'Auto Escrow Prod 2',
    duration: '1m', price: 300, deliveryType: 'auto',
    credentials: [{ loginId: 'u2', password: 'p2' }]
  });
  const autoListId2 = autoListingRes2.data.listing.id;

  const autoBuy2 = await fetchApi('POST', '/orders', { buyerId, productId: autoListId2, amount: 300 });
  console.log(`Order status: ${autoBuy2.status}`);

  console.log('\n12. Confirm seller receives 95% (₹285)');
  const sWalletFinal = await fetchApi('GET', `/wallet/${sellerId}`);
  // Expected earnings: Previous 300 + new 285 = 585
  console.log(`Seller Earnings: ₹${sWalletFinal.data.earnings} (Expected 585)`);

  console.log('\n13. Confirm buyer gets 1% cashback (₹3)');
  const bWalletFinal = await fetchApi('GET', `/wallet/${buyerId}`);
  console.log(`Buyer Cashback: ₹${bWalletFinal.data.cashback} (Expected 3)`);

  console.log('\n14. Confirm admin/platform gets 5% fee (₹15)');
  const aWalletFinal = await fetchApi('GET', `/wallet/admin_1`);
  // Admin fee doesn't go to admin's standard earnings, it's a platform fee, but wait, `platform_fee` is attributed to admin_1
  // Wait, does calculateWallet add `platform_fee` to admin's totalBalance?
  // Let's check admin_1 transactions.
  const aTxRes = await fetchApi('GET', `/wallet/admin_1/transactions`);
  const feeTx = aTxRes.data.filter(t => t.type === 'platform_fee');
  const totalFees = feeTx.reduce((s,t) => s + t.amount, 0);
  console.log(`Admin Platform Fees: ₹${totalFees} (Expected 15)`);
};

runWalletTests();
