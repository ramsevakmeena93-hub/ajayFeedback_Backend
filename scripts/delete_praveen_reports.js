/**
 * DELETE All Reports for Praveen Kumar Bansal
 * 
 * ⚠️  WARNING: PERMANENT DELETION
 * 
 * This script:
 * 1. Finds user "Praveen Kumar Bansal"
 * 2. EXPORTS all his reports to JSON backup file
 * 3. PERMANENTLY DELETES all his reports from database
 * 4. New uploads will work normally after deletion
 * 
 * SAFETY: Creates backup before deletion
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const FacultyReport = require('../models/FacultyReport');

async function deleteReports() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Step 1: Find Praveen Kumar Bansal
    console.log('🔍 Searching for "Praveen Kumar Bansal"...');
    const hodUser = await User.findOne({
      name: { $regex: /praveen.*kumar.*bansal/i }
    });

    if (!hodUser) {
      console.error('❌ User "Praveen Kumar Bansal" not found\n');
      console.log('Searching for similar names...');
      const similarUsers = await User.find({
        name: { $regex: /praveen|bansal/i }
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

    console.log(`✓ Found HOD: ${hodUser.name}`);
    console.log(`  Email: ${hodUser.email}`);
    console.log(`  User ID: ${hodUser._id}`);
    console.log(`  Roles: ${hodUser.roles.join(', ')}\n`);

    // Step 2: Find all reports where he is HOD
    console.log('📊 Finding all reports for this HOD...');
    const reports = await FacultyReport.find({
      hodId: hodUser._id
    }).lean();

    console.log(`✓ Found ${reports.length} reports\n`);

    if (reports.length === 0) {
      console.log('✓ No reports to delete');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 3: Show summary
    const statuses = {};
    const semesters = {};
    const years = {};
    
    reports.forEach(r => {
      statuses[r.status] = (statuses[r.status] || 0) + 1;
      if (r.semester) semesters[r.semester] = (semesters[r.semester] || 0) + 1;
      if (r.academicYear) years[r.academicYear] = (years[r.academicYear] || 0) + 1;
    });

    console.log('📈 Report Breakdown:');
    console.log('\nBy Status:');
    Object.entries(statuses).forEach(([status, count]) => {
      console.log(`  - ${status}: ${count}`);
    });
    
    if (Object.keys(semesters).length > 0) {
      console.log('\nBy Semester:');
      Object.entries(semesters).forEach(([sem, count]) => {
        console.log(`  - ${sem}: ${count}`);
      });
    }
    
    if (Object.keys(years).length > 0) {
      console.log('\nBy Academic Year:');
      Object.entries(years).forEach(([year, count]) => {
        console.log(`  - ${year}: ${count}`);
      });
    }

    // Step 4: Create backup
    console.log('\n💾 Creating backup...');
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `praveen_reports_backup_${timestamp}.json`);
    
    const backupData = {
      deletedAt: new Date().toISOString(),
      hodUser: {
        id: hodUser._id,
        name: hodUser.name,
        email: hodUser.email
      },
      totalReports: reports.length,
      reports: reports
    };
    
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`✓ Backup saved: ${backupFile}\n`);

    // Step 5: Ask for confirmation
    console.log('⚠️  PERMANENT DELETION WARNING ⚠️');
    console.log('═'.repeat(50));
    console.log('This will PERMANENTLY DELETE:');
    console.log(`  • ${reports.length} reports from database`);
    console.log(`  • All student comments and AI analysis`);
    console.log(`  • All FFI scores and feedback data`);
    console.log(`  • HOD: ${hodUser.name} (${hodUser.email})`);
    console.log('');
    console.log('✓ Backup created: ' + path.basename(backupFile));
    console.log('✗ This action CANNOT be undone via UI');
    console.log('✓ Can only restore from backup file manually');
    console.log('✓ New uploads will work normally after deletion');
    console.log('═'.repeat(50) + '\n');
    
    // For safety, require manual execution with --confirm flag
    if (!process.argv.includes('--confirm')) {
      console.log('❌ DRY RUN MODE - NO DELETION PERFORMED');
      console.log('');
      console.log('To actually delete these reports, run:');
      console.log('  node scripts/delete_praveen_reports.js --confirm');
      console.log('');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 6: DELETE reports
    console.log('🗑️  DELETING REPORTS...\n');
    
    const deleteResult = await FacultyReport.deleteMany({
      hodId: hodUser._id
    });

    console.log('✅ DELETION COMPLETE');
    console.log('═'.repeat(50));
    console.log(`Deleted: ${deleteResult.deletedCount} reports`);
    console.log(`Backup: ${backupFile}`);
    console.log('');
    console.log('✓ HOD can now upload new Excel files');
    console.log('✓ New reports will appear in dashboard normally');
    console.log('✓ Faculty dashboards updated (old reports removed)');
    console.log('✓ Pro-VC/Admin views updated');
    console.log('═'.repeat(50) + '\n');

    console.log('📝 To restore from backup (if needed):');
    console.log('  1. Open MongoDB shell');
    console.log('  2. Run: db.facultyreports.insertMany(JSON.parse(fs.readFileSync("' + backupFile + '")).reports)');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

// Run the deletion
deleteReports();
