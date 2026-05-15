require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
const corsOptions = {
  origin: [
    'http://localhost:5500', 
    'http://127.0.0.1:5500', 
    'http://localhost:3000',
    'https://jugaadubhai.shop', 
    'https://www.jugaadubhai.shop'
  ],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const listingsRoutes = require('./routes/listingsRoutes');
const ordersRoutes = require('./routes/ordersRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminOperationsRoutes = require('./routes/adminOperationsRoutes');
const disputesRoutes = require('./routes/disputesRoutes');
const paymentsRoutes = require('./routes/paymentsRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/operations', adminOperationsRoutes);
app.use('/api/disputes', disputesRoutes);
app.use('/api/payments', paymentsRoutes);

// Basic Route
app.get('/', (req, res) => {
  res.send('Backend running');
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
