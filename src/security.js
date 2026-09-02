export const roles = ["Super Admin", "School Admin", "Instructor", "Student", "Parent"];

// Underlying role values stay as they were (five tiers, unchanged permission
// logic below) so nothing here or in Supabase RLS has to be migrated. The
// school only ever talks about three account *types* — Manager, Instructor,
// Student — so `roleLabel` is what the UI shows instead of the raw role.
// Super Admin and School Admin are both "Manager" to an end user; Parent
// keeps its own label since parents are guardians, not an account type an
// admin issues.
export function roleLabel(role) {
  if (role === "Super Admin" || role === "School Admin") return "Manager";
  return role;
}

export const permissions = {
  "Super Admin": ["dashboard", "students", "families", "classes", "assignments", "materials", "attendance", "communications", "reports", "notifications", "accounts", "leads", "reviews", "settings", "audit"],
  "School Admin": ["dashboard", "students", "families", "classes", "assignments", "materials", "attendance", "communications", "reports", "notifications", "accounts", "leads", "reviews"],
  Instructor: ["dashboard", "students", "classes", "assignments", "materials", "attendance", "communications", "notifications", "accounts"],
  Student: ["dashboard", "assignments", "materials", "attendance", "communications", "notifications"],
  Parent: ["dashboard", "students", "assignments", "materials", "attendance", "communications", "notifications"],
};

// Manager (Super Admin or School Admin) can issue Manager, Instructor, and
// Student logins. Instructor can issue Student logins only, and only for
// students in their own classes (the class scoping itself is enforced by
// the caller using filterStudentsForViewer + the server in
// api/create-account.js, which re-checks everything with the service key).
// A Manager-issued "Manager" login always becomes the underlying "School
// Admin" role, never a second "Super Admin" — self-service creation of
// another Super Admin is never offered anywhere in the UI or API.
export function canManageAnyAccounts(role) {
  return ["Super Admin", "School Admin", "Instructor"].includes(role);
}

export function issuableRolesFor(role) {
  if (["Super Admin", "School Admin"].includes(role)) return ["Manager", "Instructor", "Student"];
  if (role === "Instructor") return ["Student"];
  return [];
}

// Can this role create brand-new Instructor / Student / Class / Group /
// Assignment records (not just issue a login for one that already exists)?
export function canCreateInstructorProfiles(role) {
  return ["Super Admin", "School Admin"].includes(role);
}

export function canCreateClasses(role) {
  return ["Super Admin", "School Admin", "Instructor"].includes(role);
}

export function canCreateStudentProfiles(role) {
  return ["Super Admin", "School Admin", "Instructor"].includes(role);
}

export function canAccessModule(role, moduleId) {
  return Boolean(permissions[role]?.includes(moduleId));
}

export function visibleModulesForRole(role, navItems) {
  return navItems.filter(([moduleId]) => canAccessModule(role, moduleId));
}

export function canViewStudent(viewer, student) {
  if (["Super Admin", "School Admin"].includes(viewer.role)) return true;
  if (viewer.role === "Student") return student.id === viewer.studentId;
  if (viewer.role === "Parent") return viewer.childStudentIds?.includes(student.id);
  if (viewer.role === "Instructor") return viewer.classIds?.includes(student.classId);
  return false;
}

export function filterStudentsForViewer(viewer, students) {
  return students.filter((student) => canViewStudent(viewer, student));
}

export function canViewStaffDirectory(viewer) {
  return ["Super Admin", "School Admin"].includes(viewer.role);
}

export function canViewFamilyDirectory(viewer) {
  return ["Super Admin", "School Admin"].includes(viewer.role);
}

export function safeSearchRowsForViewer(viewer, rows) {
  return rows.filter((row) => {
    if (row.student && !canViewStudent(viewer, row.student)) return false;
    if (row.staffOnly && !canViewStaffDirectory(viewer)) return false;
    if (row.familyOnly && !canViewFamilyDirectory(viewer)) return false;
    if (row.moduleId && !canAccessModule(viewer.role, row.moduleId)) return false;
    return true;
  });
}
