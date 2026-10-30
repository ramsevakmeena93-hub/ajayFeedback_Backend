require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const User = require('./models/User');

async function verifyUser() {
  const email = '25tc1aj7@mitsgwl.ac.in';
  
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected successfully');

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(`User ${email} not found`);
      process.exit(0);
    }

    console.log(`\nFinal user: ${user.name} (${user.email})`);
    console.log(`Role: ${user.role}`);
    console.log(`Roles: ${JSON.stringify(user.roles || [])}`);
    console.log(`Department: ${user.department || 'none'}`);
    console.log(`Is HOD: ${user.isHOD}`);

    await mongoose.disconnect();
    console.log('\nVerification complete!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

verifyUser();
