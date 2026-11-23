/**
 * PDF ANALYZER TEST SCRIPT
 * 
 * This script tests the fixed PDF analyzer to verify:
 * 1. Section detection works (finds "Student Feedback Comments")
 * 2. Only comments from that section are extracted (no form text)
 * 3. Classification produces non-empty appreciation/needs attention arrays
 * 
 * HOW TO USE:
 * 1. Place a test PDF file in the backend folder (name it 'test_feedback.pdf')
 * 2. Run: node test_pdf_analyzer.js
 * 3. Review the console output showing:
 *    - Section boundaries found
 *    - Comments extracted (with validation messages)
 *    - Classification results
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdfAnalyzer = require('./services/pdfAnalyzer');

// ANSI color codes for better readability
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

function section(title) {
    console.log('\n' + '═'.repeat(70));
    log(title, 'bright');
    console.log('═'.repeat(70));
}

async function testPDFAnalyzer(pdfPath) {
    section('PDF ANALYZER TEST');
    
    // Check if file exists
    if (!fs.existsSync(pdfPath)) {
        log(`❌ ERROR: Test PDF not found at: ${pdfPath}`, 'red');
        log('\nTo run this test:', 'yellow');
        log('1. Place a feedback PDF in the backend folder', 'yellow');
        log('2. Name it "test_feedback.pdf" (or update pdfPath in script)', 'yellow');
        log('3. Run: node test_pdf_analyzer.js', 'yellow');
        process.exit(1);
    }
    
    log(`✓ Found test PDF: ${path.basename(pdfPath)}`, 'green');
    
    // Read PDF buffer
    const buffer = fs.readFileSync(pdfPath);
    log(`✓ PDF size: ${(buffer.length / 1024).toFixed(2)} KB`, 'green');
    
    section('STEP 1: EXTRACTING HIGHLIGHTED TEXT (Red/Yellow backgrounds)');
    
    try {
        const highlighted = await pdfAnalyzer.extractHighlightedText(buffer);
        
        log(`\n📊 Results:`, 'cyan');
        log(`   • Appreciation comments: ${highlighted.appreciation.length}`, 'green');
        log(`   • Needs Attention comments: ${highlighted.commentsNeedingAttention.length}`, 'red');
        
        if (highlighted.appreciation.length > 0) {
            log('\n✓ Sample Appreciation:', 'green');
            highlighted.appreciation.slice(0, 3).forEach((c, i) => {
                console.log(`   ${i + 1}. "${c.substring(0, 80)}${c.length > 80 ? '...' : ''}"`);
            });
        }
        
        if (highlighted.commentsNeedingAttention.length > 0) {
            log('\n✓ Sample Needs Attention:', 'red');
            highlighted.commentsNeedingAttention.slice(0, 3).forEach((c, i) => {
                console.log(`   ${i + 1}. "${c.substring(0, 80)}${c.length > 80 ? '...' : ''}"`);
            });
        }
        
        if (highlighted.appreciation.length === 0 && highlighted.commentsNeedingAttention.length === 0) {
            log('\n⚠ WARNING: No highlighted comments found!', 'yellow');
            log('   This PDF may not have red/yellow backgrounds', 'yellow');
        }
        
    } catch (error) {
        log(`\n❌ ERROR: ${error.message}`, 'red');
        console.error(error);
    }
    
    section('STEP 2: ANALYZING WITH AI (Section-based extraction + Classification)');
    
    try {
        // Test without course code filter
        log('\n🔍 Analyzing PDF (all courses)...', 'cyan');
        const result = await pdfAnalyzer.analyzeFeedbackPDF(buffer, null);
        
        log(`\n📊 Results:`, 'cyan');
        log(`   • Total analyzed: ${result.total}`, 'blue');
        log(`   • Appreciation: ${result.appreciation.length}`, 'green');
        log(`   • Needs Attention: ${result.commentsNeedingAttention.length}`, 'red');
        log(`   • Mixed/Neutral: ${result.mixed.length}`, 'yellow');
        
        // Check for empty arrays issue
        if (result.appreciation.length === 0 && result.commentsNeedingAttention.length === 0) {
            log('\n❌ ISSUE DETECTED: Both arrays are EMPTY!', 'red');
            log('   Possible causes:', 'yellow');
            log('   1. isValidComment() rejecting all comments', 'yellow');
            log('   2. Section boundaries not detected correctly', 'yellow');
            log('   3. No text found in "Student Feedback Comments" section', 'yellow');
            log('\n   Check the logs above for:', 'yellow');
            log('   - "[PDF] ✓ Found section header at Y=..."', 'yellow');
            log('   - "[PDF] ✓ ACCEPTED (has feedback indicators): ..."', 'yellow');
            log('   - "[PDF] ✗ Filtered (Y=...): ..." (should only be form text)', 'yellow');
        } else {
            log('\n✅ SUCCESS: Classification working!', 'green');
            
            if (result.appreciation.length > 0) {
                log('\n📝 Sample Appreciation:', 'green');
                result.appreciation.slice(0, 3).forEach((c, i) => {
                    console.log(`   ${i + 1}. "${c.substring(0, 80)}${c.length > 80 ? '...' : ''}"`);
                });
            }
            
            if (result.commentsNeedingAttention.length > 0) {
                log('\n📝 Sample Needs Attention:', 'red');
                result.commentsNeedingAttention.slice(0, 3).forEach((c, i) => {
                    console.log(`   ${i + 1}. "${c.substring(0, 80)}${c.length > 80 ? '...' : ''}"`);
                });
            }
            
            if (result.mixed.length > 0) {
                log('\n📝 Sample Mixed/Neutral:', 'yellow');
                result.mixed.slice(0, 3).forEach((c, i) => {
                    console.log(`   ${i + 1}. "${c.substring(0, 80)}${c.length > 80 ? '...' : ''}"`);
                });
            }
        }
        
    } catch (error) {
        log(`\n❌ ERROR: ${error.message}`, 'red');
        console.error(error);
    }
    
    section('TEST COMPLETE');
    log('\n✓ Test finished! Review the logs above for details.', 'green');
    log('\nKey things to check:', 'cyan');
    log('1. Section header detected: "[PDF] ✓ Found section header at Y=..."', 'cyan');
    log('2. Comments accepted: "[PDF] ✓ ACCEPTED (has feedback indicators): ..."', 'cyan');
    log('3. Form text filtered: "[PDF] ✗ Filtered (Y=...): ..." should show survey questions', 'cyan');
    log('4. Final arrays non-empty: appreciation.length > 0 OR commentsNeedingAttention.length > 0', 'cyan');
}

// Main execution
const pdfPath = process.argv[2] || path.join(__dirname, 'test_feedback.pdf');

testPDFAnalyzer(pdfPath)
    .then(() => {
        log('\n✅ All tests completed', 'green');
        process.exit(0);
    })
    .catch(error => {
        log(`\n❌ Test failed: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    });
