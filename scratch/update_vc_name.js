// Update VC user name to Dr. Manjuree Pandit
const mongoose = require('mongoose');
const User = require('../models/User');

// Load .env manually
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
      process.env[key.trim()] = values.join('=').trim();
    }
  });
}

async function updateVCName() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Update the VC user
    const result = await User.updateOne(
      { role: 'vc' },
      { 
        $set: { 
          name: 'Dr. Manjuree Pandit'
        } 
      }
    );

    console.log('Update result:', result);

    if (result.matchedCount > 0) {
      console.log('✅ Successfully updated VC name to "Dr. Manjuree Pandit"');
      const vcUser = await User.findOne({ role: 'vc' }).select('name email role');
      console.log('Current VC user:', vcUser);
    } else {
      console.log('❌ No VC user found');
    }

    await mongoose.connection.close();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateVCName();
