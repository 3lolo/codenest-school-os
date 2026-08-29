export const roles = ["Super Admin", "School Admin", "Instructor", "Student", "Parent"];

export const permissions = {
  "Super Admin": ["dashboard", "students", "families", "classes", "assignments", "attendance", "communications", "reports", "notifications", "accounts", "settings", "audit"],
  "School Admin": ["dashboard", "students", "families", "classes", "assignments", "attendance", "communications", "reports", "notifications", "accounts"],
  Instructor: ["dashboard", "students", "classes", "assignments", "attendance", "communications", "notifications"],
  Student: ["dashboard", "assignments", "attendance", "communications", "notifications"],
  Parent: ["dashboard", "students", "assignments", "attendance", "communications", "notifications"],
};

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
