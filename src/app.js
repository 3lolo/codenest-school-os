import {
  canAccessModule,
  canCreateClasses,
  canCreateInstructorProfiles,
  canCreateStudentProfiles,
  canManageOpportunities,
  canRemoveAccounts,
  filterStudentsForViewer,
  roleLabel,
  safeSearchRowsForViewer,
  visibleModulesForRole,
} from "./security.js";
import {
  changePassword as authChangePassword,
  fetchCurrentUser,
  loadStoredSession,
  refreshSession,
  signInWithPassword,
  signOut as authSignOut,
  storeSession,
} from "./supabaseAuth.js";

const state = {
  role: "Super Admin",
  view: "dashboard",
  query: "",
  authMode: "checking", // "checking" | "marketing" | "not-configured" | "signed-out" | "force-password" | "signed-in"
  authError: "",
  authBusy: false,
  session: null,
  profile: null,
  viewerContext: null,
  accountsDirectory: null,
  accountsNotice: null,
  accountsBusy: null,
  leadsDirectory: null,
  contactNotice: null,
  contactBusy: false,
  publicReviews: [],
  reviewNotice: null,
  reviewBusy: false,
  reviewsDirectory: null,
  reviewsBusy: null,
  promoModalDismissed: false,
  modal: null,
  modalBusy: false,
  modalError: "",
  modalNotice: "",
  selectedStudentId: null,
  studentClassFilter: "",
  staffRequestBusy: null,
  staffRequestNotice: null,
  settingsBusy: false,
  settingsError: "",
  settingsNotice: "",
  publicOpportunities: [],
  opportunitiesDirectory: null,
  opportunitiesBusy: null,
  opportunitiesNotice: null,
  opportunityDetail: null,
};

const config = window.CODENEST_CONFIG || {};
const dataSource = {
  label: "Not connected",
  status: "Connect Supabase to load your school's data.",
  error: "",
};

const navItems = [
  ["dashboard", "Dashboard", "grid"],
  ["instructors", "Instructors", "users"],
  ["students", "Students", "users"],
  ["classes", "Classes", "layers"],
  ["assignments", "Assignments", "clipboard"],
  ["attendance", "Attendance", "check"],
  ["staffRequests", "Requests", "message"],
  ["reports", "Reports", "chart"],
  ["materials", "Materials", "folder"],
  ["accounts", "Accounts & Logins", "key"],
  ["leads", "Contact Requests", "message"],
  ["reviews", "Reviews", "chart"],
  ["opportunities", "Work With Us", "briefcase"],
  ["settings", "Settings", "gear"],
];

// Production defaults. Nothing here is sample/demo content — every list
// starts empty and is populated from Supabase once someone signs in.
// `school` holds the editable defaults for a brand-new deployment before
// a Manager opens Settings and changes them.
let school = {
  id: null,
  name: "Hero Tech Academy",
  portalUrl: "",
  social: {
    facebook: "https://www.facebook.com/profile.php?id=61591036567069",
    whatsapp: "+3791838956",
  },
  settings: {
    absenceThreshold: 3,
    parentAssignmentEmails: true,
    dueSoonHours: 24,
    maxUploadMb: 25,
    careersEmail: "",
  },
};

let people = {
  students: [],
  instructors: [],
};

let classes = [];
let assignments = [];
let groups = [];
let groupMembers = [];
let materials = [];
let attendanceRecords = [];
let staffRequests = [];

const icons = {
  grid: "▦",
  users: "◎",
  home: "⌂",
  layers: "▤",
  clipboard: "☑",
  check: "✓",
  message: "✉",
  chart: "▥",
  bell: "◔",
  gear: "⚙",
  shield: "◇",
  key: "⚷",
  folder: "▧",
  briefcase: "▣",
};

function can(view) {
  return canAccessModule(state.role, view);
}

function navigate(view) {
  if (!can(view)) return;
  state.view = view;
  render();
  if ((view === "accounts" || view === "instructors") && canManageAccounts()) {
    loadAccountsDirectory().then(renderContentOnly);
  }
  if (view === "leads" && canManageAccounts()) {
    loadLeads().then(renderContentOnly);
  }
  if (view === "reviews" && ["Super Admin", "School Admin"].includes(state.role)) {
    loadReviewsDirectory().then(renderContentOnly);
  }
  if (view === "opportunities" && canManageOpportunities(state.role)) {
    loadOpportunitiesDirectory().then(renderContentOnly);
  }
}

function setSearch(value) {
  state.query = value.toLowerCase();
  renderContentOnly();
}

function currentViewer() {
  if (state.viewerContext) {
    return { role: state.role, ...state.viewerContext };
  }
  return {
    role: state.role,
    studentId: null,
    childStudentIds: [],
    classIds: [],
  };
}

function fullName(student) {
  return `${student.first} ${student.last}`;
}

function pct(value) {
  return `<div class="meter" aria-label="${value}%"><span style="width:${value}%"></span></div>`;
}

function badge(value) {
  const key = value.toLowerCase().replace(/\s+/g, "-");
  return `<span class="badge ${key}">${value}</span>`;
}

function shell() {
  const allowedNav = visibleModulesForRole(state.role, navItems);
  return `
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="Hero Tech Academy" />
        <div>
          <strong>${school.name}</strong>
          <span>School Operations</span>
        </div>
      </div>
      <nav aria-label="Primary navigation">
        ${allowedNav.map(([id, label, icon]) => `
          <button class="nav-item ${state.view === id ? "active" : ""}" onclick="navigate('${id}')">
            <span aria-hidden="true">${icons[icon]}</span>${label}
          </button>
        `).join("")}
      </nav>
      <div class="security-note">
        <strong>RBAC active</strong>
        <span>${roleLabel(state.role)} sees ${allowedNav.length} authorized modules.</span>
        <span>${dataSource.label}</span>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">Academic Year 2026-2027</p>
          <h1>${titleForView()}</h1>
          <small>${dataSource.status}</small>
        </div>
        <label class="search">
          <span>Search</span>
          <input type="search" placeholder="Students, classes, assignments" value="${state.query}" oninput="setSearch(this.value)" />
        </label>
        <div class="account-chip">
          <div>
            <strong>${state.profile?.full_name || state.session?.user?.email || roleLabel(state.role)}</strong>
            <span>${roleLabel(state.role)}</span>
          </div>
          <button onclick="handleSignOut()">Sign out</button>
        </div>
      </header>
      <section id="content" class="content">${content()}</section>
    </main>
    ${modalHost()}
  `;
}

function titleForView() {
  return {
    dashboard: `${roleLabel(state.role)} Dashboard`,
    instructors: "Instructor Management",
    students: state.role === "Parent" ? "Linked Children" : "Student Management",
    classes: "Courses and Classes",
    assignments: "Assignment Center",
    materials: "Class Materials",
    attendance: "Attendance",
    staffRequests: ["Super Admin", "School Admin"].includes(state.role) ? "Staff Requests" : "Requests to Managers",
    reports: "Reports",
    accounts: state.role === "Instructor" ? "Student Logins" : "Accounts & Logins",
    leads: "Contact Requests",
    reviews: "Reviews",
    opportunities: "Work With Us",
    settings: "School Settings",
  }[state.view];
}

function content() {
  if (state.query) return searchResults();
  return {
    dashboard: dashboard(),
    instructors: instructorsView(),
    students: students(),
    classes: classesView(),
    assignments: assignmentsView(),
    materials: materialsView(),
    attendance: attendanceView(),
    staffRequests: staffRequestsView(),
    reports: reportsView(),
    accounts: accountsView(),
    leads: leadsView(),
    reviews: reviewsView(),
    opportunities: opportunitiesView(),
    settings: settingsView(),
  }[state.view] || dashboard();
}

function dashboard() {
  if (state.role === "Student") return studentDashboard();
  if (state.role === "Parent") return parentDashboard();
  if (state.role === "Instructor") return instructorDashboard();
  return adminDashboard();
}

function average(numbers) {
  if (!numbers.length) return 0;
  return Math.round(numbers.reduce((sum, n) => sum + n, 0) / numbers.length);
}

function computeActionItems() {
  const items = [];
  const threshold = school.settings.absenceThreshold;

  people.students
    .filter((s) => s.absences >= threshold)
    .forEach((s) => items.push(action("High", `${fullName(s)} reached the absence threshold`, "Notify family and schedule a check-in")));

  assignments
    .filter((a) => a.total - a.submissions > 0)
    .forEach((a) => items.push(action("Medium", `${a.total - a.submissions} ${a.className} submissions are ungraded`, "Instructor follow-up")));

  classes
    .filter((c) => c.status === "Paused")
    .forEach((c) => items.push(action("Low", `${c.name} is paused`, "Confirm a resume date")));

  return items.join("") || `<p class="empty">No action items right now.</p>`;
}

function adminDashboard() {
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const pending = assignments.reduce((sum, a) => sum + Math.max(a.total - a.submissions, 0), 0);
  const attendanceAlerts = people.students.filter((s) => s.absences >= school.settings.absenceThreshold).length;
  const avgAttendance = average(people.students.map((s) => s.attendance));
  const avgCompletion = average(classes.map((c) => c.completion));
  const avgGrade = average(people.students.map((s) => s.avgGrade));
  const retention = people.students.length ? Math.round((activeStudents / people.students.length) * 100) : 0;

  return `
    <div class="metric-grid">
      ${metric("Total students", people.students.length, people.students.length ? "Across all classes" : "No students yet")}
      ${metric("Active students", activeStudents, people.students.length ? `${retention}% of total` : "—")}
      ${metric("Active classes", classes.filter((c) => c.status === "Active").length, `${classes.filter((c) => c.status === "Paused").length} paused`)}
      ${metric("Pending submissions", pending, "Needs grading")}
      ${metric("Avg. attendance", people.students.length ? `${avgAttendance}%` : "—", `${attendanceAlerts} absence alert${attendanceAlerts === 1 ? "" : "s"}`)}
      ${metric("Instructors", people.instructors.length, "On staff")}
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Action Queue</h2><button onclick="navigate('reports')">Review all</button></div>
        ${computeActionItems()}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Performance Overview</h2><button onclick="navigate('reports')">Export</button></div>
        ${chartRow("Attendance", avgAttendance)}
        ${chartRow("Assignment completion", avgCompletion)}
        ${chartRow("Average grade", avgGrade)}
      </section>
    </div>
    <div class="two-col">
      ${recentStudents()}
      ${recentAssignmentsPanel()}
    </div>
  `;
}

// Pairs with recentStudents() in the admin dashboard's second row — real
// data (assignments actually created through "New assignment"), soonest
// due date first.
function recentAssignmentsPanel() {
  const recent = [...assignments].sort((a, b) => new Date(a.due) - new Date(b.due)).slice(0, 6);
  return `
    <section class="panel">
      <div class="panel-head"><h2>Recent Assignments</h2><button onclick="navigate('assignments')">Open</button></div>
      ${recent.map((a) => `<div class="report-row"><span>${a.title} · ${a.className}</span><strong>${badge(a.status)}</strong></div>`).join("") || `<p class="empty">No assignments yet.</p>`}
    </section>
  `;
}

function emptyState(message) {
  return `<section class="panel"><p class="empty">${message}</p></section>`;
}

function instructorDashboard() {
  // classes / people.students / assignments are already scoped to this
  // instructor's own classes by Supabase row-level security (see
  // supabase/migrations/0002_production_rls.sql) — no extra client-side
  // filtering is needed here.
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const toGrade = assignments.reduce((sum, a) => sum + Math.max(a.total - a.submissions, 0), 0);
  const attendanceAlerts = people.students.filter((s) => s.absences >= school.settings.absenceThreshold).length;
  return `
    <div class="metric-grid">
      ${metric("Assigned classes", classes.length, classes.map((c) => c.course).join(", ") || "None assigned yet")}
      ${metric("Students", people.students.length, `${activeStudents} active`)}
      ${metric("To grade", toGrade, "Ungraded submissions")}
      ${metric("Attendance alerts", attendanceAlerts, "Follow-up needed")}
    </div>
    <div class="two-col">
      ${assignmentPanel()}
      <section class="panel">
        <div class="panel-head"><h2>Today</h2><button onclick="navigate('attendance')">Take attendance</button></div>
        ${
          classes.length
            ? classes.slice(0, 4).map((item) => `<div class="class-row"><strong>${item.name}</strong><span>${item.schedule} · ${item.room}</span>${pct(item.completion)}</div>`).join("")
            : `<p class="empty">No classes assigned yet.</p>`
        }
      </section>
    </div>
  `;
}

function studentDashboard() {
  // Row-level security limits `people.students` to exactly this student's
  // own record once signed in through Supabase.
  const student = people.students[0];
  if (!student) return emptyState("Your student record hasn't been linked yet. Ask your school for help.");
  const openAssignments = assignments.filter((a) => a.status === "Published").length;
  return `
    <div class="profile-hero">
      <div class="avatar">${student.first[0]}${student.last[0]}</div>
      <div><p class="eyebrow">Student Portal</p><h2>${fullName(student)}</h2><span>${student.level} · ${student.email}</span></div>
    </div>
    <div class="metric-grid">
      ${metric("Progress", `${student.progress}%`, "Keep it up")}
      ${metric("Attendance", `${student.attendance}%`, `${student.absences} absence${student.absences === 1 ? "" : "s"}`)}
      ${metric("Average grade", `${student.avgGrade}%`, "Latest grade")}
      ${metric("Open assignments", openAssignments, "Published")}
    </div>
    ${assignmentPanel()}
  `;
}

function parentDashboard() {
  // Row-level security limits `people.students` to this parent's linked
  // children (see parent_student_links / can_view_student).
  const children = people.students;
  const child = children[0];
  if (!child) return emptyState("No children are linked to your account yet. Ask your school to link them.");
  const parentName = state.profile?.full_name || "Parent";
  const initials = parentName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "P";
  const openAssignments = assignments.filter((a) => a.status === "Published").length;
  return `
    <div class="profile-hero">
      <div class="avatar">${initials}</div>
      <div><p class="eyebrow">Parent Portal</p><h2>${parentName}</h2><span>Viewing linked child: ${fullName(child)}${children.length > 1 ? ` (+${children.length - 1} more)` : ""}</span></div>
    </div>
    <div class="metric-grid">
      ${metric("Child attendance", `${child.attendance}%`, "Healthy")}
      ${metric("Average grade", `${child.avgGrade}%`, "Latest grade published")}
      ${metric("Assignments", `${openAssignments} open`, "Published")}
    </div>
    ${studentProfile(child)}
  `;
}

function metric(label, value, note) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function action(level, title, body) {
  return `<div class="action"><span class="priority">${level}</span><div><strong>${title}</strong><small>${body}</small></div></div>`;
}

function chartRow(label, value) {
  return `<div class="chart-row"><div><strong>${label}</strong><span>${value}%</span></div>${pct(value)}</div>`;
}

function recentStudents() {
  return `<section class="panel"><div class="panel-head"><h2>Recent Students</h2><button onclick="navigate('students')">Open</button></div>${people.students.map(studentCard).join("") || `<p class="empty">No students yet.</p>`}</section>`;
}

function studentCard(student) {
  return `
    <div class="student-card">
      <div class="avatar">${student.first[0]}${student.last[0]}</div>
      <div class="student-main">
        <strong>${fullName(student)}</strong>
        <span>${student.level} · ${student.id}</span>
        ${pct(student.progress)}
      </div>
      ${badge(student.status)}
    </div>
  `;
}

function students() {
  const canAdd = canCreateStudentProfiles(state.role);
  const viewerClasses = classesForViewer();
  const isInstructor = state.role === "Instructor";
  let list = filterStudentsForViewer(currentViewer(), people.students);
  if (state.studentClassFilter) list = list.filter((s) => s.classId === state.studentClassFilter);

  const selected = list.find((s) => s.id === state.selectedStudentId) || list[0];
  const classFilterOptions = (isInstructor ? viewerClasses : classes)
    .map((item) => `<option value="${item.id}" ${state.studentClassFilter === item.id ? "selected" : ""}>${item.name}</option>`)
    .join("");

  return `
    <div class="toolbar">
      ${canAdd ? `<button onclick="openModal('addStudent')">New student</button>` : ""}
      <select onchange="setStudentClassFilter(this.value)" aria-label="Filter by class">
        <option value="">All classes</option>
        ${classFilterOptions}
      </select>
      <button onclick="exportStudentsCsv()">Export CSV</button>
    </div>
    <div class="split">
      <section class="panel table-panel">
        <table>
          <thead><tr><th>Student</th><th>Class</th><th>Attendance</th><th>Grade</th><th>Status</th></tr></thead>
          <tbody>
            ${
              list
                .map(
                  (s) =>
                    `<tr class="${selected?.id === s.id ? "selected-row" : ""}" onclick="selectStudent('${escapeJs(s.id)}')"><td><strong>${fullName(s)}</strong><span>${s.email}</span></td><td>${className(s.classId)}</td><td>${s.attendance}%</td><td>${s.avgGrade}%</td><td>${badge(s.status)}</td></tr>`,
                )
                .join("") || `<tr><td colspan="5" class="empty">No students to show yet.</td></tr>`
            }
          </tbody>
        </table>
      </section>
      ${selected ? studentProfile(selected) : `<section class="panel"><p class="empty">No students to show yet.</p></section>`}
    </div>
  `;
}

function selectStudent(id) {
  state.selectedStudentId = id;
  renderContentOnly();
}

function setStudentClassFilter(classId) {
  state.studentClassFilter = classId;
  renderContentOnly();
}

function exportStudentsCsv() {
  let list = filterStudentsForViewer(currentViewer(), people.students);
  if (state.studentClassFilter) list = list.filter((s) => s.classId === state.studentClassFilter);
  const header = ["Student ID", "First name", "Last name", "Email", "Class", "Status", "Attendance %", "Average grade %"];
  const rows = list.map((s) => [s.id, s.first, s.last, s.email, className(s.classId), s.status, s.attendance, s.avgGrade]);
  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "students.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function studentProfile(student) {
  if (!student) return `<section class="panel"><p class="empty">No student selected.</p></section>`;
  const studentGroups = groups.filter((group) =>
    groupMembers.some((member) => member.groupId === group.id && member.studentId === student.id),
  );
  const canRemove = canRemoveAccounts(state.role);
  const removeKey = `remove-student-${student.id}`;
  const removeBusy = state.accountsBusy === removeKey;
  return `
    <section class="panel profile">
      <div class="profile-hero compact"><div class="avatar">${escapeHtml(student.first[0])}${escapeHtml(student.last[0])}</div><div><h2>${escapeHtml(fullName(student))}</h2><span>${escapeHtml(student.id)} · ${escapeHtml(student.status)}</span></div></div>
      <dl>
        <div><dt>Email</dt><dd>${escapeHtml(student.email)}</dd></div>
        <div><dt>Phone</dt><dd>${escapeHtml(student.phone) || "—"}</dd></div>
        <div><dt>Class</dt><dd>${escapeHtml(className(student.classId))}</dd></div>
        <div><dt>Group(s)</dt><dd>${studentGroups.length ? studentGroups.map((g) => escapeHtml(g.name)).join(", ") : "—"}</dd></div>
        <div><dt>Family</dt><dd>${escapeHtml(student.family) || "—"}</dd></div>
        <div><dt>Parent</dt><dd>${escapeHtml(student.parent) || "—"}</dd></div>
        <div><dt>Level</dt><dd>${escapeHtml(student.level) || "—"}</dd></div>
        <div><dt>Notes</dt><dd>${escapeHtml(student.notes) || "—"}</dd></div>
      </dl>
      ${canRemove ? `<div class="toolbar"><button onclick="handleRemoveStudent('${escapeJs(student.id)}', '${escapeJs(fullName(student))}')" ${removeBusy ? "disabled" : ""}>${removeBusy ? "Removing…" : "Remove student"}</button></div>` : ""}
    </section>
  `;
}

// Manager-only, direct removal — deletes the student's record and login
// (if one was issued) via api/remove-account.js. An Instructor never gets
// this button; they can only request a removal from the Requests tab (see
// addStaffRequestModal), which a Manager approves through the same API.
async function handleRemoveStudent(id, name) {
  if (!window.confirm(`Remove ${name}? This deletes their student record and login. This can't be undone.`)) return;
  const key = `remove-student-${id}`;
  state.accountsBusy = key;
  state.accountsNotice = null;
  renderContentOnly();
  try {
    await removeAccountApi({ role: "Student", ref: id });
    if (state.selectedStudentId === id) state.selectedStudentId = null;
    await refreshAfterWrite();
    state.accountsNotice = { type: "removed", message: `${name} was removed.` };
  } catch (error) {
    state.accountsNotice = { type: "error", message: error.message };
  } finally {
    state.accountsBusy = null;
    renderContentOnly();
  }
}

function className(id) {
  return classes.find((item) => item.id === id)?.name || "Unassigned";
}

function classesView() {
  const canAddClass = canCreateClasses(state.role);
  const canAddStudent = canCreateStudentProfiles(state.role);
  const viewerClasses = classesForViewer();
  return `
    <div class="toolbar">
      ${canAddClass ? `<button onclick="openModal('addClass')">New class</button>` : ""}
      ${canAddStudent ? `<button onclick="openModal('addStudent')">Add student</button>` : ""}
    </div>
    <div class="class-grid">
      ${classes.map((item) => `
        <article class="panel class-tile">
          <div class="panel-head"><h2>${item.name}</h2>${badge(item.status)}</div>
          <p>${item.course}</p>
          <dl>
            <div><dt>Instructor</dt><dd>${item.instructor}</dd></div>
            <div><dt>Students</dt><dd>${item.students}</dd></div>
            <div><dt>Schedule</dt><dd>${item.schedule}</dd></div>
            <div><dt>Room</dt><dd>${item.room}</dd></div>
          </dl>
          ${chartRow("Curriculum completion", item.completion)}
          ${viewerClasses.some((c) => c.id === item.id) ? `<button onclick="openModal('addGroup', { classId: '${escapeJs(item.id)}' })">Manage groups</button>` : ""}
        </article>
      `).join("") || `<p class="empty">No classes yet.</p>`}
    </div>
  `;
}

function assignmentsView() {
  return `
    <div class="toolbar"><button onclick="openModal('addAssignment')">New assignment</button></div>
    ${assignmentPanel()}
  `;
}

function assignmentPanel() {
  return `
    <section class="panel table-panel">
      <div class="panel-head"><h2>Assignments</h2><span>${assignments.length} total</span></div>
      <table>
        <thead><tr><th>Assignment</th><th>Class</th><th>Due</th><th>Completion</th><th>Status</th></tr></thead>
        <tbody>
          ${assignments.map((a) => `<tr><td><strong>${a.title}</strong><span>${a.course} · ${a.difficulty} · ${a.maxGrade} pts</span></td><td>${a.className}</td><td>${a.due}</td><td>${a.submissions}/${a.total}</td><td>${badge(a.status)}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function attendanceView() {
  const canTake = canCreateStudentProfiles(state.role) || state.role === "Instructor";
  const isInstructor = state.role === "Instructor";
  const viewerClassIds = new Set(classesForViewer().map((item) => item.id));
  const recentLog = attendanceRecords
    .filter((record) => !isInstructor || viewerClassIds.has(record.classId))
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);

  return `
    <div class="toolbar">${canTake ? `<button onclick="openModal('takeAttendance')">Take attendance</button>` : ""}</div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>Attendance Watchlist</h2><span>Threshold: ${school.settings.absenceThreshold} absences</span></div>
      <table>
        <thead><tr><th>Student</th><th>Class</th><th>Attendance</th><th>Absences</th><th>Late</th><th>Status</th></tr></thead>
        <tbody>
          ${people.students.map((s) => `<tr><td><strong>${fullName(s)}</strong><span>${s.parent}</span></td><td>${className(s.classId)}</td><td>${s.attendance}%</td><td>${s.absences}</td><td>${s.late}</td><td>${s.absences >= school.settings.absenceThreshold ? badge("Notify") : badge("Monitor")}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No students yet.</td></tr>`}
        </tbody>
      </table>
    </section>
    <section class="panel table-panel">
      <div class="panel-head"><h2>Recent Attendance Log</h2><span>${recentLog.length} sessions marked</span></div>
      <table>
        <thead><tr><th>Date</th><th>Class</th><th>Present</th><th>Absent</th><th>Late</th><th>Excused</th></tr></thead>
        <tbody>
          ${
            groupAttendanceBySession(recentLog)
              .map(
                (session) =>
                  `<tr><td>${session.date}</td><td>${className(session.classId)}</td><td>${session.present}</td><td>${session.absent}</td><td>${session.late}</td><td>${session.excused}</td></tr>`,
              )
              .join("") || `<tr><td colspan="6" class="empty">No attendance taken yet — use "Take attendance" above.</td></tr>`
          }
        </tbody>
      </table>
    </section>
  `;
}

// Collapses individual per-student attendance_records rows into one
// summary row per class/date, since that's what's useful to scan at a
// glance; the modal below still writes one row per student underneath.
function groupAttendanceBySession(records) {
  const sessions = new Map();
  for (const record of records) {
    const key = `${record.classId}__${record.date}`;
    if (!sessions.has(key)) {
      sessions.set(key, { classId: record.classId, date: record.date, present: 0, absent: 0, late: 0, excused: 0 });
    }
    const session = sessions.get(key);
    if (session[record.status] !== undefined) session[record.status] += 1;
  }
  return [...sessions.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function reportsView() {
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const pausedStudents = people.students.filter((s) => s.status === "Paused").length;
  const attendanceAlerts = people.students.filter((s) => s.absences >= school.settings.absenceThreshold).length;
  const lateArrivals = people.students.reduce((sum, s) => sum + (s.late || 0), 0);
  const pending = assignments.reduce((sum, a) => sum + Math.max(a.total - a.submissions, 0), 0);

  return `
    <div class="toolbar"><button onclick="exportReportsCsv()">Export CSV</button></div>
    <div class="report-grid">
      <section class="panel">${reportBlock("Enrollment", [["Active", activeStudents], ["Paused", pausedStudents], ["Total", people.students.length]])}</section>
      <section class="panel">${reportBlock("Attendance", [["Average", `${average(people.students.map((s) => s.attendance))}%`], ["At risk", attendanceAlerts], ["Late arrivals", lateArrivals]])}</section>
      <section class="panel">${reportBlock("Academic", [["Completion", `${average(classes.map((c) => c.completion))}%`], ["Average grade", `${average(people.students.map((s) => s.avgGrade))}%`], ["Ungraded", pending]])}</section>
    </div>
  `;
}

function reportBlock(title, rows) {
  return `<div class="panel-head"><h2>${title}</h2></div>${rows.map(([label, value]) => `<div class="report-row"><span>${label}</span><strong>${value}</strong></div>`).join("")}`;
}

// Exports the same summary numbers shown on screen, so what a Manager
// downloads always matches what they were just looking at.
function exportReportsCsv() {
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const pausedStudents = people.students.filter((s) => s.status === "Paused").length;
  const attendanceAlerts = people.students.filter((s) => s.absences >= school.settings.absenceThreshold).length;
  const lateArrivals = people.students.reduce((sum, s) => sum + (s.late || 0), 0);
  const pending = assignments.reduce((sum, a) => sum + Math.max(a.total - a.submissions, 0), 0);

  const rows = [
    ["Section", "Metric", "Value"],
    ["Enrollment", "Active", activeStudents],
    ["Enrollment", "Paused", pausedStudents],
    ["Enrollment", "Total", people.students.length],
    ["Attendance", "Average", `${average(people.students.map((s) => s.attendance))}%`],
    ["Attendance", "At risk", attendanceAlerts],
    ["Attendance", "Late arrivals", lateArrivals],
    ["Academic", "Completion", `${average(classes.map((c) => c.completion))}%`],
    ["Academic", "Average grade", `${average(people.students.map((s) => s.avgGrade))}%`],
    ["Academic", "Ungraded", pending],
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "reports-summary.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function settingsView() {
  return `
    <form class="settings-grid" onsubmit="handleSaveSettings(event)">
      ${state.settingsError ? `<p class="auth-error">${escapeHtml(state.settingsError)}</p>` : ""}
      ${state.settingsNotice ? `<p class="notice-row m-success">${escapeHtml(state.settingsNotice)}</p>` : ""}
      <section class="panel"><h2>School</h2><label>School name<input name="schoolName" value="${escapeHtml(school.name)}" required /></label><label>Portal URL<input name="portalUrl" value="${escapeHtml(school.portalUrl)}" /></label></section>
      <section class="panel"><h2>Attendance &amp; Assignments</h2><label>Absence threshold<input name="absenceThreshold" type="number" min="1" value="${school.settings.absenceThreshold}" required /></label><label>Due soon hours<input name="dueSoonHours" type="number" min="1" value="${school.settings.dueSoonHours}" required /></label><label class="checkline"><input name="parentAssignmentEmails" type="checkbox" ${school.settings.parentAssignmentEmails ? "checked" : ""} /> Parent assignment emails</label></section>
      <section class="panel"><h2>Uploads</h2><label>Upload limit MB<input name="maxUploadMb" type="number" min="1" value="${school.settings.maxUploadMb}" required /></label><p class="hint">Issue or reset an individual instructor/student username and password from <button type="button" onclick="navigate('accounts')">Accounts &amp; Logins</button>.</p></section>
      <section class="panel"><h2>Work With Us</h2><label>Careers email<input name="careersEmail" type="email" value="${escapeHtml(school.settings.careersEmail)}" placeholder="careers@yourschool.com" /></label><p class="hint">Shown on every opportunity's detail page as where applicants should send their CV and cover letter. Leave blank to point applicants at the contact form instead.</p></section>
      <div class="toolbar"><button type="submit" ${state.settingsBusy ? "disabled" : ""}>${state.settingsBusy ? "Saving…" : "Save changes"}</button></div>
    </form>
  `;
}

function searchResults() {
  const term = state.query;
  const viewer = currentViewer();
  const rows = safeSearchRowsForViewer(viewer, [
    ...people.students.map((s) => ({ type: "Student", title: fullName(s), detail: `${s.email} · ${className(s.classId)}`, student: s, moduleId: "students" })),
    ...people.instructors.map((i) => ({ type: "Instructor", title: i.name, detail: `${i.email} · ${i.classes.join(", ")}`, staffOnly: true })),
    ...classes.map((c) => ({ type: "Class", title: c.name, detail: `${c.course} · ${c.instructor}`, moduleId: "classes" })),
    ...assignments.map((a) => ({ type: "Assignment", title: a.title, detail: `${a.course} · due ${a.due}`, moduleId: "assignments" })),
  ]).filter((row) => `${row.type} ${row.title} ${row.detail}`.toLowerCase().includes(term));

  return `
    <section class="panel">
      <div class="panel-head"><h2>Search Results</h2><span>${rows.length} matches</span></div>
      <div class="results">${rows.map((row) => `<article><span>${row.type}</span><strong>${row.title}</strong><small>${row.detail}</small></article>`).join("") || `<p class="empty">No matches found.</p>`}</div>
    </section>
  `;
}

function hasSupabaseConfig() {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes("your-project"));
}

async function supabaseSelect(table, select = "*", token) {
  const base = config.supabaseUrl.replace(/\/$/, "");
  const bearer = token || config.supabaseAnonKey;
  const response = await fetch(`${base}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${table}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Generic authenticated write helpers used by every "Add ..." form below.
// These insert/update directly against PostgREST with the signed-in
// user's own access token, relying entirely on the RLS policies in the
// Supabase migrations (0002-0006) to decide who is actually allowed to do
// what — the same policies that already govern reads.
async function supabaseInsert(table, rows) {
  if (!state.session) throw new Error("Sign in and try again.");
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session.access_token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error(friendlyDuplicateMessage(body) || `That already exists in ${table} — check for a duplicate entry.`);
    }
    throw new Error(body?.message || body?.hint || `Could not save to ${table}.`);
  }
  return body;
}

// PostgREST reports a unique-constraint violation (Postgres error code
// 23505 — e.g. adding a second instructor with an email that's already in
// use) as a plain HTTP 409, with a machine-oriented `message` like
// `duplicate key value violates unique constraint "instructors_email_key"`
// and a `details` field like `Key (email)=(x@example.com) already exists.`
// That's accurate but not something a Manager/Instructor filling in a form
// should have to parse. Turn it into a plain-language message naming the
// field and value, when we can find one; otherwise fall back to a generic
// "already exists" message rather than the raw Postgres error text.
function friendlyDuplicateMessage(body) {
  const detail = body?.details || body?.detail || "";
  const match = /Key \(([^)]+)\)=\(([^)]+)\)/.exec(detail);
  if (match) {
    const field = match[1].replace(/_/g, " ");
    return `That ${field} ("${match[2]}") is already in use — please use a different one.`;
  }
  if (body?.code === "23505") {
    return "That entry already exists — please check for a duplicate.";
  }
  return "";
}

// Insert-or-update in one call, keyed on `onConflict` columns — used for
// attendance, where re-submitting the same class/date should overwrite
// that day's marks instead of creating duplicate rows (see the `unique`
// constraint in 0007_staff_requests_attendance.sql).
async function supabaseUpsert(table, rows, onConflict) {
  if (!state.session) throw new Error("Sign in and try again.");
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session.access_token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error(friendlyDuplicateMessage(body) || `That already exists in ${table} — check for a duplicate entry.`);
    }
    throw new Error(body?.message || body?.hint || `Could not save to ${table}.`);
  }
  return body;
}

async function supabaseUploadFile(path, file) {
  if (!state.session) throw new Error("Sign in and try again.");
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/storage/v1/object/materials/${path}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session.access_token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || "Could not upload the file.");
  }
}

async function supabaseDownloadFile(path, fileName) {
  if (!state.session) return;
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/storage/v1/object/materials/${path}`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session.access_token}`,
    },
  });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "material";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function nextRefId(prefix, existingIds) {
  const used = new Set(existingIds);
  let n = 1;
  while (used.has(`${prefix}-${String(n).padStart(3, "0")}`)) n += 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

// One failed table must never hide every other tab's data. Each select
// below is caught individually: a table that fails to load keeps
// whatever was already in memory (so a successful earlier load, or data
// you just wrote and are re-fetching, never gets wiped out and replaced
// with nothing) while every table that *did* load refreshes normally.
// This is also why a newly-added row could previously seem to
// "disappear": before this, a single failing table (e.g. `assignments`,
// which wasn't wrapped) aborted the entire refresh via Promise.all,
// silently discarding every table's fresh data — including the row you
// just added — and leaving the whole dashboard on stale, pre-write data
// with no visible error beyond a small "Demo fallback" label.
async function loadFromSupabase(token) {
  if (!hasSupabaseConfig()) return;

  const failures = [];
  const TOTAL_TABLES = 10; // must match the number of safeSelect(...) calls below
  const safeSelect = (table, select = "*") =>
    supabaseSelect(table, select, token).catch((error) => {
      failures.push({ table, message: error.message || String(error) });
      return null;
    });

  try {
    const [
      settingsRows,
      studentRows,
      instructorRows,
      classRows,
      assignmentRows,
      groupRows,
      groupMemberRows,
      materialRows,
      attendanceRows,
      staffRequestRows,
    ] = await Promise.all([
      safeSelect("school_settings"),
      safeSelect("students"),
      safeSelect("instructors"),
      safeSelect("classes"),
      safeSelect("assignments"),
      safeSelect("groups"),
      safeSelect("group_members"),
      safeSelect("materials"),
      safeSelect("attendance_records"),
      safeSelect("staff_requests"),
    ]);

    const settings = settingsRows ? settingsRows[0] : null;
    if (settings) {
      // Spread the previous `school` first so fields this table doesn't
      // store (like `social`, the marketing page's Facebook/WhatsApp
      // links) survive a reload instead of silently disappearing.
      school = {
        ...school,
        id: settings.id,
        name: settings.name,
        portalUrl: settings.portal_url,
        settings: settings.settings,
      };
    }

    people = {
      students: studentRows === null ? people.students : studentRows.map((student) => ({
        id: student.student_id,
        first: student.first_name,
        last: student.last_name,
        email: student.email,
        phone: student.phone,
        dob: student.date_of_birth,
        status: student.status,
        level: student.level,
        family: student.family,
        parent: student.parent_name,
        classId: student.class_id,
        progress: student.progress,
        attendance: student.attendance,
        avgGrade: student.avg_grade,
        absences: student.absences,
        late: student.late,
        notes: student.notes,
      })),
      instructors: instructorRows === null ? people.instructors : instructorRows.map((instructor) => ({
        name: instructor.name,
        email: instructor.email,
        classes: instructor.classes || [],
        status: instructor.status,
      })),
    };

    classes = classRows === null ? classes : classRows.map((item) => ({
      id: item.class_id,
      name: item.name,
      course: item.course,
      instructor: item.instructor,
      students: item.student_count,
      schedule: item.schedule,
      room: item.room,
      status: item.status,
      completion: item.completion,
    }));

    assignments = assignmentRows === null ? assignments : assignmentRows.map((assignment) => ({
      title: assignment.title,
      course: assignment.course,
      className: assignment.class_name,
      groupId: assignment.group_id || null,
      due: assignment.due_date,
      status: assignment.status,
      submissions: assignment.submissions,
      total: assignment.total,
      maxGrade: assignment.max_grade,
      difficulty: assignment.difficulty,
    }));

    groups = groupRows === null ? groups : groupRows.map((group) => ({
      id: group.group_id,
      name: group.name,
      classId: group.class_id,
    }));

    groupMembers = groupMemberRows === null ? groupMembers : groupMemberRows.map((member) => ({
      groupId: member.group_id,
      studentId: member.student_id,
    }));

    materials = materialRows === null ? materials : materialRows.map((material) => ({
      id: material.id,
      title: material.title,
      classId: material.class_id,
      groupId: material.group_id,
      filePath: material.file_path,
      fileName: material.file_name,
      createdAt: material.created_at,
    }));

    attendanceRecords = attendanceRows === null ? attendanceRecords : attendanceRows.map((record) => ({
      id: record.id,
      studentId: record.student_id,
      classId: record.class_id,
      date: record.session_date,
      status: record.status,
    }));

    staffRequests = staffRequestRows === null
      ? staffRequests
      : staffRequestRows
          .map((request) => ({
            id: request.id,
            instructorName: request.instructor_name,
            kind: request.kind,
            subject: request.subject,
            message: request.message,
            startDate: request.start_date,
            endDate: request.end_date,
            targetStudentId: request.target_student_id,
            targetStudentName: request.target_student_name,
            status: request.status,
            createdAt: request.created_at,
          }))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (failures.length === 0) {
      dataSource.label = "Supabase connected";
      dataSource.status = "Live data loaded from Supabase";
      dataSource.error = "";
    } else {
      const failedTables = failures.map((item) => item.table).join(", ");
      dataSource.label = failures.length === TOTAL_TABLES ? "Demo fallback" : "Partially loaded";
      dataSource.status =
        failures.length === TOTAL_TABLES
          ? "Supabase unavailable, showing the last data loaded successfully."
          : `Everything loaded except: ${failedTables} (showing the last data loaded successfully for those).`;
      dataSource.error = failures.map((item) => `${item.table}: ${item.message}`).join(" · ");
    }
  } catch (error) {
    dataSource.label = "Demo fallback";
    dataSource.status = "Supabase unavailable, using sample data";
    dataSource.error = error.message;
  }
}

function renderContentOnly() {
  document.querySelector("#content").innerHTML = content();
}

function render() {
  document.querySelector("#app").innerHTML = appShell();
  if (state.authMode === "marketing") setupScrollReveal();
}

// Fades/slides each marketing-page section, card, and stat into place the
// first time it scrolls into view. Falls back to showing everything
// immediately if IntersectionObserver isn't available; CSS also disables
// all of this under prefers-reduced-motion.
function setupScrollReveal() {
  const targets = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("in-view"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 },
  );
  targets.forEach((el) => observer.observe(el));
}

// ---------------------------------------------------------------------
// Dashboard modals: Add Class, Add Instructor, Add Student, Add Manager,
// Add Group, Add Material, Add Assignment. One small overlay system reused
// by all of them instead of a separate dialog implementation each.
// ---------------------------------------------------------------------

function openModal(type, extra = {}) {
  state.modal = { type, ...extra };
  state.modalBusy = false;
  state.modalError = "";
  state.modalNotice = "";
  render();
}

function closeModal() {
  state.modal = null;
  state.modalBusy = false;
  state.modalError = "";
  state.modalNotice = "";
  render();
}

function classesForViewer() {
  if (state.role === "Instructor") {
    return classes.filter((item) => item.instructor === state.viewerContext?.instructorName);
  }
  return classes;
}

function studentsInClass(classId) {
  return people.students.filter((student) => student.classId === classId);
}

function groupsInClass(classId) {
  return groups.filter((group) => group.classId === classId);
}

async function refreshAfterWrite() {
  await loadFromSupabase(state.session?.access_token);
  recomputeInstructorClassIds();
  if (state.accountsDirectory) await loadAccountsDirectory();
}

function modalHost() {
  if (!state.modal) return "";
  return `
    <div class="modal-overlay" onclick="if (event.target === this) closeModal()">
      <div class="modal-box" role="dialog" aria-modal="true">
        <button type="button" class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
        ${modalBody(state.modal)}
      </div>
    </div>
  `;
}

function modalMessages() {
  return `
    ${state.modalError ? `<p class="notice-row auth-error">${state.modalError}</p>` : ""}
    ${state.modalNotice ? `<p class="notice-row m-success">${state.modalNotice}</p>` : ""}
  `;
}

function modalBody(modal) {
  switch (modal.type) {
    case "addClass":
      return addClassModal();
    case "addInstructor":
      return addInstructorModal();
    case "addStudent":
      return addStudentModal(modal);
    case "addManager":
      return addManagerModal();
    case "addGroup":
      return addGroupModal(modal);
    case "addMaterial":
      return addMaterialModal();
    case "addAssignment":
      return addAssignmentModal();
    case "takeAttendance":
      return addAttendanceModal();
    case "addStaffRequest":
      return addStaffRequestModal();
    case "addOpportunity":
      return addOpportunityModal();
    default:
      return "";
  }
}

function addClassModal() {
  const isInstructor = state.role === "Instructor";
  if (!isInstructor && people.instructors.length === 0) {
    return emptyDependencyNotice(
      "Add a class",
      "You need at least one instructor before you can create a class — add one first, then come back to create the class and assign it to them.",
      "Add an instructor",
      "addInstructor",
    );
  }
  const instructorOptions = people.instructors
    .map((instructor) => `<option value="${instructor.name}">${instructor.name}</option>`)
    .join("");
  return `
    <h2>Add a class</h2>
    ${modalMessages()}
    <form onsubmit="handleAddClass(event)">
      <label>Class name<input type="text" name="name" required /></label>
      <label>Course / subject<input type="text" name="course" required /></label>
      ${
        isInstructor
          ? `<input type="hidden" name="instructor" value="${escapeHtml(state.viewerContext?.instructorName || "")}" /><p class="hint">Instructor: ${state.viewerContext?.instructorName || "—"}</p>`
          : `<label>Instructor<select name="instructor" required><option value="">Choose...</option>${instructorOptions}</select></label>`
      }
      <label>Schedule<input type="text" name="schedule" placeholder="e.g. Tue &amp; Thu 5-6pm" /></label>
      <label>Room<input type="text" name="room" placeholder="e.g. Room A / Online" /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Saving…" : "Create class"}</button>
      </div>
    </form>
  `;
}

function addInstructorModal() {
  return `
    <h2>Add an instructor</h2>
    <p class="hint">Creates a real instructor record. Leave "issue a login now" checked to also give them a username and password right away.</p>
    ${modalMessages()}
    <form onsubmit="handleAddInstructor(event)">
      <label>Full name<input type="text" name="name" required /></label>
      <label>Email<input type="email" name="email" required /></label>
      <label class="checkline"><input type="checkbox" name="issueLogin" checked /> Issue a login now</label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Saving…" : "Add instructor"}</button>
      </div>
    </form>
  `;
}

function addStudentModal() {
  const isInstructor = state.role === "Instructor";
  const availableClasses = classesForViewer();
  if (availableClasses.length === 0) {
    return emptyDependencyNotice(
      "Add a student",
      isInstructor
        ? "You need at least one of your own classes before you can add a student — create a class first, then come back to add the student to it."
        : "You need at least one class before you can add a student — create a class first, then come back to add the student to it.",
      "Add a class",
      "addClass",
    );
  }
  const classOptions = availableClasses
    .map((item) => `<option value="${item.id}">${item.name}</option>`)
    .join("");
  return `
    <h2>Add a student</h2>
    ${isInstructor ? `<p class="hint">You can only add students to your own classes.</p>` : ""}
    ${modalMessages()}
    <form onsubmit="handleAddStudent(event)">
      <label>First name<input type="text" name="firstName" required /></label>
      <label>Last name<input type="text" name="lastName" required /></label>
      <label>Email<input type="email" name="email" required /></label>
      <label>Class<select name="classId" required><option value="">Choose...</option>${classOptions}</select></label>
      <label class="checkline"><input type="checkbox" name="issueLogin" checked /> Issue a login now</label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Saving…" : "Add student"}</button>
      </div>
    </form>
  `;
}

function addManagerModal() {
  return `
    <h2>Add a manager</h2>
    <p class="hint">Gives someone full school-operations access, the same as your own account.</p>
    ${modalMessages()}
    <form onsubmit="handleAddManager(event)">
      <label>Full name<input type="text" name="name" required /></label>
      <label>Email<input type="email" name="email" required /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Saving…" : "Add manager"}</button>
      </div>
    </form>
  `;
}

function addGroupModal(modal) {
  const classId = modal.classId;
  const cls = classes.find((item) => item.id === classId);
  const roster = studentsInClass(classId);
  const existing = groupsInClass(classId);
  return `
    <h2>Groups — ${cls ? cls.name : ""}</h2>
    ${modalMessages()}
    <div class="modal-existing-list">
      ${
        existing.length
          ? existing
              .map((group) => {
                const members = groupMembers.filter((m) => m.groupId === group.id).map((m) => m.studentId);
                const names = people.students.filter((s) => members.includes(s.id)).map(fullName);
                return `<article class="modal-existing-row"><strong>${group.name}</strong><span>${names.join(", ") || "No students yet"}</span></article>`;
              })
              .join("")
          : `<p class="hint">No groups yet for this class.</p>`
      }
    </div>
    <form onsubmit="handleAddGroup(event, '${escapeJs(classId)}')">
      <label>New group name<input type="text" name="name" required /></label>
      <fieldset class="modal-checklist">
        <legend>Students in this class</legend>
        ${
          roster
            .map((student) => `<label class="checkline"><input type="checkbox" name="members" value="${student.id}" /> ${fullName(student)}</label>`)
            .join("") || `<p class="hint">No students in this class yet.</p>`
        }
      </fieldset>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Saving…" : "Create group"}</button>
      </div>
    </form>
  `;
}

function addMaterialModal() {
  const availableClasses = classesForViewer();
  if (availableClasses.length === 0) {
    return emptyDependencyNotice(
      "Upload material",
      "You need at least one class before you can upload material for it — create a class first.",
      "Add a class",
      "addClass",
    );
  }
  const classOptions = availableClasses
    .map((item) => `<option value="${item.id}">${item.name}</option>`)
    .join("");
  return `
    <h2>Upload material</h2>
    ${modalMessages()}
    <form onsubmit="handleAddMaterial(event)">
      <label>Title<input type="text" name="title" required /></label>
      <label>Class<select name="classId" required onchange="renderModalGroupOptions(this.value)"><option value="">Choose...</option>${classOptions}</select></label>
      <label>Share with (optional)<select name="groupId" id="material-group-select"><option value="">Whole class</option></select></label>
      <label>File<input type="file" name="file" required /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Uploading…" : "Upload"}</button>
      </div>
    </form>
  `;
}

function renderModalGroupOptions(classId) {
  const select = document.getElementById("material-group-select");
  if (!select) return;
  const options = groupsInClass(classId)
    .map((group) => `<option value="${group.id}">${group.name}</option>`)
    .join("");
  select.innerHTML = `<option value="">Whole class</option>${options}`;
}

function addAssignmentModal() {
  const availableClasses = classesForViewer();
  if (availableClasses.length === 0) {
    return emptyDependencyNotice(
      "New assignment",
      "You need at least one class before you can create an assignment for it — create a class first.",
      "Add a class",
      "addClass",
    );
  }
  const classOptions = availableClasses
    .map((item) => `<option value="${item.id}">${item.name}</option>`)
    .join("");
  return `
    <h2>New assignment</h2>
    ${modalMessages()}
    <form onsubmit="handleAddAssignment(event)">
      <label>Title<input type="text" name="title" required /></label>
      <label>Course / topic<input type="text" name="course" required /></label>
      <label>Class<select name="classId" required onchange="renderAssignmentGroupOptions(this.value)"><option value="">Choose...</option>${classOptions}</select></label>
      <label>Share with (optional)<select name="groupId" id="assignment-group-select"><option value="">Whole class</option></select></label>
      <label>Due date<input type="date" name="dueDate" /></label>
      <label>Max grade<input type="number" name="maxGrade" value="100" min="1" /></label>
      <label>Difficulty
        <select name="difficulty">
          <option value="Beginner">Beginner</option>
          <option value="Intermediate">Intermediate</option>
          <option value="Advanced">Advanced</option>
        </select>
      </label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Saving…" : "Create assignment"}</button>
      </div>
    </form>
  `;
}

function renderAssignmentGroupOptions(classId) {
  const select = document.getElementById("assignment-group-select");
  if (!select) return;
  const options = groupsInClass(classId)
    .map((group) => `<option value="${group.id}">${group.name}</option>`)
    .join("");
  select.innerHTML = `<option value="">Whole class</option>${options}`;
}

function addAttendanceModal() {
  const availableClasses = classesForViewer();
  if (availableClasses.length === 0) {
    return emptyDependencyNotice(
      "Take attendance",
      "You need at least one class before you can take attendance for it — create a class first.",
      "Add a class",
      "addClass",
    );
  }
  const defaultClassId = availableClasses[0].id;
  const today = new Date().toISOString().slice(0, 10);
  const classOptions = availableClasses.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  return `
    <h2>Take attendance</h2>
    ${modalMessages()}
    <form onsubmit="handleTakeAttendance(event)">
      <label>Class
        <select name="classId" id="attendance-class-select" onchange="renderAttendanceRoster(this.value, document.getElementById('attendance-date-input').value)">
          ${classOptions}
        </select>
      </label>
      <label>Date
        <input type="date" name="date" id="attendance-date-input" value="${today}" onchange="renderAttendanceRoster(document.getElementById('attendance-class-select').value, this.value)" />
      </label>
      <div id="attendance-roster">${attendanceRosterRows(defaultClassId, today)}</div>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Saving…" : "Save attendance"}</button>
      </div>
    </form>
  `;
}

// Re-rendered whenever the class or date changes: pre-fills each
// student's status from any attendance already saved for that exact
// class/date, so reopening the same day shows what was marked instead of
// resetting everyone back to "Present".
function attendanceRosterRows(classId, date) {
  const roster = studentsInClass(classId);
  if (!roster.length) return `<p class="hint">No students in this class yet.</p>`;
  const existing = new Map(
    attendanceRecords.filter((record) => record.classId === classId && record.date === date).map((record) => [record.studentId, record.status]),
  );
  return `
    <fieldset class="modal-checklist">
      <legend>Mark each student</legend>
      ${roster
        .map((student) => {
          const current = existing.get(student.id) || "present";
          return `
            <div class="attendance-row">
              <span>${fullName(student)}</span>
              <select name="status-${escapeHtml(student.id)}" data-student-id="${escapeHtml(student.id)}">
                <option value="present" ${current === "present" ? "selected" : ""}>Present</option>
                <option value="absent" ${current === "absent" ? "selected" : ""}>Absent</option>
                <option value="late" ${current === "late" ? "selected" : ""}>Late</option>
                <option value="excused" ${current === "excused" ? "selected" : ""}>Excused</option>
              </select>
            </div>
          `;
        })
        .join("")}
    </fieldset>
  `;
}

function renderAttendanceRoster(classId, date) {
  const container = document.getElementById("attendance-roster");
  if (!container) return;
  container.innerHTML = attendanceRosterRows(classId, date);
}

async function handleTakeAttendance(event) {
  event.preventDefault();
  const form = event.target;
  const classId = form.classId.value;
  const date = form.date.value;
  const selects = [...form.querySelectorAll("select[data-student-id]")];
  if (!classId || !date) {
    state.modalError = "Please choose a class and a date.";
    render();
    return;
  }
  if (!selects.length) {
    state.modalError = "There are no students in this class to mark yet.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const rows = selects.map((select) => ({
      student_id: select.dataset.studentId,
      class_id: classId,
      session_date: date,
      status: select.value,
    }));
    await supabaseUpsert("attendance_records", rows, "student_id,class_id,session_date");
    await refreshAfterWrite();
    closeModal();
    navigate("attendance");
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not save attendance. Has migration 0007 been run yet?";
    render();
  }
}

function addStaffRequestModal() {
  const ownStudents = filterStudentsForViewer(currentViewer(), people.students);
  const studentOptions = ownStudents
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(fullName(s))} · ${escapeHtml(className(s.classId))}</option>`)
    .join("");
  return `
    <h2>New request to Managers</h2>
    <p class="hint">Send a quick message, request time off, or ask a Manager to remove a student from one of your own classes — a Manager decides every request from their Requests panel.</p>
    ${modalMessages()}
    <form onsubmit="handleAddStaffRequest(event)">
      <label>Type
        <select name="kind" onchange="toggleStaffRequestFields(this.value)">
          <option value="message">Message</option>
          <option value="holiday">Time off request</option>
          <option value="removal">Student removal</option>
        </select>
      </label>
      <div id="staff-request-student" hidden>
        <label>Student
          <select name="studentRef">
            <option value="">Select a student…</option>
            ${studentOptions}
          </select>
        </label>
        ${ownStudents.length === 0 ? `<p class="hint">You don't have any students in your own classes yet.</p>` : ""}
      </div>
      <label>Subject<input type="text" name="subject" required /></label>
      <label>Details<textarea name="message" rows="3"></textarea></label>
      <div id="staff-request-dates" hidden>
        <label>Start date<input type="date" name="startDate" /></label>
        <label>End date<input type="date" name="endDate" /></label>
      </div>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Sending…" : "Send"}</button>
      </div>
    </form>
  `;
}

function toggleStaffRequestFields(kind) {
  const datesContainer = document.getElementById("staff-request-dates");
  if (datesContainer) datesContainer.hidden = kind !== "holiday";
  const studentContainer = document.getElementById("staff-request-student");
  if (studentContainer) studentContainer.hidden = kind !== "removal";
}

async function handleAddStaffRequest(event) {
  event.preventDefault();
  const form = event.target;
  const kind = form.kind.value;
  const subject = form.subject.value.trim();
  const message = form.message.value.trim();
  const startDate = form.startDate.value || null;
  const endDate = form.endDate.value || null;
  const studentRef = form.studentRef ? form.studentRef.value : "";
  const instructorName = state.viewerContext?.instructorName;
  if (!subject) {
    state.modalError = "Please add a subject.";
    render();
    return;
  }
  if (!instructorName) {
    state.modalError = "Your account isn't linked to an instructor record yet. Ask a Manager to fix this.";
    render();
    return;
  }
  let targetStudentId = null;
  let targetStudentName = null;
  if (kind === "removal") {
    if (!studentRef) {
      state.modalError = "Choose which student you're requesting to remove.";
      render();
      return;
    }
    const targetStudent = filterStudentsForViewer(currentViewer(), people.students).find((s) => s.id === studentRef);
    if (!targetStudent) {
      state.modalError = "That student isn't in one of your own classes.";
      render();
      return;
    }
    targetStudentId = targetStudent.id;
    targetStudentName = fullName(targetStudent);
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseInsert("staff_requests", [
      {
        instructor_name: instructorName,
        kind,
        subject,
        message: message || null,
        start_date: kind === "holiday" ? startDate : null,
        end_date: kind === "holiday" ? endDate : null,
        target_student_id: targetStudentId,
        target_student_name: targetStudentName,
      },
    ]);
    await refreshAfterWrite();
    closeModal();
    navigate("staffRequests");
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not send this. Has migration 0009 been run yet?";
    render();
  }
}

function staffRequestsView() {
  const isManager = ["Super Admin", "School Admin"].includes(state.role);
  const rows = isManager ? staffRequests : staffRequests.filter((r) => r.instructorName === state.viewerContext?.instructorName);

  return `
    ${state.staffRequestNotice ? `<p class="notice-row ${state.staffRequestNotice.type === "error" ? "auth-error" : "m-success"}">${escapeHtml(state.staffRequestNotice.message)}<button type="button" class="notice-dismiss" onclick="dismissStaffRequestNotice()" aria-label="Dismiss">&times;</button></p>` : ""}
    <div class="toolbar">${!isManager ? `<button onclick="openModal('addStaffRequest')">New request</button>` : ""}</div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>${isManager ? "Staff Requests" : "Your Requests"}</h2><span>${rows.length} total</span></div>
      <table>
        <thead><tr>${isManager ? "<th>From</th>" : ""}<th>Type</th><th>Subject</th><th>Details</th><th>Status</th>${isManager ? "<th>Action</th>" : ""}</tr></thead>
        <tbody>
          ${
            rows.map((r) => staffRequestRow(r, isManager)).join("") ||
            `<tr><td colspan="${isManager ? 6 : 4}" class="empty">${isManager ? "No requests yet." : "You haven't sent any requests yet."}</td></tr>`
          }
        </tbody>
      </table>
    </section>
  `;
}

function staffRequestRow(request, isManager) {
  const busy = state.staffRequestBusy === request.id;
  const isRemoval = request.kind === "removal";
  const details = isRemoval
    ? `Remove ${escapeHtml(request.targetStudentName || request.targetStudentId || "student")}${request.message ? ` · ${escapeHtml(request.message)}` : ""}`
    : request.kind === "holiday"
      ? `${request.startDate || "?"} → ${request.endDate || "?"}${request.message ? ` · ${escapeHtml(request.message)}` : ""}`
      : escapeHtml(request.message) || "—";
  const kindLabel = isRemoval ? "Student removal" : request.kind === "holiday" ? "Time off" : "Message";
  const approveHandler = isRemoval ? `approveRemovalRequest('${request.id}')` : `setStaffRequestStatus('${request.id}', 'approved')`;
  const approveLabel = busy ? "Working…" : isRemoval ? "Approve & remove" : "Approve";
  return `
    <tr>
      ${isManager ? `<td>${escapeHtml(request.instructorName)}</td>` : ""}
      <td>${badge(kindLabel)}</td>
      <td><strong>${escapeHtml(request.subject)}</strong></td>
      <td>${details}</td>
      <td>${badge(request.status.charAt(0).toUpperCase() + request.status.slice(1))}</td>
      ${
        isManager
          ? `<td>
              <button onclick="${approveHandler}" ${busy ? "disabled" : ""}>${approveLabel}</button>
              <button onclick="setStaffRequestStatus('${request.id}', 'denied')" ${busy ? "disabled" : ""}>Deny</button>
              <button onclick="setStaffRequestStatus('${request.id}', 'read')" ${busy ? "disabled" : ""}>Mark read</button>
            </td>`
          : ""
      }
    </tr>
  `;
}

async function setStaffRequestStatus(id, status) {
  if (!state.session) return;
  state.staffRequestBusy = id;
  renderContentOnly();
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    await fetch(`${base}/rest/v1/staff_requests?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status }),
    });
    await refreshAfterWrite();
  } finally {
    state.staffRequestBusy = null;
    renderContentOnly();
  }
}

// Approving a "removal" request does two things: actually remove the
// student (their record and login, via api/remove-account.js — always run
// as the Manager's own session, never the requesting instructor's), then
// mark the request approved the same way any other request is decided.
// If the removal itself fails (e.g. the student was already removed a
// different way), the request is left exactly as it was — status is never
// flipped to "approved" for a removal that didn't actually happen.
async function approveRemovalRequest(id) {
  const request = staffRequests.find((r) => r.id === id);
  if (!request) return;
  await handleApproveRemovalRequest(request);
}

async function handleApproveRemovalRequest(request) {
  if (!state.session) return;
  const label = request.targetStudentName || request.targetStudentId || "this student";
  if (!window.confirm(`Remove ${label}? This deletes their student record and login. This can't be undone.`)) return;
  state.staffRequestBusy = request.id;
  state.staffRequestNotice = null;
  renderContentOnly();
  try {
    await removeAccountApi({ role: "Student", ref: request.targetStudentId });
    await setStaffRequestStatus(request.id, "approved");
    state.staffRequestNotice = { type: "success", message: `${label} was removed.` };
  } catch (error) {
    state.staffRequestNotice = { type: "error", message: error.message || "Could not remove this student." };
  } finally {
    state.staffRequestBusy = null;
    renderContentOnly();
  }
}

function dismissStaffRequestNotice() {
  state.staffRequestNotice = null;
  renderContentOnly();
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Several "Add ..." forms depend on another kind of record existing first
// (a class needs an instructor to assign; a student/material/assignment
// needs a class to belong to). On a brand-new school with nothing created
// yet, showing a required dropdown with zero options is a dead end — this
// renders a clear next step instead of a form that can never be submitted.
function emptyDependencyNotice(title, message, buttonLabel, nextModal) {
  return `
    <h2>${title}</h2>
    <p class="hint">${message}</p>
    <div class="modal-actions">
      <button type="button" onclick="openModal('${nextModal}')">${buttonLabel}</button>
    </div>
  `;
}

async function handleAddClass(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const course = form.course.value.trim();
  const instructor = form.instructor.value.trim();
  const schedule = form.schedule.value.trim();
  const room = form.room.value.trim();
  if (!name || !course || !instructor) {
    state.modalError = "Please fill in the class name, course, and instructor.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const classId = nextRefId("CLS", classes.map((item) => item.id));
    await supabaseInsert("classes", [
      {
        class_id: classId,
        name,
        course,
        instructor,
        student_count: 0,
        schedule: schedule || null,
        room: room || null,
        status: "Active",
        completion: 0,
      },
    ]);
    await refreshAfterWrite();
    closeModal();
    navigate("classes");
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not create the class.";
    render();
  }
}

async function handleAddInstructor(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  const issueLogin = form.issueLogin.checked;
  if (!name || !email) {
    state.modalError = "Please add a name and email.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseInsert("instructors", [{ name, email, classes: [], status: "Active" }]);
    let notice = `${name} was added as an instructor.`;
    if (issueLogin) {
      const result = await callAccountApi({ role: "Instructor", email, fullName: name, instructorRef: name });
      notice += ` Username: ${result.email} · Temporary password: ${result.password}`;
    }
    await refreshAfterWrite();
    state.modalBusy = false;
    state.modalError = "";
    state.modalNotice = notice;
    render();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not add the instructor.";
    render();
  }
}

async function handleAddStudent(event) {
  event.preventDefault();
  const form = event.target;
  const firstName = form.firstName.value.trim();
  const lastName = form.lastName.value.trim();
  const email = form.email.value.trim().toLowerCase();
  const classId = form.classId.value;
  const issueLogin = form.issueLogin.checked;
  if (!firstName || !lastName || !email || !classId) {
    state.modalError = "Please fill in every field and choose a class.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const studentId = nextRefId("STU", people.students.map((student) => student.id));
    await supabaseInsert("students", [
      {
        student_id: studentId,
        first_name: firstName,
        last_name: lastName,
        email,
        status: "Active",
        class_id: classId,
        progress: 0,
        attendance: 0,
        avg_grade: 0,
        absences: 0,
        late: 0,
      },
    ]);
    let notice = `${firstName} ${lastName} was added.`;
    if (issueLogin) {
      const result = await callAccountApi({ role: "Student", email, fullName: `${firstName} ${lastName}`, studentRef: studentId });
      notice += ` Username: ${result.email} · Temporary password: ${result.password}`;
    }
    await refreshAfterWrite();
    state.modalBusy = false;
    state.modalError = "";
    state.modalNotice = notice;
    render();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not add the student.";
    render();
  }
}

async function handleAddManager(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  if (!name || !email) {
    state.modalError = "Please add a name and email.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const result = await callAccountApi({ role: "Manager", email, fullName: name });
    state.modalBusy = false;
    state.modalError = "";
    state.modalNotice = `${name} can now sign in as a Manager. Username: ${result.email} · Temporary password: ${result.password}`;
    render();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not add the manager.";
    render();
  }
}

// Only a Super Admin can reach this form at all (see the "settings"
// permission in security.js), matching the "settings update super admin"
// RLS policy in 0002_production_rls.sql — so this PATCH is doubly gated,
// not just hidden client-side.
async function handleSaveSettings(event) {
  event.preventDefault();
  if (!state.session) return;
  const form = event.target;
  const name = form.schoolName.value.trim();
  const portalUrl = form.portalUrl.value.trim();
  const absenceThreshold = Number(form.absenceThreshold.value);
  const dueSoonHours = Number(form.dueSoonHours.value);
  const maxUploadMb = Number(form.maxUploadMb.value);
  const parentAssignmentEmails = form.parentAssignmentEmails.checked;
  const careersEmail = form.careersEmail.value.trim();

  if (!name) {
    state.settingsError = "School name can't be empty.";
    render();
    return;
  }
  if (!Number.isFinite(absenceThreshold) || absenceThreshold < 1) {
    state.settingsError = "Absence threshold must be a number of 1 or more.";
    render();
    return;
  }
  if (careersEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(careersEmail)) {
    state.settingsError = "Careers email doesn't look like a valid email address.";
    render();
    return;
  }

  state.settingsBusy = true;
  state.settingsError = "";
  state.settingsNotice = "";
  render();
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    const nextSettings = { absenceThreshold, dueSoonHours, maxUploadMb, parentAssignmentEmails, careersEmail };
    const query = school.id ? `?id=eq.${encodeURIComponent(school.id)}` : "";
    const response = await fetch(`${base}/rest/v1/school_settings${query}`, {
      method: "PATCH",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ name, portal_url: portalUrl, settings: nextSettings }),
    });
    const body = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(body?.message || body?.hint || "Could not save settings.");
    }
    if (Array.isArray(body) && body.length === 0) {
      throw new Error("No school settings row was updated — is more than one row present, or none at all?");
    }
    school = { ...school, name, portalUrl, settings: nextSettings };
    state.settingsNotice = "Settings saved.";
  } catch (error) {
    state.settingsError = error.message || "Could not save settings.";
  } finally {
    state.settingsBusy = false;
    render();
  }
}

async function handleAddGroup(event, classId) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const memberIds = [...form.querySelectorAll("input[name='members']:checked")].map((input) => input.value);
  if (!name) {
    state.modalError = "Please name the group.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const groupId = nextRefId("GRP", groups.map((group) => group.id));
    await supabaseInsert("groups", [{ group_id: groupId, name, class_id: classId }]);
    if (memberIds.length) {
      await supabaseInsert(
        "group_members",
        memberIds.map((studentId) => ({ group_id: groupId, student_id: studentId })),
      );
    }
    await refreshAfterWrite();
    state.modalBusy = false;
    state.modalError = "";
    state.modalNotice = `"${name}" was created.`;
    state.modal = { type: "addGroup", classId };
    render();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not create the group.";
    render();
  }
}

async function handleAddMaterial(event) {
  event.preventDefault();
  const form = event.target;
  const title = form.title.value.trim();
  const classId = form.classId.value;
  const groupId = form.groupId.value || null;
  const file = form.file.files[0];
  if (!title || !classId || !file) {
    state.modalError = "Please fill in the title, class, and choose a file.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${classId}/${Date.now()}-${safeName}`;
    await supabaseUploadFile(path, file);
    await supabaseInsert("materials", [
      {
        title,
        class_id: classId,
        group_id: groupId,
        file_path: path,
        file_name: file.name,
        uploaded_by: state.profile?.user_id || null,
      },
    ]);
    await refreshAfterWrite();
    closeModal();
    navigate("materials");
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not upload the material.";
    render();
  }
}

async function handleAddAssignment(event) {
  event.preventDefault();
  const form = event.target;
  const title = form.title.value.trim();
  const course = form.course.value.trim();
  const classId = form.classId.value;
  const groupId = form.groupId.value || null;
  const dueDate = form.dueDate.value || null;
  const maxGrade = Number(form.maxGrade.value) || 100;
  const difficulty = form.difficulty.value;
  const cls = classes.find((item) => item.id === classId);
  if (!title || !course || !cls) {
    state.modalError = "Please fill in the title, course, and choose a class.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const total = groupId ? groupMembers.filter((m) => m.groupId === groupId).length : studentsInClass(classId).length;
    await supabaseInsert("assignments", [
      {
        title,
        course,
        class_name: cls.name,
        group_id: groupId,
        due_date: dueDate,
        status: "Assigned",
        submissions: 0,
        total,
        max_grade: maxGrade,
        difficulty,
      },
    ]);
    await refreshAfterWrite();
    closeModal();
    navigate("assignments");
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not create the assignment.";
    render();
  }
}

function materialsView() {
  // `materials` is already scoped by the "materials scoped read" RLS
  // policy (0006 migration) at fetch time in loadFromSupabase — a
  // Student/Parent only ever receives rows for their own class/group, an
  // Instructor only their own classes, so no extra client-side filtering
  // is needed here.
  const canUpload = ["Super Admin", "School Admin", "Instructor"].includes(state.role);
  const rows = materials;

  return `
    ${canUpload ? `<div class="toolbar"><button onclick="openModal('addMaterial')">Upload material</button></div>` : ""}
    <section class="panel table-panel">
      <div class="panel-head"><h2>Shared Materials</h2><span>${rows.length} files</span></div>
      <table>
        <thead><tr><th>Title</th><th>Class</th><th>Shared with</th><th>Uploaded</th><th>Action</th></tr></thead>
        <tbody>
          ${
            rows
              .map((item) => {
                const cls = classes.find((c) => c.id === item.classId);
                const group = groups.find((g) => g.id === item.groupId);
                return `<tr><td><strong>${item.title}</strong><span>${item.fileName}</span></td><td>${cls ? cls.name : item.classId}</td><td>${group ? group.name : "Whole class"}</td><td>${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}</td><td><button onclick="supabaseDownloadFile('${escapeJs(item.filePath)}', '${escapeJs(item.fileName)}')">Download</button></td></tr>`;
              })
              .join("") || `<tr><td colspan="5" class="empty">No materials shared yet.</td></tr>`
          }
        </tbody>
      </table>
    </section>
  `;
}

function appShell() {
  if (state.authMode === "checking") return authLoadingScreen();
  if (state.authMode === "marketing") return state.opportunityDetail ? opportunityDetailScreen(state.opportunityDetail) : marketingScreen();
  if (state.authMode === "not-configured") return notConfiguredScreen();
  if (state.authMode === "signed-out") return loginScreen();
  if (state.authMode === "force-password") return forcePasswordScreen();
  return shell();
}

function authLoadingScreen() {
  return `
    <div class="auth-screen">
      <div class="auth-card">
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="Hero Tech Academy" />
        <p>Loading ${school.name} portal…</p>
      </div>
    </div>
  `;
}

function loginScreen() {
  return `
    <div class="auth-screen">
      <form class="auth-card" onsubmit="handleLoginSubmit(event)">
        <button type="button" class="auth-back" onclick="backToMarketing()">&larr; Back to homepage</button>
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="Hero Tech Academy" />
        <h1>${school.name}</h1>
        <p class="eyebrow">Sign in to your portal</p>
        ${state.authError ? `<p class="auth-error">${state.authError}</p>` : ""}
        <label>Username (email)<input type="email" name="email" autocomplete="username" required autofocus /></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required /></label>
        <button type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? "Signing in…" : "Sign in"}</button>
        <small>Lost your credentials? Ask your manager or instructor to issue or reset them from Accounts &amp; Logins.</small>
      </form>
    </div>
  `;
}

function notConfiguredScreen() {
  return `
    <div class="auth-screen">
      <div class="auth-card">
        <button type="button" class="auth-back" onclick="backToMarketing()">&larr; Back to homepage</button>
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="Hero Tech Academy" />
        <h1>Almost there</h1>
        <p class="eyebrow">This portal isn't connected to a database yet</p>
        <p>${school.name} hasn't been connected to Supabase yet, so there's no sign-in to show. If you're setting this school up, follow <code>docs/deploy-vercel-supabase.md</code> to create the Supabase project, run the migrations, and add the environment variables in Vercel — then this button will take visitors to a real sign-in screen.</p>
      </div>
    </div>
  `;
}

function forcePasswordScreen() {
  return `
    <div class="auth-screen">
      <form class="auth-card" onsubmit="handleForcePasswordSubmit(event)">
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="Hero Tech Academy" />
        <h1>Set a new password</h1>
        <p class="eyebrow">First login for ${state.profile?.full_name || state.profile?.email || "your account"}</p>
        ${state.authError ? `<p class="auth-error">${state.authError}</p>` : ""}
        <label>New password<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required /></label>
        <label>Confirm new password<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required /></label>
        <button type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? "Saving…" : "Save and continue"}</button>
        <small>Your admin issued a temporary password. Choose a new one only you know.</small>
      </form>
    </div>
  `;
}

// Starter testimonials shown until real, Manager-approved reviews come in
// from the "Leave a review" form — no visible "sample" labeling on the
// live site; swap these for real quotes any time in this file.
const sampleReviews = [
  {
    quote: "My son couldn't stop talking about the game he built in class — he's already asking when the next module starts!",
    name: "Parent of a Junior Coders student",
  },
  {
    quote: "I built my own website in the Code Builders track and showed it to my whole class. Best decision my parents made for me this year.",
    name: "Code Builders student, age 12",
  },
  {
    quote: "ابني بقى يتحمس يروح الحصة كل أسبوع، وعمل أول لعبة له بنفسه — فخورين جدًا فيه.",
    name: "والد طالب في مسار Junior Coders",
  },
  {
    quote: "تعلمت البرمجة من الصفر وعملت أول موقع إلكتروني ليا في خلال شهرين بس.",
    name: "طالبة في مسار Code Builders",
  },
  {
    quote: "The instructors are patient and really get how kids learn. My daughter went from \"I don't get coding\" to teaching her little brother in a few weeks.",
    name: "Parent of a Young Developers student",
  },
];

const trustStats = [
  { value: "60+", label: "Students trained so far" },
  { value: "Ages 6–16", label: "Programs for every age" },
  { value: "Live", label: "Instructor-led, not pre-recorded" },
];

const programTracks = [
  {
    name: "Junior Coders",
    age: "Ages 6–9",
    desc: "Block-based coding with Scratch — kids build their first animations and games while learning logic and sequencing.",
    skills: ["Scratch", "Logic & sequencing", "First animations & games"],
  },
  {
    name: "Code Builders",
    age: "Ages 10–13",
    desc: "Python fundamentals and web basics — real projects kids can show off, from simple apps to their first website.",
    skills: ["Python basics", "HTML & CSS", "First real projects"],
  },
  {
    name: "Young Developers",
    age: "Ages 14–17",
    desc: "Web and app development, plus game-dev fundamentals — building a portfolio ready for the next step.",
    skills: ["Web & app development", "Game-dev fundamentals", "Portfolio project"],
  },
];

const howItWorks = [
  { step: "1", title: "Book a free trial class", desc: "Send a message or request a call back — we'll find a class time that fits your child's age and schedule." },
  { step: "2", title: "Quick placement chat", desc: "A short conversation with an instructor makes sure your child starts in the right track for their age and experience." },
  { step: "3", title: "Start learning, live", desc: "Small live classes with a real instructor — and a parent login so you can follow attendance and progress along the way." },
];

const compareRows = [
  ["Live, instructor-led classes with real-time feedback", "check", "cross", "partial"],
  ["Small class sizes with personal attention", "check", "cross", "partial"],
  ["Structured curriculum that builds skills over time", "check", "partial", "cross"],
  ["Real projects your child can show off and be proud of", "check", "partial", "partial"],
  ["Parents can track attendance & progress online", "check", "cross", "cross"],
];

function compareIcon(kind) {
  if (kind === "check") return `<span class="cmp-icon cmp-yes" title="Yes">&#10003;</span>`;
  if (kind === "partial") return `<span class="cmp-icon cmp-partial" title="Partially">&#8213;</span>`;
  return `<span class="cmp-icon cmp-no" title="No">&#10005;</span>`;
}

const socialIcons = {
  facebook: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M13.5 21v-8h2.7l.4-3.1h-3.1V8c0-.9.25-1.5 1.53-1.5H16.7V3.7C16.4 3.66 15.42 3.58 14.29 3.58c-2.36 0-3.98 1.44-3.98 4.08v2.24H7.6v3.1h2.71v8h3.19z"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17.5 14.4c-.3-.15-1.75-.86-2-.96-.27-.1-.47-.15-.66.15-.2.3-.76.96-.93 1.16-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.47-.9-.8-1.5-1.78-1.67-2.08-.17-.3-.02-.46.13-.61.14-.14.3-.34.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.66-1.6-.9-2.18-.24-.58-.48-.5-.66-.5h-.56c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.4.25-.7.25-1.3.17-1.4-.07-.13-.27-.2-.57-.35z"/><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12c0 1.9.52 3.68 1.44 5.2L2 22l4.94-1.4A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18.2a8.17 8.17 0 0 1-4.24-1.19l-.3-.18-3 .85.85-2.92-.2-.3A8.19 8.19 0 1 1 20.2 12 8.2 8.2 0 0 1 12 20.2z"/></svg>`,
};

function socialLinksHtml() {
  const wa = (school.social.whatsapp || "").replace(/[^\d]/g, "");
  return `
    <a class="m-social-link" href="${school.social.facebook}" target="_blank" rel="noopener">${socialIcons.facebook}<span>Facebook</span></a>
    <a class="m-social-link" href="https://wa.me/${wa}" target="_blank" rel="noopener">${socialIcons.whatsapp}<span>WhatsApp</span></a>
  `;
}

// An opportunity's own page — reached by clicking "View details & apply"
// on a Work With Us card, or a direct link (see applyOpportunityHash()).
// Shows the full posting and where to send a CV and cover letter.
function opportunityDetailScreen(op) {
  const careersEmail = (school.settings.careersEmail || "").trim();
  const mailSubject = encodeURIComponent(`Application: ${op.title}`);
  const mailBody = encodeURIComponent(
    `Hi ${school.name} team,\n\nI'd like to apply for the ${op.title} position. My CV and cover letter are attached.\n\nThanks,\n`,
  );
  return `
    <div class="marketing">
      <header class="m-nav">
        <div class="brand">
          <img class="brand-mark" src="/src/assets/logo-icon.png" alt="Hero Tech Academy" />
          <strong>${escapeHtml(school.name)}</strong>
        </div>
        <div class="m-nav-social">${socialLinksHtml()}</div>
        <button class="m-login-button" onclick="beginLogin()">Login</button>
      </header>

      <section class="m-section reveal">
        <button type="button" class="auth-back" onclick="closeOpportunityDetail()">&larr; Back to Work With Us</button>
        <p class="eyebrow">Open position</p>
        <h1>${escapeHtml(op.title)}</h1>
        <p class="m-sub">${escapeHtml([op.employment_type, op.location].filter(Boolean).join(" · ")) || "Details on request"}</p>

        <div class="panel">
          ${op.description ? `<p>${escapeHtml(op.description)}</p>` : `<p class="empty">No further details posted yet — reach out and ask.</p>`}
        </div>

        <div class="panel">
          <h2>How to apply</h2>
          ${
            careersEmail
              ? `<p>Send your CV and a short cover letter to <a href="mailto:${escapeHtml(careersEmail)}?subject=${mailSubject}&body=${mailBody}">${escapeHtml(careersEmail)}</a> — mention "${escapeHtml(op.title)}" in the subject line.</p>`
              : `<p>We haven't set up an application email yet — use the <a href="#contact" onclick="closeOpportunityDetail()">contact form</a> and mention you're applying for "${escapeHtml(op.title)}".</p>`
          }
        </div>
      </section>

      <footer class="m-footer">
        <span>&copy; ${new Date().getFullYear()} ${escapeHtml(school.name)}</span>
        <div class="m-footer-social">${socialLinksHtml()}</div>
        <button class="m-login-button" onclick="beginLogin()">Login</button>
      </footer>
    </div>
  `;
}

function marketingScreen() {
  const notice = state.contactNotice;
  const reviewNotice = state.reviewNotice;
  const allReviews = [...state.publicReviews, ...sampleReviews];
  const showPromo = !state.promoModalDismissed;
  return `
    <div class="marketing">
      ${showPromo ? `
        <div class="promo-overlay" onclick="if (event.target === this) dismissPromoModal()">
          <div class="promo-modal" role="dialog" aria-modal="true" aria-label="Enroll your child">
            <button type="button" class="promo-close" onclick="dismissPromoModal()" aria-label="Close">&times;</button>
            <img src="/src/assets/promo-different-start.jpg" alt="Every child has a different beginning — Hero Tech Academy" />
            <div class="promo-modal-body">
              <p>Ready to help your child start? Book a free trial class today.</p>
              <button type="button" class="promo-cta" onclick="openPromoForm()">Fill the form</button>
            </div>
          </div>
        </div>
      ` : ""}
      <header class="m-nav">
        <div class="brand">
          <img class="brand-mark" src="/src/assets/logo-icon.png" alt="Hero Tech Academy" />
          <strong>${escapeHtml(school.name)}</strong>
        </div>
        <nav class="m-nav-links" aria-label="Marketing navigation">
          <a href="#how">How it works</a>
          <a href="#features">Programs</a>
          <a href="#compare">Compare</a>
          <a href="#reviews">Reviews</a>
          <a href="#careers">Work With Us</a>
          <a href="#contact">Contact</a>
        </nav>
        <div class="m-nav-social">${socialLinksHtml()}</div>
        <button class="m-login-button" onclick="beginLogin()">Login</button>
      </header>

      <section class="m-hero">
        <p class="eyebrow">Coding courses for kids</p>
        <h1>Where Kids Learn to Code, Create, and Build Real Projects</h1>
        <p class="m-sub">Live, instructor-led coding classes for kids — small groups, real projects, and a secure portal so parents can follow every step of their child's progress.</p>
        <div class="m-hero-actions">
          <a class="m-cta-primary" href="#contact">Book a free trial class</a>
          <a class="m-cta-secondary" href="#features">View our programs</a>
        </div>
        <div class="m-stats">
          ${trustStats.map((stat) => `<div class="m-stat reveal"><strong>${stat.value}</strong><span>${stat.label}</span></div>`).join("")}
        </div>
      </section>

      <section id="how" class="m-section reveal">
        <h2>How It Works</h2>
        <p class="m-sub">Getting started takes three simple steps.</p>
        <div class="m-cards">
          ${howItWorks.map((item) => `
            <article class="m-card reveal">
              <span class="m-step">${item.step}</span>
              <h3>${item.title}</h3>
              <p>${item.desc}</p>
            </article>
          `).join("")}
        </div>
      </section>

      <section id="features" class="m-section reveal">
        <h2>Our Coding Programs</h2>
        <p class="m-sub">Structured tracks by age, so every child starts at the right level.</p>
        <div class="m-cards">
          ${programTracks.map((track) => `
            <article class="m-card reveal">
              <h3>${track.name} <span class="m-age">${track.age}</span></h3>
              <p>${track.desc}</p>
              <div class="m-skills">${track.skills.map((skill) => `<span class="m-skill-tag">${skill}</span>`).join("")}</div>
            </article>
          `).join("")}
        </div>
        <p class="m-sub">Every student gets a secure login to track their own attendance, assignments, and progress — and parents can follow along too.</p>
      </section>

      <section id="compare" class="m-section reveal">
        <h2>How We Compare</h2>
        <p class="m-sub">How Hero Tech Academy stacks up against common alternatives for kids' coding education.</p>
        <div class="table-panel">
          <table class="m-compare">
            <thead><tr><th></th><th>${school.name}</th><th>Pre-recorded video courses</th><th>One-off workshops</th></tr></thead>
            <tbody>
              ${compareRows.map(([label, a, b, c]) => `<tr><td>${label}</td><td>${compareIcon(a)}</td><td>${compareIcon(b)}</td><td>${compareIcon(c)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section id="reviews" class="m-section reveal">
        <h2>What Parents &amp; Students Say</h2>
        <p class="m-sub">We've trained <strong>60+ students</strong> so far — here's what a few of them have to say.</p>
        <div class="m-cards">
          ${allReviews.map((review) => `
            <article class="m-card m-review reveal">
              <p dir="auto">&ldquo;${escapeHtml(review.quote)}&rdquo;</p>
              <strong>${escapeHtml(review.name)}</strong>
              ${review.role_or_school ? `<span class="m-review-role">${escapeHtml(review.role_or_school)}</span>` : ""}
              ${review.rating ? `<span class="m-review-stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span>` : ""}
            </article>
          `).join("")}
        </div>

        <form class="m-review-form" onsubmit="handleReviewSubmit(event)">
          <h3>Leave a review</h3>
          ${reviewNotice ? `<p class="notice-row ${reviewNotice.type === "error" ? "auth-error" : "m-success"}">${reviewNotice.message}<button type="button" class="notice-dismiss" onclick="dismissReviewNotice()" aria-label="Dismiss">&times;</button></p>` : ""}
          <div class="m-review-form-grid">
            <label>Your name<input type="text" name="name" required /></label>
            <label>You are a... (optional)<input type="text" name="roleOrSchool" placeholder="e.g. Parent of a Code Builders student" /></label>
          </div>
          <label>Rating
            <select name="rating">
              <option value="5">★★★★★ (5)</option>
              <option value="4">★★★★☆ (4)</option>
              <option value="3">★★★☆☆ (3)</option>
              <option value="2">★★☆☆☆ (2)</option>
              <option value="1">★☆☆☆☆ (1)</option>
            </select>
          </label>
          <label>Your review<textarea name="quote" rows="3" required></textarea></label>
          <button type="submit" ${state.reviewBusy ? "disabled" : ""}>${state.reviewBusy ? "Sending…" : "Submit review"}</button>
          <small>Reviews are checked by a Manager before they go live.</small>
        </form>
      </section>

      <section id="careers" class="m-section reveal">
        <h2>Work With Us</h2>
        <p class="m-sub">${escapeHtml(school.name)} is growing — here's what we're hiring for right now.</p>
        <div class="m-cards">
          ${
            state.publicOpportunities.length
              ? state.publicOpportunities
                  .map(
                    (op) => `
              <article class="m-card reveal">
                <h3>${escapeHtml(op.title)}</h3>
                <p class="m-sub">${escapeHtml([op.employment_type, op.location].filter(Boolean).join(" · ")) || "Details on request"}</p>
                ${op.description ? `<p>${escapeHtml(op.description.length > 160 ? `${op.description.slice(0, 160)}…` : op.description)}</p>` : ""}
                <button type="button" class="m-cta-secondary" onclick="openOpportunityDetail('${escapeJs(op.id)}')">View details &amp; apply</button>
              </article>
            `,
                  )
                  .join("")
              : `<p class="empty">No open roles right now — check back soon, or introduce yourself using the contact form below.</p>`
          }
        </div>
        <a class="m-cta-secondary" href="#contact">Interested? Get in touch</a>
      </section>

      <section id="contact" class="m-section m-contact reveal">
        <div class="m-contact-grid">
          <div>
            <h2>Contact us</h2>
            <p class="m-sub">Want to book a free trial class, ask about pricing, or find the right program for your child? Send a message, request a call back, or reach us directly.</p>
            <div class="m-contact-social">${socialLinksHtml()}</div>
          </div>
          <form class="m-contact-form" onsubmit="handleContactSubmit(event)">
            ${notice ? `<p class="notice-row ${notice.type === "error" ? "auth-error" : "m-success"}">${notice.message}<button type="button" class="notice-dismiss" onclick="dismissContactNotice()" aria-label="Dismiss">&times;</button></p>` : ""}
            <label>Name<input type="text" name="name" required /></label>
            <label>Email<input type="email" name="email" required /></label>
            <label>Phone (optional)<input type="tel" name="phone" /></label>
            <label>Message<textarea name="message" rows="4"></textarea></label>
            <label class="checkline"><input type="checkbox" name="wantsCall" /> Request a call back instead of email</label>
            <button type="submit" ${state.contactBusy ? "disabled" : ""}>${state.contactBusy ? "Sending…" : "Send message"}</button>
          </form>
        </div>
      </section>

      <footer class="m-footer">
        <span>&copy; ${new Date().getFullYear()} ${escapeHtml(school.name)}</span>
        <div class="m-footer-social">${socialLinksHtml()}</div>
        <button class="m-login-button" onclick="beginLogin()">Login</button>
      </footer>
    </div>
  `;
}

// The "book a trial class" popup shows on every visit to the homepage
// (including a plain page refresh) — dismissing it only clears the
// in-memory flag for the rest of this page load, nothing is remembered
// in storage, so reloading the page brings it back.
function dismissPromoModal() {
  state.promoModalDismissed = true;
  render();
}

// Closes the popup and takes the visitor straight to the real Contact
// form — submissions there already land in the Contact Requests panel
// every Manager can see, so there's no separate inbox to check.
function openPromoForm() {
  dismissPromoModal();
  requestAnimationFrame(() => {
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector(".m-contact-form input[name='name']")?.focus();
  });
}

function beginLogin() {
  state.authMode = hasSupabaseConfig() ? "signed-out" : "not-configured";
  state.authError = "";
  state.view = "dashboard";
  render();
}

function backToMarketing() {
  state.authMode = "marketing";
  state.authError = "";
  render();
}

// Opens an opportunity's own page (still within the marketing/signed-out
// flow — see appShell()) with its full description and how to apply.
// Updates the URL hash so the page is directly linkable/shareable and
// survives a refresh (see applyOpportunityHash(), called from initApp()).
function openOpportunityDetail(id) {
  const opportunity = state.publicOpportunities.find((op) => op.id === id);
  if (!opportunity) return;
  state.opportunityDetail = opportunity;
  window.location.hash = `opportunity-${id}`;
  window.scrollTo(0, 0);
  render();
}

function closeOpportunityDetail() {
  state.opportunityDetail = null;
  window.location.hash = "careers";
  render();
}

// Called once on load, after the public opportunities list has loaded —
// if the URL already points at one (someone followed a shared link, or
// refreshed the page while viewing one), open it immediately instead of
// showing the general homepage first.
function applyOpportunityHash() {
  const match = /^#opportunity-(.+)$/.exec(window.location.hash);
  if (!match) return;
  const opportunity = state.publicOpportunities.find((op) => op.id === decodeURIComponent(match[1]));
  if (opportunity) state.opportunityDetail = opportunity;
}

async function handleContactSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const phone = form.phone.value.trim();
  const message = form.message.value.trim();
  const wantsCall = form.wantsCall.checked;

  if (!name || !email) {
    state.contactNotice = { type: "error", message: "Please add your name and email." };
    render();
    return;
  }

  state.contactBusy = true;
  state.contactNotice = null;
  render();

  try {
    if (hasSupabaseConfig()) {
      const base = config.supabaseUrl.replace(/\/$/, "");
      const response = await fetch(`${base}/rest/v1/contact_requests`, {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${config.supabaseAnonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify([
          {
            kind: wantsCall ? "call_request" : "contact",
            name,
            email,
            phone: phone || null,
            message: message || null,
          },
        ]),
      });
      if (!response.ok) throw new Error("Could not send your message. Please try again or email us directly.");
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    state.contactNotice = {
      type: "success",
      message: wantsCall
        ? "Thanks! We received your request and will call you back shortly."
        : "Thanks! Your message has been sent.",
    };
  } catch (error) {
    state.contactNotice = { type: "error", message: error.message || "Something went wrong. Please try again." };
  } finally {
    state.contactBusy = false;
    render();
  }
}

function dismissContactNotice() {
  state.contactNotice = null;
  render();
}

// Approved reviews only — anyone (even signed out) can read these under the
// reviews table's "approved only" RLS policy; a submitted review never
// shows here until a Manager approves it from the Reviews panel.
async function loadPublicReviews() {
  if (!hasSupabaseConfig()) return;
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    const response = await fetch(
      `${base}/rest/v1/reviews?status=eq.approved&select=name,role_or_school,rating,quote&order=created_at.desc&limit=12`,
      {
        headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`, Accept: "application/json" },
      },
    );
    state.publicReviews = response.ok ? await response.json() : [];
  } catch {
    state.publicReviews = [];
  }
}

async function handleReviewSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const roleOrSchool = form.roleOrSchool.value.trim();
  const quote = form.quote.value.trim();
  const rating = Number(form.rating.value) || 5;

  if (!name || !quote) {
    state.reviewNotice = { type: "error", message: "Please add your name and a short review." };
    render();
    return;
  }

  state.reviewBusy = true;
  state.reviewNotice = null;
  render();

  try {
    if (hasSupabaseConfig()) {
      const base = config.supabaseUrl.replace(/\/$/, "");
      const response = await fetch(`${base}/rest/v1/reviews`, {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${config.supabaseAnonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify([{ name, role_or_school: roleOrSchool || null, quote, rating }]),
      });
      if (!response.ok) throw new Error("Could not submit your review. Please try again.");
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    state.reviewNotice = { type: "success", message: "Thanks! Your review is in — it'll appear here once a Manager approves it." };
    form.reset();
  } catch (error) {
    state.reviewNotice = { type: "error", message: error.message || "Something went wrong. Please try again." };
  } finally {
    state.reviewBusy = false;
    render();
  }
}

function dismissReviewNotice() {
  state.reviewNotice = null;
  render();
}

function canManageAccounts() {
  return ["Super Admin", "School Admin", "Instructor"].includes(state.role);
}

// A dedicated Instructors directory for Managers — separate from the
// generic Accounts & Logins list — so adding a new instructor profile and
// issuing their first login both happen from one obvious place, before a
// Manager ever needs to think about classes or students.
function instructorRow(instructor) {
  const directory = state.accountsDirectory;
  const account = directory?.find((row) => row.instructor_name === instructor.name);
  const ownClasses = classes.filter((item) => item.instructor === instructor.name);
  const key = `instructor-${instructor.name}`;
  const busy = state.accountsBusy === key;
  const status = account
    ? account.must_change_password
      ? badge("Invited")
      : badge("Active")
    : `<span class="muted-pill">Not set up</span>`;
  const actionLabel = account ? "Reset password" : "Generate login";
  const handlerName = account ? "resetCredentials" : "generateCredentials";
  const handler = `${handlerName}('${key}', 'Instructor', '${escapeJs(instructor.email)}', '${escapeJs(instructor.name)}', '${escapeJs(instructor.name)}')`;
  const canRemove = canRemoveAccounts(state.role);
  const removeKey = `remove-instructor-${instructor.name}`;
  const removeBusy = state.accountsBusy === removeKey;

  return `
    <tr>
      <td><strong>${escapeHtml(instructor.name)}</strong></td>
      <td>${escapeHtml(instructor.email)}</td>
      <td>${ownClasses.length ? ownClasses.map((c) => escapeHtml(c.name)).join(", ") : "No classes yet"}</td>
      <td>${status}</td>
      <td>
        <button onclick="${handler}" ${busy ? "disabled" : ""}>${busy ? "Working…" : actionLabel}</button>
        ${canRemove ? `<button onclick="handleRemoveInstructor('${escapeJs(instructor.name)}')" ${removeBusy ? "disabled" : ""}>${removeBusy ? "Removing…" : "Remove"}</button>` : ""}
      </td>
    </tr>
  `;
}

function instructorsView() {
  const rows = people.instructors.map(instructorRow);

  return `
    ${state.accountsNotice ? accountsNoticeBanner(state.accountsNotice) : ""}
    <div class="toolbar">
      ${canCreateInstructorProfiles(state.role) ? `<button onclick="openModal('addInstructor')">Add instructor</button>` : ""}
    </div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>Instructors</h2><span>${people.instructors.length} on staff</span></div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Classes</th><th>Portal access</th><th>Action</th></tr></thead>
        <tbody>${rows.join("") || `<tr><td colspan="5" class="empty">No instructors yet — add one to get started.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

// Removing an instructor is Manager-only and irreversible: it deletes both
// the instructor's school record and their portal login (if one was ever
// issued), via api/remove-account.js. The server itself refuses if the
// instructor still has classes assigned, so a Manager sees that reason
// directly rather than a generic failure.
async function handleRemoveInstructor(name) {
  if (!window.confirm(`Remove ${name}? This deletes their instructor record and login. This can't be undone.`)) return;
  const key = `remove-instructor-${name}`;
  state.accountsBusy = key;
  state.accountsNotice = null;
  renderContentOnly();
  try {
    await removeAccountApi({ role: "Instructor", ref: name });
    await refreshAfterWrite();
    state.accountsNotice = { type: "removed", message: `${name} was removed.` };
  } catch (error) {
    state.accountsNotice = { type: "error", message: error.message };
  } finally {
    state.accountsBusy = null;
    renderContentOnly();
  }
}

function accountsView() {
  const isInstructor = state.role === "Instructor";
  const directory = state.accountsDirectory;
  const accountFor = (refId) => directory?.find((row) => row.student_id === refId);

  // Instructor logins now live on their own "Instructors" tab (above
  // Students in the sidebar) so a Manager doesn't have to hunt for them
  // here — this panel is Student logins plus, for a Manager, adding
  // another Manager.
  const visibleStudents = isInstructor ? filterStudentsForViewer(currentViewer(), people.students) : people.students;
  const studentRows = visibleStudents.map((student) =>
    accountRow({
      key: `student-${student.id}`,
      role: "Student",
      name: fullName(student),
      email: student.email,
      refId: student.id,
      account: accountFor(student.id),
    }),
  );

  const isManager = ["Super Admin", "School Admin"].includes(state.role);
  return `
    ${state.accountsNotice ? accountsNoticeBanner(state.accountsNotice) : ""}
    ${isInstructor ? `<p class="hint">You can issue or reset a login for students in your own classes only. Ask a Manager for instructor or manager accounts.</p>` : `<p class="hint">Looking for instructor logins? See the <button onclick="navigate('instructors')">Instructors</button> tab.</p>`}
    <div class="toolbar">
      ${isManager ? `<button onclick="openModal('addManager')">Add manager</button>` : ""}
      ${canCreateStudentProfiles(state.role) ? `<button onclick="openModal('addStudent')">Add student</button>` : ""}
    </div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>Student Logins</h2><span>${directory ? directory.length : 0} accounts issued</span></div>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Username (email)</th><th>Portal access</th><th>Action</th></tr></thead>
        <tbody>${studentRows.join("") || `<tr><td colspan="5" class="empty">No accounts to manage yet.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function leadsView() {
  const leads = state.leadsDirectory || [];
  return `
    <section class="panel table-panel">
      <div class="panel-head"><h2>Contact Requests</h2><span>${leads.length} received</span></div>
      <table>
        <thead><tr><th>Received</th><th>Type</th><th>Name</th><th>Email</th><th>Phone</th><th>Message</th></tr></thead>
        <tbody>${
          leads
            .map(
              (lead) => `<tr><td>${new Date(lead.created_at).toLocaleString()}</td><td>${badge(lead.kind === "call_request" ? "Call requested" : "Contact")}</td><td><strong>${escapeHtml(lead.name)}</strong></td><td>${escapeHtml(lead.email)}</td><td>${escapeHtml(lead.phone) || "—"}</td><td>${escapeHtml(lead.message) || "—"}</td></tr>`,
            )
            .join("") || `<tr><td colspan="6" class="empty">No messages yet.</td></tr>`
        }</tbody>
      </table>
    </section>
  `;
}

function reviewsView() {
  const reviews = state.reviewsDirectory || [];
  const pending = reviews.filter((r) => r.status === "pending");
  const decided = reviews.filter((r) => r.status !== "pending");
  return `
    <p class="hint">Reviews submitted from the homepage land here as "Pending" and never appear publicly until you approve them.</p>
    <section class="panel table-panel">
      <div class="panel-head"><h2>Pending review</h2><span>${pending.length} waiting</span></div>
      <table>
        <thead><tr><th>Received</th><th>Name</th><th>Quote</th><th>Rating</th><th>Action</th></tr></thead>
        <tbody>${pending.map(reviewRow).join("") || `<tr><td colspan="5" class="empty">Nothing pending.</td></tr>`}</tbody>
      </table>
    </section>
    <section class="panel table-panel">
      <div class="panel-head"><h2>Decided</h2><span>${decided.length} reviewed</span></div>
      <table>
        <thead><tr><th>Received</th><th>Name</th><th>Quote</th><th>Rating</th><th>Status</th></tr></thead>
        <tbody>${
          decided
            .map(
              (r) => `<tr><td>${new Date(r.created_at).toLocaleString()}</td><td><strong>${escapeHtml(r.name)}</strong></td><td dir="auto">${escapeHtml(r.quote)}</td><td>${"★".repeat(r.rating || 5)}</td><td>${badge(r.status === "approved" ? "Approved" : "Rejected")}</td></tr>`,
            )
            .join("") || `<tr><td colspan="5" class="empty">No decisions yet.</td></tr>`
        }</tbody>
      </table>
    </section>
  `;
}

function reviewRow(review) {
  const busy = state.reviewsBusy === review.id;
  return `
    <tr>
      <td>${new Date(review.created_at).toLocaleString()}</td>
      <td><strong>${escapeHtml(review.name)}</strong>${review.role_or_school ? `<span>${escapeHtml(review.role_or_school)}</span>` : ""}</td>
      <td dir="auto">${escapeHtml(review.quote)}</td>
      <td>${"★".repeat(review.rating || 5)}</td>
      <td>
        <button onclick="setReviewStatus('${review.id}', 'approved')" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Approve"}</button>
        <button onclick="setReviewStatus('${review.id}', 'rejected')" ${busy ? "disabled" : ""}>Reject</button>
      </td>
    </tr>
  `;
}

async function loadReviewsDirectory() {
  if (!hasSupabaseConfig() || !state.session) return;
  const base = config.supabaseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(
      `${base}/rest/v1/reviews?select=id,name,role_or_school,rating,quote,status,created_at&order=created_at.desc`,
      {
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${state.session.access_token}`,
          Accept: "application/json",
        },
      },
    );
    state.reviewsDirectory = response.ok ? await response.json() : [];
  } catch {
    state.reviewsDirectory = [];
  }
}

async function setReviewStatus(id, status) {
  if (!state.session) return;
  state.reviewsBusy = id;
  renderContentOnly();
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    await fetch(`${base}/rest/v1/reviews?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status }),
    });
    await loadReviewsDirectory();
  } finally {
    state.reviewsBusy = null;
    renderContentOnly();
  }
}

// ---------------------------------------------------------------------
// Opportunities ("Work With Us"): a Manager posts and removes job
// openings from here. Anything marked "Open" is what the public homepage
// section (see marketingScreen()) shows to signed-out visitors — enforced
// by Supabase RLS (0009_opportunities_and_removal_requests.sql), not by
// this view.
// ---------------------------------------------------------------------

function opportunitiesView() {
  const rows = state.opportunitiesDirectory || [];
  return `
    ${state.opportunitiesNotice ? opportunitiesNoticeBanner(state.opportunitiesNotice) : ""}
    <p class="hint">Opportunities marked "Open" appear publicly on the homepage's Work With Us section right away.</p>
    <div class="toolbar"><button onclick="openModal('addOpportunity')">Add opportunity</button></div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>Opportunities</h2><span>${rows.length} total</span></div>
      <table>
        <thead><tr><th>Title</th><th>Location</th><th>Type</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${rows.map(opportunityRow).join("") || `<tr><td colspan="5" class="empty">No opportunities yet — add one to get started.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function opportunityRow(op) {
  const busy = state.opportunitiesBusy === op.id;
  const isOpen = op.status === "open";
  return `
    <tr>
      <td><strong>${escapeHtml(op.title)}</strong>${op.description ? `<span>${escapeHtml(op.description)}</span>` : ""}</td>
      <td>${escapeHtml(op.location) || "—"}</td>
      <td>${escapeHtml(op.employment_type) || "—"}</td>
      <td>${badge(isOpen ? "Open" : "Closed")}</td>
      <td>
        <button onclick="setOpportunityStatus('${op.id}', '${isOpen ? "closed" : "open"}')" ${busy ? "disabled" : ""}>${busy ? "Working…" : isOpen ? "Close" : "Reopen"}</button>
        <button onclick="removeOpportunity('${op.id}', '${escapeJs(op.title)}')" ${busy ? "disabled" : ""}>Remove</button>
      </td>
    </tr>
  `;
}

function opportunitiesNoticeBanner(notice) {
  return `
    <section class="panel credential-reveal error">
      <div class="panel-head"><h2>Could not complete that request</h2><button onclick="dismissOpportunitiesNotice()">Dismiss</button></div>
      <p>${escapeHtml(notice.message)}</p>
    </section>
  `;
}

function dismissOpportunitiesNotice() {
  state.opportunitiesNotice = null;
  renderContentOnly();
}

function addOpportunityModal() {
  return `
    <h2>Add an opportunity</h2>
    <p class="hint">Published as "Open" immediately — visible on the homepage's Work With Us section right away.</p>
    ${modalMessages()}
    <form onsubmit="handleAddOpportunity(event)">
      <label>Title<input type="text" name="title" required /></label>
      <label>Location<input type="text" name="location" placeholder="e.g. On-site, or Remote" /></label>
      <label>Type
        <select name="employmentType">
          <option value="Full-time">Full-time</option>
          <option value="Part-time">Part-time</option>
          <option value="Contract">Contract</option>
          <option value="Volunteer">Volunteer</option>
        </select>
      </label>
      <label>Description<textarea name="description" rows="4"></textarea></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? "Adding…" : "Add opportunity"}</button>
      </div>
    </form>
  `;
}

async function handleAddOpportunity(event) {
  event.preventDefault();
  const form = event.target;
  const title = form.title.value.trim();
  const location = form.location.value.trim();
  const employmentType = form.employmentType.value;
  const description = form.description.value.trim();
  if (!title) {
    state.modalError = "Please add a title.";
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseInsert("opportunities", [
      {
        title,
        location: location || null,
        employment_type: employmentType,
        description: description || null,
        status: "open",
      },
    ]);
    await loadOpportunitiesDirectory();
    closeModal();
    navigate("opportunities");
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || "Could not add this opportunity. Has migration 0009 been run yet?";
    render();
  }
}

async function loadOpportunitiesDirectory() {
  if (!hasSupabaseConfig() || !state.session) return;
  const base = config.supabaseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(
      `${base}/rest/v1/opportunities?select=id,title,description,location,employment_type,status,created_at&order=created_at.desc`,
      {
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${state.session.access_token}`,
          Accept: "application/json",
        },
      },
    );
    state.opportunitiesDirectory = response.ok ? await response.json() : [];
  } catch {
    state.opportunitiesDirectory = [];
  }
}

// Anyone, signed in or not, can see "open" opportunities — this is what
// powers the homepage's Work With Us section for a signed-out visitor.
async function loadPublicOpportunities() {
  if (!hasSupabaseConfig()) return;
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    const response = await fetch(
      `${base}/rest/v1/opportunities?status=eq.open&select=id,title,description,location,employment_type,created_at&order=created_at.desc`,
      {
        headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`, Accept: "application/json" },
      },
    );
    state.publicOpportunities = response.ok ? await response.json() : [];
  } catch {
    state.publicOpportunities = [];
  }
}

async function setOpportunityStatus(id, status) {
  if (!state.session) return;
  state.opportunitiesBusy = id;
  renderContentOnly();
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    await fetch(`${base}/rest/v1/opportunities?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status }),
    });
    await loadOpportunitiesDirectory();
  } finally {
    state.opportunitiesBusy = null;
    renderContentOnly();
  }
}

async function removeOpportunity(id, title) {
  if (!state.session) return;
  if (!window.confirm(`Remove the "${title}" opportunity? This can't be undone.`)) return;
  state.opportunitiesBusy = id;
  renderContentOnly();
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/rest/v1/opportunities?id=eq.${id}`, {
      method: "DELETE",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        Prefer: "return=minimal",
      },
    });
    if (!response.ok) throw new Error("Could not remove this opportunity.");
    await loadOpportunitiesDirectory();
  } catch (error) {
    state.opportunitiesNotice = { type: "error", message: error.message };
  } finally {
    state.opportunitiesBusy = null;
    renderContentOnly();
  }
}

function accountRow({ key, role, name, email, refId, account }) {
  const busy = state.accountsBusy === key;
  const status = account
    ? account.must_change_password
      ? badge("Invited")
      : badge("Active")
    : `<span class="muted-pill">Not set up</span>`;
  const actionLabel = account ? "Reset password" : "Generate login";
  const handlerName = account ? "resetCredentials" : "generateCredentials";
  const handler = `${handlerName}('${key}', '${role}', '${escapeJs(email)}', '${escapeJs(name)}', '${escapeJs(refId)}')`;

  return `
    <tr>
      <td><strong>${name}</strong></td>
      <td>${role}</td>
      <td>${email}</td>
      <td>${status}</td>
      <td><button onclick="${handler}" ${busy ? "disabled" : ""}>${busy ? "Working…" : actionLabel}</button></td>
    </tr>
  `;
}

function accountsNoticeBanner(notice) {
  if (notice.type === "error") {
    return `
      <section class="panel credential-reveal error">
        <div class="panel-head"><h2>Could not complete that request</h2><button onclick="dismissAccountsNotice()">Dismiss</button></div>
        <p>${escapeHtml(notice.message)}</p>
      </section>
    `;
  }

  if (notice.type === "removed") {
    return `
      <section class="panel credential-reveal">
        <div class="panel-head"><h2>Removed</h2><button onclick="dismissAccountsNotice()">Dismiss</button></div>
        <p>${escapeHtml(notice.message)}</p>
      </section>
    `;
  }

  return `
    <section class="panel credential-reveal">
      <div class="panel-head"><h2>${notice.reset ? "Password reset" : "Login created"} for ${notice.name}</h2><button onclick="dismissAccountsNotice()">Dismiss</button></div>
      <p>Share these credentials with ${notice.name} now — the password will not be shown again.</p>
      <dl>
        <div><dt>Username (email)</dt><dd><code>${notice.email}</code></dd></div>
        <div><dt>Temporary password</dt><dd><code>${notice.password}</code></dd></div>
      </dl>
      <small>They will be asked to choose their own password the first time they sign in.</small>
    </section>
  `;
}

function escapeJs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function loadAccountsDirectory() {
  if (!hasSupabaseConfig() || !state.session) return;
  const base = config.supabaseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(
      `${base}/rest/v1/user_profiles?select=user_id,role,student_id,instructor_name,full_name,email,must_change_password`,
      {
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${state.session.access_token}`,
          Accept: "application/json",
        },
      },
    );
    state.accountsDirectory = response.ok ? await response.json() : [];
  } catch {
    state.accountsDirectory = [];
  }
}

async function loadLeads() {
  if (!hasSupabaseConfig() || !state.session) return;
  const base = config.supabaseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(
      `${base}/rest/v1/contact_requests?select=id,kind,name,email,phone,message,status,created_at&order=created_at.desc`,
      {
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${state.session.access_token}`,
          Accept: "application/json",
        },
      },
    );
    state.leadsDirectory = response.ok ? await response.json() : [];
  } catch {
    state.leadsDirectory = [];
  }
}

async function callAccountApi(payload) {
  const response = await fetch("/api/create-account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }
  return body;
}

// Removing an instructor or student always goes through this server
// endpoint (never a direct table delete from the browser) so the login is
// revoked in the same step as the school record — see api/remove-account.js.
async function removeAccountApi(payload) {
  if (!state.session) throw new Error("Sign in and try again.");
  const response = await fetch("/api/remove-account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }
  return body;
}

async function issueCredentials(key, role, email, name, refId) {
  state.accountsBusy = key;
  state.accountsNotice = null;
  renderContentOnly();
  try {
    const result = await callAccountApi({
      role,
      email,
      fullName: name,
      studentRef: role === "Student" ? refId : undefined,
      instructorRef: role === "Instructor" ? refId : undefined,
    });
    state.accountsNotice = { name, email: result.email, password: result.password, reset: result.reset };
    await loadAccountsDirectory();
  } catch (error) {
    state.accountsNotice = { type: "error", message: error.message };
  } finally {
    state.accountsBusy = null;
    renderContentOnly();
  }
}

async function generateCredentials(key, role, email, name, refId) {
  await issueCredentials(key, role, email, name, refId);
}

async function resetCredentials(key, role, email, name, refId) {
  await issueCredentials(key, role, email, name, refId);
}

function dismissAccountsNotice() {
  state.accountsNotice = null;
  renderContentOnly();
}

function recomputeInstructorClassIds() {
  if (state.viewerContext?.instructorName) {
    state.viewerContext.classIds = classes
      .filter((item) => item.instructor === state.viewerContext.instructorName)
      .map((item) => item.id);
  }
}

async function loadViewerProfile(user) {
  const base = config.supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${state.session.access_token}`,
    Accept: "application/json",
  };

  const profileResponse = await fetch(`${base}/rest/v1/user_profiles?user_id=eq.${user.id}&select=*`, { headers });
  const profileRows = profileResponse.ok ? await profileResponse.json() : [];
  const profile = profileRows[0];

  if (!profile) {
    state.authError = "This account is not linked to a school role yet. Ask an admin to set up your portal access.";
    state.session = null;
    storeSession(null);
    state.authMode = "signed-out";
    return;
  }

  state.profile = profile;
  state.role = profile.role;
  state.viewerContext = {
    studentId: profile.student_id || null,
    instructorName: profile.instructor_name || null,
    classIds: [],
    childStudentIds: [],
  };

  if (profile.role === "Parent") {
    const linksResponse = await fetch(
      `${base}/rest/v1/parent_student_links?parent_user_id=eq.${user.id}&select=student_id`,
      { headers },
    );
    const links = linksResponse.ok ? await linksResponse.json() : [];
    state.viewerContext.childStudentIds = links.map((link) => link.student_id);
  }

  state.view = "dashboard";
  state.authError = "";
  state.authMode = profile.must_change_password ? "force-password" : "signed-in";
}

async function hydrateSessionFromToken(session) {
  const user = await fetchCurrentUser(config, session.access_token);
  state.session = session;
  await loadViewerProfile(user);
}

async function bootstrapAuthSession() {
  const stored = loadStoredSession();
  if (!stored?.access_token) {
    state.authMode = "marketing";
    return;
  }
  try {
    await hydrateSessionFromToken(stored);
  } catch {
    try {
      const refreshed = await refreshSession(config, stored.refresh_token);
      await hydrateSessionFromToken(refreshed);
    } catch {
      storeSession(null);
      state.session = null;
      state.authMode = "marketing";
    }
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const email = form.email.value.trim();
  const password = form.password.value;
  state.authBusy = true;
  state.authError = "";
  render();
  try {
    const session = await signInWithPassword(config, email, password);
    await hydrateSessionFromToken(session);
    await loadFromSupabase(state.session?.access_token);
    recomputeInstructorClassIds();
    resetIdleTimer();
  } catch (error) {
    state.authError = error.message || "Could not sign in.";
    state.authMode = "signed-out";
  } finally {
    state.authBusy = false;
    render();
  }
}

async function handleSignOut() {
  clearIdleTimer();
  await authSignOut(config, state.session);
  state.session = null;
  state.profile = null;
  state.viewerContext = null;
  state.accountsDirectory = null;
  state.leadsDirectory = null;
  state.opportunitiesDirectory = null;
  state.staffRequestNotice = null;
  state.role = "Super Admin";
  state.view = "dashboard";
  state.authMode = "marketing";
  await loadFromSupabase();
  render();
}

// ---------------------------------------------------------------------
// Idle auto sign-out: signs a person out automatically after 3 minutes
// with no mouse, keyboard, touch, or scroll activity, so a school/library
// computer left unattended doesn't stay logged in to a real Manager,
// Instructor, or Student account. Only ever active while someone is
// actually signed in (`signed-in` or `force-password`) — it never fires
// on the public marketing page or the login screen itself.
// ---------------------------------------------------------------------

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
let idleTimer = null;
let idleActivityThrottleAt = 0;

function isAuthenticatedMode() {
  return Boolean(state.session) && (state.authMode === "signed-in" || state.authMode === "force-password");
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function resetIdleTimer() {
  clearIdleTimer();
  if (!isAuthenticatedMode()) return;
  idleTimer = setTimeout(handleIdleTimeout, IDLE_TIMEOUT_MS);
}

async function handleIdleTimeout() {
  // Guards against a stray fire racing a manual sign-out.
  if (!isAuthenticatedMode()) return;
  clearIdleTimer();
  await authSignOut(config, state.session);
  state.session = null;
  state.profile = null;
  state.viewerContext = null;
  state.accountsDirectory = null;
  state.leadsDirectory = null;
  state.opportunitiesDirectory = null;
  state.staffRequestNotice = null;
  state.role = "Super Admin";
  state.view = "dashboard";
  state.authMode = "signed-out";
  state.authError = "You were signed out after 3 minutes of inactivity. Please sign back in.";
  render();
}

// Throttled so a burst of mousemove/scroll events doesn't clear and
// reschedule the timer hundreds of times a second — resetting once a
// second is more than enough to track "is someone still here."
function onIdleActivity() {
  const now = Date.now();
  if (now - idleActivityThrottleAt < 1000) return;
  idleActivityThrottleAt = now;
  resetIdleTimer();
}

["mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"].forEach((type) => {
  window.addEventListener(type, onIdleActivity, { passive: true, capture: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resetIdleTimer();
});

async function handleForcePasswordSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const next = form.newPassword.value;
  const confirmValue = form.confirmPassword.value;
  state.authError = "";

  if (next.length < 8) {
    state.authError = "Choose a password with at least 8 characters.";
    render();
    return;
  }
  if (next !== confirmValue) {
    state.authError = "Passwords do not match.";
    render();
    return;
  }

  state.authBusy = true;
  render();
  try {
    await authChangePassword(config, state.session.access_token, next);
    const base = config.supabaseUrl.replace(/\/$/, "");
    await fetch(`${base}/rest/v1/rpc/mark_password_changed`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    state.profile.must_change_password = false;
    state.authMode = "signed-in";
    resetIdleTimer();
  } catch (error) {
    state.authError = error.message || "Could not update your password.";
  } finally {
    state.authBusy = false;
    render();
  }
}

window.navigate = navigate;
window.setSearch = setSearch;
window.beginLogin = beginLogin;
window.backToMarketing = backToMarketing;
window.handleContactSubmit = handleContactSubmit;
window.dismissContactNotice = dismissContactNotice;
window.handleReviewSubmit = handleReviewSubmit;
window.dismissReviewNotice = dismissReviewNotice;
window.setReviewStatus = setReviewStatus;
window.handleLoginSubmit = handleLoginSubmit;
window.handleSignOut = handleSignOut;
window.handleForcePasswordSubmit = handleForcePasswordSubmit;
window.generateCredentials = generateCredentials;
window.resetCredentials = resetCredentials;
window.dismissAccountsNotice = dismissAccountsNotice;
window.dismissPromoModal = dismissPromoModal;
window.openPromoForm = openPromoForm;
window.openModal = openModal;
window.closeModal = closeModal;
window.handleAddClass = handleAddClass;
window.handleAddInstructor = handleAddInstructor;
window.handleAddStudent = handleAddStudent;
window.handleAddManager = handleAddManager;
window.handleAddGroup = handleAddGroup;
window.handleAddMaterial = handleAddMaterial;
window.handleAddAssignment = handleAddAssignment;
window.renderModalGroupOptions = renderModalGroupOptions;
window.renderAssignmentGroupOptions = renderAssignmentGroupOptions;
window.supabaseDownloadFile = supabaseDownloadFile;
window.selectStudent = selectStudent;
window.setStudentClassFilter = setStudentClassFilter;
window.exportStudentsCsv = exportStudentsCsv;
window.renderAttendanceRoster = renderAttendanceRoster;
window.handleTakeAttendance = handleTakeAttendance;
window.toggleStaffRequestFields = toggleStaffRequestFields;
window.handleAddStaffRequest = handleAddStaffRequest;
window.setStaffRequestStatus = setStaffRequestStatus;
window.approveRemovalRequest = approveRemovalRequest;
window.dismissStaffRequestNotice = dismissStaffRequestNotice;
window.exportReportsCsv = exportReportsCsv;
window.handleSaveSettings = handleSaveSettings;
window.handleRemoveInstructor = handleRemoveInstructor;
window.handleRemoveStudent = handleRemoveStudent;
window.handleAddOpportunity = handleAddOpportunity;
window.setOpportunityStatus = setOpportunityStatus;
window.removeOpportunity = removeOpportunity;
window.dismissOpportunitiesNotice = dismissOpportunitiesNotice;
window.openOpportunityDetail = openOpportunityDetail;
window.closeOpportunityDetail = closeOpportunityDetail;

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!state.promoModalDismissed && state.authMode === "marketing") {
    dismissPromoModal();
    return;
  }
  if (state.modal) closeModal();
});

// Registered once, not per-render: re-queries the nav each scroll instead
// of capturing a reference, so it keeps working across full re-renders of
// #app without leaking a new listener every time.
window.addEventListener(
  "scroll",
  () => {
    const nav = document.querySelector(".m-nav");
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
  },
  { passive: true },
);

async function initApp() {
  render();
  loadPublicReviews().then(() => {
    if (state.authMode === "marketing") render();
  });
  loadPublicOpportunities().then(() => {
    applyOpportunityHash();
    if (state.authMode === "marketing") render();
  });

  if (!hasSupabaseConfig()) {
    state.authMode = "marketing";
    await loadFromSupabase();
    render();
    return;
  }

  await bootstrapAuthSession();
  await loadFromSupabase(state.session?.access_token);
  recomputeInstructorClassIds();
  resetIdleTimer();
  render();
}

initApp();
