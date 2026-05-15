const http = require('http');

(async () => {
  try {
    console.log('1. Testing Login post-restart (9000000001)...');
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9000000001', password: 'password123' })
    });
    console.log('Login Response:', loginRes.status, await loginRes.json());
    
    console.log('\n2. Testing Admin Login post-restart...');
    const adminRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9820539961', password: 'Chiru@3739' }) // The password hashed in initDB
    });
    console.log('Admin Login Response:', adminRes.status, await adminRes.json());
  } catch (err) {
    console.error(err);
  }
})();
