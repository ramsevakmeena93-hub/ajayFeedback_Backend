const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const UserRole = require('../models/UserRole');
const AuditLog = require('../models/AuditLog');
const { authMiddleware } = require('./middleware');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const TOKEN_EXPIRY = '7d';

// ─────────────────────────────────────────────────────────────────────────────
// Domain whitelist — only @mitsgwalior.in is allowed
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS = ['@mitsgwalior.in', '@mitsgwl.ac.in'];

function isAllowedDomain(email) {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  return ALLOWED_DOMAINS.some(domain => lower.endsWith(domain));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build full user payload (used in login + /me responses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildUserPayload — reads the User doc + active UserRoles and returns the
 * standardised object the frontend expects.
 *
 * Shape:
 * {
 *   id, name, email,
 *   role,            ← legacy primary role (backward compat)
 *   roles[],         ← all active role names
 *   roleDetails[],   ← full UserRole docs with departmentScope
 *   activeWorkspace, ← current workspace context
 *   department,
 *   hasSignature,
 *   profilePhoto?,
 *   defaultAlternateApproverId?,
 * }
 */
async function buildUserPayload(user) {
  const activeRoles = await UserRole.find({ userId: user._id, active: true })
    .select('role departmentScope')
    .lean();

  const rolesArray = [...new Set(activeRoles.map(r => r.role))];
  // Every HOD is inherently a faculty member teaching subjects
  if (user.role === 'hod' || rolesArray.includes('hod')) {
    if (!rolesArray.includes('hod')) rolesArray.push('hod');
    if (!rolesArray.includes('faculty')) rolesArray.push('faculty');
  }

  // Merge DB roles into legacy field: most-privileged wins
  const PRIORITY = ['admin', 'vc', 'hod', 'faculty'];
  const primaryRole = PRIORITY.find(r => rolesArray.includes(r)) || user.role || 'faculty';

  // Determine activeWorkspace: stored on user, or fall back to primary role
  const activeWorkspace = user.activeWorkspace || primaryRole;

  return {
    id:                       user._id,
    name:                     user.name,
    email:                    user.email,
    role:                     primaryRole,          // legacy — always present
    roles:                    rolesArray.length ? rolesArray : [primaryRole],
    roleDetails:              activeRoles,           // includes departmentScope
    activeWorkspace,
    department:               user.department || '',
    hasSignature:             !!user.signatureImage,
    profilePhoto:             user.profilePhoto || '',
    defaultAlternateApproverId: user.defaultAlternateApproverId || null,
  };
}

/**
 * signToken — includes roles[] and activeWorkspace in the JWT so the
 * backend can validate them without a DB round-trip on every request.
 *
 * The backend NEVER trusts role values submitted in request bodies.
 */
function signToken(user, roles, activeWorkspace) {
  return jwt.sign(
    {
      id:              user._id,
      role:            user.role,            // legacy field
      roles:           roles,                // multi-role array
      activeWorkspace: activeWorkspace || user.role,
      department:      user.department || '',
      departmentScope: user.department || '', // convenience alias used by middleware
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    let { name, email, password, department } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required' });
    const cleanEmail = email.toLowerCase().trim();

    if (!isAllowedDomain(cleanEmail)) {
      return res.status(403).json({
        error: 'Only @mitsgwalior.in institutional emails are permitted to register.',
      });
    }

    const existing = await User.findOne({ email: cleanEmail });
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    // Public self-registration grants faculty role, but special accounts may have elevated roles.
    // Assign 'vc' role for designated institutional email.
    // Assign 'hod' role for designated HOD institutional email.
    let safeRole = 'faculty';
    let safeDepartment = department || '';
    if (cleanEmail === '25tc1aj7@mitsgwl.ac.in') {
      safeRole = 'admin';
      safeDepartment = '';
    }
    if (cleanEmail === '25mc1sh132@mitsgwl.ac.in') {
      safeRole = 'hod';
      safeDepartment = safeDepartment || 'Literature, Politics and Economics';
    }

    const user = await User.create({
      name, email: cleanEmail,
      password:        hashed,
      role:            safeRole,
      roles:           [safeRole],
      department:      safeDepartment,
      activeWorkspace: safeRole,
    });

    // Create the initial UserRole document
    await UserRole.create({
      userId:          user._id,
      role:            safeRole,
      departmentScope: safeDepartment,
    });

    const payload = await buildUserPayload(user);
    const token   = signToken(user, payload.roles, payload.activeWorkspace);

    console.log(`[Auth] New user registered: ${name} (${email}) as ${safeRole}`);
    res.json({ token, user: payload });
  } catch (err) {
    console.error(`[Auth] Registration failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const cleanEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      console.warn(`[Auth] Login failed — unknown email: ${cleanEmail}`);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Domain restriction: only @mitsgwalior.in
    // Pre-authorized system accounts (admin, hod, vc) created by admin bypass if pre-existing
    if (!isAllowedDomain(cleanEmail) && !['admin', 'hod', 'vc'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access is restricted to @mitsgwalior.in accounts.',
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.warn(`[Auth] Login failed — wrong password for: ${cleanEmail}`);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Contact admin.' });
    }

    // Update login tracking
    await User.findByIdAndUpdate(user._id, {
      lastLogin:      new Date(),
      currentLoginAt: new Date(),
      $inc: { loginCount: 1 },
    });

    // Re-apply hardcoded role overrides for designated accounts
    if (cleanEmail === '25tc1aj7@mitsgwl.ac.in' && user.role !== 'admin') {
      await User.findByIdAndUpdate(user._id, { role: 'admin', roles: ['admin'], activeWorkspace: 'admin', department: '' });
      await UserRole.deleteMany({ userId: user._id });
      await UserRole.create({ userId: user._id, role: 'admin', departmentScope: '', active: true });
      user.role = 'admin'; user.activeWorkspace = 'admin'; user.department = '';
    }
    if (cleanEmail === '25mc1sh132@mitsgwl.ac.in' && user.role !== 'hod') {
      await User.findByIdAndUpdate(user._id, { role: 'hod', roles: ['hod','faculty'], activeWorkspace: 'hod', department: 'Literature, Politics and Economics' });
      await UserRole.deleteMany({ userId: user._id });
      await UserRole.create([
        { userId: user._id, role: 'hod',    departmentScope: 'Literature, Politics and Economics', active: true },
        { userId: user._id, role: 'faculty', departmentScope: 'Literature, Politics and Economics', active: true },
      ]);
      user.role = 'hod'; user.activeWorkspace = 'hod';
    }

    // Ensure this user has at least one UserRole document (backfill for old accounts)
    const existingRoles = await UserRole.find({ userId: user._id, active: true });
    if (existingRoles.length === 0) {
      await UserRole.create({
        userId:          user._id,
        role:            user.role,
        departmentScope: user.department || '',
      });
    }

    const payload = await buildUserPayload(user);
    const token   = signToken(user, payload.roles, payload.activeWorkspace);

    console.log(`[Auth] Login: ${user.name} (${user.email}) [${payload.roles.join(',')}] ws:${payload.activeWorkspace}`);
    res.json({ token, user: payload });
  } catch (err) {
    console.error(`[Auth] Login error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Workspace switch  (also at /api/workspace/switch — see workspace.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/workspace/switch
 * Body: { workspace: 'hod'|'faculty'|'vc'|'admin' }
 *
 * Validates the user actually holds that role before switching.
 * Issues a fresh JWT with the new activeWorkspace.
 * Records an AuditLog entry.
 */
router.post('/workspace/switch', authMiddleware, async (req, res) => {
  try {
    const { workspace } = req.body;
    if (!workspace) return res.status(400).json({ error: 'workspace is required' });

    // Re-read from DB — never trust the request body for role validation
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const activeRoles = await UserRole.find({ userId: user._id, active: true }).select('role departmentScope');
    const rolesArray  = [...new Set(activeRoles.map(r => r.role))];
    if (user.role === 'hod' || rolesArray.includes('hod')) {
      if (!rolesArray.includes('hod')) rolesArray.push('hod');
      if (!rolesArray.includes('faculty')) rolesArray.push('faculty');
    }

    if (!rolesArray.includes(workspace)) {
      return res.status(403).json({
        error: `You do not hold the '${workspace}' role`,
        yourRoles: rolesArray,
      });
    }

    // Persist the new active workspace
    await User.findByIdAndUpdate(user._id, { activeWorkspace: workspace });
    user.activeWorkspace = workspace;

    const payload = await buildUserPayload(user);
    const token   = signToken(user, rolesArray, workspace);

    // Audit
    await AuditLog.record({
      actorId:     user._id,
      actorName:   user.name,
      actorRole:   req.user.role,
      workspace,
      event:       'workspace_switch',
      description: `${user.name} switched workspace from '${req.user.activeWorkspace || req.user.role}' to '${workspace}'`,
      targetType:  'user',
      targetId:    user._id,
      meta: {
        from: req.user.activeWorkspace || req.user.role,
        to:   workspace,
        ip:   req.ip,
      },
    });

    console.log(`[Auth] Workspace switch: ${user.name} → ${workspace}`);
    res.json({ token, user: { ...payload, activeWorkspace: workspace } });
  } catch (err) {
    console.error(`[Auth] Workspace switch error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Upload / update signature
// ─────────────────────────────────────────────────────────────────────────────

router.post('/signature', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const { signatureImage } = req.body;
    if (!signatureImage) return res.status(400).json({ error: 'No signature provided' });

    const updatedUser = await User.findByIdAndUpdate(
      decoded.id,
      { signatureImage, signatureUploadedAt: new Date() },
      { new: true }
    );
    const payload = await buildUserPayload(updatedUser);
    console.log(`[Auth] Signature uploaded: ${updatedUser.name} (${updatedUser.email})`);
    res.json({ message: 'Signature saved', user: payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Get current user profile
// ─────────────────────────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const payload = await buildUserPayload(user);
    // Also return the full user doc fields (minus password) for profile pages
    res.json({ ...user.toObject(), ...payload });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Get VC user info (for signature display on reports)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/vc-info', authMiddleware, async (req, res) => {
  try {
    const vc = await User.findOne({ role: 'vc' }).select('name signatureImage');
    res.json(vc || { name: 'Pro Vice-Chancellor', signatureImage: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Update own profile
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const allowed = ['phone','gender','bio','employeeId','designation',
                     'qualification','experience','cabin','profilePhoto','signatureImage'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(decoded.id, update, { new: true }).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Google OAuth
// ─────────────────────────────────────────────────────────────────────────────

router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'No credential provided' });

    // ── Step 1: Verify Google ID token (Google OAuth 2.0 policy compliant) ──
    let googlePayload;
    try {
      const { OAuth2Client } = require('google-auth-library');
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      googlePayload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('[Auth] Google token verification failed:', verifyErr.message);
      return res.status(401).json({ error: 'Invalid or expired Google token. Please try again.' });
    }

    if (!googlePayload?.email) {
      return res.status(400).json({ error: 'Google token missing email claim' });
    }

    // ── Step 2: Verify email is confirmed by Google ──
    if (!googlePayload.email_verified) {
      return res.status(403).json({ error: 'Google email is not verified' });
    }

    const { email, name, picture, sub } = googlePayload;

    // ── Step 3: Enforce institutional domain restriction ──
    const cleanEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: cleanEmail });
    if (!isAllowedDomain(cleanEmail) && !user) {
      console.warn(`[Auth] Google OAuth — blocked non-institutional email: ${cleanEmail}`);
      return res.status(403).json({
        error: `Only @mitsgwalior.in accounts are allowed. Please use your institutional Google account.`,
      });
    }

    // ── Step 4: Find or create user ──
    if (!user) {
      let assignedRole = 'faculty';
      let assignedDepartment = '';
      if (email.toLowerCase().includes('admin')) assignedRole = 'admin';
      if (cleanEmail === '25tc1aj7@mitsgwl.ac.in') { assignedRole = 'admin'; assignedDepartment = ''; }
      if (cleanEmail === '25mc1sh132@mitsgwl.ac.in') {
        assignedRole = 'hod';
        assignedDepartment = 'Literature, Politics and Economics';
      }

      const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);
      user = await User.create({
        name: name || email.split('@')[0],
        email: email.toLowerCase(),
        password: randomPassword,
        role: assignedRole,
        roles: [assignedRole],
        department: assignedDepartment,
        activeWorkspace: assignedRole,
        profilePhoto: picture || '',
        googleId: sub || '',
        googleVerified: true,
        lastLogin: new Date(),
        currentLoginAt: new Date(),
        loginCount: 1,
        needsDeptSetup: !assignedDepartment,   // prompt department on first login if not pre-set
        profileComplete: false,
      });

      await UserRole.create({ userId: user._id, role: assignedRole, departmentScope: assignedDepartment });
      console.log(`[Auth] Google OAuth — new user: ${user.name} (${email}) [${assignedRole}]`);
    } else {
      // Check if account is suspended
      if (user.status === 'suspended') {
        return res.status(403).json({ error: 'Account suspended. Contact admin.' });
      }

      // ── Re-apply hardcoded role overrides for designated accounts ──
      // This ensures the role is always correct even if the DB was modified
      // externally (e.g. by a seed script that didn't know about this account).
      let correctedRole = null;
      let correctedDept = null;
      if (cleanEmail === '25tc1aj7@mitsgwl.ac.in') { correctedRole = 'admin'; correctedDept = ''; }
      if (cleanEmail === '25mc1sh132@mitsgwl.ac.in') {
        correctedRole = 'hod';
        correctedDept = 'Literature, Politics and Economics';
      }

      if (correctedRole && user.role !== correctedRole) {
        console.log(`[Auth] Google OAuth — correcting role for ${cleanEmail}: ${user.role} → ${correctedRole}`);
        user.role            = correctedRole;
        user.roles           = correctedRole === 'hod' ? ['hod', 'faculty'] : [correctedRole];
        user.activeWorkspace = correctedRole;
        if (correctedDept && !user.department) user.department = correctedDept;

        // Rebuild UserRole documents to match
        await UserRole.deleteMany({ userId: user._id });
        const roleDocs = correctedRole === 'hod'
          ? [
              { userId: user._id, role: 'hod',    departmentScope: correctedDept || user.department || '', active: true },
              { userId: user._id, role: 'faculty', departmentScope: correctedDept || user.department || '', active: true },
            ]
          : [{ userId: user._id, role: correctedRole, departmentScope: user.department || '', active: true }];
        await UserRole.create(roleDocs);
      }

      user.googleId       = sub || user.googleId;
      user.googleVerified = true;
      user.lastLogin      = new Date();
      user.loginCount     = (user.loginCount || 0) + 1;
      if (picture) user.profilePhoto = picture;
      await user.save();

      // Backfill UserRole if missing (for all other users)
      if (!correctedRole) {
        const hasRole = await UserRole.findOne({ userId: user._id, active: true });
        if (!hasRole) {
          await UserRole.create({ userId: user._id, role: user.role, departmentScope: user.department || '' });
        }
      }
      console.log(`[Auth] Google OAuth — login: ${user.name} (${email}) [${user.role}]`);
    }

    // ── Step 5: Issue JWT and respond ──
    const payload = await buildUserPayload(user);
    const token   = signToken(user, payload.roles, payload.activeWorkspace);
    res.json({
      token,
      user: payload,
      needsDeptSetup: !!user.needsDeptSetup,
    });
  } catch (err) {
    console.error(`[Auth] Google OAuth error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
