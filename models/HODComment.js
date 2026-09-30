const mongoose = require('mongoose');

/**
 * HODComment Schema
 * 
 * Stores department-level comments from HOD that appear in the consolidated PDF
 * between the summary statistics and the faculty reports table.
 * 
 * One comment per department per academic year per session.
 * HOD can edit anytime.
 */
const hodCommentSchema = new mongoose.Schema({
  // Department identifier
  department: {
    type: String,
    required: true,
    trim: true,
    index: true,
    description: 'Department name (e.g., "Computer Science", "Humanities")'
  },

  // Academic context
  academicYear: {
    type: String,
    default: '2026-2027',
    trim: true,
    description: 'Academic year (e.g., "2026-2027")'
  },

  session: {
    type: String,
    default: '',
    trim: true,
    description: 'Session period (e.g., "July - December", "January - June")'
  },

  // The actual comment text
  comment: {
    type: String,
    required: true,
    maxlength: 2000,
    description: 'HOD remarks/comments that appear in the PDF report'
  },

  // Who created it
  hodUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    description: 'User ID of the HOD who created this comment'
  },

  hodName: {
    type: String,
    default: '',
    description: 'Name of the HOD for display purposes'
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true, // Automatically manages createdAt and updatedAt
  collection: 'hod_comments'
});

// Compound index for efficient queries
hodCommentSchema.index({ department: 1, academicYear: 1, session: 1 });

// Update the updatedAt timestamp before saving
hodCommentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('HODComment', hodCommentSchema);
