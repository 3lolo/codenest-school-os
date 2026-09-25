export const roles = ["Super Admin", "School Admin", "Instructor", "Student"];

// Underlying role values stay as they were (four tiers now that Parent is
// gone) so nothing here or in Supabase RLS has to be migrated further than
// it already was. The school only ever talks about three account *types*
// — Manager, Instructor, Student — so `roleLabel` is what the UI shows
// instead of the raw role. Super Admin and School Admin are both
// "Manager" to an end user.
export function roleLabel(role) {
  if (role === "Super Admin" || role === "School Admin") return "Manager";
  return role;
}

// "classes"/"materials"/"attendance" are no longer their own nav tabs:
// Groups is the sole class-like container (see groupsView() in app.js),
// materials are uploaded from a "Upload materials" button on a group's
// own page, and attendance is taken from that same group page by its own
// Instructor — there is no school-wide Attendance or Materials tab
// anymore.
export const permissions = {
  "Super Admin": ["dashboard", "instructors", "students", "groups", "assignments", "grades", "chat", "staffRequests", "reports", "accounts", "leads", "reviews", "opportunities", "settings", "profile"],
  "School Admin": ["dashboard", "instructors", "students", "groups", "assignments", "grades", "chat", "staffRequests", "reports", "accounts", "leads", "reviews", "opportunities", "profile"],
  Instructor: ["dashboard", "students", "groups", "assignments", "grades", "chat", "staffRequests", "accounts", "profile"],
  Student: ["dashboard", "groups", "assignments", "grades", "chat", "profile"],
};

// Manager (Super Admin or School Admin) can issue Manager, Instructor, and
// Student logins. Instructor can issue Student logins only, and only for
// students in their own groups (the group scoping itself is enforced by
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

// Can this role create brand-new Instructor / Student / Group /
// Assignment records (not just issue a login for one that already exists)?
export function canCreateInstructorProfiles(role) {
  return ["Super Admin", "School Admin"].includes(role);
}

// Groups are the sole class-like container now, and only a Manager can
// create or edit one — an Instructor is assigned to a group (see
// `groups.instructor` in supabase/migrations/0011_...sql) but can never
// create one themselves. RLS enforces the same boundary server-side (the
// "groups write admin only" policy in that migration), this is just what
// keeps the "New group" button from ever appearing for an Instructor.
export function canCreateGroups(role) {
  return ["Super Admin", "School Admin"].includes(role);
}

export function canCreateStudentProfiles(role) {
  return ["Super Admin", "School Admin", "Instructor"].includes(role);
}

// Only staff create assignments and enter grades. Students see both
// read-only — RLS enforces the same boundary server-side (see
// supabase/migrations/0010_grades_and_chat.sql and 0011_...sql), this is
// just what keeps the "New assignment" / "Grade" buttons from ever
// appearing for them.
export function canManageAssignments(role) {
  return ["Super Admin", "School Admin", "Instructor"].includes(role);
}

// Only a Manager can permanently remove an Instructor or Student record
// (and their login) outright. An Instructor never gets this — they can
// only *request* a student's removal from Requests, scoped to their own
// groups, for a Manager to decide on (see the "removal" staff_requests
// kind and api/remove-account.js, which re-checks this same rule
// server-side before ever touching the database).
export function canRemoveAccounts(role) {
  return ["Super Admin", "School Admin"].includes(role);
}

// Opportunities ("Work With Us"): only a Manager posts or removes a job
// opening. The public listing on the marketing homepage needs no signed-in
// viewer at all — that's enforced by Supabase RLS (status = 'open' is
// readable by anyone), not by this permission.
export function canManageOpportunities(role) {
  return ["Super Admin", "School Admin"].includes(role);
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
  if (viewer.role === "Instructor") return viewer.groupIds?.includes(student.groupId);
  return false;
}

export function filterStudentsForViewer(viewer, students) {
  return students.filter((student) => canViewStudent(viewer, student));
}

export function canViewStaffDirectory(viewer) {
  return ["Super Admin", "School Admin"].includes(viewer.role);
}

export function safeSearchRowsForViewer(viewer, rows) {
  return rows.filter((row) => {
    if (row.student && !canViewStudent(viewer, row.student)) return false;
    if (row.staffOnly && !canViewStaffDirectory(viewer)) return false;
    if (row.moduleId && !canAccessModule(viewer.role, row.moduleId)) return false;
    return true;
  });
}

// A group's own page shows "Upload materials" and, for Instructors, "Take
// attendance" — both scoped to that ONE group, never a school-wide tab
// (see requirements: materials moves onto the group page, and attendance
// is taken by that group's own Instructor per session). A Manager can do
// both for any group; an Instructor only for a group they're assigned to.
export function canManageGroup(viewer, group) {
  if (["Super Admin", "School Admin"].includes(viewer.role)) return true;
  if (viewer.role === "Instructor") return group?.instructor === viewer.instructorName;
  return false;
}

export function canTakeAttendanceForGroup(viewer, group) {
  return canManageGroup(viewer, group);
}
