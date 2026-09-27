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
// Domain whitelist
// Both MITS email domains are allowed.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS = [
  '@mitsgwl.ac.in',
  '@mitsgwalior.in'
];

function isAllowedDomain(email) {
  if (!email) return false;
  const cleanEmail = String(email)
    .toLowerCase()
    .trim();
  return ALLOWED_DOMAINS.some(domain =>
    cleanEmail.endsWith(domain)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Designated institutional accounts
// ─────────────────────────────────────────────────────────────────────────────

const DESIGNATED_ADMIN_EMAIL =
  '25tc1aj7@mitsgwl.ac.in';

const DESIGNATED_HOD_EMAIL =
  '25mc1sh132@mitsgwl.ac.in';

const DESIGNATED_HOD_DEPARTMENT =
  'Humanities';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build full user payload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildUserPayload — reads the User doc + active UserRoles and returns the
 * standardised object the frontend expects.
 *
 * Shape:
 * {
 *   id,
 *   name,
 *   email,
 *   role,
 *   roles[],
 *   roleDetails[],
 *   activeWorkspace,
 *   department,
 *   hasSignature,
 *   profilePhoto?,
 *   defaultAlternateApproverId?,
 * }
 */
async function buildUserPayload(user) {
  const activeRoles = await UserRole.find({
    userId: user._id,
    active: true
  })
    .select('role departmentScope')
    .lean();

  const rolesArray = [
    ...new Set(activeRoles.map(r => r.role))
  ];

  // Every HOD is inherently a faculty member.
  if (
    user.role === 'hod' ||
    rolesArray.includes('hod')
  ) {
    if (!rolesArray.includes('hod')) {
      rolesArray.push('hod');
    }
    if (!rolesArray.includes('faculty')) {
      rolesArray.push('faculty');
    }
  }

  // Merge DB roles into legacy field: most-privileged wins.
  const PRIORITY = [
    'admin',
    'vc',
    'hod',
    'faculty'
  ];

  const primaryRole =
    PRIORITY.find(r => rolesArray.includes(r)) ||
    user.role ||
    'faculty';

  // Determine active workspace.
  const activeWorkspace =
    user.activeWorkspace ||
    primaryRole;

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: primaryRole,
    roles:
      rolesArray.length
        ? rolesArray
        : [primaryRole],
    roleDetails: activeRoles,
    activeWorkspace,
    department: user.department || '',
    hasSignature: !!user.signatureImage,
    profilePhoto: user.profilePhoto || '',
    defaultAlternateApproverId:
      user.defaultAlternateApproverId || null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// signToken
// ─────────────────────────────────────────────────────────────────────────────

/**
 * signToken — includes roles[] and activeWorkspace in the JWT.
 *
 * The backend NEVER trusts role values submitted in request bodies.
 */
function signToken(
  user,
  roles,
  activeWorkspace
) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      roles: roles,
      activeWorkspace:
        activeWorkspace || user.role,
      department:
        user.department || '',
      departmentScope:
        user.department || ''
    },
    JWT_SECRET,
    {
      expiresIn: TOKEN_EXPIRY
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    let {
      name,
      email,
      password,
      department
    } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    const cleanEmail =
      email.toLowerCase().trim();

    if (!isAllowedDomain(cleanEmail)) {
      return res.status(403).json({
        error:
          'Registration is currently restricted. Please use your institute email.'
      });
    }

    const existing =
      await User.findOne({
        email: cleanEmail
      });

    if (existing) {
      return res.status(400).json({
        error: 'Email already registered'
      });
    }

    const hashed =
      await bcrypt.hash(password, 10);

    // Default registration role.
    let safeRole = 'faculty';
    let safeDepartment = department || '';

    // Designated admin.
    if (
      cleanEmail === DESIGNATED_ADMIN_EMAIL
    ) {
      safeRole = 'admin';
      safeDepartment = '';
    }

    // Designated HOD.
    if (
      cleanEmail === DESIGNATED_HOD_EMAIL
    ) {
      safeRole = 'hod';
      safeDepartment =
        DESIGNATED_HOD_DEPARTMENT;
    }

    const user = await User.create({
      name,
      email: cleanEmail,
      password: hashed,
      role: safeRole,
      roles:
        safeRole === 'hod'
          ? ['hod', 'faculty']
          : [safeRole],
      department: safeDepartment,
      activeWorkspace: safeRole
    });

    // Create UserRole documents.
    if (safeRole === 'hod') {
      await UserRole.create([
        {
          userId: user._id,
          role: 'hod',
          departmentScope:
            safeDepartment,
          active: true
        },
        {
          userId: user._id,
          role: 'faculty',
          departmentScope:
            safeDepartment,
          active: true
        }
      ]);
    } else {
      await UserRole.create({
        userId: user._id,
        role: safeRole,
        departmentScope:
          safeDepartment,
        active: true
      });
    }

    const payload =
      await buildUserPayload(user);

    const token =
      signToken(
        user,
        payload.roles,
        payload.activeWorkspace
      );

    console.log(
      `[Auth] New user registered: ${name} (${email}) as ${safeRole}`
    );

    res.json({
      token,
      user: payload
    });
  } catch (err) {
    console.error(
      `[Auth] Registration failed: ${err.message}`
    );
    res.status(500).json({
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    const cleanEmail =
      email.toLowerCase().trim();

    const user =
      await User.findOne({
        email: cleanEmail
      });

    if (!user) {
      console.warn(
        `[Auth] Login failed — unknown email: ${cleanEmail}`
      );
      return res.status(400).json({
        error: 'Invalid credentials'
      });
    }

    // Domain restriction.
    if (
      !isAllowedDomain(cleanEmail) &&
      !['admin', 'hod', 'vc'].includes(
        user.role
      )
    ) {
      return res.status(403).json({
        error:
          'Access is currently restricted. Please use your institute email.'
      });
    }

    const match =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!match) {
      console.warn(
        `[Auth] Login failed — wrong password for: ${cleanEmail}`
      );
      return res.status(400).json({
        error: 'Invalid credentials'
      });
    }

    if (
      user.status === 'suspended'
    ) {
      return res.status(403).json({
        error:
          'Account suspended. Contact admin.'
      });
    }

    // Update login tracking.
    await User.findByIdAndUpdate(
      user._id,
      {
        lastLogin: new Date(),
        currentLoginAt: new Date(),
        $inc: {
          loginCount: 1
        }
      }
    );

    // ─────────────────────────────────────────────────────────
    // Designated Admin
    // ─────────────────────────────────────────────────────────

    if (
      cleanEmail === DESIGNATED_ADMIN_EMAIL
    ) {
      await User.findByIdAndUpdate(
        user._id,
        {
          role: 'admin',
          roles: ['admin'],
          activeWorkspace: 'admin',
          department: ''
        }
      );

      await UserRole.deleteMany({
        userId: user._id
      });

      await UserRole.create({
        userId: user._id,
        role: 'admin',
        departmentScope: '',
        active: true
      });

      user.role = 'admin';
      user.roles = ['admin'];
      user.activeWorkspace = 'admin';
      user.department = '';
    }

    // ─────────────────────────────────────────────────────────
    // Designated HOD
    //
    // Always enforce this account's HOD configuration.
    // ─────────────────────────────────────────────────────────

    if (
      cleanEmail === DESIGNATED_HOD_EMAIL
    ) {
      await User.findByIdAndUpdate(
        user._id,
        {
          role: 'hod',
          roles: ['hod', 'faculty'],
          activeWorkspace: 'hod',
          department:
            DESIGNATED_HOD_DEPARTMENT
        }
      );

      await UserRole.deleteMany({
        userId: user._id
      });

      await UserRole.create([
        {
          userId: user._id,
          role: 'hod',
          departmentScope:
            DESIGNATED_HOD_DEPARTMENT,
          active: true
        },
        {
          userId: user._id,
          role: 'faculty',
          departmentScope:
            DESIGNATED_HOD_DEPARTMENT,
          active: true
        }
      ]);

      user.role = 'hod';
      user.roles = [
        'hod',
        'faculty'
      ];
      user.activeWorkspace = 'hod';
      user.department =
        DESIGNATED_HOD_DEPARTMENT;
    }

    // ─────────────────────────────────────────────────────────
    // Ensure UserRole exists
    // ─────────────────────────────────────────────────────────

    const existingRoles =
      await UserRole.find({
        userId: user._id,
        active: true
      });

    if (
      existingRoles.length === 0
    ) {
      if (user.role === 'hod') {
        await UserRole.create([
          {
            userId: user._id,
            role: 'hod',
            departmentScope:
              user.department || '',
            active: true
          },
          {
            userId: user._id,
            role: 'faculty',
            departmentScope:
              user.department || '',
            active: true
          }
        ]);
      } else {
        await UserRole.create({
          userId: user._id,
          role: user.role,
          departmentScope:
            user.department || '',
          active: true
        });
      }
    }

    const payload =
      await buildUserPayload(user);

    const token =
      signToken(
        user,
        payload.roles,
        payload.activeWorkspace
      );

    console.log(
      `[Auth] Login: ${user.name} (${user.email}) [${payload.roles.join(',')}] ws:${payload.activeWorkspace}`
    );

    res.json({
      token,
      user: payload
    });
  } catch (err) {
    console.error(
      `[Auth] Login error: ${err.message}`
    );
    res.status(500).json({
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Workspace switch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/workspace/switch
 * Body: { workspace: 'hod'|'faculty'|'vc'|'admin' }
 */
router.post(
  '/workspace/switch',
  authMiddleware,
  async (req, res) => {
    try {
      const {
        workspace
      } = req.body;

      if (!workspace) {
        return res.status(400).json({
          error:
            'workspace is required'
        });
      }

      // Re-read from DB.
      const user =
        await User.findById(
          req.user.id
        );

      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      const activeRoles =
        await UserRole.find({
          userId: user._id,
          active: true
        }).select(
          'role departmentScope'
        );

      const rolesArray = [
        ...new Set(
          activeRoles.map(
            r => r.role
          )
        )
      ];

      // Every HOD can access faculty workspace.
      if (
        user.role === 'hod' ||
        rolesArray.includes('hod')
      ) {
        if (
          !rolesArray.includes('hod')
        ) {
          rolesArray.push('hod');
        }
        if (
          !rolesArray.includes('faculty')
        ) {
          rolesArray.push('faculty');
        }
      }

      if (
        !rolesArray.includes(workspace)
      ) {
        return res.status(403).json({
          error:
            `You do not hold the '${workspace}' role`,
          yourRoles: rolesArray
        });
      }

      // Persist workspace.
      await User.findByIdAndUpdate(
        user._id,
        {
          activeWorkspace:
            workspace
        }
      );

      user.activeWorkspace =
        workspace;

      const payload =
        await buildUserPayload(
          user
        );

      const token =
        signToken(
          user,
          rolesArray,
          workspace
        );

      // Audit.
      await AuditLog.record({
        actorId: user._id,
        actorName: user.name,
        actorRole: req.user.role,
        workspace,
        event:
          'workspace_switch',
        description:
          `${user.name} switched workspace from '${req.user.activeWorkspace || req.user.role}' to '${workspace}'`,
        targetType: 'user',
        targetId: user._id,
        meta: {
          from:
            req.user.activeWorkspace ||
            req.user.role,
          to: workspace,
          ip: req.ip
        }
      });

      console.log(
        `[Auth] Workspace switch: ${user.name} → ${workspace}`
      );

      res.json({
        token,
        user: {
          ...payload,
          activeWorkspace:
            workspace
        }
      });
    } catch (err) {
      console.error(
        `[Auth] Workspace switch error: ${err.message}`
      );
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Upload / update signature
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/signature',
  async (req, res) => {
    try {
      const token =
        req.headers.authorization
          ?.split(' ')[1];

      if (!token) {
        return res.status(401).json({
          error: 'No token'
        });
      }

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      const {
        signatureImage
      } = req.body;

      if (!signatureImage) {
        return res.status(400).json({
          error:
            'No signature provided'
        });
      }

      const updatedUser =
        await User.findByIdAndUpdate(
          decoded.id,
          {
            signatureImage,
            signatureUploadedAt:
              new Date()
          },
          {
            new: true
          }
        );

      const payload =
        await buildUserPayload(
          updatedUser
        );

      console.log(
        `[Auth] Signature uploaded: ${updatedUser.name} (${updatedUser.email})`
      );

      res.json({
        message:
          'Signature saved',
        user: payload
      });
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Get current user profile
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/me',
  async (req, res) => {
    try {
      const token =
        req.headers.authorization
          ?.split(' ')[1];

      if (!token) {
        return res.status(401).json({
          error: 'No token'
        });
      }

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      const user =
        await User.findById(
          decoded.id
        ).select('-password');

      if (!user) {
        return res.status(404).json({
          error:
            'User not found'
        });
      }

      const payload =
        await buildUserPayload(
          user
        );

      // Return complete user document
      // minus password.
      res.json({
        ...user.toObject(),
        ...payload
      });
    } catch (err) {
      res.status(401).json({
        error:
          'Invalid token'
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Get VC user info
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/vc-info',
  authMiddleware,
  async (req, res) => {
    try {
      const vc =
        await User.findOne({
          role: 'vc'
        }).select(
          'name signatureImage'
        );

      res.json(
        vc || {
          name:
            'Pro Vice-Chancellor',
          signatureImage: null
        }
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Update own profile
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  '/profile',
  async (req, res) => {
    try {
      const token =
        req.headers.authorization
          ?.split(' ')[1];

      if (!token) {
        return res.status(401).json({
          error: 'No token'
        });
      }

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      const allowed = [
        'phone',
        'gender',
        'bio',
        'employeeId',
        'designation',
        'qualification',
        'experience',
        'cabin',
        'profilePhoto',
        'signatureImage'
      ];

      const update = {};

      for (const key of allowed) {
        if (
          req.body[key] !== undefined
        ) {
          update[key] =
            req.body[key];
        }
      }

      const user =
        await User.findByIdAndUpdate(
          decoded.id,
          update,
          {
            new: true
          }
        ).select('-password');

      res.json(user);
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Google OAuth
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/google',
  async (req, res) => {
    try {
      const {
        credential
      } = req.body;

      if (!credential) {
        return res.status(400).json({
          error:
            'No credential provided'
        });
      }

      // ───────────────────────────────────────────────────────
      // Step 1: Verify Google ID token
      // ───────────────────────────────────────────────────────

      let googlePayload;

      try {
        const {
          OAuth2Client
        } = require(
          'google-auth-library'
        );

        const client =
          new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID
          );

        const ticket =
          await client.verifyIdToken({
            idToken:
              credential,
            audience:
              process.env.GOOGLE_CLIENT_ID
          });

        googlePayload =
          ticket.getPayload();
      } catch (verifyErr) {
        console.error(
          '[Auth] Google token verification failed:',
          verifyErr.message
        );

        return res.status(401).json({
          error:
            'Invalid or expired Google token. Please try again.'
        });
      }

      // ───────────────────────────────────────────────────────
      // Step 2: Check email
      // ───────────────────────────────────────────────────────

      if (!googlePayload?.email) {
        return res.status(400).json({
          error:
            'Google token missing email claim'
        });
      }

      if (
        !googlePayload.email_verified
      ) {
        return res.status(403).json({
          error:
            'Google email is not verified'
        });
      }

      const {
        email,
        name,
        picture,
        sub
      } = googlePayload;

      // ───────────────────────────────────────────────────────
      // Step 3: Domain restriction
      // ───────────────────────────────────────────────────────

      const cleanEmail =
        email.toLowerCase().trim();

      let user =
        await User.findOne({
          email: cleanEmail
        });

      if (
        !isAllowedDomain(
          cleanEmail
        ) &&
        !user
      ) {
        console.warn(
          `[Auth] Google OAuth — blocked email: ${cleanEmail}`
        );

        return res.status(403).json({
          error:
            'Access is currently restricted. Please use your institute email.'
        });
      }

      // ───────────────────────────────────────────────────────
      // Step 4: Find or create user
      // ───────────────────────────────────────────────────────

      if (!user) {
        let assignedRole =
          'faculty';

        let assignedDepartment =
          '';

        // Admin.
        if (
          email
            .toLowerCase()
            .includes('admin')
        ) {
          assignedRole =
            'admin';
        }

        // Designated admin.
        if (
          cleanEmail ===
          DESIGNATED_ADMIN_EMAIL
        ) {
          assignedRole =
            'admin';
          assignedDepartment =
            '';
        }

        // Designated HOD.
        if (
          cleanEmail ===
          DESIGNATED_HOD_EMAIL
        ) {
          assignedRole =
            'hod';
          assignedDepartment =
            DESIGNATED_HOD_DEPARTMENT;
        }

        const randomPassword =
          await bcrypt.hash(
            Math.random().toString(36),
            10
          );

        user =
          await User.create({
            name:
              name ||
              email.split('@')[0],
            email:
              email.toLowerCase(),
            password:
              randomPassword,
            role:
              assignedRole,
            roles:
              assignedRole === 'hod'
                ? ['hod', 'faculty']
                : [assignedRole],
            department:
              assignedDepartment,
            activeWorkspace:
              assignedRole,
            profilePhoto:
              picture || '',
            googleId:
              sub || '',
            googleVerified:
              true,
            lastLogin:
              new Date(),
            currentLoginAt:
              new Date(),
            loginCount:
              1,
            needsDeptSetup:
              !assignedDepartment,
            profileComplete:
              false
          });

        // Create UserRole records.
        if (
          assignedRole === 'hod'
        ) {
          await UserRole.create([
            {
              userId: user._id,
              role: 'hod',
              departmentScope:
                assignedDepartment,
              active: true
            },
            {
              userId: user._id,
              role: 'faculty',
              departmentScope:
                assignedDepartment,
              active: true
            }
          ]);
        } else {
          await UserRole.create({
            userId: user._id,
            role: assignedRole,
            departmentScope:
              assignedDepartment,
            active: true
          });
        }

        console.log(
          `[Auth] Google OAuth — new user: ${user.name} (${email}) [${assignedRole}]`
        );
      } else {
        // ─────────────────────────────────────────────────────
        // Existing user
        // ─────────────────────────────────────────────────────

        if (
          user.status === 'suspended'
        ) {
          return res.status(403).json({
            error:
              'Account suspended. Contact admin.'
          });
        }

        // ─────────────────────────────────────────────────────
        // Designated account correction
        // ─────────────────────────────────────────────────────

        let correctedRole = null;
        let correctedDept = null;

        if (
          cleanEmail ===
          DESIGNATED_ADMIN_EMAIL
        ) {
          correctedRole =
            'admin';
          correctedDept =
            '';
        }

        if (
          cleanEmail ===
          DESIGNATED_HOD_EMAIL
        ) {
          correctedRole =
            'hod';
          correctedDept =
            DESIGNATED_HOD_DEPARTMENT;
        }

        /*
         * IMPORTANT:
         * Always apply the designated account configuration.
         *
         * We do NOT check:
         *
         * user.role !== correctedRole
         *
         * because the role could already be correct while the
         * department or UserRole records are incorrect.
         */
        if (correctedRole) {
          console.log(
            `[Auth] Google OAuth — applying designated account configuration for ${cleanEmail}`
          );

          user.role =
            correctedRole;

          user.roles =
            correctedRole === 'hod'
              ? ['hod', 'faculty']
              : [correctedRole];

          user.activeWorkspace =
            correctedRole;

          user.department =
            correctedDept;

          // Rebuild UserRole documents.
          await UserRole.deleteMany({
            userId: user._id
          });

          if (
            correctedRole === 'hod'
          ) {
            await UserRole.create([
              {
                userId: user._id,
                role: 'hod',
                departmentScope:
                  correctedDept,
                active: true
              },
              {
                userId: user._id,
                role: 'faculty',
                departmentScope:
                  correctedDept,
                active: true
              }
            ]);
          } else {
            await UserRole.create({
              userId: user._id,
              role: correctedRole,
              departmentScope:
                correctedDept,
              active: true
            });
          }
        }

        // ─────────────────────────────────────────────────────
        // Update Google information
        // ─────────────────────────────────────────────────────

        user.googleId =
          sub || user.googleId;

        user.googleVerified =
          true;

        user.lastLogin =
          new Date();

        user.currentLoginAt =
          new Date();

        user.loginCount =
          (user.loginCount || 0) + 1;

        if (picture) {
          user.profilePhoto =
            picture;
        }

        // Make sure designated HOD state is saved.
        if (
          cleanEmail ===
          DESIGNATED_HOD_EMAIL
        ) {
          user.role =
            'hod';

          user.roles = [
            'hod',
            'faculty'
          ];

          user.activeWorkspace =
            'hod';

          user.department =
            DESIGNATED_HOD_DEPARTMENT;

          user.needsDeptSetup =
            false;
        }

        // Make sure designated admin state is saved.
        if (
          cleanEmail ===
          DESIGNATED_ADMIN_EMAIL
        ) {
          user.role =
            'admin';

          user.roles = [
            'admin'
          ];

          user.activeWorkspace =
            'admin';

          user.department =
            '';

          user.needsDeptSetup =
            false;
        }

        await user.save();

        // ─────────────────────────────────────────────────────
        // Backfill UserRole if missing
        // ─────────────────────────────────────────────────────

        const hasRole =
          await UserRole.findOne({
            userId: user._id,
            active: true
          });

        if (!hasRole) {
          if (
            user.role === 'hod'
          ) {
            await UserRole.create([
              {
                userId: user._id,
                role: 'hod',
                departmentScope:
                  user.department ||
                  '',
                active: true
              },
              {
                userId: user._id,
                role: 'faculty',
                departmentScope:
                  user.department ||
                  '',
                active: true
              }
            ]);
          } else {
            await UserRole.create({
              userId: user._id,
              role: user.role,
              departmentScope:
                user.department ||
                '',
              active: true
            });
          }
        }

        console.log(
          `[Auth] Google OAuth — login: ${user.name} (${email}) [${user.role}]`
        );
      }

      // ───────────────────────────────────────────────────────
      // Step 5: Issue JWT and respond
      // ───────────────────────────────────────────────────────

      const payload =
        await buildUserPayload(
          user
        );

      const token =
        signToken(
          user,
          payload.roles,
          payload.activeWorkspace
        );

      console.log(
        `[Auth] Google OAuth success: ${user.email} | role=${payload.role} | roles=${payload.roles.join(',')} | department=${payload.department} | workspace=${payload.activeWorkspace}`
      );

      res.json({
        token,
        user: payload,
        needsDeptSetup:
          !!user.needsDeptSetup
      });
    } catch (err) {
      console.error(
        `[Auth] Google OAuth error: ${err.message}`
      );

      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

module.exports = router;
