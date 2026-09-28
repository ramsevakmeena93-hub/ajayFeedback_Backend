const XLSX = require('xlsx');
const AdmZip = require('adm-zip');

/**
 * Extract hyperlink URLs directly from xlsx ZIP XML relationships.
 * This works regardless of xlsx library version or environment.
 * Returns: { cellRef -> url } e.g. { 'A1': 'https://...', 'A2': 'https://...' }
 */
function extractHyperlinksFromXlsx(buffer) {
  const urlMap = {}; // cellRef -> url
  try {
    const zip = new AdmZip(buffer);

    // Find sheet1 XML and its relationships file
    const sheetXmlEntry = zip.getEntries().find(e => e.entryName.match(/xl\/worksheets\/sheet1\.xml$/i));
    const relsEntry = zip.getEntries().find(e => e.entryName.match(/xl\/worksheets\/_rels\/sheet1\.xml\.rels$/i));

    if (!relsEntry) return urlMap;

    // Parse relationships: Id -> URL
    const relsXml = zip.readAsText(relsEntry);
    const relMap = {};
    const relRegex = /Id="([^"]+)"[^>]+Type="[^"]*hyperlink[^"]*"[^>]+Target="([^"]+)"/gi;
    let m;
    while ((m = relRegex.exec(relsXml)) !== null) {
      relMap[m[1]] = m[2].replace(/&amp;/g, '&');
    }

    if (!sheetXmlEntry) return urlMap;

    // Parse sheet XML: find <hyperlink ref="A1" r:id="rId1"/>
    const sheetXml = zip.readAsText(sheetXmlEntry);
    const hlRegex = /<hyperlink[^>]+ref="([^"]+)"[^>]+r:id="([^"]+)"[^>]*\/?>/gi;
    while ((m = hlRegex.exec(sheetXml)) !== null) {
      const cellRef = m[1]; // e.g. "A1"
      const rId = m[2];     // e.g. "rId1"
      if (relMap[rId]) urlMap[cellRef] = relMap[rId];
    }
  } catch (e) {
    console.warn('[Parser] hyperlink XML extraction error:', e.message);
  }
  return urlMap;
}

/**
 * Extract Google Drive / PDF links & associated metadata from Excel (.xlsx/.xls) or CSV files.
 * - Inspects raw cell values, formatted strings, Excel hyperlinks (cell.l.Target), and formulas (=HYPERLINK).
 * - Multi-column detector extracts Faculty Name, Subject Code, Course Name, Programme, Semester, Response Count, and FFI Score.
 * - Deduplicates URLs and sanitizes whitespace/punctuation.
 */
function parseCSV(buffer) {
  const results = [];
  const seenUrls = new Set();

  // Extract hyperlinks directly from xlsx XML (reliable on all environments)
  const hyperlinkMap = extractHyperlinksFromXlsx(buffer);
  console.log('[Parser] Hyperlinks from XML:', hyperlinkMap);

  let sheetsData = [];

  // 1. Try reading with XLSX (supports .xlsx, .xls, .ods)
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellStyles: true, cellHTML: false, bookVBA: false });
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
          // Use XML hyperlink map first (most reliable), fall back to cell.l
          let link = hyperlinkMap[cellAddr] || ((cell.l && cell.l.Target) ? String(cell.l.Target).trim().replace(/&amp;/g, '&') : '');
          const formula = cell.f ? String(cell.f).trim() : '';

          // If formula is =HYPERLINK("url", ...), extract url
          if (!link && formula) {
            const m = formula.match(/HYPERLINK\s*\(\s*["']([^"']+)["']/i);
            if (m) link = m[1].trim().replace(/&amp;/g, '&');
          }

          // If val itself looks like a URL, use it as link too
          if (!link && val.startsWith('http')) {
            link = val.replace(/&amp;/g, '&');
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
      const rowStr = texts.join(' ');

      // Skip rows that actually contain URLs — those are data rows
      const hasUrl = row.some(c => /https?:\/\//i.test(c.val) || (c.link && c.link.startsWith('http')));
      if (hasUrl) continue;

      const isHeader = texts.some(t =>
        t.includes('faculty') || t.includes('teacher') || t.includes('instructor') ||
        t.includes('link') || t.includes('url') ||
        t.includes('course') || t.includes('subject') || t.includes('name')
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

      // Collect ALL urls from this row — a cell may contain multiple concatenated URLs
      const allUrlsInRow = [];

      // First check cell hyperlink targets
      for (const c of row) {
        if (c.link && c.link.startsWith('http')) {
          allUrlsInRow.push(c.link.trim());
        }
      }

      // Then scan all cell text values — extract every https?:// occurrence
      const fullRowStr = row.map(c => c.val).join(' ');
      const urlRegex = /https?:\/\/[^\s"',;<>\]]+/gi;
      let m;
      while ((m = urlRegex.exec(fullRowStr)) !== null) {
        const url = m[0].replace(/[.,;)&]+$/, ''); // strip trailing junk
        if (!allUrlsInRow.includes(url)) allUrlsInRow.push(url);
      }

      if (allUrlsInRow.length === 0) continue;

      // Extract facultyName from first non-URL text cell (usually col A = filename)
      let facultyName = '';
      for (const c of row) {
        const v = c.val.trim();
        if (v && !v.startsWith('http') && v.length > 2) {
          // Strip .pdf extension to get a clean name
          facultyName = v.replace(/\.pdf$/i, '').trim();
          break;
        }
      }

      let subjectCode = '';
      if (colMap.subjectCode !== -1 && row[colMap.subjectCode]) subjectCode = row[colMap.subjectCode].val.trim();

      let courseName = '';
      if (colMap.courseName !== -1 && row[colMap.courseName]) courseName = row[colMap.courseName].val.trim();

      let programme = '';
      if (colMap.programme !== -1 && row[colMap.programme]) programme = row[colMap.programme].val.trim();

      let semester = '';
      if (colMap.semester !== -1 && row[colMap.semester]) semester = row[colMap.semester].val.trim();

      let responseCount = null;
      if (colMap.resp !== -1 && row[colMap.resp]) {
        const v = parseInt(row[colMap.resp].val.replace(/[^\d]/g, ''), 10);
        if (!isNaN(v) && v > 0) responseCount = v;
      }

      let ffiScore = null;
      if (colMap.ffi !== -1 && row[colMap.ffi]) {
        const v = parseFloat(row[colMap.ffi].val.replace(/[^\d.]/g, ''));
        if (!isNaN(v) && v >= 0 && v <= 5) ffiScore = v;
      }

      // Emit one result per URL found in this row
      for (const url of allUrlsInRow) {
        const cleanUrl = url.replace(/&amp;/g, '&').replace(/[.,;)]+$/, '');
        if (!cleanUrl.startsWith('http')) continue;
        if (seenUrls.has(cleanUrl)) continue;
        seenUrls.add(cleanUrl);

        results.push({
          pdfLink: cleanUrl,
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
  }

  console.log(`[Spreadsheet Parser] Successfully parsed ${results.length} valid links.`);
  return results;
}

module.exports = { parseCSV };
