/**
 * Clean Programme Names in Database
 * 
 * Removes "submitted answer", "Course Name:", and other garbage text
 * from the programme field in all FacultyReport documents.
 * 
 * SAFE: Can be reverted by restoring from backup
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FacultyReport = require('../models/FacultyReport');

function cleanProgrammeName(name) {
  if (!name) return name;
  
  const original = name;
  const cleaned = String(name)
    // Remove "submitted answer(s)" variations
    .replace(/\bsubmitted\s+answers?\s*:?\s*-?\s*/gi, "")
    .replace(/\bsubmitted\s+responses?\s*:?\s*/gi, "")
    .replace(/\bstudent\s+feedback\s*:?\s*-?\s*/gi, "")
    // Remove "Course Name:" prefix
    .replace(/^course\s+name\s*:?\s*-?\s*/gi, "")
    // Remove "Programme:" prefix
    .replace(/^programme\s*:?\s*-?\s*/gi, "")
    // Remove extra punctuation at start
    .replace(/^[:\-\s]+/, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
  
  return cleaned || original; // If cleaning results in empty string, keep original
}

async function cleanProgrammeNames() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Step 1: Find all reports with programme field
    console.log('📊 Finding all reports with programme field...');
    const reports = await FacultyReport.find({
      programme: { $exists: true, $ne: null, $ne: '' }
    }).lean();

    console.log(`✓ Found ${reports.length} reports with programme data\n`);

    if (reports.length === 0) {
      console.log('✓ No reports to clean');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 2: Analyze what needs cleaning
    const needsCleaning = [];
    const cleanPreview = [];

    reports.forEach(r => {
      const original = r.programme;
      const cleaned = cleanProgrammeName(original);
      
      if (original !== cleaned) {
        needsCleaning.push(r);
        cleanPreview.push({
          id: r._id,
          faculty: r.facultyName,
          subject: r.subjectCode,
          before: original,
          after: cleaned
        });
      }
    });

    console.log(`📈 Summary:`);
    console.log(`  Total reports: ${reports.length}`);
    console.log(`  Need cleaning: ${needsCleaning.length}`);
    console.log(`  Already clean: ${reports.length - needsCleaning.length}\n`);

    if (needsCleaning.length === 0) {
      console.log('✅ All programme names are already clean!');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 3: Show preview of changes
    console.log('🔍 Preview of Changes (first 10):');
    console.log('═'.repeat(80));
    cleanPreview.slice(0, 10).forEach((item, i) => {
      console.log(`\n${i + 1}. Faculty: ${item.faculty} (${item.subject})`);
      console.log(`   BEFORE: "${item.before}"`);
      console.log(`   AFTER:  "${item.after}"`);
    });
    
    if (cleanPreview.length > 10) {
      console.log(`\n... and ${cleanPreview.length - 10} more`);
    }
    console.log('\n' + '═'.repeat(80) + '\n');

    // Step 4: Ask for confirmation
    console.log('⚠️  DATABASE UPDATE');
    console.log('This will update ' + needsCleaning.length + ' reports in database');
    console.log('✓ Original values will be lost (unless you have backup)');
    console.log('✓ PDF reports will show cleaned names');
    console.log('✓ HOD/Faculty dashboards will show cleaned names\n');

    if (!process.argv.includes('--confirm')) {
      console.log('❌ DRY RUN MODE - NO CHANGES MADE');
      console.log('');
      console.log('To actually clean programme names, run:');
      console.log('  node scripts/clean_programme_names.js --confirm');
      console.log('');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 5: Update database
    console.log('🔄 CLEANING PROGRAMME NAMES...\n');
    
    let updated = 0;
    for (const report of needsCleaning) {
      const cleaned = cleanProgrammeName(report.programme);
      await FacultyReport.findByIdAndUpdate(report._id, {
        $set: { programme: cleaned }
      });
      updated++;
      
      if (updated % 10 === 0) {
        console.log(`  Processed ${updated}/${needsCleaning.length}...`);
      }
    }

    console.log('\n✅ CLEANING COMPLETE');
    console.log('═'.repeat(80));
    console.log(`Updated: ${updated} reports`);
    console.log('');
    console.log('✓ Programme names cleaned');
    console.log('✓ PDFs will now show clean names');
    console.log('✓ Dashboards updated');
    console.log('═'.repeat(80) + '\n');

    console.log('Examples of cleaned names:');
    cleanPreview.slice(0, 5).forEach((item, i) => {
      console.log(`  ${i + 1}. "${item.after}" (was: "${item.before}")`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

cleanProgrammeNames();
