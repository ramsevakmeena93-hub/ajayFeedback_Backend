require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const User = require('./models/User');
const UserRole = require('./models/UserRole');

const TARGET_EMAIL  = '25tc1aj7@mitsgwl.ac.in';
const DEPARTMENT    = 'Industrial Production';

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    const user = await User.findOne({ email: TARGET_EMAIL.toLowerCase() });
    if (!user) {
      console.error(`User ${TARGET_EMAIL} not found.`);
      await mongoose.disconnect();
      return;
    }
    console.log(`Found: ${user.name} (${user.email})`);
    console.log(`Before — role: ${user.role}, department: "${user.department}", roles: ${JSON.stringify(user.roles)}`);

    // 1. Delete ALL existing UserRole documents for this user
    const deleted = await UserRole.deleteMany({ userId: user._id });
    console.log(`✔ Deleted ${deleted.deletedCount} UserRole document(s).`);

    // 2. Create a single HOD role scoped to Industrial Production
    const newRole = await UserRole.create({
      userId:          user._id,
      role:            'hod',
      departmentScope: DEPARTMENT,
      active:          true,
      grantedAt:       new Date(),
    });
    console.log(`✔ Created UserRole: hod / ${DEPARTMENT} (${newRole._id})`);

    // 3. Update the User document — primary role = hod, roles cache = ['hod'] only
    user.role       = 'hod';
    user.department = DEPARTMENT;
    user.roles      = ['hod'];
    await user.save();
    console.log(`✔ User document updated.`);

    // 4. Verify final state
    const allRoles = await UserRole.find({ userId: user._id });
    console.log('\n=== Final UserRole documents ===');
    allRoles.forEach(r =>
      console.log(`  role: ${r.role}  dept: "${r.departmentScope}"  active: ${r.active}`)
    );
    const finalUser = await User.findById(user._id).select('role department roles');
    console.log(`\n=== Final User document ===`);
    console.log(`  role: ${finalUser.role}`);
    console.log(`  department: ${finalUser.department}`);
    console.log(`  roles: ${JSON.stringify(finalUser.roles)}`);

    await mongoose.disconnect();
    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

run();
