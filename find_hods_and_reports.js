/**
 * Find all HODs and their reports in the database
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const FacultyReport = require('./models/FacultyReport');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mits-feedback';

async function main() {
  try {
    console.log('[Find] Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('[Find] ✅ Connected\n');

    // Find all HODs
    console.log('═══════════════════════════════════════════════════════');
    console.log('ALL HOD ACCOUNTS:');
    console.log('═══════════════════════════════════════════════════════\n');

    const hods = await User.find({ 
      $or: [
        { role: 'hod' },
        { roles: 'hod' }
      ]
    }).select('name email department role roles');

    if (hods.length === 0) {
      console.log('❌ No HOD accounts found!\n');
    } else {
      for (const hod of hods) {
        const reportCount = await FacultyReport.countDocuments({ hodId: hod._id });
        
        console.log(`📌 ${hod.name}`);
        console.log(`   Email: ${hod.email}`);
        console.log(`   ID: ${hod._id}`);
        console.log(`   Department: ${hod.department || '(none)'}`);
        console.log(`   Reports: ${reportCount}`);
        
        if (reportCount > 0) {
          const reports = await FacultyReport.find({ hodId: hod._id })
            .select('facultyName subjectCode status')
            .limit(3);
          
          reports.forEach((r, i) => {
            console.log(`      ${i + 1}. ${r.facultyName} - ${r.subjectCode} (${r.status})`);
          });
          
          if (reportCount > 3) {
            console.log(`      ... and ${reportCount - 3} more`);
          }
        }
        console.log('');
      }
    }

    // Find all reports without HOD
    console.log('═══════════════════════════════════════════════════════');
    console.log('REPORTS WITHOUT HOD:');
    console.log('═══════════════════════════════════════════════════════\n');

    const orphanReports = await FacultyReport.find({ hodId: null })
      .select('facultyName subjectCode status')
      .limit(10);

    if (orphanReports.length === 0) {
      console.log('✅ No orphan reports\n');
    } else {
      console.log(`Found ${orphanReports.length} reports without HOD:\n`);
      orphanReports.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.facultyName} - ${r.subjectCode} (${r.status})`);
      });
      console.log('');
    }

    // Total stats
    console.log('═══════════════════════════════════════════════════════');
    console.log('STATISTICS:');
    console.log('═══════════════════════════════════════════════════════\n');

    const totalReports = await FacultyReport.countDocuments();
    const totalUsers = await User.countDocuments();
    const totalHods = hods.length;

    console.log(`Total Users: ${totalUsers}`);
    console.log(`Total HODs: ${totalHods}`);
    console.log(`Total Reports: ${totalReports}`);
    console.log('');

  } catch (err) {
    console.error('[Error]', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('[Find] Disconnected from MongoDB');
  }
}

main();
