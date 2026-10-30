require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const User = require('./models/User');
const UserRole = require('./models/UserRole');

async function updateRoles() {
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

    console.log(`User ID: ${user._id}`);
    
    // Find all user roles
    const userRoles = await UserRole.find({ userId: user._id });
    console.log(`Found ${userRoles.length} UserRole documents`);

    // Update the HOD role to Pro-VC
    let updatedCount = 0;
    for (const ur of userRoles) {
      console.log(`\nProcessing: ${ur.role} (${ur.departmentScope})`);
      
      if (ur.role === 'hod') {
        // Change hod to provc and clear department
        ur.role = 'provc';
        ur.departmentScope = '';
        await ur.save();
        console.log(`  Updated to: provc (no department)`);
        updatedCount++;
      } else if (ur.role === 'provc') {
        // Make sure provc has no department
        if (ur.departmentScope) {
          ur.departmentScope = '';
          await ur.save();
          console.log(`  Cleared department for provc`);
        }
      }
    }

    // Update the User document's roles array to match
    const finalRoles = await UserRole.find({ userId: user._id, active: true })
      .distinct('role');
    
    // Set primary role to provc if present, otherwise first role
    user.role = finalRoles.includes('provc') ? 'provc' : (finalRoles[0] || 'provc');
    user.roles = finalRoles;
    await user.save();
    
    console.log(`\n=== Final State ===`);
    console.log(`User.role: ${user.role}`);
    console.log(`User.roles: ${JSON.stringify(user.roles)}`);
    console.log(`User.department: ${user.department || 'none'}`);
    
    const remainingRoles = await UserRole.find({ userId: user._id }).lean();
    console.log(`\nUserRole documents after update: ${remainingRoles.length}`);
    remainingRoles.forEach(r => {
      console.log(`  - ${r.role} (${r.departmentScope})`);
    });

    await mongoose.disconnect();
    console.log(`\nDone! Updated ${updatedCount} role(s).`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

updateRoles();
