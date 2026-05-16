const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const dbURI = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!dbURI) throw new Error("Database URI is missing in environment variables!");

    const conn = await mongoose.connect(dbURI, {
      serverSelectionTimeoutMS: 50000,
      socketTimeoutMS: 45000
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`Error connecting to MongoDB: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
