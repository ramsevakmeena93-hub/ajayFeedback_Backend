/**
 * Undo Faculty Approval for Dr. Aftab Ahmed Ansari
 * 
 * This script:
 * 1. Finds user "Dr. Aftab Ahmed Ansari"
 * 2. Finds all his reports with status "faculty_approved"
 * 3. Changes status back to "sent_to_faculty"
 * 4. Removes facultyAcknowledged flag
 * 5. HOD can then re-approve the reports
 * 
 * SAFE: Does not delete anything, just changes status
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const FacultyReport = require('../models/FacultyReport');

async function undoApproval() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Step 1: Find Dr. Aftab Ahmed Ansari
    console.log('🔍 Searching for "Dr. Aftab Ahmed Ansari"...');
    const facultyUser = await User.findOne({
      name: { $regex: /aftab.*ahmed.*ansari/i }
    });

    if (!facultyUser) {
      console.error('❌ User "Dr. Aftab Ahmed Ansari" not found\n');
      console.log('Searching for similar names...');
      const similarUsers = await User.find({
        name: { $regex: /aftab|ansari/i }
      }).select('name email roles');
      
      if (similarUsers.length > 0) {
        console.log('\nFound similar users:');
        similarUsers.forEach(u => {
          console.log(`  - ${u.name} (${u.email}) [${u.roles.join(', ')}]`);
        });
        console.log('\n💡 Tip: Update the regex pattern in the script to match exact name');
      }
      
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log(`✓ Found Faculty: ${facultyUser.name}`);
    console.log(`  Email: ${facultyUser.email}`);
    console.log(`  User ID: ${facultyUser._id}`);
    console.log(`  Roles: ${facultyUser.roles.join(', ')}\n`);

    // Step 2: Find all approved reports for this faculty
    console.log('📊 Finding approved reports...');
    
    // Try multiple query methods to catch all reports
    const byUserId = await FacultyReport.find({
      facultyUserId: facultyUser._id,
      status: 'faculty_approved'
    }).lean();

    // Also try by name (for older reports without userId link)
    const nameWithoutTitle = facultyUser.name.replace(/^(Dr\.?|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, '').trim();
    const firstName = nameWithoutTitle.split(' ')[0];
    
    const byName = await FacultyReport.find({
      facultyName: new RegExp(firstName, 'i'),
      status: 'faculty_approved'
    }).lean();

    // Combine and deduplicate
    const allReportsMap = new Map();
    [...byUserId, ...byName].forEach(r => {
      allReportsMap.set(r._id.toString(), r);
    });
    
    const reports = Array.from(allReportsMap.values());

    console.log(`✓ Found ${reports.length} approved reports\n`);

    if (reports.length === 0) {
      console.log('✓ No approved reports to undo');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 3: Show summary
    console.log('📈 Report Summary:');
    console.log(`  Total Approved Reports: ${reports.length}`);
    
    const bySubject = {};
    const bySemester = {};
    
    reports.forEach(r => {
      if (r.subjectCode) bySubject[r.subjectCode] = (bySubject[r.subjectCode] || 0) + 1;
      if (r.semester) bySemester[r.semester] = (bySemester[r.semester] || 0) + 1;
    });
    
    if (Object.keys(bySubject).length > 0) {
      console.log('\nBy Subject:');
      Object.entries(bySubject).forEach(([sub, count]) => {
        console.log(`  - ${sub}: ${count}`);
      });
    }
    
    if (Object.keys(bySemester).length > 0) {
      console.log('\nBy Semester:');
      Object.entries(bySemester).forEach(([sem, count]) => {
        console.log(`  - ${sem}: ${count}`);
      });
    }

    console.log('\n⚠️  UNDO APPROVAL OPERATION');
    console.log('═'.repeat(50));
    console.log('This will:');
    console.log(`  • Change ${reports.length} reports status`);
    console.log(`  • From: "faculty_approved"`);
    console.log(`  • To: "sent_to_faculty"`);
    console.log(`  • Remove facultyAcknowledged flag`);
    console.log(`  • Faculty: ${facultyUser.name}`);
    console.log('');
    console.log('✓ Reports remain in database');
    console.log('✓ Faculty will need to re-acknowledge');
    console.log('✓ HOD can re-approve after faculty action');
    console.log('✓ Reversible (can be re-approved)');
    console.log('═'.repeat(50) + '\n');
    
    // For safety, require manual execution with --confirm flag
    if (!process.argv.includes('--confirm')) {
      console.log('❌ DRY RUN MODE - NO CHANGES MADE');
      console.log('');
      console.log('To actually undo approval, run:');
      console.log('  node scripts/undo_aftab_approval.js --confirm');
      console.log('');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 4: Undo approval
    console.log('🔄 UNDOING APPROVAL...\n');
    
    const updateResult = await FacultyReport.updateMany(
      {
        _id: { $in: reports.map(r => r._id) }
      },
      {
        $set: {
          status: 'sent_to_faculty',
          facultyAcknowledged: false
        },
        $unset: {
          facultyAcknowledgedAt: ''
        }
      }
    );

    console.log('✅ APPROVAL UNDONE');
    console.log('═'.repeat(50));
    console.log(`Updated: ${updateResult.modifiedCount} reports`);
    console.log(`Faculty: ${facultyUser.name} (${facultyUser.email})`);
    console.log('');
    console.log('Status Changes:');
    console.log('  • Before: faculty_approved ✓');
    console.log('  • After: sent_to_faculty ⏳');
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Faculty logs in → sees reports with "Pending Review"');
    console.log('  2. Faculty clicks "I have seen this" to acknowledge');
    console.log('  3. Status changes to "faculty_approved"');
    console.log('  4. HOD can then proceed with workflow');
    console.log('═'.repeat(50) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

// Run the script
undoApproval();
