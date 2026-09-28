// Direct database fix script - runs without API
const mongoose = require('mongoose');

// Load environment variables manually
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
      process.env[key.trim()] = values.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}

async function fixDatabase() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    console.log('URI:', process.env.MONGO_URI ? 'Found' : 'NOT FOUND');
    
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Import models
    const User = require('./models/User');
    const FacultyReport = require('./models/FacultyReport');

    // ============================================================================
    // FIX 1: Update VC Name
    // ============================================================================
    console.log('========================================');
    console.log('FIX 1: Update VC Name to Dr. Manjuree Pandit');
    console.log('========================================');
    
    const vcResult = await User.updateOne(
      { role: 'vc' },
      { $set: { name: 'Dr. Manjuree Pandit' } }
    );

    if (vcResult.matchedCount > 0) {
      console.log(`✅ Updated ${vcResult.modifiedCount} VC user(s)`);
      const vcUser = await User.findOne({ role: 'vc' }).select('name email role');
      console.log('   Current VC:', vcUser);
    } else {
      console.log('⚠️  No VC user found');
    }

    // ============================================================================
    // FIX 2: Clean "Submitted answers:-" from course names
    // ============================================================================
    console.log('\n========================================');
    console.log('FIX 2: Clean "Submitted answers" from Course Names');
    console.log('========================================');

    // Find all reports with "Submitted answers" text
    const reportsToClean = await FacultyReport.find({
      $or: [
        { programme: /Submitted\s*answers?:?-?\s*/i },
        { courseName: /Submitted\s*answers?:?-?\s*/i }
      ]
    });

    console.log(`Found ${reportsToClean.length} reports with "Submitted answers" text\n`);

    if (reportsToClean.length > 0) {
      // Show sample
      console.log('Sample records (first 5):');
      reportsToClean.slice(0, 5).forEach((r, i) => {
        console.log(`\n${i + 1}. Faculty: ${r.facultyName || 'Unknown'}`);
        console.log(`   Before: "${r.programme}"`);
        const cleaned = (r.programme || '').replace(/\s*Submitted\s*answers?:?-?\s*/gi, '').trim();
        console.log(`   After:  "${cleaned}"`);
      });

      console.log('\n📝 Cleaning all records...');
      
      let cleanedCount = 0;
      for (const report of reportsToClean) {
        const updateFields = {};
        
        if (report.programme) {
          const cleaned = report.programme.replace(/\s*Submitted\s*answers?:?-?\s*/gi, '').trim();
          if (cleaned !== report.programme) {
            updateFields.programme = cleaned;
          }
        }

        if (report.courseName) {
          const cleaned = report.courseName.replace(/\s*Submitted\s*answers?:?-?\s*/gi, '').trim();
          if (cleaned !== report.courseName) {
            updateFields.courseName = cleaned;
          }
        }

        if (Object.keys(updateFields).length > 0) {
          await FacultyReport.updateOne({ _id: report._id }, { $set: updateFields });
          cleanedCount++;
        }
      }

      console.log(`✅ Cleaned ${cleanedCount} records`);
    } else {
      console.log('✅ No records need cleaning. Database is clean!');
    }

    // ============================================================================
    // Summary
    // ============================================================================
    console.log('\n========================================');
    console.log('✅ ALL FIXES COMPLETED!');
    console.log('========================================');
    console.log('Refresh your browser to see the changes.\n');

    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixDatabase();
