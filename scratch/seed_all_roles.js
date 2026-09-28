require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const UserRole = require('../models/UserRole');

const USERS = [
  {
    name: 'System Administrator',
    email: 'admin@mits.ac.in',
    password: 'admin123',
    role: 'admin',
    department: 'Administration'
  },
  {
    name: 'Dr. Abhishek Dixit (HOD)',
    email: 'hod@mits.ac.in',
    password: 'hod123',
    role: 'hod',
    department: 'Computer Science & Engineering'
  },
  {
    name: 'Tanuja Sharma (Faculty)',
    email: 'faculty@mits.ac.in',
    password: 'faculty123',
    role: 'faculty',
    department: 'Computer Science & Engineering'
  },
  {
    name: 'Prof. R. K. Pandit (VC)',
    email: 'vc@mits.ac.in',
    password: 'vc123',
    role: 'vc',
    department: 'Vice Chancellor Office'
  }
];

async function seed() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB:', mongoUri);

    for (const item of USERS) {
      const hashedPassword = await bcrypt.hash(item.password, 10);
      let user = await User.findOne({ email: item.email });

      if (user) {
        user.name = item.name;
        user.password = hashedPassword;
        user.role = item.role;
        user.roles = [item.role];
        user.activeWorkspace = item.role;
        user.department = item.department;
        user.status = 'active';
        await user.save();
        console.log(`Updated user: ${item.email} [${item.role}] -> password: '${item.password}'`);
      } else {
        user = await User.create({
          name: item.name,
          email: item.email,
          password: hashedPassword,
          role: item.role,
          roles: [item.role],
          activeWorkspace: item.role,
          department: item.department,
          status: 'active'
        });
        console.log(`Created user: ${item.email} [${item.role}] -> password: '${item.password}'`);
      }

      // Upsert UserRole
      await UserRole.deleteMany({ userId: user._id });
      await UserRole.create({
        userId: user._id,
        role: item.role,
        departmentScope: item.department,
        active: true
      });
    }

    console.log('\nAll demo role accounts successfully seeded and configured!');
  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

seed();
