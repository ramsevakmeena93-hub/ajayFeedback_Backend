require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const User = require('./models/User');
const UserRole = require('./models/UserRole');

async function updateIndustrialHOD() {
  // Support both email formats
  const possibleEmails = [
    '25tc1aj7@mitsgwalior.in',
    '25tc1aj7@mitsgwalior.in.ac',
    '25tc1aj7@mitsgwl.ac.in'
  ];
  
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected successfully\n');

    // Try to find user with any of the possible emails
    let user = null;
    let foundEmail = '';
    
    for (const email of possibleEmails) {
      user = await User.findOne({ email: email.toLowerCase() });
      if (user) {
        foundEmail = email;
        break;
      }
    }
    
    if (!user) {
      console.log(`❌ User not found with any of these emails:`);
      possibleEmails.forEach(e => console.log(`   - ${e}`));
      console.log('\n🔍 Searching for similar emails...');
      
      const allUsers = await User.find({ 
        email: { $regex: '25tc1aj7', $options: 'i' } 
      }).select('email name department role');
      
      if (allUsers.length > 0) {
        console.log('\n📧 Found similar users:');
        allUsers.forEach(u => {
          console.log(`   Email: ${u.email}`);
          console.log(`   Name: ${u.name}`);
          console.log(`   Dept: ${u.department}`);
          console.log(`   Role: ${u.role}\n`);
        });
      } else {
        console.log('❌ No users found with similar email');
      }
      
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(`✅ Found user: ${foundEmail}`);
    console.log(`   User ID: ${user._id}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Current Role: ${user.role}`);
    console.log(`   Current Department: ${user.department}`);
    
    // Find all current roles
    const currentRoles = await UserRole.find({ userId: user._id });
    console.log(`\n📋 Current UserRole documents: ${currentRoles.length}`);
    currentRoles.forEach(r => {
      console.log(`   - ${r.role} (${r.departmentScope || 'no department'}) - Active: ${r.active}`);
    });

    console.log('\n🔄 Making changes...');

    // 1. Remove admin role if exists
    const adminRole = await UserRole.findOne({ 
      userId: user._id, 
      role: 'admin' 
    });
    
    if (adminRole) {
      await UserRole.deleteOne({ _id: adminRole._id });
      console.log('   ✅ Removed admin role');
    } else {
      console.log('   ℹ️  No admin role found to remove');
    }

    // 2. Check if HOD role for Industrial Production already exists
    let hodRole = await UserRole.findOne({
      userId: user._id,
      role: 'hod'
    });

    if (hodRole) {
      // Update existing HOD role
      hodRole.departmentScope = 'Industrial Production';
      hodRole.active = true;
      await hodRole.save();
      console.log('   ✅ Updated existing HOD role to Industrial Production');
    } else {
      // Create new HOD role
      hodRole = new UserRole({
        userId: user._id,
        role: 'hod',
        departmentScope: 'Industrial Production',
        active: true,
        assignedBy: user._id,
        assignedAt: new Date(),
      });
      await hodRole.save();
      console.log('   ✅ Created new HOD role for Industrial Production');
    }

    // 3. Update User document
    user.role = 'hod';
    user.department = 'Industrial Production';
    user.activeWorkspace = 'hod';
    
    // Update roles array
    const activeRoles = await UserRole.find({ 
      userId: user._id, 
      active: true 
    }).distinct('role');
    
    user.roles = activeRoles;
    await user.save();
    
    console.log('   ✅ Updated User document');

    // Display final state
    console.log('\n✨ === FINAL STATE ===');
    console.log(`Email: ${user.email}`);
    console.log(`Name: ${user.name}`);
    console.log(`Primary Role: ${user.role}`);
    console.log(`Department: ${user.department}`);
    console.log(`Active Workspace: ${user.activeWorkspace}`);
    console.log(`All Roles: ${JSON.stringify(user.roles)}`);
    
    const finalRoles = await UserRole.find({ userId: user._id }).lean();
    console.log(`\n📋 UserRole documents: ${finalRoles.length}`);
    finalRoles.forEach(r => {
      console.log(`   - ${r.role} (${r.departmentScope || 'no department'}) - Active: ${r.active}`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Done! User is now HOD of Industrial Production (admin removed)');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

updateIndustrialHOD();
