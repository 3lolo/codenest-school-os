import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canAccessModule,
  canViewStudent,
  filterStudentsForViewer,
  safeSearchRowsForViewer,
  visibleModulesForRole,
} from "../src/security.js";

const navItems = [
  ["dashboard", "Dashboard"],
  ["students", "Students"],
  ["families", "Families"],
  ["classes", "Classes"],
  ["assignments", "Assignments"],
  ["attendance", "Attendance"],
  ["communications", "Messages"],
  ["reports", "Reports"],
  ["notifications", "Notifications"],
  ["settings", "Settings"],
  ["audit", "Audit"],
];

const students = [
  { id: "STU-1001", first: "Maya", classId: "CLS-PY-A" },
  { id: "STU-1002", first: "Omar", classId: "CLS-WEB-B" },
  { id: "STU-1003", first: "Lina", classId: "CLS-SC-C" },
];

test("student role cannot access admin-only modules", () => {
  assert.equal(canAccessModule("Student", "settings"), false);
  assert.equal(canAccessModule("Student", "audit"), false);
  assert.equal(canAccessModule("Student", "reports"), false);
  assert.equal(canAccessModule("Student", "families"), false);
});

test("parent role cannot access staff/admin modules", () => {
  assert.equal(canAccessModule("Parent", "settings"), false);
  assert.equal(canAccessModule("Parent", "audit"), false);
  assert.equal(canAccessModule("Parent", "reports"), false);
  assert.equal(canAccessModule("Parent", "families"), false);
});

test("instructor role cannot access settings, audit logs, or family directory", () => {
  assert.equal(canAccessModule("Instructor", "settings"), false);
  assert.equal(canAccessModule("Instructor", "audit"), false);
  assert.equal(canAccessModule("Instructor", "families"), false);
});

test("admin roles can access reporting while only super admin can access platform settings", () => {
  assert.equal(canAccessModule("School Admin", "reports"), true);
  assert.equal(canAccessModule("School Admin", "settings"), false);
  assert.equal(canAccessModule("Super Admin", "settings"), true);
  assert.equal(canAccessModule("Super Admin", "audit"), true);
});

test("visible navigation is derived from role permissions", () => {
  assert.deepEqual(
    visibleModulesForRole("Student", navItems).map(([id]) => id),
    ["dashboard", "assignments", "attendance", "communications", "notifications"],
  );
});

test("only admins can access the accounts and logins module", () => {
  assert.equal(canAccessModule("Super Admin", "accounts"), true);
  assert.equal(canAccessModule("School Admin", "accounts"), true);
  assert.equal(canAccessModule("Instructor", "accounts"), false);
  assert.equal(canAccessModule("Student", "accounts"), false);
  assert.equal(canAccessModule("Parent", "accounts"), false);
});

test("student can only view their own student record", () => {
  const viewer = { role: "Student", studentId: "STU-1001" };
  assert.equal(canViewStudent(viewer, students[0]), true);
  assert.equal(canViewStudent(viewer, students[1]), false);
  assert.deepEqual(filterStudentsForViewer(viewer, students), [students[0]]);
});

test("parent can only view linked children", () => {
  const viewer = { role: "Parent", childStudentIds: ["STU-1001", "STU-1003"] };
  assert.equal(canViewStudent(viewer, students[0]), true);
  assert.equal(canViewStudent(viewer, students[1]), false);
  assert.equal(canViewStudent(viewer, students[2]), true);
  assert.deepEqual(filterStudentsForViewer(viewer, students), [students[0], students[2]]);
});

test("instructor can only view students in assigned classes", () => {
  const viewer = { role: "Instructor", classIds: ["CLS-WEB-B"] };
  assert.equal(canViewStudent(viewer, students[0]), false);
  assert.equal(canViewStudent(viewer, students[1]), true);
  assert.deepEqual(filterStudentsForViewer(viewer, students), [students[1]]);
});

test("global search removes rows outside viewer scope", () => {
  const viewer = { role: "Parent", childStudentIds: ["STU-1001"] };
  const rows = safeSearchRowsForViewer(viewer, [
    { type: "Student", student: students[0], title: "Maya" },
    { type: "Student", student: students[1], title: "Omar" },
    { type: "Instructor", title: "Amina", staffOnly: true },
    { type: "Parent", title: "Dina", familyOnly: true },
    { type: "Assignment", title: "Number Game", moduleId: "assignments" },
  ]);

  assert.deepEqual(rows.map((row) => row.title), ["Maya", "Number Game"]);
});

test("production RLS migration uses authenticated policies and avoids public read-all policies", async () => {
  const sql = await readFile(new URL("../supabase/migrations/0002_production_rls.sql", import.meta.url), "utf8");
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /enable row level security/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
});
