// Minimal server for debugging Render deployment
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';

console.log('='.repeat(60));
console.log('MINIMAL SERVER STARTUP TEST');
console.log('='.repeat(60));
console.log('PORT:', PORT);
console.log('MONGO_URI:', MONGO_URI ? `Set (${MONGO_URI.length} chars)` : 'NOT SET');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'Set' : 'NOT SET');
console.log('='.repeat(60));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/', (req, res) => {
  res.send('MITS Feedback Backend is running!');
});

console.log('Attempting MongoDB connection...');
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully');
    
    app.listen(PORT, () => {
      console.log('✅ Server is listening on port', PORT);
      console.log('✅ Health check: http://localhost:' + PORT + '/api/health');
      console.log('='.repeat(60));
      console.log('SERVER READY');
      console.log('='.repeat(60));
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:');
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    if (err.reason) {
      console.error('Error reason:', err.reason);
    }
    console.error('Full error:', JSON.stringify(err, null, 2));
    console.log('='.repeat(60));
    console.log('Exiting due to MongoDB connection failure');
    process.exit(1);
  });

// Catch uncaught errors
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ UNHANDLED REJECTION:');
  console.error('Error:', err);
  process.exit(1);
});
