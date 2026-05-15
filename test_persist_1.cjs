const http = require('http');

(async () => {
  try {
    console.log('1. Registering new customer (9000000001)...');
    const regRes = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9000000001', password: 'password123', name: 'Persist Test', role: 'customer' })
    });
    
    if (regRes.status === 400) {
      console.log('User already registered. Proceeding to next step.');
    } else {
      const regData = await regRes.json();
      console.log('Register Response:', regRes.status, regData);
    }

    console.log('\n2. Testing duplicate registration block...');
    const dupRes = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9000000001', password: 'password123', name: 'Persist Test', role: 'customer' })
    });
    console.log('Duplicate Registration Response:', dupRes.status, await dupRes.json());
    
  } catch (err) {
    console.error(err);
  }
})();
