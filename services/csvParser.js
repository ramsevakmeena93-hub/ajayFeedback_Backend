const XLSX = require('xlsx');

/**
 * Extract Google Drive / PDF links & associated metadata from Excel (.xlsx/.xls) or CSV files.
 * - Inspects raw cell values, formatted strings, Excel hyperlinks (cell.l.Target), and formulas (=HYPERLINK).
 * - Multi-column detector extracts Faculty Name, Subject Code, Course Name, Programme, Semester, Response Count, and FFI Score.
 * - Deduplicates URLs and sanitizes whitespace/punctuation.
 */
function parseCSV(buffer) {
  const results = [];
  const seenUrls = new Set();

  let sheetsData = [];

  // 1. Try reading with XLSX (supports .xlsx, .xls, .ods)
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet['!ref']) continue;

      const range = XLSX.utils.decode_range(sheet['!ref']);
      const sheetRows = [];

      for (let R = range.s.r; R <= range.e.r; ++R) {
        const rowCells = [];
        let rowHasContent = false;

        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = sheet[cellAddr];
          if (!cell) {
            rowCells.push({ val: '', link: '', formula: '' });
            continue;
          }

          rowHasContent = true;
          const val = cell.w !== undefined ? String(cell.w).trim() : cell.v !== undefined ? String(cell.v).trim() : '';
          let link = (cell.l && cell.l.Target) ? String(cell.l.Target).trim() : '';
          const formula = cell.f ? String(cell.f).trim() : '';

          // If formula is =HYPERLINK("url", ...), extract url
          if (!link && formula) {
            const m = formula.match(/HYPERLINK\s*\(\s*["']([^"']+)["']/i);
            if (m) link = m[1].trim();
          }

          rowCells.push({ val, link, formula });
        }

        if (rowHasContent) {
          sheetRows.push(rowCells);
        }
      }

      if (sheetRows.length > 0) {
        sheetsData.push(sheetRows);
      }
    }
  } catch (err) {
    console.warn('[Parser] XLSX parse notice:', err.message);
  }

  // 2. Fallback to plain text CSV if XLSX didn't produce rows
  if (sheetsData.length === 0) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    const splitRow = (row) => row.split(/,(?=(?:(?:[^"]*"){2})*[^" ]*$)|[;\t]/)
      .map(c => c.trim().replace(/^["']|["']$/g, ''));
    const rows = lines.map(line => splitRow(line).map(c => ({ val: c, link: '', formula: '' })));
    if (rows.length > 0) sheetsData.push(rows);
  }

  if (sheetsData.length === 0) return [];

  // 3. Process extracted sheets
  for (const rows of sheetsData) {
    let headerIdx = -1;
    const colMap = {
      faculty: -1,
      subjectCode: -1,
      courseName: -1,
      link: -1,
      resp: -1,
      programme: -1,
      semester: -1,
      ffi: -1
    };

    // Scan first 15 rows for header row
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const row = rows[r];
      const texts = row.map(c => c.val.toLowerCase());

      const isHeader = texts.some(t => 
        t.includes('faculty') || t.includes('teacher') || t.includes('instructor') ||
        t.includes('link') || t.includes('drive') || t.includes('url') || 
        t.includes('course') || t.includes('subject')
      );

      if (isHeader) {
        headerIdx = r;
        texts.forEach((txt, idx) => {
          if (colMap.link === -1 && (txt.includes('link') || txt.includes('drive') || txt.includes('url') || txt.includes('pdf'))) {
            colMap.link = idx;
          } else if (colMap.faculty === -1 && (txt.includes('faculty') || txt.includes('teacher') || txt.includes('instructor') || (txt.includes('name') && !txt.includes('course') && !txt.includes('subject')))) {
            colMap.faculty = idx;
          } else if (colMap.subjectCode === -1 && (txt.includes('code') || txt.includes('course id') || txt.includes('sub code') || txt.includes('paper code'))) {
            colMap.subjectCode = idx;
          } else if (colMap.courseName === -1 && (txt.includes('course name') || txt.includes('subject name') || txt.includes('paper name') || (txt.includes('subject') && !txt.includes('code')))) {
            colMap.courseName = idx;
          } else if (colMap.resp === -1 && (txt.includes('resp') || txt.includes('student') || txt.includes('count') || txt.includes('feedback count'))) {
            colMap.resp = idx;
          } else if (colMap.programme === -1 && (txt.includes('program') || txt.includes('degree') || txt.includes('branch') || txt.includes('dept'))) {
            colMap.programme = idx;
          } else if (colMap.semester === -1 && (txt.includes('sem') || txt.includes('term'))) {
            colMap.semester = idx;
          } else if (colMap.ffi === -1 && (txt.includes('ffi') || txt.includes('score') || txt.includes('rating') || txt.includes('index'))) {
            colMap.ffi = idx;
          }
        });
        break;
      }
    }

    const startRow = headerIdx !== -1 ? headerIdx + 1 : 0;

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      let foundUrl = '';

      // Check designated link column
      if (colMap.link !== -1 && row[colMap.link]) {
        const c = row[colMap.link];
        if (c.link && c.link.startsWith('http')) {
          foundUrl = c.link;
        } else if (c.val) {
          const m = c.val.match(/https?:\/\/[^\s"',;<>]+/i);
          if (m) foundUrl = m[0];
        }
      }

      // Scan row for cell hyperlink target
      if (!foundUrl) {
        for (const c of row) {
          if (c.link && c.link.startsWith('http')) {
            foundUrl = c.link;
            break;
          }
        }
      }

      // Scan row for Drive or HTTP string
      if (!foundUrl) {
        const fullRowStr = row.map(c => c.val).join(' ');
        const driveM = fullRowStr.match(/https?:\/\/(?:drive\.google\.com|docs\.google\.com)[^\s"',;<>]+/i);
        if (driveM) {
          foundUrl = driveM[0];
        } else {
          const httpM = fullRowStr.match(/https?:\/\/[^\s"',;<>]+/i);
          if (httpM) foundUrl = httpM[0];
        }
      }

      if (!foundUrl) continue;

      // Clean up URL
      foundUrl = foundUrl.replace(/[.,;)]+$/, '');
      if (seenUrls.has(foundUrl)) continue;
      seenUrls.add(foundUrl);

      // Extract metadata
      let facultyName = '';
      if (colMap.faculty !== -1 && row[colMap.faculty]) {
        facultyName = row[colMap.faculty].val.trim();
      }

      let subjectCode = '';
      if (colMap.subjectCode !== -1 && row[colMap.subjectCode]) {
        subjectCode = row[colMap.subjectCode].val.trim();
      }

      let courseName = '';
      if (colMap.courseName !== -1 && row[colMap.courseName]) {
        courseName = row[colMap.courseName].val.trim();
      }

      let programme = '';
      if (colMap.programme !== -1 && row[colMap.programme]) {
        programme = row[colMap.programme].val.trim();
      }

      let semester = '';
      if (colMap.semester !== -1 && row[colMap.semester]) {
        semester = row[colMap.semester].val.trim();
      }

      let responseCount = null;
      if (colMap.resp !== -1 && row[colMap.resp]) {
        const v = parseInt(row[colMap.resp].val.replace(/[^\d]/g, ''), 10);
        if (!isNaN(v) && v > 0) responseCount = v;
      }
      // Fallback response count in adjacent cells
      if (responseCount === null) {
        for (const c of row) {
          if (/^\d{1,4}$/.test(c.val.trim())) {
            const v = parseInt(c.val.trim(), 10);
            if (v > 0 && v < 5000) {
              responseCount = v;
              break;
            }
          }
        }
      }

      let ffiScore = null;
      if (colMap.ffi !== -1 && row[colMap.ffi]) {
        const v = parseFloat(row[colMap.ffi].val.replace(/[^\d.]/g, ''));
        if (!isNaN(v) && v >= 0 && v <= 5) ffiScore = v;
      }

      results.push({
        pdfLink: foundUrl,
        facultyName,
        subjectCode,
        courseName,
        programme,
        semester,
        responseCount,
        ffiScore
      });
    }
  }

  console.log(`[Spreadsheet Parser] Successfully parsed ${results.length} valid links.`);
  return results;
}

module.exports = { parseCSV };
