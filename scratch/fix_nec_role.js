require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const UserRole = require('../models/UserRole');

const MONGO_URI = process.env.MONGO_URI;

async function fix() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected');

  const email = 'nec@mitsgwalior.in';
  let user = await User.findOne({ email });

  if (!user) {
    console.log('User not found — creating...');
    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash('Mits@1234', 10);
    user = await User.create({
      name: 'Pro Vice Chancellor',
      email,
      password: hashed,
      role: 'vc',
      roles: ['vc'],
      activeWorkspace: 'vc',
      department: 'Vice Chancellor Office',
      status: 'active',
    });
    console.log('Created:', user._id);
  } else {
    user.role = 'vc';
    user.roles = ['vc'];
    user.activeWorkspace = 'vc';
    await user.save();
    console.log('Updated role to vc:', user._id);
  }

  await UserRole.deleteMany({ userId: user._id });
  await UserRole.create({ userId: user._id, role: 'vc', departmentScope: '', active: true });
  console.log('UserRole set to vc');

  const verify = await User.findOne({ email });
  console.log('Final role:', verify.role, '| workspace:', verify.activeWorkspace);

  await mongoose.disconnect();
  console.log('Done');
}

fix().catch(console.error);
