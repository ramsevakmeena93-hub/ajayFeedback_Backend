# 🧪 How to Test New Changes

## ⚠️ **IMPORTANT: You're Seeing Old Data!**

The code changes ARE deployed, but you're seeing **old reports from the database** that were processed with the old code.

---

## ✅ **Steps to See New Changes:**

### **Option 1: Delete Old Reports (Recommended)**

1. **Open Postman or Browser Console**
2. **Make this API call:**
   ```
   DELETE https://your-backend-url.onrender.com/api/process/clear-all
   Headers: Authorization: Bearer YOUR_TOKEN
   ```
3. **Or use browser console on your dashboard:**
   ```javascript
   fetch('/api/process/clear-all', {
     method: 'DELETE',
     headers: {
       'Authorization': 'Bearer ' + localStorage.getItem('token')
     }
   }).then(r => r.json()).then(console.log)
   ```

### **Option 2: Upload Excel Again**

1. **Clear browser cache**: Press `Ctrl + Shift + R`
2. **Wait 5 minutes** for Render to finish deploying
3. **Upload the SAME Excel file again**
4. **The new uploads will use the new code!**

---

## 🔍 **What Changed in the Code:**

### **1. Comment Filters (backend/services/pdfAnalyzer.js):**
```javascript
// OLD: Minimum 8 characters
if (clean.length < 8) return false;

// NEW: Minimum 10 characters
if (clean.length < 10) return false;

// NEW: Filter garbage keywords
const tableKeywords = [
  'faculty name', 'course code', 'submitted answer',
  'requirement', 'operating system', 'real world', 
  'purchased', 'problem', ...
];
```

### **2. Course Name Line Breaks (backend/services/pdfAnalyzer.js):**
```javascript
// OLD: Join with space
const programme = courseNameParts.join(' ').replace(/\s+/g, ' ').trim();

// NEW: Preserve line breaks
const programme = courseNameParts.join('\n').trim();
```

### **3. Semester Detection (4 strategies):**
```javascript
// Strategy 1: Check expected column (X: 280-370)
// Strategy 2: Wider search (X: 230-450)
// Strategy 3: Scan nearby rows (±15 units)
// Strategy 4: Look for "Sem: 5" or Roman numerals (I→1, IV→4, VI→6)
```

### **4. Frontend Display (src/components/FeedbackTable.jsx):**
```javascript
// Display course names with line breaks
if (field === 'programme' && value) {
  const lines = value.split('\n').filter(Boolean);
  if (lines.length > 1) {
    return lines.map((line, i) => <div key={i}>{line}</div>);
  }
}
```

---

## 🎯 **Expected Results After Re-Upload:**

### **Before (Old):**
```
Course Name: Software Engineering
Comments: 
  - operating system purchased
  - requirement problem
  - submitted answer 45
Semester: (missing)
```

### **After (New):**
```
Course Name: Software
             Engineering
Comments: 
  - Hands on practical usage of power bi is very good and understanding
  - (short garbage filtered out)
Semester: 5
```

---

## 📊 **How to Verify Deployment:**

1. **Check Render Logs:**
   - Go to https://dashboard.render.com
   - Click your service → Logs
   - Should show: "Build successful" with latest commit hash `b71ddea`

2. **Check Git Commit:**
   ```bash
   cd backend
   git log --oneline -1
   # Should show: b71ddea Add clear-all endpoint...
   ```

3. **Test API Health:**
   ```
   GET https://your-backend-url.onrender.com/api/health
   # Should return: {"status":"ok",...}
   ```

---

## 🚀 **Timeline:**

- ✅ Code pushed to GitHub: **DONE**
- ⏱️ Render auto-deploy: **3-5 minutes** (wait for this!)
- ⏱️ Re-upload Excel: **After deployment completes**

---

## ❓ **Still Not Working?**

If after re-upload you still see bad data:

1. **Check Render logs** for errors
2. **Send me the exact text** of a "garbage" comment you see
3. **Tell me which faculty/report** has the issue
4. I'll add that specific pattern to the filter

---

**The code IS changed. You just need to re-upload Excel after Render deploys!** 🎉
