/**
 * Archive Reports for Praveen Kumar Bansal
 * 
 * This script:
 * 1. Finds user "Praveen Kumar Bansal" 
 * 2. Adds "archived: true, archivedReason" to all his reports
 * 3. Reports remain in DB but are filtered from all dashboards
 * 4. Can be reversed by setting archived: false
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const FacultyReport = require('../models/FacultyReport');

async function archiveReports() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // Step 1: Find Praveen Kumar Bansal
    const hodUser = await User.findOne({
      name: { $regex: /praveen.*kumar.*bansal/i }
    });

    if (!hodUser) {
      console.error('❌ User "Praveen Kumar Bansal" not found');
      console.log('\nSearching for similar names...');
      const similarUsers = await User.find({
        name: { $regex: /praveen|bansal/i }
      }).select('name email roles');
      
      if (similarUsers.length > 0) {
        console.log('\nFound similar users:');
        similarUsers.forEach(u => {
          console.log(`  - ${u.name} (${u.email}) [${u.roles.join(', ')}]`);
        });
      }
      
      process.exit(1);
    }

    console.log(`\n✓ Found HOD: ${hodUser.name}`);
    console.log(`  Email: ${hodUser.email}`);
    console.log(`  User ID: ${hodUser._id}`);
    console.log(`  Roles: ${hodUser.roles.join(', ')}`);

    // Step 2: Find all reports where he is HOD
    const reports = await FacultyReport.find({
      hodId: hodUser._id
    });

    console.log(`\n📊 Found ${reports.length} reports for this HOD`);

    if (reports.length === 0) {
      console.log('✓ No reports to archive');
      process.exit(0);
    }

    // Step 3: Show summary
    const statuses = {};
    reports.forEach(r => {
      statuses[r.status] = (statuses[r.status] || 0) + 1;
    });

    console.log('\nReport Status Breakdown:');
    Object.entries(statuses).forEach(([status, count]) => {
      console.log(`  - ${status}: ${count}`);
    });

    // Step 4: Ask for confirmation
    console.log('\n⚠️  ARCHIVE OPERATION');
    console.log('This will:');
    console.log('  ✓ Add "archived: true" flag to all reports');
    console.log('  ✓ Hide reports from HOD, Faculty, Pro-VC, Admin dashboards');
    console.log('  ✓ Keep data in database (reversible)');
    console.log('  ✗ Reports will not be deleted permanently');
    
    // For safety, require manual execution with --confirm flag
    if (!process.argv.includes('--confirm')) {
      console.log('\n❌ DRY RUN MODE');
      console.log('To actually archive, run: node scripts/archive_praveen_reports.js --confirm');
      process.exit(0);
    }

    // Step 5: Archive reports
    console.log('\n🔄 Archiving reports...');
    
    const result = await FacultyReport.updateMany(
      { hodId: hodUser._id },
      {
        $set: {
          archived: true,
          archivedAt: new Date(),
          archivedReason: 'HOD reports archived by admin request',
          archivedBy: 'system'
        }
      }
    );

    console.log(`\n✅ ARCHIVED ${result.modifiedCount} reports`);
    console.log('\nThese reports are now:');
    console.log('  ✓ Hidden from all dashboards');
    console.log('  ✓ Still in database');
    console.log('  ✓ Can be restored by removing archived flag');

    console.log('\nTo restore these reports, run:');
    console.log('  db.facultyreports.updateMany(');
    console.log('    { archived: true, hodId: ObjectId("' + hodUser._id + '") },');
    console.log('    { $unset: { archived: "", archivedAt: "", archivedReason: "", archivedBy: "" } }');
    console.log('  )');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

archiveReports();
