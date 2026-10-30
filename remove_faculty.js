require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const UserRole = require('./models/UserRole');

async function removeFacultyRole() {
  const email = '25tc1aj7@mitsgwl.ac.in';
  
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected successfully');

    const User = require('./models/User');
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(`User ${email} not found`);
      process.exit(0);
    }

    console.log(`User ID: ${user._id}`);

    // Delete the faculty role from UserRole collection
    const result = await UserRole.deleteOne({ 
      userId: user._id, 
      role: 'faculty' 
    });
    
    console.log(`Deleted ${result.deletedCount} faculty role(s)`);

    // Update User document to have only provc in roles array
    user.roles = ['provc'];
    user.role = 'provc';
    await user.save();

    console.log('\n=== Final State ===');
    console.log(`User.role: ${user.role}`);
    console.log(`User.roles: ${JSON.stringify(user.roles)}`);
    console.log(`User.department: ${user.department || 'none'}`);

    const remainingRoles = await UserRole.find({ userId: user._id }).lean();
    console.log(`\nUserRole documents after cleanup: ${remainingRoles.length}`);
    remainingRoles.forEach(r => {
      console.log(`  - ${r.role} (${r.departmentScope || 'none'})`);
    });

    await mongoose.disconnect();
    console.log('\nDone! Only provc role remains.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

removeFacultyRole();
