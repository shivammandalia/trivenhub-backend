const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, required: true },
  name: { type: String, required: true },
  wallet: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  trust: { type: Number, default: 100 },
  online: { type: Boolean, default: false },
}, { timestamps: true });

const listingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  sellerId: { type: String, required: true, index: true },
  sellerName: { type: String, required: true },
  productName: { type: String, required: true },
  productImage: { type: String },
  duration: { type: String },
  price: { type: Number, required: true },
  description: { type: String },
  deliveryType: { type: String, required: true, index: true }, // 'auto' or 'manual'
  stock: { type: Number, default: 0 },
  status: { type: String, default: 'active', index: true },
  rating: { type: Number, default: 5.0 },
}, { timestamps: true });

const credentialSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  listingId: { type: String, required: true },
  loginId: { type: String, required: true },
  password: { type: String, required: true },
  status: { type: String, default: 'available' },
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  from: { type: String, required: true },
  text: { type: String, required: true },
  time: { type: String, required: true },
});

const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  productId: { type: String, required: true },
  productName: { type: String },
  productImage: { type: String },
  sellerId: { type: String, required: true, index: true },
  sellerName: { type: String },
  buyerId: { type: String, required: true, index: true },
  buyerName: { type: String },
  buyerPhone: { type: String },
  amount: { type: Number, required: true },
  status: { type: String, required: true, index: true }, // 'new', 'accepted', 'otp_requested', 'otp_submitted', 'delivered', 'completed', 'cancelled', 'disputed'
  deliveryType: { type: String }, // 'auto' or 'manual'
  timer: { type: String },
  messages: [messageSchema],
  credentials: { type: mongoose.Schema.Types.Mixed }, // Array of objects
  otp: { type: String },
}, { timestamps: true });

const walletLedgerSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true }, // 'deposit', 'withdrawal', 'purchase_hold', 'purchase_release', 'sale_credit', 'refund', 'penalty'
  amount: { type: Number, required: true },
  status: { type: String, default: 'completed', index: true }, // 'pending', 'completed', 'failed'
  referenceType: { type: String }, // 'order', 'deposit', 'withdrawal'
  referenceId: { type: String, index: true },
  label: { type: String },
  availableAt: { type: Date },
  upiId: { type: String },
}, { timestamps: true });

const withdrawalSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  upiId: { type: String, required: true },
  status: { type: String, default: 'pending' }, // 'pending', 'completed', 'rejected'
}, { timestamps: true });

const disputeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  orderId: { type: String, required: true },
  raisedBy: { type: String, required: true }, // 'buyer' or 'seller'
  reason: { type: String, required: true },
  status: { type: String, default: 'open' }, // 'open', 'resolved'
  resolution: { type: String },
}, { timestamps: true });

const adminAuditSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  adminId: { type: String, required: true },
  action: { type: String, required: true },
  targetId: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

const paymentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: 'pending' }, // 'pending', 'success', 'failed'
  paymentSessionId: { type: String },
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: 'info' },
  read: { type: Boolean, default: false },
}, { timestamps: true });

const adminSettingSchema = new mongoose.Schema({
  platformFeePercent: { type: Number, default: 0 },
  cashbackPercent: { type: Number, default: 0 },
});

const User = mongoose.model('User', userSchema);
const Listing = mongoose.model('Listing', listingSchema);
const Credential = mongoose.model('Credential', credentialSchema);
const Order = mongoose.model('Order', orderSchema);
const WalletLedger = mongoose.model('WalletLedger', walletLedgerSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
const Dispute = mongoose.model('Dispute', disputeSchema);
const AdminAudit = mongoose.model('AdminAudit', adminAuditSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const AdminSetting = mongoose.model('AdminSetting', adminSettingSchema);

module.exports = {
  User, Listing, Credential, Order, WalletLedger, 
  Withdrawal, Dispute, AdminAudit, Payment, Notification, AdminSetting
};
