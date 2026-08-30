import {
  canAccessModule,
  filterStudentsForViewer,
  permissions,
  roleLabel,
  roles,
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
  authMode: "checking", // "checking" | "marketing" | "demo" | "signed-out" | "force-password" | "signed-in"
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
  label: "Demo data",
  status: "Using built-in sample data",
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

let school = {
  name: "CodeNest Academy",
  portalUrl: "https://portal.codenest.school",
  settings: {
    absenceThreshold: 3,
    parentAssignmentEmails: true,
    dueSoonHours: 24,
    maxUploadMb: 25,
  },
};

let people = {
  students: [
    {
      id: "STU-1001",
      first: "Maya",
      last: "Hassan",
      email: "maya.hassan@student.codenest.school",
      phone: "+20 100 233 9911",
      dob: "2012-04-18",
      status: "Active",
      level: "Python Foundations",
      family: "Hassan Family",
      parent: "Nour Hassan",
      classId: "CLS-PY-A",
      progress: 84,
      attendance: 94,
      avgGrade: 91,
      absences: 1,
      late: 2,
      notes: "Strong project instincts; benefits from stretch debugging tasks.",
    },
    {
      id: "STU-1002",
      first: "Omar",
      last: "Saleh",
      email: "omar.saleh@student.codenest.school",
      phone: "+20 111 802 4112",
      dob: "2011-09-07",
      status: "Active",
      level: "Web Apps",
      family: "Saleh Family",
      parent: "Dina Saleh",
      classId: "CLS-WEB-B",
      progress: 71,
      attendance: 87,
      avgGrade: 82,
      absences: 3,
      late: 1,
      notes: "Needs follow-up on async JavaScript and project pacing.",
    },
    {
      id: "STU-1003",
      first: "Lina",
      last: "Farouk",
      email: "lina.farouk@student.codenest.school",
      phone: "+20 122 918 7044",
      dob: "2013-01-26",
      status: "Active",
      level: "Scratch to Python",
      family: "Farouk Family",
      parent: "Karim Farouk",
      classId: "CLS-SC-C",
      progress: 62,
      attendance: 76,
      avgGrade: 78,
      absences: 4,
      late: 3,
      notes: "Attendance alert triggered; parent check-in recommended.",
    },
    {
      id: "STU-1004",
      first: "Youssef",
      last: "Adel",
      email: "youssef.adel@student.codenest.school",
      phone: "+20 101 481 6110",
      dob: "2010-12-02",
      status: "Paused",
      level: "Robotics",
      family: "Adel Family",
      parent: "Salma Adel",
      classId: "CLS-ROB-A",
      progress: 48,
      attendance: 81,
      avgGrade: 74,
      absences: 2,
      late: 0,
      notes: "Paused for exam month; resume plan needed.",
    },
  ],
  parents: [
    { name: "Nour Hassan", email: "nour.hassan@example.com", children: ["Maya Hassan"], preference: "Email + in-app", status: "Active" },
    { name: "Dina Saleh", email: "dina.saleh@example.com", children: ["Omar Saleh"], preference: "Email", status: "Invited" },
    { name: "Karim Farouk", email: "karim.farouk@example.com", children: ["Lina Farouk"], preference: "Email + SMS", status: "Active" },
    { name: "Salma Adel", email: "salma.adel@example.com", children: ["Youssef Adel"], preference: "Email", status: "Active" },
  ],
  instructors: [
    { name: "Amina Nabil", email: "amina@codenest.school", classes: ["Python Beginners - Group A"], status: "Active" },
    { name: "Mostafa Kamal", email: "mostafa@codenest.school", classes: ["Web Apps - Group B"], status: "Active" },
    { name: "Heba Sami", email: "heba@codenest.school", classes: ["Scratch Creators - Group C"], status: "Active" },
  ],
};

let classes = [
  { id: "CLS-PY-A", name: "Python Beginners - Group A", course: "Python Programming", instructor: "Amina Nabil", students: 14, schedule: "Mon/Wed 5:00 PM", room: "Lab 2", status: "Active", completion: 58 },
  { id: "CLS-WEB-B", name: "Web Apps - Group B", course: "Frontend Web Apps", instructor: "Mostafa Kamal", students: 12, schedule: "Tue/Thu 6:00 PM", room: "Lab 1", status: "Active", completion: 46 },
  { id: "CLS-SC-C", name: "Scratch Creators - Group C", course: "Scratch to Python", instructor: "Heba Sami", students: 16, schedule: "Sat 11:00 AM", room: "Studio", status: "Active", completion: 32 },
  { id: "CLS-ROB-A", name: "Robotics - Group A", course: "Robotics Lab", instructor: "Amina Nabil", students: 8, schedule: "Fri 2:00 PM", room: "Maker Room", status: "Paused", completion: 41 },
];

let assignments = [
  { title: "Build a Number Guessing Game", course: "Python Programming", className: "Python Beginners - Group A", due: "2026-08-28", status: "Published", submissions: 9, total: 14, maxGrade: 100, difficulty: "Core" },
  { title: "Responsive Portfolio Page", course: "Frontend Web Apps", className: "Web Apps - Group B", due: "2026-08-26", status: "Published", submissions: 5, total: 12, maxGrade: 100, difficulty: "Stretch" },
  { title: "Sprite Storyboard", course: "Scratch to Python", className: "Scratch Creators - Group C", due: "2026-08-30", status: "Draft", submissions: 0, total: 16, maxGrade: 50, difficulty: "Intro" },
];

let communications = [
  { type: "Assignment", recipient: "Python Beginners - Group A", subject: "New assignment published", time: "Today 10:15", status: "Delivered" },
  { type: "Attendance", recipient: "Karim Farouk", subject: "Attendance warning for Lina Farouk", time: "Yesterday 18:30", status: "Opened" },
  { type: "Announcement", recipient: "All families", subject: "September schedule update", time: "Aug 21, 2026", status: "Queued" },
  { type: "Welcome", recipient: "Dina Saleh", subject: "Parent portal activation", time: "Aug 20, 2026", status: "Failed retrying" },
];

let auditLogs = [
  { actor: "Sara Admin", action: "student.created", entity: "STU-1004", time: "2026-08-23 12:13", meta: "Activation link generated" },
  { actor: "Amina Nabil", action: "assignment.published", entity: "Build a Number Guessing Game", time: "2026-08-23 10:14", meta: "Parent notifications enabled" },
  { actor: "System", action: "notification.retry_scheduled", entity: "email-log-8831", time: "2026-08-22 09:42", meta: "Attempt 2 of 5" },
  { actor: "Mostafa Kamal", action: "grade.updated", entity: "Omar Saleh", time: "2026-08-21 17:20", meta: "Score changed from 78 to 82" },
];

let notifications = [
  { type: "Attendance warning", title: "Lina Farouk reached the absence threshold", time: "12 min ago", unread: true },
  { type: "Submission", title: "5 portfolios are ready for grading", time: "46 min ago", unread: true },
  { type: "Payment", title: "3 invoices are overdue", time: "2 hr ago", unread: false },
  { type: "System", title: "Email retry queue has 1 failed delivery", time: "Yesterday", unread: false },
];

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

function setRole(role) {
  if (state.authMode !== "demo") return;
  state.role = role;
  if (!can(state.view)) state.view = "dashboard";
  render();
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
    studentId: "STU-1001",
    childStudentIds: ["STU-1001"],
    classIds: ["CLS-PY-A", "CLS-ROB-A"],
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
        ${state.authMode === "demo" ? `
        <label class="role-switcher">
          <span>Preview role</span>
          <select onchange="setRole(this.value)">
            ${roles.map((role) => `<option value="${role}" ${role === state.role ? "selected" : ""}>${role === "Super Admin" ? "Manager (Super Admin)" : role === "School Admin" ? "Manager (School Admin)" : role}</option>`).join("")}
          </select>
        </label>
        ` : `
        <div class="account-chip">
          <div>
            <strong>${state.profile?.full_name || state.session?.user?.email || roleLabel(state.role)}</strong>
            <span>${roleLabel(state.role)}</span>
          </div>
          <button onclick="handleSignOut()">Sign out</button>
        </div>
        `}
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

function adminDashboard() {
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const pending = assignments.reduce((sum, a) => sum + (a.total - a.submissions), 0);
  return `
    <div class="metric-grid">
      ${metric("Total students", people.students.length, "+2 this week")}
      ${metric("Active students", activeStudents, "94% retained")}
      ${metric("Active classes", classes.filter((c) => c.status === "Active").length, "4 labs scheduled")}
      ${metric("Pending submissions", pending, "Needs grading")}
      ${metric("Attendance today", "89%", "3 absence alerts")}
      ${metric("Outstanding payments", "$2,420", "6 family accounts")}
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Action Queue</h2><button>Review all</button></div>
        ${action("High", "Lina Farouk attendance threshold reached", "Notify parent and schedule check-in")}
        ${action("Medium", "5 Web Apps submissions are ungraded", "Instructor follow-up")}
        ${action("Medium", "Parent activation email failed", "Retry from email queue")}
        ${action("Low", "Robotics class paused", "Confirm September resume date")}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Performance Overview</h2><button>Export</button></div>
        ${chartRow("Attendance", 89)}
        ${chartRow("Assignment completion", 66)}
        ${chartRow("Average grade", 83)}
        ${chartRow("Parent portal activation", 75)}
      </section>
    </div>
    <div class="two-col">
      ${recentStudents()}
      ${communicationTimeline()}
    </div>
  `;
}

function instructorDashboard() {
  return `
    <div class="metric-grid">
      ${metric("Assigned classes", 2, "Python + Robotics")}
      ${metric("Students", 22, "18 active")}
      ${metric("To grade", 8, "Due this week")}
      ${metric("Attendance alerts", 2, "Follow-up needed")}
    </div>
    <div class="two-col">
      ${assignmentPanel()}
      <section class="panel">
        <div class="panel-head"><h2>Today</h2><button>Take attendance</button></div>
        ${classes.slice(0, 2).map((item) => `<div class="class-row"><strong>${item.name}</strong><span>${item.schedule} · ${item.room}</span>${pct(item.completion)}</div>`).join("")}
      </section>
    </div>
  `;
}

function studentDashboard() {
  const student = people.students[0];
  return `
    <div class="profile-hero">
      <div class="avatar">${student.first[0]}${student.last[0]}</div>
      <div><p class="eyebrow">Student Portal</p><h2>${fullName(student)}</h2><span>${student.level} · ${student.email}</span></div>
    </div>
    <div class="metric-grid">
      ${metric("Progress", `${student.progress}%`, "On track")}
      ${metric("Attendance", `${student.attendance}%`, "1 absence")}
      ${metric("Average grade", `${student.avgGrade}%`, "Strong")}
      ${metric("Open assignments", 2, "1 due soon")}
    </div>
    ${assignmentPanel()}
  `;
}

function parentDashboard() {
  const child = people.students[0];
  return `
    <div class="profile-hero">
      <div class="avatar">NH</div>
      <div><p class="eyebrow">Parent Portal</p><h2>Nour Hassan</h2><span>Viewing linked child: ${fullName(child)}</span></div>
    </div>
    <div class="metric-grid">
      ${metric("Child attendance", `${child.attendance}%`, "Healthy")}
      ${metric("Average grade", `${child.avgGrade}%`, "Latest grade published")}
      ${metric("Assignments", "2 open", "1 due Aug 28")}
      ${metric("Messages", "1 unread", "Instructor note")}
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
  return `<section class="panel"><div class="panel-head"><h2>Recent Students</h2><button onclick="navigate('students')">Open</button></div>${people.students.map(studentCard).join("")}</section>`;
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
      ${studentProfile(list[0])}
    </div>
  `;
}

function studentProfile(student) {
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
  return `
    <div class="toolbar"><button>Export CSV</button><button>Export PDF</button><button>Schedule report</button></div>
    <div class="report-grid">
      <section class="panel">${reportBlock("Enrollment", [["Active", 3], ["Paused", 1], ["New this month", 2]])}</section>
      <section class="panel">${reportBlock("Attendance", [["Average", "89%"], ["At risk", 2], ["Late arrivals", 6]])}</section>
      <section class="panel">${reportBlock("Academic", [["Completion", "66%"], ["Average grade", "83%"], ["Ungraded", 8]])}</section>
      <section class="panel">${reportBlock("Notifications", [["Sent", 184], ["Failed", 1], ["Open rate", "72%"]])}</section>
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
  state.authMode = hasSupabaseConfig() ? "signed-out" : "demo";
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
  return ["Super Admin", "School Admin", "Instructor"].includes(state.role) && state.authMode !== "demo";
}

function accountsView() {
  const isInstructor = state.role === "Instructor";

  if (state.authMode === "demo") {
    return `
      <section class="panel">
        <div class="panel-head"><h2>Accounts &amp; Logins</h2></div>
        <p>Connect Supabase (see <code>docs/deploy-vercel-supabase.md</code>) to issue a real username and password for every instructor and student. Managers can issue Instructor and Student logins; Instructors can issue Student logins for their own classes. This panel activates once the app is signed in through Supabase instead of the preview role switcher.</p>
      </section>
    `;
  }

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
  if (state.authMode === "demo") {
    return `
      <section class="panel">
        <div class="panel-head"><h2>Contact Requests</h2></div>
        <p>Connect Supabase to collect "Contact us" and "Request a call" submissions from your public marketing page here.</p>
      </section>
    `;
  }

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
window.setRole = setRole;
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
