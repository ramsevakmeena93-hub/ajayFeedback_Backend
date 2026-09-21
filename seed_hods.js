require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const UserRole = require("./models/UserRole");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/faculty_feedback";

const officialHods = [
  { name: "Dr. Abhishek Dixit",        email: "abhishekdixit@mitsgwalior.in",   department: "Centre for Computer Science and Technology",          designation: "HOD" },
  { name: "Dr. Anita Verma",           email: "wegegjgdgdscg98@gmail.com",      department: "Computer Science & Technology",                       designation: "HOD" },
  { name: "Dr. Anjali S Patil",        email: "anjalipatil@mitsgwalior.in",     department: "School of Architecture",                              designation: "HOD" },
  { name: "Dr. D.K. Jain",            email: "ain_dkj@mitsgwalior.in",         department: "School of Engineering Mathematics & Computing",        designation: "HOD" },
  { name: "Dr. Laxmi Shrivastava",    email: "lselex@mitsgwalior.in",          department: "School of Electronics and Communication Engineering",  designation: "HOD" },
  { name: "Dr. Pratesh Jayaswal",     email: "pratesh_jayaswal@mitsgwalior.in",department: "School of Mechanical Engineering",                     designation: "HOD" },
  { name: "Dr. Sanjay Tiwari",        email: "stiwari.fce@mitsgwalior.in",     department: "School of Civil Engineering",                         designation: "HOD" },
  { name: "Dr. Sanjeev Khanna",       email: "drkhannasanjeev@mitsgwalior.in", department: "School of Humanities and Management",                  designation: "HOD" },
  { name: "Dr. Shishir Dixit",        email: "shishir.dixit1@mitsgwalior.in",  department: "School of Electrical Engineering",                    designation: "HOD" },
  { name: "Dr. Vandana Vikas Thakare",email: "vandana@mitsgwalior.in",         department: "School of Electronics and Communication Engineering",  designation: "HOD" },
  { name: "Manish Dixit",             email: "dixitmits@mitsgwalior.in",       department: "Computer Science and Design",                         designation: "HOD" },
  { name: "Praveen Bansal",           email: "pbansal444@mitsgwalior.in",      department: "Centre for Internet of Things",                       designation: "HOD" },
  { name: "Punit Kumar Johari",       email: "pkjohari@mitsgwalior.in",        department: "School of Information Technology",                    designation: "HOD" },
  { name: "R R Singh",                email: "rrsingh@mitsgwalior.in",         department: "Centre for Artificial Intelligence",                  designation: "HOD" },
  { name: "HOD",                      email: "25mc1sh132@mitsgwl.ac.in",       department: "Literature, Politics and Economics",                   designation: "HOD" },
];

const systemAccounts = [
  { name: "System Administrator", email: "admin@mits.ac.in", password: "admin123", role: "admin", department: "Administration" },
  { name: "System Administrator", email: "admin@mitsgwalior.in", password: "admin123", role: "admin", department: "Administration" },
  { name: "Prof. R. K. Pandit (VC)", email: "vc@mits.ac.in", password: "vc123", role: "vc", department: "Vice Chancellor Office" },
];

// These emails are given special roles by the system — exclude them from the HOD demotion sweep
const protectedEmails = [
  '25tc1aj7@mitsgwl.ac.in',    // VC account
  '25mc1sh132@mitsgwl.ac.in',  // HOD account
];

async function seedHODs() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB:", MONGO_URI);

    const defaultPassword = "Mits@1234";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const officialEmails = officialHods.map(h => h.email.toLowerCase());
    const exemptEmails   = [...officialEmails, ...protectedEmails];

    // Demote any user with role 'hod' who is NOT in the official list or protected list
    const nonOfficialHods = await User.find({ role: "hod", email: { $nin: exemptEmails } });
    for (const nonHod of nonOfficialHods) {
      console.log(`Demoting unauthorized HOD ${nonHod.email} -> faculty`);
      nonHod.role = "faculty";
      nonHod.roles = ["faculty"];
      nonHod.activeWorkspace = "faculty";
      await nonHod.save();
      await UserRole.deleteMany({ userId: nonHod._id, role: "hod" });
    }

    console.log("\n--- Seeding Official 14 HODs ---");
    let count = 0;
    for (const hod of officialHods) {
      const email = hod.email.toLowerCase();
      let user = await User.findOne({ email });

      if (user) {
        user.name = hod.name;
        user.role = "hod";
        user.roles = ["hod", "faculty"];
        user.activeWorkspace = "hod";
        user.department = hod.department;
        user.designation = hod.designation;
        user.status = "active";
        await user.save();
        console.log(`[Synced] ${hod.name} (${email}) -> ${hod.department}`);
      } else {
        user = await User.create({
          name: hod.name,
          email: email,
          password: hashedPassword,
          role: "hod",
          roles: ["hod", "faculty"],
          activeWorkspace: "hod",
          department: hod.department,
          designation: hod.designation,
          status: "active",
        });
        console.log(`[Created] ${hod.name} (${email}) -> ${hod.department}`);
      }

      // Ensure both 'hod' and 'faculty' UserRoles exist for dual-role support
      await UserRole.deleteMany({ userId: user._id });
      await UserRole.create([
        { userId: user._id, role: "hod", departmentScope: hod.department, active: true },
        { userId: user._id, role: "faculty", departmentScope: hod.department, active: true },
      ]);
      count++;
    }

    console.log("\n--- Seeding Admin and VC accounts ---");
    for (const acc of systemAccounts) {
      const accHashed = await bcrypt.hash(acc.password, 10);
      let u = await User.findOne({ email: acc.email });
      if (u) {
        u.role = acc.role;
        u.roles = [acc.role];
        u.activeWorkspace = acc.role;
        u.status = "active";
        await u.save();
        console.log(`[Synced] ${acc.email} [${acc.role}]`);
      } else {
        u = await User.create({
          name: acc.name,
          email: acc.email,
          password: accHashed,
          role: acc.role,
          roles: [acc.role],
          activeWorkspace: acc.role,
          department: acc.department,
          status: "active",
        });
        console.log(`[Created] ${acc.email} [${acc.role}]`);
      }
      await UserRole.deleteMany({ userId: u._id });
      await UserRole.create({ userId: u._id, role: acc.role, departmentScope: acc.department, active: true });
    }

    const verified = await User.find({ role: "hod" }).select("name email department").lean();
    console.log(`\n========================================`);
    console.log(`TOTAL OFFICIAL HODs IN DATABASE: ${verified.length}`);
    console.log(`========================================`);
    verified.forEach((h, idx) => {
      console.log(`${idx + 1}. ${h.name} | ${h.email} | ${h.department}`);
    });
    console.log(`Default password for HODs: ${defaultPassword}`);

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

seedHODs();
