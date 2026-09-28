/**
 * Create VC test account and submit HOD reports to VC
 * 
 * Usage: node create_vc_test_account.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const UserRole = require('./models/UserRole');
const FacultyReport = require('./models/FacultyReport');
const Submission = require('./models/Submission');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mits-feedback';

// VC test account details
const VC_EMAIL = 'vc.test@mitsgwl.ac.in';
const VC_NAME = 'Dr. Dr. Manjuree Pandit';
const VC_PASSWORD = 'vc123456';

// HOD account to find
const HOD_EMAIL = '25mc1sh132@mitsgwl.ac.in';
const HOD_NAME = 'Shivam Singh Rajput';

async function main() {
  try {
    console.log('[Setup] Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('[Setup] ✅ Connected to MongoDB\n');

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Find HOD
    // ═══════════════════════════════════════════════════════════════
    console.log('[Step 1] Finding HOD account...');
    const hod = await User.findOne({ email: HOD_EMAIL });
    
    if (!hod) {
      console.error(`[Error] HOD not found with email: ${HOD_EMAIL}`);
      console.log('[Info] Creating HOD account...');
      
      const hodPassword = await bcrypt.hash('shivam123', 10);
      const newHod = await User.create({
        name: HOD_NAME,
        email: HOD_EMAIL,
        password: hodPassword,
        role: 'hod',
        roles: ['hod', 'faculty'],
        department: 'Humanities',
        activeWorkspace: 'hod'
      });

      await UserRole.create([
        {
          userId: newHod._id,
          role: 'hod',
          departmentScope: 'Humanities',
          active: true
        },
        {
          userId: newHod._id,
          role: 'faculty',
          departmentScope: 'Humanities',
          active: true
        }
      ]);

      console.log(`[Setup] ✅ Created HOD: ${HOD_NAME} (${HOD_EMAIL})`);
      console.log(`[Setup]    Password: shivam123`);
      console.log(`[Setup]    Department: Humanities\n`);
      
      return; // Exit - user needs to upload reports first
    }

    console.log(`[Step 1] ✅ Found HOD: ${hod.name} (${hod.email})`);
    console.log(`[Step 1]    ID: ${hod._id}`);
    console.log(`[Step 1]    Role: ${hod.role}`);
    console.log(`[Step 1]    Department: ${hod.department}\n`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Find HOD's reports
    // ═══════════════════════════════════════════════════════════════
    console.log('[Step 2] Finding HOD reports...');
    const reports = await FacultyReport.find({ hodId: hod._id });
    
    console.log(`[Step 2] ✅ Found ${reports.length} reports`);
    
    if (reports.length === 0) {
      console.log('[Step 2] ⚠️  No reports found!');
      console.log('[Step 2]    Please upload Excel file as HOD first.');
      console.log('[Step 2]    Then run this script again.\n');
      process.exit(0);
    }

    // Show report summary
    console.log(`[Step 2] Report Summary:`);
    reports.slice(0, 5).forEach((r, i) => {
      console.log(`[Step 2]    ${i + 1}. ${r.facultyName} - ${r.subjectCode} (${r.status})`);
    });
    if (reports.length > 5) {
      console.log(`[Step 2]    ... and ${reports.length - 5} more`);
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Create/Find VC account
    // ═══════════════════════════════════════════════════════════════
    console.log('[Step 3] Creating VC test account...');
    
    let vc = await User.findOne({ email: VC_EMAIL });
    
    if (vc) {
      console.log(`[Step 3] ✅ VC account already exists: ${vc.name}`);
      
      // Update to VC role if needed
      if (vc.role !== 'vc') {
        await User.findByIdAndUpdate(vc._id, {
          role: 'vc',
          roles: ['vc'],
          activeWorkspace: 'vc',
          department: ''
        });
        
        await UserRole.deleteMany({ userId: vc._id });
        await UserRole.create({
          userId: vc._id,
          role: 'vc',
          departmentScope: '',
          active: true
        });
        
        console.log(`[Step 3] ✅ Updated to VC role`);
      }
    } else {
      // Create new VC account
      const hashedPassword = await bcrypt.hash(VC_PASSWORD, 10);
      
      vc = await User.create({
        name: VC_NAME,
        email: VC_EMAIL,
        password: hashedPassword,
        role: 'vc',
        roles: ['vc'],
        department: '',
        activeWorkspace: 'vc'
      });

      await UserRole.create({
        userId: vc._id,
        role: 'vc',
        departmentScope: '',
        active: true
      });

      console.log(`[Step 3] ✅ Created VC account`);
    }

    console.log(`[Step 3]    Name: ${vc.name}`);
    console.log(`[Step 3]    Email: ${VC_EMAIL}`);
    console.log(`[Step 3]    Password: ${VC_PASSWORD}`);
    console.log(`[Step 3]    ID: ${vc._id}\n`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Update reports to faculty_approved status
    // ═══════════════════════════════════════════════════════════════
    console.log('[Step 4] Updating report statuses...');
    
    const updateResult = await FacultyReport.updateMany(
      { hodId: hod._id, status: { $ne: 'faculty_approved' } },
      { status: 'faculty_approved' }
    );
    
    console.log(`[Step 4] ✅ Updated ${updateResult.modifiedCount} reports to faculty_approved\n`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Check if submission already exists
    // ═══════════════════════════════════════════════════════════════
    console.log('[Step 5] Checking existing submissions...');
    
    const existingSubmission = await Submission.findOne({ hodId: hod._id });
    
    if (existingSubmission) {
      console.log(`[Step 5] ✅ Submission already exists`);
      console.log(`[Step 5]    ID: ${existingSubmission._id}`);
      console.log(`[Step 5]    Status: ${existingSubmission.status}`);
      console.log(`[Step 5]    Reports: ${existingSubmission.reports.length}`);
      console.log(`[Step 5]    Created: ${existingSubmission.createdAt}\n`);
    } else {
      // ═══════════════════════════════════════════════════════════════
      // STEP 6: Create submission to VC
      // ═══════════════════════════════════════════════════════════════
      console.log('[Step 6] Creating submission to VC...');
      
      const currentYear = new Date().getFullYear();
      const academicYear = `${currentYear}-${currentYear + 1}`;
      
      const submission = await Submission.create({
        hodId: hod._id,
        reports: reports.map(r => r._id),
        academicYear: academicYear,
        department: hod.department || 'Humanities',
        semester: '5',
        session: 'July-December',
        feedbackFormNo: 'I',
        submissionDate: new Date(),
        status: 'submitted',
        submittedFromWorkspace: 'hod'
      });

      console.log(`[Step 6] ✅ Created submission`);
      console.log(`[Step 6]    ID: ${submission._id}`);
      console.log(`[Step 6]    Status: ${submission.status}`);
      console.log(`[Step 6]    Academic Year: ${academicYear}`);
      console.log(`[Step 6]    Reports: ${reports.length}`);
      console.log(`[Step 6]    Department: ${hod.department || 'Humanities'}\n`);
    }

    // ═══════════════════════════════════════════════════════════════
    // FINAL: Show login instructions
    // ═══════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ SETUP COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log('🔐 VC LOGIN CREDENTIALS:');
    console.log(`   Email: ${VC_EMAIL}`);
    console.log(`   Password: ${VC_PASSWORD}\n`);
    
    console.log('📊 WHAT TO DO NEXT:');
    console.log('   1. Open your frontend app');
    console.log('   2. Login with VC credentials above');
    console.log(`   3. You will see ${reports.length} reports from HOD "${HOD_NAME}"`);
    console.log('   4. Approve/Reject the submission\n');
    
    console.log('👤 HOD ACCOUNT (for reference):');
    console.log(`   Email: ${HOD_EMAIL}`);
    console.log(`   Name: ${HOD_NAME}`);
    console.log(`   Reports: ${reports.length}\n`);

  } catch (err) {
    console.error('[Error]', err.message);
    console.error(err.stack);
  } finally {
    await mongoose.disconnect();
    console.log('[Setup] Disconnected from MongoDB');
  }
}

main();
