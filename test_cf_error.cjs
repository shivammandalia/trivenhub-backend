const http = require('http');

(async () => {
  console.log('Testing create-order...');
  try {
    const res = await fetch('http://localhost:5000/api/payments/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'admin1', amount: 10 }) // We know admin1 exists in memory from DataContext initialization, wait actually the backend has its own mockDB
    });
    
    // First let's check what the backend mockDB has
    if (res.status === 404) {
        console.log('Got 404, doing sync first...');
        await fetch('http://localhost:5000/api/users/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'test_user_1', phone: '1234567890' })
        });
        const res2 = await fetch('http://localhost:5000/api/payments/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'test_user_1', amount: 10 })
        });
        console.log('Retry Result:', await res2.json());
    } else {
        console.log('Result:', await res.json());
    }
  } catch(e) {
    console.error(e);
  }
})();
