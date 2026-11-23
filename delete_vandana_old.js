require('dotenv').config();
const mongoose = require('mongoose');

async function deleteVandanaOld() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✓ Connected to MongoDB');
        
        const FacultyReports = mongoose.connection.db.collection('facultyreports');
        
        const result = await FacultyReports.deleteMany({
            facultyName: /vandana.*jaiswal/i
        });
        
        console.log(`✓ Deleted ${result.deletedCount} old Vandana records`);
        console.log('Now re-upload her PDF through the web interface');
        
        await mongoose.connection.close();
        
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

deleteVandanaOld();
