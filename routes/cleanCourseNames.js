// Clean "Submitted answers:-" from course names in database
const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const { authenticate, authorize } = require('../middleware/auth');

// Route to clean all existing course names
router.post('/clean-course-names', authenticate, authorize('admin', 'hod', 'vc'), async (req, res) => {
  try {
    console.log('[Clean] Starting course name cleanup...');
    
    // Find all reports with "Submitted answers" in programme or courseName fields
    const reportsToUpdate = await Report.find({
      $or: [
        { programme: /Submitted\s*answers?:?-?\s*/i },
        { courseName: /Submitted\s*answers?:?-?\s*/i }
      ]
    });

    console.log(`[Clean] Found ${reportsToUpdate.length} reports to clean`);

    let updatedCount = 0;
    const updates = [];

    for (const report of reportsToUpdate) {
      const updateFields = {};
      
      // Clean programme field
      if (report.programme) {
        const cleanedProgramme = report.programme
          .replace(/\s*Submitted\s*answers?:?-?\s*/gi, '')
          .trim();
        if (cleanedProgramme !== report.programme) {
          updateFields.programme = cleanedProgramme;
        }
      }

      // Clean courseName field (if exists)
      if (report.courseName) {
        const cleanedCourseName = report.courseName
          .replace(/\s*Submitted\s*answers?:?-?\s*/gi, '')
          .trim();
        if (cleanedCourseName !== report.courseName) {
          updateFields.courseName = cleanedCourseName;
        }
      }

      // Update if there are changes
      if (Object.keys(updateFields).length > 0) {
        await Report.updateOne(
          { _id: report._id },
          { $set: updateFields }
        );
        updatedCount++;
        updates.push({
          id: report._id,
          facultyName: report.facultyName,
          before: report.programme,
          after: updateFields.programme || report.programme
        });
      }
    }

    console.log(`[Clean] Successfully cleaned ${updatedCount} reports`);

    res.json({
      success: true,
      message: `Cleaned ${updatedCount} course names`,
      totalFound: reportsToUpdate.length,
      updated: updatedCount,
      samples: updates.slice(0, 10) // Show first 10 samples
    });

  } catch (error) {
    console.error('[Clean] Error cleaning course names:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to clean course names', 
      error: error.message 
    });
  }
});

// Route to preview what would be cleaned (dry run)
router.get('/preview-clean-course-names', authenticate, authorize('admin', 'hod', 'vc'), async (req, res) => {
  try {
    const reportsToUpdate = await Report.find({
      $or: [
        { programme: /Submitted\s*answers?:?-?\s*/i },
        { courseName: /Submitted\s*answers?:?-?\s*/i }
      ]
    }).select('facultyName programme courseName subjectCode');

    const preview = reportsToUpdate.map(r => ({
      id: r._id,
      facultyName: r.facultyName,
      subjectCode: r.subjectCode,
      currentProgramme: r.programme,
      cleanedProgramme: r.programme ? r.programme.replace(/\s*Submitted\s*answers?:?-?\s*/gi, '').trim() : '',
      currentCourseName: r.courseName,
      cleanedCourseName: r.courseName ? r.courseName.replace(/\s*Submitted\s*answers?:?-?\s*/gi, '').trim() : ''
    }));

    res.json({
      success: true,
      totalToClean: preview.length,
      preview: preview.slice(0, 20) // Show first 20
    });

  } catch (error) {
    console.error('[Clean] Error previewing:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to preview', 
      error: error.message 
    });
  }
});

module.exports = router;
