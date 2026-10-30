require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const User = require('./models/User');
const UserRole = require('./models/UserRole');

async function checkRoles() {
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

    console.log(`\n=== User Document ===`);
    console.log(`ID: ${user._id}`);
    console.log(`Name: ${user.name}`);
    console.log(`Email: ${user.email}`);
    console.log(`role: ${user.role}`);
    console.log(`roles: ${JSON.stringify(user.roles || [])}`);
    console.log(`department: ${user.department || 'none'}`);

    console.log(`\n=== UserRole Collection ===`);
    const userRoles = await UserRole.find({ userId: user._id }).lean();
    console.log(`Found ${userRoles.length} UserRole documents:`);
    userRoles.forEach((ur, i) => {
      console.log(`\n[${i + 1}] Role: ${ur.role}`);
      console.log(`    Department: ${ur.departmentScope || 'none'}`);
      console.log(`    Active: ${ur.active}`);
      console.log(`    Created: ${ur.createdAt}`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkRoles();
