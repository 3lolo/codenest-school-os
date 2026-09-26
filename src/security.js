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
// anymore. "assignments" joined that list too: a group's own page now has
// its own Assignments section (see groupDetailView()'s assignments block
// in app.js), so there's no more school-wide Assignments tab either.
export const permissions = {
  "Super Admin": ["dashboard", "instructors", "students", "groups", "grades", "chat", "staffRequests", "reports", "accounts", "leads", "reviews", "opportunities", "gallery", "settings", "profile"],
  "School Admin": ["dashboard", "instructors", "students", "groups", "grades", "chat", "staffRequests", "reports", "accounts", "leads", "reviews", "opportunities", "gallery", "profile"],
  Instructor: ["dashboard", "students", "groups", "grades", "chat", "code", "staffRequests", "accounts", "profile"],
  Student: ["dashboard", "groups", "grades", "chat", "code", "profile"],
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

// The homepage Gallery ("previous experience" photos/videos): only a
// Manager adds or removes items — every row is public the moment it's
// created (see supabase/migrations/0013_gallery.sql's "gallery items
// public read" policy), there's no per-item approval step to gate here.
export function canManageGallery(role) {
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

// Deleting a group is Manager-only and irreversible (it cascades to that
// group's attendance/materials/assignments/chat history — see
// supabase/migrations/0012_...sql) — unlike editing a group's own info,
// which canManageGroup() above already lets that group's own Instructor
// do too.
export function canRemoveGroups(role) {
  return ["Super Admin", "School Admin"].includes(role);
}

// Adding an EXISTING student to a group by searching across the whole
// school only makes sense for a Manager — an Instructor's own view of
// `students` is already scoped by RLS to students already in one of their
// own groups (see can_view_student() in the same migration), so there's
// nothing wider for them to search. An Instructor still adds a brand-new
// student straight into their own group via canCreateStudentProfiles.
export function canAddExistingStudentToGroup(role) {
  return ["Super Admin", "School Admin"].includes(role);
}

// Editing an instructor's own profile fields (name/email/bio) stays
// Manager-only — separate from canManageGroup(), which only covers a
// group's own info, not the instructor record itself.
export function canEditInstructorProfiles(role) {
  return ["Super Admin", "School Admin"].includes(role);
}

// A Manager can edit any student's info. An Instructor can edit a
// student's info only for a student already in one of their own groups —
// same boundary as canViewStudent(), reused here rather than duplicated.
// The server re-checks this again at the row level (see
// supabase/migrations/0012_...sql's "students update own instructor"
// policy and its column-restricting trigger — an Instructor's edit is
// further limited there to non-identity fields), this is just what keeps
// the "Edit" button from ever appearing somewhere it would just fail.
export function canEditStudent(viewer, student) {
  return canViewStudent(viewer, student);
}
