# ≡ƒöº Fix: AI Analyzer Cannot Read Links with MITS Domain Restriction

## Problem
When you set Google Drive folder to "Anyone at MITS can access", the service account (AI analyzer) loses access because it's not an @mitsgwl.ac.in or @mitsgwalior.in email.

## Γ£à Solution: Dual Access Setup

You need **BOTH** types of access:
1. **Domain-wide sharing** for MITS faculty (upload/edit access)
2. **Explicit service account sharing** for AI analyzer (read-only access)

---

## ≡ƒôï Step-by-Step Fix

### **Step 1: Find Your Service Account Email**

1. Open your service account JSON key file (the one you downloaded from Google Cloud Console)
2. Look for `"client_email"` - it looks like:
   ```
   feedback-drive-access@project-123456.iam.gserviceaccount.com
   ```
3. **Copy this email address**

### **Step 2: Share Folder with Service Account**

1. Go to Google Drive
2. Find your **feedback reports folder** (the one where PDFs are uploaded)
3. **Right-click** on the folder ΓåÆ **Share**
4. In the "Add people" field, **paste the service account email**
5. Set permission to **Viewer**
6. **Uncheck** "Notify people" (service accounts don't need emails)
7. Click **Share**

### **Step 3: Keep Domain Restriction**

Your folder should now show:

```
≡ƒîÉ General Access:
   ΓööΓöÇ Anyone at Madhav Institute of Technology & Science
      ΓööΓöÇ Can edit

≡ƒæÑ Shared with:
   ΓööΓöÇ feedback-drive-access@project-123456.iam.gserviceaccount.com
      ΓööΓöÇ Viewer
```

This setup allows:
- Γ£à **MITS faculty** (@mitsgwl.ac.in, @mitsgwalior.in) can upload/edit
- Γ£à **Service account** (AI analyzer) can read files
- Γ¥î **External users** are blocked

---

## ≡ƒº¬ Test the Fix

### **Option 1: Quick Test (Command Line)**

Run this in your backend directory:

```bash
node test_drive_link_access.js
```

**Before running:**
1. Open `test_drive_link_access.js`
2. Replace `testLink` with an actual PDF link from your Drive folder
3. Save and run

**Expected output:**
```
Γ£à File metadata access successful!
Γ£à File download successful!
≡ƒÄë All tests passed!
```

### **Option 2: Test via Application**

1. Log in as HOD
2. Upload a feedback Excel file with a Drive link
3. Submit for approval
4. Check if AI analysis generates successfully
5. Pro-VC should see the AI summary in approval page

---

## ≡ƒÜ¿ Troubleshooting

### **Error: "Permission denied (403)"**

**Cause:** Service account doesn't have access to the folder

**Fix:**
1. Double-check you shared the **folder** (not individual files)
2. Verify the service account email is correct
3. Refresh the folder permissions
4. Make sure the folder is the **parent folder** where PDFs are stored

### **Error: "File not found (404)"**

**Cause:** Drive link format issue or file doesn't exist

**Fix:**
1. Verify the PDF link is valid (open it in browser)
2. Check the file ID extraction in `aiAnalyzer.js`
3. Make sure files are in the shared folder

### **AI Analyzer Still Fails**

**Debug steps:**
1. Check Render logs for error messages
2. Verify environment variables are set:
   - `GOOGLE_DRIVE_CLIENT_EMAIL`
   - `GOOGLE_DRIVE_PRIVATE_KEY`
3. Run the test script locally first
4. Check if service account credentials are valid

---

## ≡ƒô¥ Important Notes

1. **Share the FOLDER, not individual files**
   - Sharing the parent folder gives access to all files inside
   - No need to share each PDF individually

2. **Service account needs Viewer permission only**
   - Read-only access is sufficient for AI analyzer
   - Never give Editor access unless absolutely necessary

3. **Domain restriction stays active**
   - Faculty can still upload normally
   - Only service account gets special access

4. **No notification needed**
   - Service accounts are robots, they don't check email
   - Always uncheck "Notify people" when sharing

---

## Γ£à Verification Checklist

- [ ] Service account email copied from JSON key file
- [ ] Folder shared with service account (Viewer permission)
- [ ] Domain restriction still active (MITS emails only)
- [ ] Test script runs successfully
- [ ] HOD can upload Excel with Drive links
- [ ] AI analysis generates without errors
- [ ] Pro-VC sees AI summary in approval page

---

## ≡ƒÄ» Final Result

Your system should now support:

1. Γ£à **MITS faculty** upload feedback via Drive links
2. Γ£à **Domain restriction** blocks external access
3. Γ£à **AI analyzer** reads PDFs automatically
4. Γ£à **Pro-VC** gets AI summaries for approval

**Security maintained + Functionality restored!** ≡ƒÄë
