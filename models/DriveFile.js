/**
 * models/DriveFile.js
 *
 * Stores Google Drive file metadata saved by HODs.
 * Completely separate from FacultyReport — does not modify any existing model.
 *
 * Fields match the requirement exactly:
 *   applicationId, hodId, googleAccountId, googleDriveFileId,
 *   fileName, mimeType, googleDriveUrl, createdAt, updatedAt
 */

const mongoose = require('mongoose');

const driveFileSchema = new mongoose.Schema(
  {
    // Which HOD saved this file
    hodId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },

    // Optional: link to a FacultyReport if auto-matched by name
    // Leave null if no match — never required
    applicationId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'FacultyReport',
      default: null,
    },

    // Google account email that owns this file
    googleAccountId: {
      type:    String,
      default: '',
    },

    // Core Drive metadata
    googleDriveFileId: {
      type:     String,
      required: true,
    },

    fileName: {
      type:    String,
      default: '',
    },

    mimeType: {
      type:    String,
      default: 'application/pdf',
    },

    googleDriveUrl: {
      type:    String,
      default: '',
    },

    // When the HOD clicked "Save Links"
    savedAt: {
      type:    Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

// Compound index — one record per HOD per Drive file (no duplicates)
driveFileSchema.index({ hodId: 1, googleDriveFileId: 1 }, { unique: true });

module.exports = mongoose.model('DriveFile', driveFileSchema);
