# HOD Export PDF with Filters - Implementation Guide

## ✅ What's Been Implemented

### Backend Changes (routes/reports.js)

1. **Enhanced Export Endpoint** - Now supports filter parameters:
   - `semester` - Filter by specific semester (1-8) or "all"
   - `academicYear` - Filter by academic year (e.g., "2026-2027") or "all"
   - `session` - Filter by session ("jan-may", "july-dec") or "all"

2. **New API Endpoint** - `/api/reports/my/export-filters` (GET)
   - Returns available filter options from HOD's reports
   - Response format:
   ```json
   {
     "semesters": [1, 2, 3, 4, 5, 6],
     "academicYears": ["2026-2027", "2025-2026"],
     "sessions": ["jan-may", "july-dec"],
     "totalReports": 38
   }
   ```

3. **Dynamic Filenames** - PDF files now have descriptive names:
   - All reports: `hod-feedback-report.pdf`
   - Filtered by semester: `hod-feedback-report-sem3.pdf`
   - Filtered by year: `hod-feedback-report-2026-2027.pdf`
   - Combined: `hod-feedback-report-sem5-2026-2027.pdf`

### PDF Generator Changes (services/pdfGenerator.js)

1. **Filter Display in PDF Header** - Shows which filters were applied:
   ```
   Semester Filter: Semester 3
   --- OR ---
   Included Semesters: 1, 2, 3, 4
   ```

2. **Filter Context** - Passed via `submission.filterInfo` object

## 🔧 API Usage

### Export All Reports (No Filters)
```javascript
POST /api/reports/my/export-pdf
Headers: { Authorization: "Bearer <token>" }
Body: {}
```

### Export Filtered Reports
```javascript
POST /api/reports/my/export-pdf
Headers: { 
  Authorization: "Bearer <token>",
  Content-Type: "application/json"
}
Body: {
  "semester": "3",           // Optional: specific semester
  "academicYear": "2026-2027", // Optional: specific year
  "session": "jan-may"       // Optional: specific session
}
```

### Get Available Filters
```javascript
GET /api/reports/my/export-filters
Headers: { Authorization: "Bearer <token>" }
```

## 📝 Example Frontend Integration

### React/JavaScript Example
```javascript
// 1. Get available filters
async function loadFilters() {
  const response = await fetch('/api/reports/my/export-filters', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  // data.semesters, data.academicYears, data.sessions
  return data;
}

// 2. Export with filters
async function exportPDF(filters) {
  const response = await fetch('/api/reports/my/export-pdf', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(filters) // { semester: "3", academicYear: "2026-2027" }
  });
  
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  
  // Get filename from response header
  const disposition = response.headers.get('Content-Disposition');
  const filename = disposition.match(/filename="(.+)"/)?.[1] || 'report.pdf';
  
  a.download = filename;
  a.click();
}

// 3. Export all reports (no filters)
async function exportAllReports() {
  await exportPDF({});
}

// 4. Export semester 5 only
async function exportSemester5() {
  await exportPDF({ semester: "5" });
}
```

## 🎨 UI Component Example

```html
<!-- Add this to your HOD Dashboard -->
<div class="export-section">
  <h3>Export Reports as PDF</h3>
  
  <div class="filter-row">
    <label>Semester:</label>
    <select id="semesterFilter">
      <option value="all">All Semesters</option>
      <!-- Populated dynamically from /api/reports/my/export-filters -->
    </select>
  </div>
  
  <div class="filter-row">
    <label>Academic Year:</label>
    <select id="yearFilter">
      <option value="all">All Years</option>
      <!-- Populated dynamically -->
    </select>
  </div>
  
  <div class="filter-row">
    <label>Session:</label>
    <select id="sessionFilter">
      <option value="all">All Sessions</option>
      <option value="jan-may">January - May</option>
      <option value="july-dec">July - December</option>
    </select>
  </div>
  
  <button onclick="handleExportPDF()">📄 Export PDF</button>
</div>
```

## 🧪 Testing

Use the provided test page: `test-hod-comment.html`

1. Open the file in your browser
2. Enter your HOD token
3. Click "Get Available Filters" to see what filters are available
4. Select filters from the dropdowns
5. Click "Export Filtered Reports"

## 📊 Filter Examples

### Example 1: All Semester 3 Reports
```json
{
  "semester": "3"
}
```
→ PDF shows only Semester 3 reports
→ Filename: `hod-feedback-report-sem3.pdf`
→ Header shows: "Semester Filter: Semester 3"

### Example 2: All Reports from 2026-2027
```json
{
  "academicYear": "2026-2027"
}
```
→ PDF shows only 2026-2027 reports
→ Filename: `hod-feedback-report-2026-2027.pdf`

### Example 3: Semester 5 + Academic Year 2026-2027
```json
{
  "semester": "5",
  "academicYear": "2026-2027"
}
```
→ PDF shows only Semester 5 reports from 2026-2027
→ Filename: `hod-feedback-report-sem5-2026-2027.pdf`

### Example 4: All Reports (No Filters)
```json
{}
```
→ PDF shows all 38 reports
→ Filename: `hod-feedback-report.pdf`
→ Header shows: "Included Semesters: 1, 2, 3, 4, 5, 6"

## 🔍 Console Logs

When exporting, check backend console for detailed logs:

```
[HOD Export] ========== EXPORT PDF REQUEST ==========
[HOD Export] HOD User: { id: '...', department: 'Humanities', name: 'Dr. Smith' }
[HOD Export] Filtering by semester: 3
[HOD Export] Query filters: { "hodId": "...", "semester": "3" }
[HOD Export] Found reports: 6
[HOD Export] First report details: { academicYear: '2026-2027', session: 'jan-may', semester: 3 }
[HOD Export] ==========================================
```

## 🚀 Next Steps

1. **Integrate into Frontend UI** - Add filter dropdowns to your HOD dashboard
2. **Test All Scenarios** - Export with different filter combinations
3. **Add Loading States** - Show spinner while PDF is generating
4. **Error Handling** - Show user-friendly messages if no reports match filters

## ⚠️ Important Notes

- Filters use **AND logic** - if you select Semester 3 AND Year 2026-2027, only reports matching BOTH are included
- If no reports match the filters, API returns 400 error with message
- The "all" option means no filter is applied for that field
- Filters are case-sensitive for session values ("jan-may" not "Jan-May")
