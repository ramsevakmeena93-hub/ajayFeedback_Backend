/**
 * QUICK TEST: Vandana Jaiswal PDF
 * 
 * This script helps diagnose why Vandana's feedback shows "No suggestion"
 * when the PDF clearly has comments like "Good", "Excellent", "Nice teacher"
 * 
 * HOW TO USE:
 * 1. Find Vandana's PDF file (should be in uploads or database)
 * 2. Run: node test_vandana_pdf.js path/to/vandana.pdf
 */

require('dotenv').config();
const fs = require('fs');
const pdfAnalyzer = require('./services/pdfAnalyzer');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bright: '\x1b[1m',
};

function log(msg, color = 'reset') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function testVandanaPDF(pdfPath) {
    console.log('\n' + '='.repeat(70));
    log('VANDANA JAISWAL PDF TEST', 'bright');
    console.log('='.repeat(70) + '\n');
    
    if (!fs.existsSync(pdfPath)) {
        log(`❌ ERROR: PDF not found: ${pdfPath}`, 'red');
        log('\nUsage: node test_vandana_pdf.js path/to/vandana.pdf', 'yellow');
        process.exit(1);
    }
    
    log(`✓ Found PDF: ${pdfPath}`, 'green');
    
    const buffer = fs.readFileSync(pdfPath);
    log(`✓ Size: ${(buffer.length / 1024).toFixed(2)} KB`, 'green');
    
    console.log('\n' + '-'.repeat(70));
    log('STEP 1: Analyzing with AI (should extract comments like "Good", "Excellent")', 'cyan');
    console.log('-'.repeat(70) + '\n');
    
    try {
        const result = await pdfAnalyzer.analyzeFeedbackPDF(buffer, null);
        
        log('\n📊 RESULTS:', 'bright');
        log(`   Total analyzed: ${result.total}`, 'cyan');
        log(`   Appreciation: ${result.appreciation.length}`, result.appreciation.length > 0 ? 'green' : 'red');
        log(`   Needs Attention: ${result.commentsNeedingAttention.length}`, result.commentsNeedingAttention.length > 0 ? 'green' : 'red');
        log(`   Mixed/Neutral: ${result.mixed.length}`, 'yellow');
        
        if (result.appreciation.length === 0 && result.commentsNeedingAttention.length === 0) {
            log('\n❌ ISSUE: Both arrays are EMPTY!', 'red');
            log('\nCheck the logs above for:', 'yellow');
            log('  • "[PDF] ✓ Found" messages - section detection', 'yellow');
            log('  • "[PDF] ✓ ACCEPTED" messages - comment validation', 'yellow');
            log('  • "[PDF] ✗ Rejected" messages - what failed validation', 'yellow');
            log('  • "[PDF] ✗ Filtered" messages - what was outside section bounds', 'yellow');
        } else {
            log('\n✅ SUCCESS! Comments extracted:', 'green');
            
            if (result.appreciation.length > 0) {
                log('\n📝 Appreciation:', 'green');
                result.appreciation.forEach((c, i) => {
                    console.log(`   ${i + 1}. ${c}`);
                });
            }
            
            if (result.commentsNeedingAttention.length > 0) {
                log('\n📝 Needs Attention:', 'red');
                result.commentsNeedingAttention.forEach((c, i) => {
                    console.log(`   ${i + 1}. ${c}`);
                });
            }
            
            if (result.mixed.length > 0) {
                log('\n📝 Mixed/Neutral:', 'yellow');
                result.mixed.forEach((c, i) => {
                    console.log(`   ${i + 1}. ${c}`);
                });
            }
        }
        
        console.log('\n' + '='.repeat(70));
        log('TEST COMPLETE', 'bright');
        console.log('='.repeat(70));
        
    } catch (error) {
        log(`\n❌ ERROR: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    }
}

const pdfPath = process.argv[2];

if (!pdfPath) {
    log('❌ ERROR: Please provide PDF path', 'red');
    log('\nUsage: node test_vandana_pdf.js path/to/vandana.pdf', 'yellow');
    log('\nExample:', 'cyan');
    log('  node test_vandana_pdf.js "C:\\Users\\Hp\\Desktop\\vandana_feedback.pdf"', 'cyan');
    process.exit(1);
}

testVandanaPDF(pdfPath)
    .then(() => process.exit(0))
    .catch(error => {
        log(`\n❌ Test failed: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    });
