require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const User = require('./models/User');
const UserRole = require('./models/UserRole');

const TARGET_EMAIL = '25tc1aj7@mitsgwl.ac.in';
const DEPARTMENT   = 'Industrial Production';

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    // Try exact email first, then with .ac.in variant
    let user = await User.findOne({ email: TARGET_EMAIL.toLowerCase() });
    if (!user) {
      // try the .ac.in variant the user may have registered with
      user = await User.findOne({ email: '25tc1aj7@gmail.com.ac.in' });
    }
    if (!user) {
      // list all users with similar pattern so we can identify the right one
      const similar = await User.find({ email: /25tc1aj7/i }).select('email name department role');
      if (similar.length === 0) {
        console.error('No user found matching 25tc1aj7. Please check the email in the DB.');
      } else {
        console.log('No exact match, but found similar users:');
        similar.forEach(u => console.log(`  ${u.email} | ${u.name} | dept: ${u.department} | role: ${u.role}`));
        console.log('\nRe-run this script with the correct email updated in TARGET_EMAIL.');
      }
      await mongoose.disconnect();
      return;
    }

    console.log(`\nFound user: ${user.name} (${user.email})`);
    console.log(`Current role: ${user.role}, department: ${user.department}`);

    // 1. Update User document
    user.role       = 'hod';
    user.department = DEPARTMENT;
    if (!user.roles.includes('hod')) user.roles.push('hod');
    await user.save();
    console.log('✔ User.role and User.department updated.');

    // 2. Upsert UserRole document
    const urResult = await UserRole.findOneAndUpdate(
      { userId: user._id, role: 'hod', departmentScope: DEPARTMENT },
      {
        userId:          user._id,
        role:            'hod',
        departmentScope: DEPARTMENT,
        active:          true,
        grantedAt:       new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`✔ UserRole upserted: ${urResult._id}`);

    // 3. Show final state
    const allRoles = await UserRole.find({ userId: user._id, active: true });
    console.log('\n=== Final active roles ===');
    allRoles.forEach(r => console.log(`  role: ${r.role}  dept: ${r.departmentScope || '(global)'}`));

    await mongoose.disconnect();
    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

run();
