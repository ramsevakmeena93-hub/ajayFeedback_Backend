const { spawn } = require('child_process');
const path = require('path');

const PYTHON_SCRIPT = path.join(__dirname, '..', 'scripts', 'hf_classifier.py');

/**
 * Classifies an array of raw feedback comments using the Hugging Face DeBERTa zero-shot model.
 * @param {string[]} rawComments
 * @returns {Promise<object>}
 */
function classifyCommentsWithHF(rawComments) {
  return new Promise((resolve) => {
    if (!Array.isArray(rawComments) || rawComments.length === 0) {
      return resolve({
        appreciation: [],
        commentsNeedingAttention: [],
        commentCategories: { Teaching: [], Communication: [], Availability: [], Materials: [], Assessment: [], General: [] },
        classifiedComments: [],
        statistics: { totalReceived: 0, appreciation: 0, attention: 0, neutral: 0, skipped: 0, aiClassified: 0 }
      });
    }

    const pythonProcess = spawn('python', [PYTHON_SCRIPT], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf-8');
    });

    pythonProcess.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf-8');
    });

    pythonProcess.on('error', (err) => {
      console.error('[HF AI] Failed to spawn python process:', err.message);
      resolve(getFallbackResult(rawComments));
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`[HF AI] Python classifier exited with code ${code}:`, stderrData);
        return resolve(getFallbackResult(rawComments));
      }

      try {
        const result = JSON.parse(stdoutData.trim());
        if (result.error) {
          console.error('[HF AI] Python error returned:', result.error);
          return resolve(getFallbackResult(rawComments));
        }

        console.log(`[HF AI] Successfully classified ${rawComments.length} comments: ${result.appreciation.length} appreciation, ${result.commentsNeedingAttention.length} attention`);
        resolve(result);
      } catch (parseErr) {
        console.error('[HF AI] Failed to parse python output:', parseErr.message, stdoutData);
        resolve(getFallbackResult(rawComments));
      }
    });

    // Send comments JSON to python stdin
    pythonProcess.stdin.write(JSON.stringify(rawComments));
    pythonProcess.stdin.end();
  });
}

/**
 * Basic fallback in case Python is unavailable
 */
function getFallbackResult(rawComments) {
  const result = {
    appreciation: [],
    commentsNeedingAttention: [],
    commentCategories: { Teaching: [], Communication: [], Availability: [], Materials: [], Assessment: [], General: [] },
    classifiedComments: [],
    statistics: { totalReceived: rawComments.length, appreciation: 0, attention: 0, neutral: 0, skipped: 0, aiClassified: 0 }
  };

  for (const item of rawComments) {
    if (!item || typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean) continue;
    // Default fallback to appreciation unless negative keywords present
    const isNegative = /\b(not|slow|fast|bad|issue|problem|difficult|incomplete|unclear|skip)\b/i.test(clean);
    if (isNegative) {
      result.commentsNeedingAttention.push(clean);
      result.statistics.attention++;
    } else {
      result.appreciation.push(clean);
      result.statistics.appreciation++;
    }
  }
  return result;
}

module.exports = {
  classifyCommentsWithHF
};
