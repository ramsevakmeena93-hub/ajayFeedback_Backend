// Temporary route to update VC name
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/auth');

// One-time update route - can be deleted after use
router.post('/update-vc-name', authenticate, authorize('admin', 'hod', 'vc'), async (req, res) => {
  try {
    const result = await User.updateOne(
      { role: 'vc' },
      { 
        $set: { 
          name: 'Dr. Manjuree Pandit'
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'No VC user found' });
    }

    const updatedVC = await User.findOne({ role: 'vc' }).select('name email role');

    res.json({
      success: true,
      message: 'VC name updated successfully',
      updated: result.modifiedCount,
      vcUser: updatedVC
    });
  } catch (error) {
    console.error('Error updating VC name:', error);
    res.status(500).json({ message: 'Failed to update VC name', error: error.message });
  }
});

module.exports = router;
