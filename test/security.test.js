import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canAccessModule,
  canManageAnyAccounts,
  canManageOpportunities,
  canRemoveAccounts,
  canViewStudent,
  filterStudentsForViewer,
  issuableRolesFor,
  roleLabel,
  safeSearchRowsForViewer,
  visibleModulesForRole,
} from "../src/security.js";

const navItems = [
  ["dashboard", "Dashboard"],
  ["students", "Students"],
  ["groups", "Groups"],
  ["reports", "Reports"],
  ["opportunities", "Work With Us"],
  ["settings", "Settings"],
];

const students = [
  { id: "STU-1001", first: "Maya", groupId: "GRP-PY-A" },
  { id: "STU-1002", first: "Omar", groupId: "GRP-WEB-B" },
  { id: "STU-1003", first: "Lina", groupId: "GRP-SC-C" },
];

test("student role cannot access admin-only modules", () => {
  assert.equal(canAccessModule("Student", "settings"), false);
  assert.equal(canAccessModule("Student", "reports"), false);
  assert.equal(canAccessModule("Student", "instructors"), false);
});

test("instructor role cannot access settings or the instructors directory", () => {
  assert.equal(canAccessModule("Instructor", "settings"), false);
  assert.equal(canAccessModule("Instructor", "instructors"), false);
});

test("admin roles can access reporting while only super admin can access platform settings", () => {
  assert.equal(canAccessModule("School Admin", "reports"), true);
  assert.equal(canAccessModule("School Admin", "settings"), false);
  assert.equal(canAccessModule("Super Admin", "settings"), true);
  assert.equal(canAccessModule("Super Admin", "instructors"), true);
});

test("visible navigation is derived from role permissions", () => {
  assert.deepEqual(
    visibleModulesForRole("Student", navItems).map(([id]) => id),
    ["dashboard", "groups"],
  );
});

test("managers and instructors can access the accounts and logins module; students cannot", () => {
  assert.equal(canAccessModule("Super Admin", "accounts"), true);
  assert.equal(canAccessModule("School Admin", "accounts"), true);
  assert.equal(canAccessModule("Instructor", "accounts"), true);
  assert.equal(canAccessModule("Student", "accounts"), false);
});

test("only managers can access contact requests (leads)", () => {
  assert.equal(canAccessModule("Super Admin", "leads"), true);
  assert.equal(canAccessModule("School Admin", "leads"), true);
  assert.equal(canAccessModule("Instructor", "leads"), false);
  assert.equal(canAccessModule("Student", "leads"), false);
});

test("only managers can access the reviews moderation module", () => {
  assert.equal(canAccessModule("Super Admin", "reviews"), true);
  assert.equal(canAccessModule("School Admin", "reviews"), true);
  assert.equal(canAccessModule("Instructor", "reviews"), false);
  assert.equal(canAccessModule("Student", "reviews"), false);
});

test("only managers can manage Work With Us opportunities", () => {
  assert.equal(canAccessModule("Super Admin", "opportunities"), true);
  assert.equal(canAccessModule("School Admin", "opportunities"), true);
  assert.equal(canAccessModule("Instructor", "opportunities"), false);
  assert.equal(canAccessModule("Student", "opportunities"), false);
  assert.equal(canManageOpportunities("Super Admin"), true);
  assert.equal(canManageOpportunities("School Admin"), true);
  assert.equal(canManageOpportunities("Instructor"), false);
});

test("only managers can remove an instructor or student outright; instructors never get this", () => {
  assert.equal(canRemoveAccounts("Super Admin"), true);
  assert.equal(canRemoveAccounts("School Admin"), true);
  assert.equal(canRemoveAccounts("Instructor"), false);
  assert.equal(canRemoveAccounts("Student"), false);
});

test("roleLabel presents Super Admin and School Admin as Manager, leaves other roles alone", () => {
  assert.equal(roleLabel("Super Admin"), "Manager");
  assert.equal(roleLabel("School Admin"), "Manager");
  assert.equal(roleLabel("Instructor"), "Instructor");
  assert.equal(roleLabel("Student"), "Student");
});

test("account issuance: managers can issue Manager, Instructor, and Student logins, instructors only Student", () => {
  assert.equal(canManageAnyAccounts("Super Admin"), true);
  assert.equal(canManageAnyAccounts("School Admin"), true);
  assert.equal(canManageAnyAccounts("Instructor"), true);
  assert.equal(canManageAnyAccounts("Student"), false);

  assert.deepEqual(issuableRolesFor("Super Admin"), ["Manager", "Instructor", "Student"]);
  assert.deepEqual(issuableRolesFor("School Admin"), ["Manager", "Instructor", "Student"]);
  assert.deepEqual(issuableRolesFor("Instructor"), ["Student"]);
  assert.deepEqual(issuableRolesFor("Student"), []);
});

test("student can only view their own student record", () => {
  const viewer = { role: "Student", studentId: "STU-1001" };
  assert.equal(canViewStudent(viewer, students[0]), true);
  assert.equal(canViewStudent(viewer, students[1]), false);
  assert.deepEqual(filterStudentsForViewer(viewer, students), [students[0]]);
});

test("instructor can only view students in assigned groups", () => {
  const viewer = { role: "Instructor", groupIds: ["GRP-WEB-B"] };
  assert.equal(canViewStudent(viewer, students[0]), false);
  assert.equal(canViewStudent(viewer, students[1]), true);
  assert.deepEqual(filterStudentsForViewer(viewer, students), [students[1]]);
});

test("global search removes rows outside viewer scope", () => {
  const viewer = { role: "Student", studentId: "STU-1001" };
  const rows = safeSearchRowsForViewer(viewer, [
    { type: "Student", student: students[0], title: "Maya" },
    { type: "Student", student: students[1], title: "Omar" },
    { type: "Instructor", title: "Amina", staffOnly: true },
    { type: "Assignment", title: "Number Game", moduleId: "groups" },
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

test("contact requests migration only allows public insert, never public read/update", async () => {
  const sql = await readFile(new URL("../supabase/migrations/0004_contact_requests.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /for insert/i);
  assert.match(sql, /public\.is_admin\(\)/);
  assert.doesNotMatch(sql, /for select\s+using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /for update\s+using\s*\(\s*true\s*\)/i);
});

test("reviews migration only allows public insert of pending rows, never public read of pending/rejected", async () => {
  const sql = await readFile(new URL("../supabase/migrations/0005_reviews.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /for insert/i);
  assert.match(sql, /status = 'pending'/);
  assert.match(sql, /status = 'approved'/);
  assert.match(sql, /public\.is_admin\(\)/);
  assert.doesNotMatch(sql, /for select\s+using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /for update\s+using\s*\(\s*true\s*\)/i);
});

test("create-account API re-verifies the caller server-side and scopes instructors to their own groups", async () => {
  const source = await readFile(new URL("../api/create-account.js", import.meta.url), "utf8");
  // Never trust a role claimed by the browser — always re-derive it from the
  // authenticated caller's own profile row using the service key.
  assert.match(source, /user_profiles\?user_id=eq\.\$\{caller\.id\}/);
  // Instructors are rejected outright if they try to issue anything but a
  // Student account.
  assert.match(source, /callerIsInstructor && role !== "Student"/);
  // An instructor's target student must belong to one of their own groups.
  assert.match(source, /ownGroupIds\.has\(studentGroupId\)/);
});

test("remove-account API re-verifies the caller is a Manager server-side and revokes the login before deleting the record", async () => {
  const source = await readFile(new URL("../api/remove-account.js", import.meta.url), "utf8");
  // Never trust a role claimed by the browser here either — an Instructor
  // must never reach this endpoint, not even for their own students.
  assert.match(source, /user_profiles\?user_id=eq\.\$\{caller\.id\}/);
  assert.match(source, /if \(!callerIsManager\)/);
  // Deleting the auth user (the login) happens before deleting the school
  // record, for both roles.
  assert.match(source, /auth\/v1\/admin\/users\/\$\{profile\.user_id\}/);
  // An instructor with groups still assigned can't be removed out from
  // under those groups.
  assert.match(source, /groupRows\.length > 0/);
});

test("opportunities migration lets anyone read only open postings, and only a Manager write", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/0009_opportunities_and_removal_requests.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /status = 'open'/);
  assert.match(sql, /public\.is_admin\(\)/);
  assert.doesNotMatch(sql, /for select\s+using\s*\(\s*true\s*\)/i);
});

test("removal-request insert policy requires the target student to be in the requesting instructor's own class", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/0009_opportunities_and_removal_requests.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /kind in \('message', 'holiday', 'removal'\)/);
  assert.match(sql, /staff_requests\.kind <> 'removal'/);
  assert.match(sql, /class\.instructor = staff_requests\.instructor_name/);
});

test("push_subscriptions migration scopes every policy to the row's own owner, never a public read/write", async () => {
  const sql = await readFile(new URL("../supabase/migrations/0015_push_subscriptions.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /auth\.uid\(\) = user_id/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
  // A device re-subscribing (refreshed keys) upserts via
  // on_conflict=endpoint (see supabaseUpsert() in src/app.js), which needs
  // an explicit update policy, not just insert/select/delete.
  assert.match(sql, /for update/i);
});

test("send-notification API re-verifies the caller server-side for every event except the one public one, which re-reads its own row instead of trusting the client", async () => {
  const source = await readFile(new URL("../api/send-notification.js", import.meta.url), "utf8");
  // Never trust a role/identity claimed by the browser — same rule as
  // create-account.js and remove-account.js.
  assert.match(source, /user_profiles\?user_id=eq\.\$\{callerUser\.id\}/);
  assert.match(source, /if \(eventHandler\.requiresAuth\)/);
  // Only review_submitted skips the Bearer-token check...
  assert.match(source, /review_submitted: \{ requiresAuth: false/);
  // ...and it's the only resolver that doesn't receive a real caller to
  // check against; it must instead re-read the reviews table so an
  // arbitrary unauthenticated POST can't manufacture a notification's text.
  assert.match(source, /status=eq\.pending&select=name,rating,created_at/);
  // A Manager can act on any group; an Instructor only one they actually
  // own — re-derived from the caller's own profile, not the request body.
  assert.match(source, /group\.instructor === caller\.instructorName/);
});

test("students insert policy lets an instructor add a student to their own group, not just a Manager", async () => {
  const sql = await readFile(new URL("../supabase/migrations/0016_students_insert_own_instructor.sql", import.meta.url), "utf8");
  assert.match(sql, /for insert/i);
  assert.match(sql, /instructor_owns_group\(students\.group_id\)/);
});

test("storage-upload-url API re-verifies the caller server-side and scopes each purpose to who could already write there", async () => {
  const source = await readFile(new URL("../api/storage-upload-url.js", import.meta.url), "utf8");
  assert.match(source, /user_profiles\?user_id=eq\.\$\{callerUser\.id\}/);
  // Gallery uploads stay Manager-only, same as the original
  // "gallery bucket write admin" Supabase Storage policy.
  assert.match(source, /allowed = MANAGER_ROLES\.includes\(caller\.role\)/);
  // Materials: a Manager, or the group's own Instructor — never an
  // Instructor for a group they don't own, and never a bare key with no
  // group segment.
  assert.match(source, /rows\[0\]\?\.instructor === caller\.instructorName/);
  // Every key is validated as a plain relative path before it's ever used
  // to build an R2 object key or a Supabase lookup — no leading slash, no
  // ".." segments that could climb into someone else's purpose folder.
  assert.match(source, /segment !== "\.\."/);
});

test("storage-view-url API only ever signs materials/submissions (gallery is public) and checks the same ownership rules as the write path", async () => {
  const source = await readFile(new URL("../api/storage-view-url.js", import.meta.url), "utf8");
  assert.match(source, /const PURPOSES = \["materials", "submissions"\]/);
  assert.match(source, /user_profiles\?user_id=eq\.\$\{callerUser\.id\}/);
  // "view" opens inline, "download" forces a save-as — same authorization
  // check either way, only the response-content-disposition differs.
  assert.match(source, /mode === "download" \? `attachment; filename="\$\{fileName\}"` : "inline"/);
});

test("storage-delete API never allows deleting a submission, and gates materials/gallery deletes the same as their write policies", async () => {
  const source = await readFile(new URL("../api/storage-delete.js", import.meta.url), "utf8");
  assert.match(source, /const PURPOSES = \["materials", "gallery"\]/);
  assert.match(source, /user_profiles\?user_id=eq\.\$\{callerUser\.id\}/);
});

test("R2 helper never lets an unsigned request through and supports the inline/attachment override presigned GET URLs rely on", async () => {
  const source = await readFile(new URL("../api/_lib/r2.js", import.meta.url), "utf8");
  assert.match(source, /signQuery: true/);
  assert.match(source, /response-content-disposition/);
});
