require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const User = require('./models/User');

async function changeRole() {
  const email = '25tc1aj7@mitsgwl.ac.in';
  
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected successfully');

    // Find the user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(`User ${email} not found`);
      process.exit(0);
    }

    console.log(`Current user: ${user.name} (${user.email})`);
    console.log(`Current role: ${user.role}`);
    console.log(`Current roles: ${JSON.stringify(user.roles || [])}`);
    console.log(`Current department: ${user.department || 'none'}`);

    // Update role to provc and remove hod department
    user.role = 'provc';
    user.roles = ['provc'];
    user.department = null;
    user.isHOD = false;

    await user.save();
    console.log('\nUpdated successfully!');
    console.log(`New role: ${user.role}`);
    console.log(`New roles: ${JSON.stringify(user.roles || [])}`);
    console.log(`New department: ${user.department || 'none'}`);

    await mongoose.disconnect();
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

changeRole();
