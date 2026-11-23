require('dotenv').config();
const mongoose = require('mongoose');

async function checkVandana() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✓ Connected to MongoDB');
        
        // List all collections
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('\nCollections in database:');
        collections.forEach(c => console.log('  -', c.name));
        
        // Check facultyreports collection  
        const FacultyReports = mongoose.connection.db.collection('facultyreports');
        const reportCount = await FacultyReports.countDocuments();
        console.log(`\nTotal documents in facultyreports: ${reportCount}`);
        
        // Get faculty reports
        const reports = await FacultyReports.find().sort({ createdAt: -1 }).limit(10).toArray();
        console.log('\nFaculty reports:');
        reports.forEach((doc, i) => {
            console.log(`\n${i + 1}. Faculty: ${doc.facultyName || 'N/A'}`);
            console.log(`   Course: ${doc.courseCode || 'N/A'}`);
            console.log(`   Semester: ${doc.semester || 'N/A'}`);
            if (doc.appreciation) {
                console.log(`   Appreciation (${doc.appreciation.length || 0}):`);
                if (doc.appreciation.length > 0) {
                    doc.appreciation.slice(0, 3).forEach(c => console.log(`     - ${c}`));
                }
            }
            if (doc.commentsNeedingAttention) {
                console.log(`   Needs Attention (${doc.commentsNeedingAttention.length || 0}):`);
                if (doc.commentsNeedingAttention.length > 0) {
                    doc.commentsNeedingAttention.slice(0, 3).forEach(c => console.log(`     - ${c}`));
                }
            }
        });
        
        await mongoose.connection.close();
        console.log('\n✓ Done');
        
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

checkVandana();
