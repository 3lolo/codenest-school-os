import {
  canAccessModule,
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
};

const config = window.CODENEST_CONFIG || {};
const dataSource = {
  label: "Not connected",
  status: "Connect Supabase to load your school's data.",
  error: "",
};

const navItems = [
  ["dashboard", "Dashboard", "grid"],
  ["students", "Students", "users"],
  ["families", "Families", "home"],
  ["classes", "Classes", "layers"],
  ["assignments", "Assignments", "clipboard"],
  ["attendance", "Attendance", "check"],
  ["communications", "Messages", "message"],
  ["reports", "Reports", "chart"],
  ["notifications", "Notifications", "bell"],
  ["accounts", "Accounts & Logins", "key"],
  ["leads", "Contact Requests", "message"],
  ["settings", "Settings", "gear"],
  ["audit", "Audit", "shield"],
];

// Production defaults. Nothing here is sample/demo content — every list
// starts empty and is populated from Supabase once someone signs in.
// `school` holds the editable defaults for a brand-new deployment before
// a Manager opens Settings and changes them.
let school = {
  name: "CodeNest Academy",
  portalUrl: "",
  settings: {
    absenceThreshold: 3,
    parentAssignmentEmails: true,
    dueSoonHours: 24,
    maxUploadMb: 25,
  },
};

let people = {
  students: [],
  parents: [],
  instructors: [],
};

let classes = [];
let assignments = [];
let communications = [];
let auditLogs = [];
let notifications = [];

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
};

function can(view) {
  return canAccessModule(state.role, view);
}

function navigate(view) {
  if (!can(view)) return;
  state.view = view;
  render();
  if (view === "accounts" && canManageAccounts()) {
    loadAccountsDirectory().then(renderContentOnly);
  }
  if (view === "leads" && canManageAccounts()) {
    loadLeads().then(renderContentOnly);
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
  const unread = notifications.filter((item) => item.unread).length;
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">CN</div>
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
          <input type="search" placeholder="Students, parents, classes, assignments" value="${state.query}" oninput="setSearch(this.value)" />
        </label>
        <button class="notification-button" onclick="navigate('notifications')" aria-label="${unread} unread notifications">
          <span>${icons.bell}</span>
          ${unread ? `<b>${unread}</b>` : ""}
        </button>
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
  `;
}

function titleForView() {
  return {
    dashboard: `${roleLabel(state.role)} Dashboard`,
    students: state.role === "Parent" ? "Linked Children" : "Student Management",
    families: "Family Management",
    classes: "Courses and Classes",
    assignments: "Assignment Center",
    attendance: "Attendance",
    communications: "Communication Center",
    reports: "Reports",
    notifications: "Notification Center",
    accounts: state.role === "Instructor" ? "Student Logins" : "Accounts & Logins",
    leads: "Contact Requests",
    settings: "School Settings",
    audit: "Audit Logs",
  }[state.view];
}

function content() {
  if (state.query) return searchResults();
  return {
    dashboard: dashboard(),
    students: students(),
    families: families(),
    classes: classesView(),
    assignments: assignmentsView(),
    attendance: attendanceView(),
    communications: communicationsView(),
    reports: reportsView(),
    notifications: notificationsView(),
    accounts: accountsView(),
    leads: leadsView(),
    settings: settingsView(),
    audit: auditView(),
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
      ${communicationTimeline()}
    </div>
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
      ${metric("Messages", communications.length, "In communication history")}
    </div>
    <div class="two-col">${studentProfile(child)}${communicationTimeline()}</div>
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
  const list = filterStudentsForViewer(currentViewer(), people.students);
  return `
    <div class="toolbar">
      <button>New student</button>
      <button>Invite parent</button>
      <button>Export</button>
    </div>
    <div class="split">
      <section class="panel table-panel">
        <table>
          <thead><tr><th>Student</th><th>Class</th><th>Attendance</th><th>Grade</th><th>Status</th></tr></thead>
          <tbody>
            ${list.map((s) => `<tr><td><strong>${fullName(s)}</strong><span>${s.email}</span></td><td>${className(s.classId)}</td><td>${s.attendance}%</td><td>${s.avgGrade}%</td><td>${badge(s.status)}</td></tr>`).join("")}
          </tbody>
        </table>
      </section>
      ${list.length ? studentProfile(list[0]) : `<section class="panel"><p class="empty">No students to show yet.</p></section>`}
    </div>
  `;
}

function studentProfile(student) {
  if (!student) return `<section class="panel"><p class="empty">No student selected.</p></section>`;
  return `
    <section class="panel profile">
      <div class="profile-hero compact"><div class="avatar">${student.first[0]}${student.last[0]}</div><div><h2>${fullName(student)}</h2><span>${student.id} · ${student.status}</span></div></div>
      <dl>
        <div><dt>Email</dt><dd>${student.email}</dd></div>
        <div><dt>Phone</dt><dd>${student.phone}</dd></div>
        <div><dt>Family</dt><dd>${student.family}</dd></div>
        <div><dt>Parent</dt><dd>${student.parent}</dd></div>
        <div><dt>Level</dt><dd>${student.level}</dd></div>
        <div><dt>Notes</dt><dd>${student.notes}</dd></div>
      </dl>
    </section>
  `;
}

function className(id) {
  return classes.find((item) => item.id === id)?.name || "Unassigned";
}

function families() {
  return `
    <div class="toolbar"><button>New family</button><button>Link child</button><button>Send activation</button></div>
    <section class="panel table-panel">
      <table>
        <thead><tr><th>Guardian</th><th>Children</th><th>Preference</th><th>Status</th></tr></thead>
        <tbody>${people.parents.map((p) => `<tr><td><strong>${p.name}</strong><span>${p.email}</span></td><td>${p.children.join(", ")}</td><td>${p.preference}</td><td>${badge(p.status)}</td></tr>`).join("")}</tbody>
      </table>
    </section>
  `;
}

function classesView() {
  return `
    <div class="toolbar"><button>New course</button><button>New class</button><button>Schedule event</button></div>
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
        </article>
      `).join("")}
    </div>
  `;
}

function assignmentsView() {
  return `
    <div class="toolbar"><button>New assignment</button><button>Publish draft</button><button>Grade queue</button></div>
    ${assignmentPanel()}
  `;
}

function assignmentPanel() {
  return `
    <section class="panel table-panel">
      <div class="panel-head"><h2>Assignments</h2><button>View submissions</button></div>
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
  return `
    <div class="toolbar"><button>Take attendance</button><button>Notify absences</button><button>Configure threshold</button></div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>Attendance Watchlist</h2><span>Threshold: ${school.settings.absenceThreshold} absences</span></div>
      <table>
        <thead><tr><th>Student</th><th>Class</th><th>Attendance</th><th>Absences</th><th>Late</th><th>Action</th></tr></thead>
        <tbody>
          ${people.students.map((s) => `<tr><td><strong>${fullName(s)}</strong><span>${s.parent}</span></td><td>${className(s.classId)}</td><td>${s.attendance}%</td><td>${s.absences}</td><td>${s.late}</td><td>${s.absences >= school.settings.absenceThreshold ? badge("Notify") : badge("Monitor")}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function communicationsView() {
  return `
    <div class="toolbar"><button>Compose</button><button>Class announcement</button><button>School-wide</button></div>
    ${communicationTimeline()}
  `;
}

function communicationTimeline() {
  return `
    <section class="panel">
      <div class="panel-head"><h2>Communication History</h2><button>Open queue</button></div>
      <div class="timeline">
        ${communications.map((item) => `<article><span>${item.time}</span><strong>${item.subject}</strong><small>${item.type} · ${item.recipient} · ${item.status}</small></article>`).join("")}
      </div>
    </section>
  `;
}

function reportsView() {
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const pausedStudents = people.students.filter((s) => s.status === "Paused").length;
  const attendanceAlerts = people.students.filter((s) => s.absences >= school.settings.absenceThreshold).length;
  const lateArrivals = people.students.reduce((sum, s) => sum + (s.late || 0), 0);
  const pending = assignments.reduce((sum, a) => sum + Math.max(a.total - a.submissions, 0), 0);
  const unreadNotifications = notifications.filter((n) => n.unread).length;

  return `
    <div class="toolbar"><button>Export CSV</button><button>Export PDF</button><button>Schedule report</button></div>
    <div class="report-grid">
      <section class="panel">${reportBlock("Enrollment", [["Active", activeStudents], ["Paused", pausedStudents], ["Total", people.students.length]])}</section>
      <section class="panel">${reportBlock("Attendance", [["Average", `${average(people.students.map((s) => s.attendance))}%`], ["At risk", attendanceAlerts], ["Late arrivals", lateArrivals]])}</section>
      <section class="panel">${reportBlock("Academic", [["Completion", `${average(classes.map((c) => c.completion))}%`], ["Average grade", `${average(people.students.map((s) => s.avgGrade))}%`], ["Ungraded", pending]])}</section>
      <section class="panel">${reportBlock("Notifications", [["Total", notifications.length], ["Unread", unreadNotifications], ["Read", notifications.length - unreadNotifications]])}</section>
    </div>
  `;
}

function reportBlock(title, rows) {
  return `<div class="panel-head"><h2>${title}</h2><button>Filter</button></div>${rows.map(([label, value]) => `<div class="report-row"><span>${label}</span><strong>${value}</strong></div>`).join("")}`;
}

function notificationsView() {
  return `
    <div class="toolbar"><button>Mark all read</button><button>Preferences</button><button>Email templates</button></div>
    <section class="panel">
      ${notifications.map((n) => `<article class="notification ${n.unread ? "unread" : ""}"><span>${n.type}</span><strong>${n.title}</strong><small>${n.time}</small></article>`).join("")}
    </section>
  `;
}

function settingsView() {
  return `
    <div class="settings-grid">
      <section class="panel"><h2>School</h2><label>School name<input value="${school.name}" /></label><label>Portal URL<input value="${school.portalUrl}" /></label></section>
      <section class="panel"><h2>Notifications</h2><label>Absence threshold<input type="number" value="${school.settings.absenceThreshold}" /></label><label>Due soon hours<input type="number" value="${school.settings.dueSoonHours}" /></label><label class="checkline"><input type="checkbox" checked /> Parent assignment emails</label></section>
      <section class="panel"><h2>Security</h2><label class="checkline"><input type="checkbox" checked /> Require activation links</label><label class="checkline"><input type="checkbox" checked /> Force first-login password change</label><label>Upload limit MB<input type="number" value="${school.settings.maxUploadMb}" /></label><p class="hint">Issue or reset an individual instructor/student username and password from <button onclick="navigate('accounts')">Accounts &amp; Logins</button>.</p></section>
    </div>
  `;
}

function auditView() {
  return `
    <section class="panel table-panel">
      <table>
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Metadata</th></tr></thead>
        <tbody>${auditLogs.map((log) => `<tr><td>${log.time}</td><td>${log.actor}</td><td><code>${log.action}</code></td><td>${log.entity}</td><td>${log.meta}</td></tr>`).join("")}</tbody>
      </table>
    </section>
  `;
}

function searchResults() {
  const term = state.query;
  const viewer = currentViewer();
  const rows = safeSearchRowsForViewer(viewer, [
    ...people.students.map((s) => ({ type: "Student", title: fullName(s), detail: `${s.email} · ${className(s.classId)}`, student: s, moduleId: "students" })),
    ...people.parents.map((p) => ({ type: "Parent", title: p.name, detail: `${p.email} · ${p.children.join(", ")}`, familyOnly: true, moduleId: "families" })),
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

async function loadFromSupabase(token) {
  if (!hasSupabaseConfig()) return;

  try {
    const [settingsRows, studentRows, parentRows, instructorRows, classRows, assignmentRows, communicationRows, auditRows, notificationRows] = await Promise.all([
      supabaseSelect("school_settings", "*", token),
      supabaseSelect("students", "*", token),
      supabaseSelect("parents", "*", token),
      supabaseSelect("instructors", "*", token),
      supabaseSelect("classes", "*", token),
      supabaseSelect("assignments", "*", token),
      supabaseSelect("communications", "*", token),
      supabaseSelect("audit_logs", "*", token),
      supabaseSelect("notifications", "*", token),
    ]);

    const settings = settingsRows[0];
    if (settings) {
      school = {
        name: settings.name,
        portalUrl: settings.portal_url,
        settings: settings.settings,
      };
    }

    people = {
      students: studentRows.map((student) => ({
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
      parents: parentRows.map((parent) => ({
        name: parent.name,
        email: parent.email,
        children: parent.children || [],
        preference: parent.preference,
        status: parent.status,
      })),
      instructors: instructorRows.map((instructor) => ({
        name: instructor.name,
        email: instructor.email,
        classes: instructor.classes || [],
        status: instructor.status,
      })),
    };

    classes = classRows.map((item) => ({
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

    assignments = assignmentRows.map((assignment) => ({
      title: assignment.title,
      course: assignment.course,
      className: assignment.class_name,
      due: assignment.due_date,
      status: assignment.status,
      submissions: assignment.submissions,
      total: assignment.total,
      maxGrade: assignment.max_grade,
      difficulty: assignment.difficulty,
    }));

    communications = communicationRows.map((message) => ({
      type: message.type,
      recipient: message.recipient,
      subject: message.subject,
      time: message.display_time,
      status: message.status,
    }));

    auditLogs = auditRows.map((log) => ({
      actor: log.actor,
      action: log.action,
      entity: log.entity,
      time: log.display_time,
      meta: log.meta,
    }));

    notifications = notificationRows.map((notification) => ({
      type: notification.type,
      title: notification.title,
      time: notification.display_time,
      unread: notification.unread,
    }));

    dataSource.label = "Supabase connected";
    dataSource.status = "Live data loaded from Supabase";
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
}

function appShell() {
  if (state.authMode === "checking") return authLoadingScreen();
  if (state.authMode === "marketing") return marketingScreen();
  if (state.authMode === "not-configured") return notConfiguredScreen();
  if (state.authMode === "signed-out") return loginScreen();
  if (state.authMode === "force-password") return forcePasswordScreen();
  return shell();
}

function authLoadingScreen() {
  return `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="brand-mark">CN</div>
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
        <div class="brand-mark">CN</div>
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
        <div class="brand-mark">CN</div>
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
        <div class="brand-mark">CN</div>
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

const sampleReviews = [
  {
    quote: "We went from three spreadsheets and a shared inbox to one place where every instructor knows exactly which students are theirs.",
    name: "Director, mid-size coding bootcamp",
    tag: "Sample review",
  },
  {
    quote: "Being able to hand an instructor the ability to set up their own students' logins — without giving them access to billing or settings — was the feature that sold us.",
    name: "Operations lead, after-school coding program",
    tag: "Sample review",
  },
  {
    quote: "Parents stopped emailing us asking for their kid's password. The reset flow just works.",
    name: "School admin, weekend coding academy",
    tag: "Sample review",
  },
];

const compareRows = [
  ["Every person signs in with their own username & password", "check", "cross", "partial"],
  ["Row-level security enforced in the database, not just the UI", "check", "cross", "cross"],
  ["Instructors can create student logins for their own classes only", "check", "cross", "cross"],
  ["Attendance, grading, and messaging in one place", "check", "partial", "check"],
  ["Deploys to your own Vercel + Supabase project (you own the data)", "check", "cross", "cross"],
];

function compareIcon(kind) {
  if (kind === "check") return `<span class="cmp-icon cmp-yes" title="Yes">&#10003;</span>`;
  if (kind === "partial") return `<span class="cmp-icon cmp-partial" title="Partially">&#8213;</span>`;
  return `<span class="cmp-icon cmp-no" title="No">&#10005;</span>`;
}

function marketingScreen() {
  const notice = state.contactNotice;
  return `
    <div class="marketing">
      <header class="m-nav">
        <div class="brand">
          <div class="brand-mark">CN</div>
          <strong>${school.name}</strong>
        </div>
        <nav class="m-nav-links" aria-label="Marketing navigation">
          <a href="#features">Features</a>
          <a href="#compare">Compare</a>
          <a href="#reviews">Reviews</a>
          <a href="#contact">Contact</a>
        </nav>
        <button class="m-login-button" onclick="beginLogin()">Login</button>
      </header>

      <section class="m-hero">
        <p class="eyebrow">Coding school management platform</p>
        <h1>Run your coding school without the spreadsheet chaos</h1>
        <p class="m-sub">Manager, Instructor, and Student accounts with real per-person logins, role-based access, attendance, assignments, and reporting — deployable on your own Vercel + Supabase project.</p>
        <div class="m-hero-actions">
          <button class="m-cta-primary" onclick="beginLogin()">Login to your portal</button>
          <a class="m-cta-secondary" href="#contact">Request a call</a>
        </div>
      </section>

      <section id="features" class="m-section">
        <h2>Built around three account types</h2>
        <p class="m-sub">Every account is scoped to exactly what that person should see and do.</p>
        <div class="m-cards">
          <article class="m-card">
            <h3>Manager</h3>
            <p>Full school operations: creates Instructor and Student accounts, manages classes, reports, settings, and contact requests.</p>
          </article>
          <article class="m-card">
            <h3>Instructor</h3>
            <p>Manages assigned classes and can create Student accounts for their own students — nothing outside their scope.</p>
          </article>
          <article class="m-card">
            <h3>Student</h3>
            <p>Signs in with their own username and password to see assignments, attendance, and grades.</p>
          </article>
        </div>
      </section>

      <section id="compare" class="m-section">
        <h2>How it compares</h2>
        <p class="m-sub"><span class="sample-tag">Sample comparison</span> — a general picture of how a dedicated platform like this stacks up against common alternatives. Edit freely once you know your real competitors.</p>
        <div class="table-panel">
          <table class="m-compare">
            <thead><tr><th></th><th>${school.name}</th><th>Spreadsheets &amp; email</th><th>Generic LMS</th></tr></thead>
            <tbody>
              ${compareRows.map(([label, a, b, c]) => `<tr><td>${label}</td><td>${compareIcon(a)}</td><td>${compareIcon(b)}</td><td>${compareIcon(c)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section id="reviews" class="m-section">
        <h2>What schools say</h2>
        <p class="m-sub"><span class="sample-tag">Sample reviews</span> — replace these with real feedback from your instructors and families.</p>
        <div class="m-cards">
          ${sampleReviews.map((review) => `
            <article class="m-card m-review">
              <p>&ldquo;${review.quote}&rdquo;</p>
              <strong>${review.name}</strong>
            </article>
          `).join("")}
        </div>
      </section>

      <section id="contact" class="m-section m-contact">
        <div class="m-contact-grid">
          <div>
            <h2>Contact us</h2>
            <p class="m-sub">Questions about setting up your school, or want a walkthrough before you commit? Send a message or request a call back.</p>
          </div>
          <form class="m-contact-form" onsubmit="handleContactSubmit(event)">
            ${notice ? `<p class="${notice.type === "error" ? "auth-error" : "m-success"}">${notice.message}</p>` : ""}
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
        <span>&copy; ${new Date().getFullYear()} ${school.name}</span>
        <button class="m-login-button" onclick="beginLogin()">Login</button>
      </footer>
    </div>
  `;
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

function canManageAccounts() {
  return ["Super Admin", "School Admin", "Instructor"].includes(state.role);
}

function accountsView() {
  const isInstructor = state.role === "Instructor";
  const directory = state.accountsDirectory;
  const accountFor = (kind, refId) =>
    directory?.find((row) => (kind === "Student" ? row.student_id === refId : row.instructor_name === refId));

  const instructorRows = isInstructor
    ? []
    : people.instructors.map((instructor) =>
        accountRow({
          key: `instructor-${instructor.name}`,
          role: "Instructor",
          name: instructor.name,
          email: instructor.email,
          refId: instructor.name,
          account: accountFor("Instructor", instructor.name),
        }),
      );

  const visibleStudents = isInstructor ? filterStudentsForViewer(currentViewer(), people.students) : people.students;
  const studentRows = visibleStudents.map((student) =>
    accountRow({
      key: `student-${student.id}`,
      role: "Student",
      name: fullName(student),
      email: student.email,
      refId: student.id,
      account: accountFor("Student", student.id),
    }),
  );

  return `
    ${state.accountsNotice ? accountsNoticeBanner(state.accountsNotice) : ""}
    ${isInstructor ? `<p class="hint">You can issue or reset a login for students in your own classes only. Ask a Manager for instructor accounts.</p>` : ""}
    <section class="panel table-panel">
      <div class="panel-head"><h2>${isInstructor ? "Student Logins" : "Instructor &amp; Student Logins"}</h2><span>${directory ? directory.length : 0} accounts issued</span></div>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Username (email)</th><th>Portal access</th><th>Action</th></tr></thead>
        <tbody>${[...instructorRows, ...studentRows].join("") || `<tr><td colspan="5" class="empty">No accounts to manage yet.</td></tr>`}</tbody>
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
              (lead) => `<tr><td>${new Date(lead.created_at).toLocaleString()}</td><td>${badge(lead.kind === "call_request" ? "Call requested" : "Contact")}</td><td><strong>${lead.name}</strong></td><td>${lead.email}</td><td>${lead.phone || "—"}</td><td>${lead.message || "—"}</td></tr>`,
            )
            .join("") || `<tr><td colspan="6" class="empty">No messages yet.</td></tr>`
        }</tbody>
      </table>
    </section>
  `;
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
        <p>${notice.message}</p>
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
  } catch (error) {
    state.authError = error.message || "Could not sign in.";
    state.authMode = "signed-out";
  } finally {
    state.authBusy = false;
    render();
  }
}

async function handleSignOut() {
  await authSignOut(config, state.session);
  state.session = null;
  state.profile = null;
  state.viewerContext = null;
  state.accountsDirectory = null;
  state.leadsDirectory = null;
  state.role = "Super Admin";
  state.view = "dashboard";
  state.authMode = "marketing";
  await loadFromSupabase();
  render();
}

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
window.handleLoginSubmit = handleLoginSubmit;
window.handleSignOut = handleSignOut;
window.handleForcePasswordSubmit = handleForcePasswordSubmit;
window.generateCredentials = generateCredentials;
window.resetCredentials = resetCredentials;
window.dismissAccountsNotice = dismissAccountsNotice;

async function initApp() {
  render();

  if (!hasSupabaseConfig()) {
    state.authMode = "marketing";
    await loadFromSupabase();
    render();
    return;
  }

  await bootstrapAuthSession();
  await loadFromSupabase(state.session?.access_token);
  recomputeInstructorClassIds();
  render();
}

initApp();
