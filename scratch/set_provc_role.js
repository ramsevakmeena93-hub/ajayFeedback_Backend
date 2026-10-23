require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const UserRole = require('../models/UserRole');

const MONGO_URI = process.env.MONGO_URI;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const email = '25tc1aj7@mitsgwl.ac.in';
  const user = await User.findOne({ email });
  if (!user) {
    console.error('ERROR: User not found:', email);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('Found user:', user._id, user.name);

  // 1. Deactivate all 'hod' UserRole docs for this user
  const hodResult = await UserRole.updateMany(
    { userId: user._id, role: 'hod' },
    { $set: { active: false, revokedAt: new Date() } }
  );
  console.log('Deactivated hod UserRole docs:', hodResult.modifiedCount);

  // 2. Upsert a 'provc' UserRole doc (reactivate if exists, create if not)
  const existing = await UserRole.findOne({ userId: user._id, role: 'provc' });
  if (existing) {
    existing.active = true;
    existing.revokedAt = null;
    existing.revokedBy = null;
    await existing.save();
    console.log('Reactivated existing provc UserRole doc');
  } else {
    await UserRole.create({ userId: user._id, role: 'provc', departmentScope: '', active: true });
    console.log('Created new provc UserRole doc');
  }

  // 3. Update User document
  const newWorkspace = (user.activeWorkspace === 'hod') ? 'provc' : user.activeWorkspace;
  const newRoles = [
    ...user.roles.filter(r => r !== 'hod'),
    'provc',
  ];
  // Remove duplicates
  const uniqueRoles = [...new Set(newRoles)];

  user.role = 'provc';
  user.roles = uniqueRoles;
  user.activeWorkspace = newWorkspace;
  await user.save();
  console.log('Updated User doc — role:', user.role, '| roles:', user.roles, '| activeWorkspace:', user.activeWorkspace);

  // 4. Verify
  const verify = await User.findOne({ email });
  const verifyRoles = await UserRole.find({ userId: verify._id });
  console.log('\n--- VERIFICATION ---');
  console.log('User.role:', verify.role);
  console.log('User.roles:', verify.roles);
  console.log('User.activeWorkspace:', verify.activeWorkspace);
  console.log('UserRole docs:');
  verifyRoles.forEach(r => console.log(' ', r.role, '| active:', r.active));

  const provcActive = verifyRoles.some(r => r.role === 'provc' && r.active);
  const hodInactive = verifyRoles.filter(r => r.role === 'hod').every(r => !r.active);
  if (provcActive && hodInactive && verify.role === 'provc') {
    console.log('\n✓ Migration successful');
  } else {
    console.error('\n✗ Migration may have issues — review output above');
  }

  await mongoose.disconnect();
  console.log('Disconnected. Done.');
}

run().catch(console.error);
