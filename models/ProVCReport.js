'use strict';

const mongoose = require('mongoose');

const provcReportSchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      enum: ['faculty-wise', 'department-overall'],
      required: true,
    },
    department:      { type: String, default: '' },
    programme:       { type: String, default: '' },
    academicYear:    { type: String, default: '' },
    session:         { type: String, default: '' },
    facultyName:     { type: String, default: '' }, // empty for department reports
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Submission',
      required: true,
      index: true,
    },
    generatedAt:     { type: Date, default: Date.now },
    generatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    generatedByName: { type: String, default: '' },
    pdfData:         { type: Buffer, required: true }, // raw PDF bytes
    reportTitle:     { type: String, default: '' },
    overallComments: { type: String, default: '' }, // vcComment snapshot
    actionTaken:     { type: String, default: '' },
  },
  { timestamps: true }
);

// Compound index for efficient history queries
provcReportSchema.index({ submissionId: 1, reportType: 1, generatedAt: -1 });

module.exports = mongoose.model('ProVCReport', provcReportSchema, 'provc_reports');
