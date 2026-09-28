import {
  canAccessModule,
  canAddExistingStudentToGroup,
  canCreateGroups,
  canCreateInstructorProfiles,
  canCreateStudentProfiles,
  canEditInstructorProfiles,
  canEditStudent,
  canManageGallery,
  canManageGroup,
  canManageOpportunities,
  canRemoveAccounts,
  canRemoveGroups,
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
import { DEFAULT_LANG, LANGS, LANG_LABELS, getLang, isRtl, setLang, t } from "./i18n.js";

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
  reviewFormOpen: false,
  reviewsDirectory: null,
  reviewsBusy: null,
  promoModalDismissed: false,
  modal: null,
  modalBusy: false,
  modalError: "",
  modalNotice: "",
  selectedStudentId: null,
  selectedGroupId: null,
  studentGroupFilter: "",
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
  // Gallery items have no draft/pending state (unlike opportunities' open/
  // closed split) — every row is public the instant it's created — so one
  // shared array powers both the homepage's public Gallery section and the
  // Manager's own "Gallery" dashboard tab. See loadPublicGalleryItems().
  publicGalleryItems: [],
  galleryBusy: null,
  galleryNotice: null,
  theme: "light",
  lang: DEFAULT_LANG,
  loginMode: null, // "student" | "staff" | null (chooser not yet answered)
  chatGroupId: null,
  chatBusy: false,
  chatError: "",
  chatSendBusy: false,
  profileBusy: false,
  profileError: "",
  profileNotice: "",
  // Web Push opt-in (see profileView()'s "Enable notifications" toggle and
  // refreshPushSubscriptionState() further down). null = not checked yet
  // (profileView() shows a neutral state rather than assuming "off").
  pushSubscribed: null,
  pushBusy: false,
  pushError: "",
  // The in-browser Python tab (Instructor/Student only — see security.js's
  // permissions). "idle": Pyodide hasn't been asked to load yet (nothing
  // has been Run). "loading": the ~10MB runtime is downloading/initializing
  // for the very first Run click this page load. "ready": it loaded fine at
  // least once. "error": the CDN script itself failed to load (a Python
  // exception from the user's own code is NOT this — that's reported inline
  // in codeOutput/codeError instead, status stays "ready").
  codeStatus: "idle", // "idle" | "loading" | "ready" | "error"
  codeError: "",
  codeSource: 'print("Hello, Hero Tech Academy!")\n',
  codeOutput: "",
  codeRunning: false,
  // Set by the `beforeinstallprompt` listener near initApp() — only ever
  // populated once registerDashboardServiceWorker() has run (i.e. once
  // someone is signed in), so the "Install app" button in the dashboard
  // topbar (see shell()) only ever appears there, never on the marketing
  // page. Cleared again once installApp() has shown the native prompt,
  // since a captured `beforeinstallprompt` event can only be used once.
  installPromptEvent: null,
};

const config = window.CODENEST_CONFIG || {};
const dataSource = {
  label: "Connecting…",
  status: "Loading your school's data…",
  error: "",
};

// Module ids only — labels are looked up through t() at render time so the
// sidebar re-labels itself instantly when the language changes. "classes"
// and standalone "materials"/"attendance" tabs are gone: Groups is the one
// class-like container (see groupsView()/groupDetailView()), materials are
// uploaded from a group's own page, and attendance is taken there too, by
// that group's own Instructor — see security.js's canManageGroup().
const navItems = [
  ["dashboard", "nav.dashboard", "grid"],
  ["instructors", "nav.instructors", "users"],
  ["students", "nav.students", "users"],
  ["groups", "nav.groups", "layers"],
  ["grades", "nav.grades", "chart"],
  ["chat", "nav.chat", "message"],
  ["code", "nav.code", "code"],
  ["scratch", "nav.scratch", "scratch"],
  ["staffRequests", "nav.staffRequests", "message"],
  ["reports", "nav.reports", "chart"],
  ["accounts", "nav.accounts", "key"],
  ["leads", "nav.leads", "message"],
  ["reviews", "nav.reviews", "chart"],
  ["opportunities", "nav.opportunities", "briefcase"],
  ["gallery", "nav.gallery", "image"],
  ["profile", "nav.profile", "home"],
  ["settings", "nav.settings", "gear"],
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

// `groups` is the sole class-like container now — it carries every field
// `classes` used to own (course, instructor, schedule, room, status,
// completion) plus its own group_id/name. See
// supabase/migrations/0011_groups_replace_classes_drop_parent.sql.
let groups = [];
let assignments = [];
let materials = [];
let attendanceRecords = [];
let staffRequests = [];
let grades = [];
// Per-student, per-assignment delivered files — see
// supabase/migrations/0014_assignment_attachments_and_submissions.sql.
// Separate from `grades`: this only tracks whether/when a student handed
// in a file, not their score.
let submissions = [];
let chatMessages = [];
let chatPollTimer = null;
// The loaded Pyodide (CPython-in-WASM) instance backing the Code tab, and
// the in-flight load promise while it's still downloading/initializing —
// module-level, not `state`, because it's a live runtime object (and a
// pending Promise), not serializable UI state. Loaded lazily on the first
// "Run" click, then reused for every run after that on this page load. See
// ensurePyodide()/runPythonCode() further down.
let pyodideInstance = null;
let pyodideLoadPromise = null;

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
  image: "▨",
  code: "▶",
  scratch: "❖",
};

function can(view) {
  return canAccessModule(state.role, view);
}

function navigate(view) {
  // "groupDetail" is reached only from a group card's own "Open" button
  // (see openGroupDetail()), never from the sidebar, so it's deliberately
  // not in `permissions` — real access is already enforced by RLS (a
  // group you can't see never appears in `groups` to begin with).
  if (view !== "groupDetail" && !can(view)) return;
  const leavingChat = state.view === "chat" && view !== "chat";
  state.view = view;
  render();
  // "students" is included here too (not just "accounts"/"instructors") so
  // a Manager's own account status — and the "Reset login" button on
  // studentProfile() below — is already loaded the moment they open a
  // student's own profile, without having to visit Accounts first.
  if ((view === "accounts" || view === "instructors" || view === "students") && canManageAccounts()) {
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
  if (view === "gallery" && canManageGallery(state.role)) {
    loadPublicGalleryItems().then(renderContentOnly);
  }
  if (view === "chat") {
    enterChatView();
  } else if (leavingChat) {
    stopChatPolling();
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
    instructorName: null,
    groupIds: [],
  };
}

function fullName(student) {
  return `${student.first} ${student.last}`;
}

function pct(value) {
  return `<div class="meter" aria-label="${value}%"><span style="width:${value}%"></span></div>`;
}

function badge(value) {
  const key = String(value).toLowerCase().replace(/\s+/g, "-");
  return `<span class="badge ${key}">${escapeHtml(value)}</span>`;
}

function shell() {
  const allowedNav = visibleModulesForRole(state.role, navItems);
  return `
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="${escapeHtml(school.name)}" />
        <div>
          <strong>${escapeHtml(school.name)}</strong>
          <span>${t("common.secureAccount")}</span>
        </div>
      </div>
      <nav aria-label="Primary navigation">
        ${allowedNav.map(([id, labelKey, icon]) => `
          <button class="nav-item ${state.view === id || (id === "groups" && state.view === "groupDetail") ? "active" : ""}" onclick="navigate('${id}')">
            <span aria-hidden="true">${icons[icon]}</span>${t(labelKey)}
          </button>
        `).join("")}
      </nav>
      <div class="security-note">
        <strong>${t("common.secureAccount")}</strong>
        <span>${roleLabel(state.role)} · ${t("common.tabsAvailable", { count: allowedNav.length })}</span>
        <span>${dataSource.label}</span>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">${t("common.academicYear")}</p>
          <h1>${titleForView()}</h1>
          <small>${dataSource.status}</small>
        </div>
        <label class="search">
          <span>${t("common.search")}</span>
          <input type="search" placeholder="${t("common.searchPlaceholder")}" value="${escapeHtml(state.query)}" oninput="setSearch(this.value)" />
        </label>
        <div class="account-chip">
          ${langSwitcherHtml("topbar-lang")}
          ${state.installPromptEvent ? `<button type="button" class="theme-toggle" onclick="installApp()" aria-label="${t("common.installApp")}" title="${t("common.installApp")}">⇩</button>` : ""}
          <button type="button" class="theme-toggle" onclick="toggleTheme()" aria-label="${t("theme.toggle")}" title="${t("theme.toggle")}">${state.theme === "dark" ? "☀" : "☾"}</button>
          <div>
            <strong>${escapeHtml(state.profile?.full_name || state.session?.user?.email || roleLabel(state.role))}</strong>
            <span>${roleLabel(state.role)}</span>
          </div>
          <button onclick="handleSignOut()">${t("common.signOut")}</button>
        </div>
      </header>
      <section id="content" class="content">${content()}</section>
    </main>
    ${modalHost()}
  `;
}

function titleForView() {
  const isStaff = ["Super Admin", "School Admin", "Instructor"].includes(state.role);
  const isManager = ["Super Admin", "School Admin"].includes(state.role);
  const selectedGroup = groups.find((g) => g.id === state.selectedGroupId);
  return {
    dashboard: t("dashboard.title", { role: roleLabel(state.role) }),
    instructors: t("instructors.title"),
    students: t("students.title"),
    groups: isStaff ? t("groups.title") : t("groups.mine.title"),
    groupDetail: selectedGroup ? escapeHtml(selectedGroup.name) : t("groups.title"),
    grades: isStaff ? t("nav.gradebook") : t("grades.title"),
    chat: t("chat.title"),
    code: t("nav.code"),
    scratch: t("nav.scratch"),
    staffRequests: isManager ? t("requests.title") : t("requests.titleMine"),
    reports: t("reports.title"),
    accounts: state.role === "Instructor" ? t("accounts.title.instructor") : t("accounts.title"),
    leads: t("leads.title"),
    reviews: t("nav.reviews"),
    opportunities: t("nav.opportunities"),
    gallery: t("nav.gallery"),
    profile: t("profile.title"),
    settings: t("settings.title"),
  }[state.view];
}

function content() {
  if (state.query) return searchResults();
  return {
    dashboard: dashboard(),
    instructors: instructorsView(),
    students: students(),
    groups: groupsView(),
    groupDetail: groupDetailView(),
    grades: gradesView(),
    chat: chatView(),
    code: codeView(),
    scratch: scratchView(),
    staffRequests: staffRequestsView(),
    reports: reportsView(),
    accounts: accountsView(),
    leads: leadsView(),
    reviews: reviewsView(),
    opportunities: opportunitiesView(),
    gallery: galleryView(),
    profile: profileView(),
    settings: settingsView(),
  }[state.view] || dashboard();
}

function dashboard() {
  if (state.role === "Student") return studentDashboard();
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
    .forEach((a) => items.push(action("Medium", `${a.total - a.submissions} ${groupName(a.groupId)} submissions are ungraded`, "Instructor follow-up")));

  groups
    .filter((g) => g.status === "Paused")
    .forEach((g) => items.push(action("Low", `${g.name} is paused`, "Confirm a resume date")));

  return items.join("") || `<p class="empty">${t("dashboard.noActionItems")}</p>`;
}

function adminDashboard() {
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const pending = assignments.reduce((sum, a) => sum + Math.max(a.total - a.submissions, 0), 0);
  const attendanceAlerts = people.students.filter((s) => s.absences >= school.settings.absenceThreshold).length;
  const avgAttendance = average(people.students.map((s) => s.attendance));
  const avgCompletion = average(groups.map((g) => g.completion));
  const avgGrade = average(people.students.map((s) => s.avgGrade));
  const retention = people.students.length ? Math.round((activeStudents / people.students.length) * 100) : 0;

  return `
    <div class="metric-grid">
      ${metric(t("dashboard.metric.totalStudents"), people.students.length, people.students.length ? t("dashboard.metric.acrossGroups") : t("dashboard.metric.noStudentsYet"), "users")}
      ${metric(t("dashboard.metric.activeStudents"), activeStudents, people.students.length ? t("dashboard.metric.percentOfTotal", { pct: retention }) : "—", "check")}
      ${metric(t("dashboard.metric.activeGroups"), groups.filter((g) => g.status === "Active").length, t("dashboard.metric.pausedCount", { count: groups.filter((g) => g.status === "Paused").length }), "layers")}
      ${metric(t("dashboard.metric.pendingSubmissions"), pending, t("dashboard.metric.needsGrading"), "clipboard")}
      ${metric(t("dashboard.metric.avgAttendance"), people.students.length ? `${avgAttendance}%` : "—", t("dashboard.metric.absenceAlerts", { count: attendanceAlerts }), "chart")}
      ${metric(t("dashboard.metric.instructors"), people.instructors.length, t("dashboard.metric.onStaff"), "shield")}
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>${t("dashboard.actionQueue")}</h2><button onclick="navigate('reports')">${t("dashboard.reviewAll")}</button></div>
        ${computeActionItems()}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${t("dashboard.performance")}</h2><button onclick="navigate('reports')">${t("common.export")}</button></div>
        <div class="donut-row">
          <div class="donut" style="--donut-value:${avgCompletion};--donut-color:var(--brand)" data-label="${avgCompletion}%" role="img" aria-label="${t("chart.completion")}: ${avgCompletion}%"></div>
          <div class="donut-legend">
            <span style="--dot-color:var(--brand)">${t("chart.completion")} · ${avgCompletion}%</span>
            <span style="--dot-color:var(--gold)">${t("chart.attendance")} · ${avgAttendance}%</span>
            <span style="--dot-color:var(--blue)">${t("chart.avgGrade")} · ${avgGrade}%</span>
          </div>
        </div>
        ${chartRow(t("chart.attendance"), avgAttendance)}
        ${chartRow(t("chart.avgGrade"), avgGrade)}
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
      <div class="panel-head"><h2>${t("dashboard.recentAssignments")}</h2><button onclick="navigate('groups')">${t("common.open")}</button></div>
      ${recent.map((a) => `<div class="report-row"><span>${escapeHtml(a.title)} · ${escapeHtml(groupName(a.groupId))}</span><strong>${badge(a.status)}</strong></div>`).join("") || `<p class="empty">${t("dashboard.noAssignmentsYet")}</p>`}
    </section>
  `;
}

function emptyState(message) {
  return `<section class="panel"><p class="empty">${message}</p></section>`;
}

function instructorDashboard() {
  // groups / people.students / assignments are already scoped to this
  // instructor's own groups by Supabase row-level security (see
  // supabase/migrations/0011_groups_replace_classes_drop_parent.sql) — no
  // extra client-side filtering is needed here.
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const toGrade = assignments.reduce((sum, a) => sum + Math.max(a.total - a.submissions, 0), 0);
  const attendanceAlerts = people.students.filter((s) => s.absences >= school.settings.absenceThreshold).length;
  return `
    <div class="metric-grid">
      ${metric(t("dashboard.metric.assignedGroups"), groups.length, groups.map((g) => g.course).join(", ") || t("dashboard.metric.noneAssignedYet"), "layers")}
      ${metric(t("dashboard.metric.students"), people.students.length, t("dashboard.metric.activeCount", { count: activeStudents }), "users")}
      ${metric(t("dashboard.metric.toGrade"), toGrade, t("dashboard.metric.ungradedSubmissions"), "clipboard")}
      ${metric(t("dashboard.metric.attendanceAlerts"), attendanceAlerts, t("dashboard.metric.followUpNeeded"), "chart")}
    </div>
    <div class="two-col">
      ${assignmentPanel()}
      <section class="panel">
        <div class="panel-head"><h2>${t("dashboard.today")}</h2></div>
        ${
          groups.length
            ? groups.slice(0, 4).map((item) => `<div class="class-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.schedule || "—")} · ${escapeHtml(item.room || "—")}</span>${pct(item.completion)}</div>`).join("")
            : `<p class="empty">${t("dashboard.noGroupsYet")}</p>`
        }
      </section>
    </div>
  `;
}

// Shared by studentAssignmentsPanel() (the student's own dashboard, below)
// and groupAssignmentsSection()'s student branch (a specific group's own
// page) so the "here's one assignment, here's its status, here's the
// button to open it" row only has one definition.
function studentAssignmentRow(a, student) {
  const status = assignmentStatusForStudent(a, student.id);
  return `
    <tr>
      <td><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.course)} · ${a.maxGrade} ${t("grades.table.score")}</span></td>
      <td>${a.due || "—"}</td>
      <td>${gradeStatusBadge(status)}</td>
      <td><button onclick="openModal('assignmentDetail', { assignmentId: '${escapeJs(a.id)}' })">${t("assignments.open")}</button></td>
    </tr>
  `;
}

// A student's own view of every assignment in their group, each with a
// real per-student status and an "Open" button into assignmentDetailModal
// — replaces the old cross-group assignmentPanel() here, which only ever
// showed the class-wide submissions/total counters and a status value
// ("Published") no assignment is ever actually created with.
function studentAssignmentsPanel(student) {
  const own = assignments.filter((a) => a.groupId === student.groupId);
  return `
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("assignments.panelTitle")}</h2><span>${t("assignments.count", { count: own.length })}</span></div>
      <table>
        <thead><tr><th>${t("assignments.table.assignment")}</th><th>${t("assignments.table.due")}</th><th>${t("common.status")}</th><th></th></tr></thead>
        <tbody>
          ${own.map((a) => studentAssignmentRow(a, student)).join("") || `<tr><td colspan="4" class="empty">${t("grades.noAssignmentsYet")}</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function studentDashboard() {
  // Row-level security limits `people.students` to exactly this student's
  // own record once signed in through Supabase.
  const student = people.students[0];
  if (!student) return emptyState(t("dashboard.studentNotLinked"));
  const ownAssignments = assignments.filter((a) => a.groupId === student.groupId);
  const pendingCount = ownAssignments.filter((a) => assignmentStatusForStudent(a, student.id) !== "uploaded").length;
  return `
    <div class="profile-hero">
      <div class="avatar">${escapeHtml(student.first[0])}${escapeHtml(student.last[0])}</div>
      <div><p class="eyebrow">${t("dashboard.studentPortal")}</p><h2>${escapeHtml(fullName(student))}</h2><span>${escapeHtml(student.level || "")} · ${escapeHtml(student.email)}</span></div>
    </div>
    <div class="metric-grid">
      ${metric(t("dashboard.metric.progress"), `${student.progress}%`, t("dashboard.metric.keepItUp"), "chart")}
      ${metric(t("dashboard.metric.attendance"), `${student.attendance}%`, t("dashboard.metric.absenceCount", { count: student.absences }), "check")}
      ${metric(t("dashboard.metric.avgGrade"), `${student.avgGrade}%`, t("dashboard.metric.latestGrade"), "clipboard")}
      ${metric(t("dashboard.metric.openAssignments"), pendingCount, t("dashboard.metric.pendingWork"), "folder")}
    </div>
    ${studentAssignmentsPanel(student)}
  `;
}

function metric(label, value, note, icon) {
  return `<article class="metric">${icon ? `<span class="metric-icon" aria-hidden="true">${icons[icon]}</span>` : ""}<span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function action(level, title, body) {
  return `<div class="action"><span class="priority">${escapeHtml(level)}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(body)}</small></div></div>`;
}

function chartRow(label, value) {
  return `<div class="chart-row"><div><strong>${label}</strong><span>${value}%</span></div>${pct(value)}</div>`;
}

function recentStudents() {
  return `<section class="panel"><div class="panel-head"><h2>${t("dashboard.recentStudents")}</h2><button onclick="navigate('students')">${t("common.open")}</button></div>${people.students.map(studentCard).join("") || `<p class="empty">${t("dashboard.noStudentsYet")}</p>`}</section>`;
}

function studentCard(student) {
  return `
    <div class="student-card">
      <div class="avatar">${escapeHtml(student.first[0])}${escapeHtml(student.last[0])}</div>
      <div class="student-main">
        <strong>${escapeHtml(fullName(student))}</strong>
        <span>${escapeHtml(student.level || "")} · ${escapeHtml(student.id)}</span>
        ${pct(student.progress)}
      </div>
      ${badge(student.status)}
    </div>
  `;
}
function students() {
  const canAdd = canCreateStudentProfiles(state.role);
  const viewerGroups = groupsForViewer();
  const isInstructor = state.role === "Instructor";
  let list = filterStudentsForViewer(currentViewer(), people.students);
  if (state.studentGroupFilter) list = list.filter((s) => s.groupId === state.studentGroupFilter);

  const selected = list.find((s) => s.id === state.selectedStudentId) || list[0];
  const groupFilterOptions = (isInstructor ? viewerGroups : groups)
    .map((item) => `<option value="${escapeHtml(item.id)}" ${state.studentGroupFilter === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");

  return `
    ${state.accountsNotice ? accountsNoticeBanner(state.accountsNotice) : ""}
    <div class="toolbar">
      ${canAdd ? `<button onclick="openModal('addStudent')">${t("students.new")}</button>` : ""}
      <select onchange="setStudentGroupFilter(this.value)" aria-label="${t("students.filterByGroup")}">
        <option value="">${t("students.allGroups")}</option>
        ${groupFilterOptions}
      </select>
      <button onclick="exportStudentsCsv()">${t("common.exportCsv")}</button>
    </div>
    <div class="split">
      <section class="panel table-panel">
        <table>
          <thead><tr><th>${t("students.table.student")}</th><th>${t("students.table.group")}</th><th>${t("students.table.attendance")}</th><th>${t("students.table.grade")}</th><th>${t("students.table.status")}</th></tr></thead>
          <tbody>
            ${
              list
                .map(
                  (s) =>
                    `<tr class="${selected?.id === s.id ? "selected-row" : ""}" onclick="selectStudent('${escapeJs(s.id)}')"><td><strong>${escapeHtml(fullName(s))}</strong><span>${escapeHtml(s.email)}</span></td><td>${escapeHtml(groupName(s.groupId))}</td><td>${s.attendance}%</td><td>${s.avgGrade}%</td><td>${badge(s.status)}</td></tr>`,
                )
                .join("") || `<tr><td colspan="5" class="empty">${t("students.noneYet")}</td></tr>`
            }
          </tbody>
        </table>
      </section>
      ${selected ? studentProfile(selected) : `<section class="panel"><p class="empty">${t("students.noSelection")}</p></section>`}
    </div>
  `;
}

function selectStudent(id) {
  state.selectedStudentId = id;
  renderContentOnly();
}

function setStudentGroupFilter(groupId) {
  state.studentGroupFilter = groupId;
  renderContentOnly();
}

function exportStudentsCsv() {
  let list = filterStudentsForViewer(currentViewer(), people.students);
  if (state.studentGroupFilter) list = list.filter((s) => s.groupId === state.studentGroupFilter);
  const header = [
    t("students.csv.header.id"),
    t("students.csv.header.first"),
    t("students.csv.header.last"),
    t("students.csv.header.email"),
    t("students.csv.header.group"),
    t("students.csv.header.status"),
    t("students.csv.header.attendance"),
    t("students.csv.header.avgGrade"),
  ];
  const rows = list.map((s) => [s.id, s.first, s.last, s.email, groupName(s.groupId), s.status, s.attendance, s.avgGrade]);
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
  if (!student) return `<section class="panel"><p class="empty">${t("students.noSelection")}</p></section>`;
  const canRemove = canRemoveAccounts(state.role);
  const canEdit = canEditStudent(currentViewer(), student);
  const removeKey = `remove-student-${student.id}`;
  const removeBusy = state.accountsBusy === removeKey;

  // Same reset/issue-login action as the Accounts tab's accountRow() (see
  // resetCredentials/generateCredentials) — surfaced here too so a Manager
  // (or an Instructor, same as on Accounts) doesn't have to leave a
  // student's own profile just to reset their password.
  const canResetLogin = canManageAccounts();
  const loginKey = `student-${student.id}`;
  const loginBusy = state.accountsBusy === loginKey;
  const existingAccount = state.accountsDirectory?.find((row) => row.student_id === student.id);
  const loginActionLabel = existingAccount ? t("accounts.resetPassword") : t("accounts.generateLogin");
  const loginHandler = existingAccount ? "resetCredentials" : "generateCredentials";

  return `
    <section class="panel profile">
      <div class="profile-hero compact"><div class="avatar">${escapeHtml(student.first[0])}${escapeHtml(student.last[0])}</div><div><h2>${escapeHtml(fullName(student))}</h2><span>${escapeHtml(student.id)} · ${escapeHtml(student.status)}</span></div></div>
      <dl>
        <div><dt>${t("students.profile.email")}</dt><dd>${escapeHtml(student.email)}</dd></div>
        <div><dt>${t("students.profile.phone")}</dt><dd>${escapeHtml(student.phone) || "—"}</dd></div>
        <div><dt>${t("students.profile.group")}</dt><dd>${escapeHtml(groupName(student.groupId))}</dd></div>
        <div><dt>${t("students.profile.family")}</dt><dd>${escapeHtml(student.family) || "—"}</dd></div>
        <div><dt>${t("students.profile.parent")}</dt><dd>${escapeHtml(student.parent) || "—"}</dd></div>
        <div><dt>${t("students.profile.level")}</dt><dd>${escapeHtml(student.level) || "—"}</dd></div>
        <div><dt>${t("students.profile.notes")}</dt><dd>${escapeHtml(student.notes) || "—"}</dd></div>
      </dl>
      <div class="toolbar">
        ${canEdit ? `<button onclick="openModal('editStudent', { studentId: '${escapeJs(student.id)}' })">${t("common.edit")}</button>` : ""}
        ${
          canResetLogin
            ? `<button onclick="${loginHandler}('${loginKey}', 'Student', '${escapeJs(student.email)}', '${escapeJs(fullName(student))}', '${escapeJs(student.id)}')" ${loginBusy ? "disabled" : ""}>${loginBusy ? t("common.working") : loginActionLabel}</button>`
            : ""
        }
        ${canRemove ? `<button onclick="handleRemoveStudent('${escapeJs(student.id)}', '${escapeJs(fullName(student))}')" ${removeBusy ? "disabled" : ""}>${removeBusy ? t("common.removing") : t("students.profile.removeStudent")}</button>` : ""}
      </div>
    </section>
  `;
}

// Manager-only, direct removal — deletes the student's record and login
// (if one was issued) via api/remove-account.js. An Instructor never gets
// this button; they can only request a removal from the Requests tab (see
// addStaffRequestModal), which a Manager approves through the same API.
async function handleRemoveStudent(id, name) {
  if (!window.confirm(t("students.confirmRemove", { name }))) return;
  const key = `remove-student-${id}`;
  state.accountsBusy = key;
  state.accountsNotice = null;
  renderContentOnly();
  try {
    await removeAccountApi({ role: "Student", ref: id });
    if (state.selectedStudentId === id) state.selectedStudentId = null;
    await refreshAfterWrite();
    state.accountsNotice = { type: "removed", message: t("students.removedNotice", { name }) };
  } catch (error) {
    state.accountsNotice = { type: "error", message: error.message || t("students.removeError") };
  } finally {
    state.accountsBusy = null;
    renderContentOnly();
  }
}

function groupName(id) {
  return groups.find((item) => item.id === id)?.name || t("common.unassigned");
}

function groupsForViewer() {
  if (state.role === "Instructor") {
    return groups.filter((item) => item.instructor === state.viewerContext?.instructorName);
  }
  return groups;
}

function studentsInGroup(groupId) {
  return people.students.filter((student) => student.groupId === groupId);
}

function submissionFor(assignmentId, studentId) {
  return submissions.find((s) => s.assignmentId === assignmentId && s.studentId === studentId);
}

// The one place that decides whether a given student has "uploaded" their
// work for an assignment, still has time ("notYet"), or missed the
// deadline without submitting ("exceeded") — used both by the grading
// modal (to decide when a score input makes sense) and by the student's
// own assignment views. An assignment with no due date is never
// "exceeded" — there's nothing to have missed.
function assignmentStatusForStudent(assignment, studentId) {
  if (submissionFor(assignment.id, studentId)) return "uploaded";
  if (assignment.due) {
    const due = new Date(`${assignment.due}T23:59:59`);
    if (!Number.isNaN(due.getTime()) && due.getTime() < Date.now()) return "exceeded";
  }
  return "notYet";
}

function assignmentStatusLabel(status) {
  return {
    uploaded: t("assignments.status.uploaded"),
    exceeded: t("assignments.status.exceeded"),
    notYet: t("assignments.status.notYet"),
  }[status];
}

// ---------------------------------------------------------------------
// Groups: the sole class-like container. A Manager creates one (with its
// course/schedule/room and an assigned Instructor); students are added
// into it directly (students.group_id — see supabase/migrations/0011).
// Opening a card (openGroupDetail) drills into that one group's own page,
// which is where "Upload materials" and "Take attendance" live now — see
// groupDetailView() below.
// ---------------------------------------------------------------------

function groupsView() {
  const isStaff = ["Super Admin", "School Admin", "Instructor"].includes(state.role);
  const canAdd = canCreateGroups(state.role);

  if (isStaff) {
    const viewerGroups = groupsForViewer();
    return `
      ${canAdd ? `<div class="toolbar"><button onclick="openModal('addGroup')">${t("groups.new")}</button></div>` : ""}
      <div class="class-grid">
        ${viewerGroups.map((item) => groupCard(item)).join("") || `<p class="empty">${t("groups.noneYet")}</p>`}
      </div>
    `;
  }

  const student = people.students[0];
  if (!student) return emptyState(t("dashboard.studentNotLinked"));
  const myGroups = groups.filter((group) => group.id === student.groupId);
  return `
    <div class="class-grid">
      ${myGroups.map((item) => groupCard(item)).join("") || `<p class="empty">${t("groups.notPartOfAny")}</p>`}
    </div>
  `;
}

function groupCard(group) {
  const memberCount = studentsInGroup(group.id).length;
  return `
    <article class="panel class-tile">
      <div class="panel-head"><h2>${escapeHtml(group.name)}</h2>${badge(group.status)}</div>
      <p>${escapeHtml(group.course)}</p>
      <dl>
        <div><dt>${t("groups.instructor")}</dt><dd>${escapeHtml(group.instructor) || t("common.unassigned")}</dd></div>
        <div><dt>${t("groups.students")}</dt><dd>${memberCount}</dd></div>
        <div><dt>${t("groups.schedule")}</dt><dd>${escapeHtml(group.schedule) || "—"}</dd></div>
        <div><dt>${t("groups.room")}</dt><dd>${escapeHtml(group.room) || "—"}</dd></div>
      </dl>
      ${chartRow(t("groups.completion"), group.completion)}
      <button onclick="openGroupDetail('${escapeJs(group.id)}')">${t("groups.open")}</button>
    </article>
  `;
}

function openGroupDetail(id) {
  state.selectedGroupId = id;
  state.view = "groupDetail";
  render();
}

function backToGroups() {
  state.selectedGroupId = null;
  navigate("groups");
}

function groupDetailView() {
  const group = groups.find((g) => g.id === state.selectedGroupId);
  if (!group) return emptyState(t("groups.notFound"));
  const viewer = currentViewer();
  const manage = canManageGroup(viewer, group);
  const canRemove = canRemoveGroups(state.role);
  const canAddExisting = canAddExistingStudentToGroup(state.role);
  const removeBusy = state.groupActionBusy === group.id;
  const roster = studentsInGroup(group.id);
  const groupMaterials = materials.filter((m) => m.groupId === group.id);
  const recentAttendance = attendanceRecords
    .filter((r) => r.groupId === group.id)
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);

  return `
    <button type="button" class="auth-back" onclick="backToGroups()">${backArrow()} ${t("groups.backToGroups")}</button>
    ${state.groupActionError ? `<p class="notice-row auth-error">${escapeHtml(state.groupActionError)}</p>` : ""}
    <section class="panel">
      <div class="panel-head">
        <h2>${escapeHtml(group.name)}</h2>
        <div class="toolbar">
          ${badge(group.status)}
          ${manage ? `<button onclick="openModal('editGroup', { groupId: '${escapeJs(group.id)}' })">${t("common.edit")}</button>` : ""}
          ${canRemove ? `<button onclick="handleRemoveGroup('${escapeJs(group.id)}', '${escapeJs(group.name)}')" ${removeBusy ? "disabled" : ""}>${removeBusy ? t("common.removing") : t("groups.remove")}</button>` : ""}
        </div>
      </div>
      <dl>
        <div><dt>${t("groups.course")}</dt><dd>${escapeHtml(group.course)}</dd></div>
        <div><dt>${t("groups.instructor")}</dt><dd>${escapeHtml(group.instructor) || t("common.unassigned")}</dd></div>
        <div><dt>${t("groups.schedule")}</dt><dd>${escapeHtml(group.schedule) || "—"}</dd></div>
        <div><dt>${t("groups.room")}</dt><dd>${escapeHtml(group.room) || "—"}</dd></div>
      </dl>
      ${chartRow(t("groups.completion"), group.completion)}
    </section>
    <section class="panel table-panel">
      <div class="panel-head">
        <h2>${t("groups.members")}</h2>
        <div class="toolbar">
          ${manage ? `<button onclick="openModal('addStudent', { groupId: '${escapeJs(group.id)}' })">${t("students.new")}</button>` : ""}
          ${canAddExisting ? `<button onclick="openModal('addExistingStudent', { groupId: '${escapeJs(group.id)}' })">${t("groups.addExisting.button")}</button>` : ""}
          <span>${roster.length}</span>
        </div>
      </div>
      <table>
        <thead><tr><th>${t("students.table.student")}</th><th>${t("students.table.attendance")}</th><th>${t("students.table.grade")}</th><th>${t("common.status")}</th></tr></thead>
        <tbody>
          ${
            roster
              .map((s) => `<tr><td><strong>${escapeHtml(fullName(s))}</strong><span>${escapeHtml(s.email)}</span></td><td>${s.attendance}%</td><td>${s.avgGrade}%</td><td>${badge(s.status)}</td></tr>`)
              .join("") || `<tr><td colspan="4" class="empty">${t("dashboard.noStudentsYet")}</td></tr>`
          }
        </tbody>
      </table>
    </section>
    ${groupAssignmentsSection(group, manage)}
    <section class="panel table-panel">
      <div class="panel-head">
        <h2>${t("materials.title")}</h2>
        ${manage ? `<button onclick="openModal('addMaterial', { groupId: '${escapeJs(group.id)}' })">${t("materials.upload")}</button>` : ""}
      </div>
      <table>
        <thead><tr><th>${t("materials.form.title")}</th><th>${t("materials.uploaded")}</th><th>${t("common.action")}</th></tr></thead>
        <tbody>
          ${
            groupMaterials
              .map(
                (m) =>
                  `<tr><td><strong>${escapeHtml(m.title)}</strong><span>${escapeHtml(m.fileName)}</span></td><td>${m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}</td><td><button onclick="openStorageFile('materials', '${escapeJs(m.filePath)}', '${escapeJs(m.fileName)}', 'view')">${t("common.view")}</button> <button onclick="openStorageFile('materials', '${escapeJs(m.filePath)}', '${escapeJs(m.fileName)}', 'download')">${t("common.download")}</button></td></tr>`,
              )
              .join("") || `<tr><td colspan="3" class="empty">${t("materials.noneYet")}</td></tr>`
          }
        </tbody>
      </table>
    </section>
    ${manage ? groupAttendanceSection(group, recentAttendance) : ""}
  `;
}

// Attendance lives on the group's own page now: only that group's
// Instructor (or a Manager) sees this section at all (gated by
// canManageGroup() above) — no school-wide Attendance tab exists anymore.
function groupAttendanceSection(group, recentLog) {
  return `
    <section class="panel table-panel">
      <div class="panel-head">
        <h2>${t("attendance.title")}</h2>
        <button onclick="openModal('takeAttendance', { groupId: '${escapeJs(group.id)}' })">${t("attendance.take")}</button>
      </div>
      <table>
        <thead><tr><th>${t("attendance.table.date")}</th><th>${t("attendance.table.present")}</th><th>${t("attendance.table.absent")}</th><th>${t("attendance.table.late")}</th><th>${t("attendance.table.excused")}</th></tr></thead>
        <tbody>
          ${
            groupAttendanceBySession(recentLog)
              .map((session) => `<tr><td>${session.date}</td><td>${session.present}</td><td>${session.absent}</td><td>${session.late}</td><td>${session.excused}</td></tr>`)
              .join("") || `<tr><td colspan="5" class="empty">${t("attendance.noneYet")}</td></tr>`
          }
        </tbody>
      </table>
    </section>
  `;
}

// Collapses individual per-student attendance_records rows into one
// summary row per date (the caller already scoped `records` to one
// group), since that's what's useful to scan at a glance; the modal still
// writes one row per student underneath.
function groupAttendanceBySession(records) {
  const sessions = new Map();
  for (const record of records) {
    if (!sessions.has(record.date)) {
      sessions.set(record.date, { date: record.date, present: 0, absent: 0, late: 0, excused: 0 });
    }
    const session = sessions.get(record.date);
    if (session[record.status] !== undefined) session[record.status] += 1;
  }
  return [...sessions.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
}

// There's no standalone Assignments tab anymore — see groupDetailView()'s
// own Assignments section below, where a group's assignments live now.
// assignmentPanel() stays as a general "every assignment I can see" table
// for the admin/instructor/student dashboards (see adminDashboard() /
// instructorDashboard() / studentDashboard()), which still reasonably
// want a cross-group summary; it just takes the list to show now instead
// of always reading the full `assignments` array itself.
function assignmentPanel(list = assignments) {
  return `
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("assignments.panelTitle")}</h2><span>${t("assignments.count", { count: list.length })}</span></div>
      <table>
        <thead><tr><th>${t("assignments.table.assignment")}</th><th>${t("assignments.table.group")}</th><th>${t("assignments.table.due")}</th><th>${t("assignments.table.completion")}</th><th>${t("assignments.table.status")}</th></tr></thead>
        <tbody>
          ${list.map((a) => `<tr><td><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.course)} · ${escapeHtml(a.difficulty || "")} · ${a.maxGrade} pts</span></td><td>${escapeHtml(groupName(a.groupId))}</td><td>${a.due || "—"}</td><td>${a.submissions}/${a.total}</td><td>${badge(a.status)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">${t("grades.noAssignmentsYet")}</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

// A group's own Assignments section (see groupDetailView()) — the
// group-column from assignmentPanel()'s table is dropped since every row
// here is already that one group's. A Student viewer gets a different
// last two columns than staff do: their own per-assignment status (see
// assignmentStatusForStudent()) and an "Open" button into
// assignmentDetailModal() to view the brief, submit a file, and check
// their grade — instead of the class-wide completion/status columns,
// which mean nothing to a single student.
function groupAssignmentsSection(group, manage) {
  const groupAssignments = assignments.filter((a) => a.groupId === group.id);
  const isStudentViewer = state.role === "Student";
  const student = isStudentViewer ? people.students[0] : null;

  return `
    <section class="panel table-panel">
      <div class="panel-head">
        <h2>${t("assignments.panelTitle")}</h2>
        ${manage ? `<button onclick="openModal('addAssignment', { groupId: '${escapeJs(group.id)}' })">${t("assignments.new")}</button>` : `<span>${t("assignments.count", { count: groupAssignments.length })}</span>`}
      </div>
      <table>
        <thead><tr>
          <th>${t("assignments.table.assignment")}</th>
          <th>${t("assignments.table.due")}</th>
          ${isStudentViewer ? `<th>${t("common.status")}</th><th></th>` : `<th>${t("assignments.table.completion")}</th><th>${t("assignments.table.status")}</th>`}
        </tr></thead>
        <tbody>
          ${
            groupAssignments
              .map((a) => {
                if (isStudentViewer && student) return studentAssignmentRow(a, student);
                return `<tr><td><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.course)} · ${escapeHtml(a.difficulty || "")} · ${a.maxGrade} pts</span></td><td>${a.due || "—"}</td><td>${a.submissions}/${a.total}</td><td>${badge(a.status)}</td></tr>`;
              })
              .join("") || `<tr><td colspan="4" class="empty">${t("grades.noAssignmentsYet")}</td></tr>`
          }
        </tbody>
      </table>
    </section>
  `;
}
// ---------------------------------------------------------------------
// Grades: Staff see a gradebook (one row per assignment, "Grade" opens a
// roster-style entry modal — same pattern as attendance). A Student sees
// only their own grades — already the only rows RLS will ever return them
// (see the "grades scoped read" policy in
// supabase/migrations/0011_groups_replace_classes_drop_parent.sql), this
// view just presents them.
// ---------------------------------------------------------------------

function gradesView() {
  const isStaff = ["Super Admin", "School Admin", "Instructor"].includes(state.role);

  // One gradebook section per group rather than a single flat table across
  // every group at once — groupsForViewer() already scopes this to every
  // group a Manager can see or the ones this Instructor is assigned to.
  if (isStaff) {
    const viewerGroups = groupsForViewer();
    return viewerGroups.length ? viewerGroups.map((group) => groupGradebookSection(group)).join("") : `<p class="empty">${t("groups.noneYet")}</p>`;
  }

  const student = people.students[0];
  if (!student) return emptyState(t("dashboard.studentNotLinked"));
  const own = grades.filter((g) => g.studentId === student.id);
  return `
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("grades.yourGrades")}</h2><span>${t("grades.gradedCount", { count: own.length })}</span></div>
      <table>
        <thead><tr><th>${t("grades.table.assignment")}</th><th>${t("grades.table.group")}</th><th>${t("grades.table.score")}</th><th>${t("grades.table.feedback")}</th></tr></thead>
        <tbody>
          ${
            own
              .map((g) => {
                const a = assignments.find((item) => item.id === g.assignmentId);
                return `<tr><td><strong>${a ? escapeHtml(a.title) : "—"}</strong></td><td>${a ? escapeHtml(groupName(a.groupId)) : "—"}</td><td>${g.score}/${g.maxScore}</td><td>${g.feedback ? escapeHtml(g.feedback) : "—"}</td></tr>`;
              })
              .join("") || `<tr><td colspan="4" class="empty">${t("grades.noneYet")}</td></tr>`
          }
        </tbody>
      </table>
    </section>
  `;
}

// One group's slice of the staff gradebook (see gradesView() above) — same
// row shape the old flat table used, minus the now-redundant "Group"
// column, since every row here is already that one group's.
function groupGradebookSection(group) {
  const groupAssignments = assignments.filter((a) => a.groupId === group.id);
  const roster = studentsInGroup(group.id);
  return `
    <section class="panel table-panel">
      <div class="panel-head"><h2>${escapeHtml(group.name)}</h2><span>${t("assignments.count", { count: groupAssignments.length })}</span></div>
      <table>
        <thead><tr><th>${t("grades.table.assignment")}</th><th>${t("grades.table.due")}</th><th>${t("grades.table.graded")}</th><th></th></tr></thead>
        <tbody>
          ${
            groupAssignments
              .map((a) => {
                const gradedCount = grades.filter((g) => g.assignmentId === a.id).length;
                return `<tr><td><strong>${escapeHtml(a.title)}</strong></td><td>${a.due || "—"}</td><td>${gradedCount}/${roster.length}</td><td>${a.id ? `<button onclick="openModal('gradeStudent', { assignmentId: '${escapeJs(a.id)}' })">${t("grades.grade")}</button>` : ""}</td></tr>`;
              })
              .join("") || `<tr><td colspan="4" class="empty">${t("grades.noAssignmentsYet")}</td></tr>`
          }
        </tbody>
      </table>
    </section>
  `;
}

function gradeStudentModal(modal) {
  const assignment = assignments.find((a) => a.id === modal.assignmentId);
  if (!assignment) {
    return `
      <h2>${t("grades.grade")}</h2>
      <p class="hint">${t("grades.modal.notFound")}</p>
      <div class="modal-actions"><button type="button" onclick="closeModal()">${t("common.close")}</button></div>
    `;
  }
  const roster = studentsInGroup(assignment.groupId);
  return `
    <h2>${t("grades.modal.title", { title: escapeHtml(assignment.title) })}</h2>
    <p class="hint">${t("grades.modal.sub", { group: escapeHtml(groupName(assignment.groupId)), max: assignment.maxGrade })}</p>
    ${modalMessages()}
    <form onsubmit="handleSaveGrade(event, '${escapeJs(assignment.id)}')">
      ${gradeRosterRows(assignment, roster)}
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("grades.modal.save")}</button>
      </div>
    </form>
  `;
}

// A score box only makes sense once there's something to grade: the
// student has uploaded a file, or the deadline has passed without one
// (see requirement: "if its uploaded or exceed to add the grade, if not
// yet within the deadline its ok"). A student who's simply not due yet
// gets a status note instead of an input — unless they already have a
// grade on record from before this status gate existed, in which case
// that's still shown and stays editable rather than silently hidden.
function gradeRosterRows(assignment, roster) {
  if (!roster.length) return `<p class="hint">${t("grades.modal.noRoster")}</p>`;
  return `
    <fieldset class="modal-checklist">
      <legend>${t("grades.modal.legend")}</legend>
      ${roster
        .map((student) => {
          const existing = grades.find((g) => g.assignmentId === assignment.id && g.studentId === student.id);
          const status = assignmentStatusForStudent(assignment, student.id);
          const canGrade = status !== "notYet" || Boolean(existing);
          // A grader could never actually see what a student turned in
          // before — only this status badge. Show a "View" link straight
          // to the delivered file whenever one exists, so grading doesn't
          // mean scoring blind.
          const submission = submissionFor(assignment.id, student.id);
          return `
            <div class="attendance-row">
              <span>${escapeHtml(fullName(student))} ${gradeStatusBadge(status)}${
                submission
                  ? ` <button type="button" class="link-button" onclick="openStorageFile('submissions', '${escapeJs(submission.filePath)}', '${escapeJs(submission.fileName)}', 'view')">${t("common.view")}</button>`
                  : ""
              }</span>
              ${
                canGrade
                  ? `<input type="number" min="0" max="${assignment.maxGrade}" step="0.5" name="score-${escapeHtml(student.id)}" data-student-id="${escapeHtml(student.id)}" value="${existing ? existing.score : ""}" placeholder="${t("grades.table.score")}" />`
                  : `<span class="muted-pill">${t("assignments.status.notYet")}</span>`
              }
            </div>
          `;
        })
        .join("")}
    </fieldset>
  `;
}

// Reuses the same tone classes badge() already relies on (.active =
// success green, .notify = danger red, .draft = warning amber — see
// styles.css) rather than inventing a parallel color system, while still
// keying off the stable English status rather than the localized label
// badge() would otherwise turn into an unstable CSS class name.
function gradeStatusBadge(status) {
  const tone = status === "uploaded" ? "active" : status === "exceeded" ? "notify" : "draft";
  return `<span class="badge ${tone}">${escapeHtml(assignmentStatusLabel(status))}</span>`;
}

async function handleSaveGrade(event, assignmentId) {
  event.preventDefault();
  const form = event.target;
  const assignment = assignments.find((a) => a.id === assignmentId);
  const maxScore = assignment?.maxGrade || 100;
  const inputs = [...form.querySelectorAll("input[data-student-id]")];
  const rows = inputs
    .filter((input) => input.value !== "")
    .map((input) => ({
      assignment_id: assignmentId,
      student_id: input.dataset.studentId,
      score: Number(input.value),
      max_score: maxScore,
    }));
  if (!rows.length) {
    state.modalError = t("grades.needOneScore");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseUpsert("grades", rows, "assignment_id,student_id");
    await refreshAfterWrite();
    closeModal();
    navigate("grades");
    for (const row of rows) {
      try {
        await notifyEvent("grade_added", {
          studentRef: row.student_id,
          assignmentTitle: assignment?.title || "",
          score: row.score,
          maxScore: row.max_score,
        });
      } catch {
        // notification is best-effort — the grade itself already saved
      }
    }
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("grades.form.saveError");
    render();
  }
}

// ---------------------------------------------------------------------
// Group chat: one shared thread per group (see can_access_group_chat() in
// supabase/migrations/0011_groups_replace_classes_drop_parent.sql — a
// Manager can always read AND send in any group's chat). Messages aren't
// part of the eager loadFromSupabase() batch — they're loaded per-group,
// on demand, and refreshed on a short interval only while the Chat tab is
// actually open (see enterChatView/startChatPolling/stopChatPolling below
// and their hook in navigate()), so nobody pays for a poll they can't see.
// ---------------------------------------------------------------------

function chatGroupsForViewer() {
  if (["Super Admin", "School Admin", "Instructor"].includes(state.role)) return groupsForViewer();
  const student = people.students[0];
  if (!student) return [];
  const group = groups.find((g) => g.id === student.groupId);
  return group ? [group] : [];
}

// Just the message bubbles — split out from chatView() so a background
// poll tick (see startChatPolling below) can refresh only this markup via
// renderChatThreadOnly() instead of a full renderContentOnly(), which used
// to blow away and recreate the composer's <input> on every tick and wipe
// out whatever the person was in the middle of typing.
function chatThreadHtml(groupMessages, canModerate, viewerName) {
  return groupMessages.length
    ? groupMessages
        .map(
          (m) => `
          <div class="chat-message ${m.senderName === viewerName && m.senderRole === state.role ? "chat-message-own" : ""}">
            <div class="chat-message-meta"><strong>${escapeHtml(m.senderName)}</strong><span>${escapeHtml(roleLabel(m.senderRole))} · ${new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
            <p>${escapeHtml(m.body)}</p>
            ${canModerate ? `<button type="button" class="chat-delete" onclick="deleteMessage('${escapeJs(m.id)}')" aria-label="${t("chat.deleteMessage")}">&times;</button>` : ""}
          </div>
        `,
        )
        .join("")
    : `<p class="empty">${t("chat.noMessages")}</p>`;
}

// Re-renders only the #chat-thread element's contents (called on every
// silent poll tick — see startChatPolling) rather than the whole #content
// panel, so the chat composer's <input> DOM node — and whatever the person
// is currently typing into it — is left completely untouched.
function renderChatThreadOnly() {
  const threadEl = document.getElementById("chat-thread");
  if (!threadEl || state.view !== "chat") return;
  const groupMessages = chatMessages
    .filter((m) => m.groupId === state.chatGroupId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const canModerate = ["Super Admin", "School Admin"].includes(state.role);
  const viewerName = state.profile?.full_name || "";
  const wasNearBottom = threadEl.scrollTop + threadEl.clientHeight >= threadEl.scrollHeight - 60;
  threadEl.innerHTML = chatThreadHtml(groupMessages, canModerate, viewerName);
  if (wasNearBottom) threadEl.scrollTop = threadEl.scrollHeight;
}

function chatView() {
  const availableGroups = chatGroupsForViewer();
  if (!availableGroups.length) {
    return emptyState(t("chat.empty"));
  }
  if (!state.chatGroupId || !availableGroups.some((g) => g.id === state.chatGroupId)) {
    state.chatGroupId = availableGroups[0].id;
  }
  const activeGroup = availableGroups.find((g) => g.id === state.chatGroupId);
  const groupMessages = chatMessages
    .filter((m) => m.groupId === state.chatGroupId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const canModerate = ["Super Admin", "School Admin"].includes(state.role);
  const viewerName = state.profile?.full_name || "";

  const messagesPanel = `
    <section class="panel chat-panel">
      <div class="panel-head">
        <h2>${escapeHtml(activeGroup?.name || t("chat.title"))}</h2>
      </div>
      ${state.chatError ? `<p class="notice-row auth-error">${escapeHtml(state.chatError)}</p>` : ""}
      <div class="chat-thread" id="chat-thread">
        ${chatThreadHtml(groupMessages, canModerate, viewerName)}
      </div>
      <form class="chat-composer" onsubmit="handleSendMessage(event)">
        <input type="text" name="body" placeholder="${t("chat.placeholder")}" maxlength="3900" required autocomplete="off" />
        <button type="submit" ${state.chatSendBusy ? "disabled" : ""}>${state.chatSendBusy ? t("common.sending") : t("chat.send")}</button>
      </form>
    </section>
  `;

  // Multiple groups (a Manager sees every group, an Instructor with more
  // than one group sees all of theirs): show a two-pane layout, a thread
  // list of groups beside the active conversation, rather than the old
  // single <select> dropdown — a single-group viewer (most Instructors,
  // every Student) just gets the one conversation panel, full width.
  if (availableGroups.length <= 1) return messagesPanel;

  return `
    <div class="chat-layout">
      <section class="panel chat-threadlist" aria-label="${t("chat.title")}">
        ${availableGroups
          .map(
            (g) => `
              <button type="button" class="chat-thread-item ${g.id === state.chatGroupId ? "active" : ""}" onclick="setChatGroup('${escapeJs(g.id)}')">
                <span class="avatar" aria-hidden="true">${escapeHtml((g.name || "?")[0])}</span>
                <span class="chat-thread-item-label">
                  <strong>${escapeHtml(g.name)}</strong>
                  <small>${escapeHtml(g.course || "")}</small>
                </span>
              </button>
            `,
          )
          .join("")}
      </section>
      ${messagesPanel}
    </div>
  `;
}

function setChatGroup(groupId) {
  state.chatGroupId = groupId;
  renderContentOnly();
  loadChatMessages(groupId).then(renderContentOnly);
}

function enterChatView() {
  const availableGroups = chatGroupsForViewer();
  if (!availableGroups.length) return;
  if (!state.chatGroupId || !availableGroups.some((g) => g.id === state.chatGroupId)) {
    state.chatGroupId = availableGroups[0].id;
  }
  loadChatMessages(state.chatGroupId).then(renderContentOnly);
  startChatPolling();
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(() => {
    if (state.view !== "chat" || !state.chatGroupId) return;
    loadChatMessages(state.chatGroupId, { silent: true }).then(renderChatThreadOnly);
  }, 4000);
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

async function loadChatMessages(groupId, opts = {}) {
  if (!hasSupabaseConfig() || !state.session || !groupId) return;
  if (!opts.silent) {
    state.chatBusy = true;
    state.chatError = "";
  }
  const base = config.supabaseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(
      `${base}/rest/v1/messages?group_id=eq.${encodeURIComponent(groupId)}&select=*&order=created_at.asc`,
      {
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${state.session.access_token}`,
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const rows = await response.json();
    chatMessages = chatMessages
      .filter((m) => m.groupId !== groupId)
      .concat(
        rows.map((m) => ({
          id: m.id,
          groupId: m.group_id,
          senderUserId: m.sender_user_id,
          senderName: m.sender_name,
          senderRole: m.sender_role,
          body: m.body,
          createdAt: m.created_at,
        })),
      );
  } catch {
    if (!opts.silent) state.chatError = t("chat.couldNotLoad");
  } finally {
    if (!opts.silent) state.chatBusy = false;
  }
}

async function handleSendMessage(event) {
  event.preventDefault();
  const form = event.target;
  const body = form.body.value.trim();
  const groupId = state.chatGroupId;
  if (!body || !groupId) return;
  state.chatSendBusy = true;
  state.chatError = "";
  renderContentOnly();
  try {
    await supabaseInsert("messages", [
      {
        group_id: groupId,
        sender_user_id: state.session.user.id,
        sender_name: state.profile?.full_name || "",
        sender_role: state.role,
        body,
      },
    ]);
    form.reset();
    await loadChatMessages(groupId);
    try {
      await notifyEvent("chat_message", { groupId, preview: body });
    } catch {
      // notification is best-effort — the message itself already sent
    }
  } catch (error) {
    state.chatError = error.message || t("chat.couldNotSend");
  } finally {
    state.chatSendBusy = false;
    renderContentOnly();
    const thread = document.getElementById("chat-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }
}

async function deleteMessage(id) {
  if (!window.confirm(t("chat.confirmDelete"))) return;
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    await fetch(`${base}/rest/v1/messages?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
      },
    });
    chatMessages = chatMessages.filter((m) => m.id !== id);
    renderContentOnly();
  } catch {
    state.chatError = t("chat.couldNotDelete");
    renderContentOnly();
  }
}

// ---------------------------------------------------------------------
// Code: an in-browser Python interpreter (Instructor + Student only — see
// security.js's permissions; deliberately not offered to either Manager
// role, per the request that added this tab). Runs entirely client-side
// via Pyodide (CPython compiled to WebAssembly, loaded from a CDN on first
// use) — there is no backend for this at all, so nothing typed here ever
// leaves the browser. It runs directly on the main window rather than in a
// sandboxed iframe: the only bridge Python code gets to JS is an explicit
// `from js import ...`, the Supabase anon key already sitting in
// window.CODENEST_CONFIG is a publishable client key (Row Level Security,
// not key secrecy, is what actually protects data), and a student with
// browser devtools already has equal or greater access than that bridge
// would grant — so this isn't a materially new attack surface for what is
// an internal school tool.
// ---------------------------------------------------------------------

function codeView() {
  return `
    <p class="hint">${t("code.hint")}</p>
    <section class="panel code-panel">
      <div class="code-panel-head">
        <h2><span class="code-panel-badge" aria-hidden="true">🐍</span> ${t("nav.code")}</h2>
        <div class="toolbar">
          <button type="button" class="code-run-btn ${state.codeRunning ? "is-running" : ""}" onclick="runPythonCode()" ${state.codeRunning ? "disabled" : ""}>${state.codeRunning ? `⏳ ${t("code.running")}` : `▶ ${t("code.run")}`}</button>
          <button type="button" class="code-clear-btn" onclick="clearCodeOutput()">✨ ${t("code.clear")}</button>
        </div>
      </div>
      ${state.codeStatus === "loading" ? `<p class="notice-row m-success">${t("code.loading")}</p>` : ""}
      ${state.codeStatus === "error" ? `<p class="notice-row auth-error">${escapeHtml(state.codeError)}</p>` : ""}
      <textarea class="code-editor" spellcheck="false" autocapitalize="off" autocorrect="off" oninput="setCodeSource(this.value)">${escapeHtml(state.codeSource)}</textarea>
      <div class="code-output-wrap">
        <div class="code-output-label">
          <span class="code-output-dots" aria-hidden="true"><span></span><span></span><span></span></span>
          ${t("code.output")}
        </div>
        <pre class="code-output">${state.codeOutput ? escapeHtml(state.codeOutput) : `<span class="hint">${t("code.noOutput")}</span>`}</pre>
      </div>
    </section>
  `;
}

// Deliberately does NOT call render()/renderContentOnly() on every
// keystroke — this is the exact bug class the chat composer had (a
// background re-render replacing the DOM node mid-type and dropping
// keystrokes). Keeping state.codeSource silently in sync here means any
// LATER full re-render (e.g. once Run finishes) still shows exactly what
// was typed, with no data loss, without paying for a re-render — and the
// cursor-position reset that would come with one — on every character.
function setCodeSource(value) {
  state.codeSource = value;
}

// Lazily loads Pyodide from the CDN the first time it's needed, then
// reuses the same instance for every later Run this page load. Concurrent
// calls (e.g. a fast double-click on Run) share the one in-flight load
// via pyodideLoadPromise rather than injecting the <script> tag twice.
async function ensurePyodide() {
  if (pyodideInstance) return pyodideInstance;
  if (!pyodideLoadPromise) {
    pyodideLoadPromise = (async () => {
      if (!window.loadPyodide) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.js";
          script.onload = resolve;
          script.onerror = () => reject(new Error(t("code.loadError")));
          document.head.appendChild(script);
        });
      }
      const pyodide = await window.loadPyodide();
      // batched() hands us complete lines (no trailing "\n"), so we add
      // our own — this is what makes print() output show up as separate
      // lines in the <pre> below instead of one run-on line.
      pyodide.setStdout({ batched: (msg) => { state.codeOutput += `${msg}\n`; } });
      pyodide.setStderr({ batched: (msg) => { state.codeOutput += `${msg}\n`; } });
      pyodideInstance = pyodide;
      return pyodide;
    })();
  }
  return pyodideLoadPromise;
}

// Output accumulates across multiple Run clicks (like a REPL/console
// history) rather than clearing each time — more useful when iterating on
// the same snippet. "Clear output" (clearCodeOutput below) is the manual
// reset for when that history gets in the way.
async function runPythonCode() {
  const code = state.codeSource;
  if (state.codeOutput) state.codeOutput += "\n";
  state.codeRunning = true;
  state.codeError = "";
  if (!pyodideInstance) state.codeStatus = "loading";
  renderContentOnly();
  try {
    const pyodide = await ensurePyodide();
    state.codeStatus = "ready";
    await pyodide.runPythonAsync(code);
  } catch (error) {
    // pyodideInstance being set means the RUNTIME loaded fine and this is
    // a Python-level error (syntax error, exception, etc) — status stays
    // "ready" and the message goes into the output like a real traceback
    // would. Only a failure to load Pyodide itself (network down, CDN
    // blocked) sets codeStatus to "error".
    state.codeStatus = pyodideInstance ? "ready" : "error";
    const message = error?.message || String(error);
    state.codeError = message;
    state.codeOutput += `${message}\n`;
  } finally {
    state.codeRunning = false;
    renderContentOnly();
  }
}

function clearCodeOutput() {
  state.codeOutput = "";
  renderContentOnly();
}

// ---------------------------------------------------------------------
// Scratch: the real, official Scratch 3.0 editor (scratchfoundation/
// scratch-gui — the same open-source project scratch.mit.edu itself runs),
// built offline and self-hosted as static files at /scratch/ (see
// scratch/README.md at the project root for how it was built and how to
// rebuild it). Embedded here via a same-origin iframe rather than ported
// into this app's own render loop — it's a large, independent React app
// with its own state management, and an iframe is what lets it just work
// unmodified. Same audience as Code (Instructor + Student — see
// security.js). No backend involved: sprites/blocks/running a project all
// happen in the student's browser, and saving/loading a project uses the
// editor's own File menu (a .sb3 file to their computer), same as the
// offline desktop Scratch app.
// ---------------------------------------------------------------------

function scratchView() {
  return `
    <p class="hint">${t("scratch.hint")}</p>
    <section class="panel scratch-panel">
      <iframe class="scratch-frame" src="/scratch/" title="${t("nav.scratch")}" allow="fullscreen"></iframe>
    </section>
  `;
}

// ---------------------------------------------------------------------
// Profile: every signed-in role's own account info, plus a voluntary
// password change any time (not just the forced first-login flow — see
// handleForcePasswordSubmit for that one). Reuses the exact same
// authChangePassword() + mark_password_changed call.
// ---------------------------------------------------------------------

function profileView() {
  const viewerName = state.profile?.full_name || state.session?.user?.email || roleLabel(state.role);
  const email = state.session?.user?.email || "—";
  const student = state.role === "Student" ? people.students[0] : null;
  const initials = viewerName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
  return `
    <div class="profile-hero compact">
      <div class="avatar">${escapeHtml(initials)}</div>
      <div><h2>${escapeHtml(viewerName)}</h2><span>${escapeHtml(roleLabel(state.role))}${student ? ` · ${escapeHtml(student.level || "")}` : ""}</span></div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>${t("profile.accountDetails")}</h2></div>
      <dl>
        <div><dt>${t("common.email")}</dt><dd>${escapeHtml(email)}</dd></div>
        <div><dt>${t("profile.role")}</dt><dd>${escapeHtml(roleLabel(state.role))}</dd></div>
        ${student ? `<div><dt>${t("profile.group")}</dt><dd>${escapeHtml(groupName(student.groupId))}</dd></div>` : ""}
      </dl>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>${t("profile.notifications.heading")}</h2></div>
      <p class="hint">${t("profile.notifications.hint")}</p>
      ${state.pushError ? `<p class="notice-row auth-error">${escapeHtml(state.pushError)}</p>` : ""}
      ${
        !pushSupported()
          ? `<p class="hint">${t("profile.notifications.unsupported")}</p>`
          : `
        <label class="switch">
          <span>${t("profile.notifications.toggle")}</span>
          <input type="checkbox" ${state.pushSubscribed ? "checked" : ""} ${state.pushBusy || state.pushSubscribed === null ? "disabled" : ""} onchange="${state.pushSubscribed ? "disableNotifications()" : "enableNotifications()"}" />
          <span class="switch-track"></span>
        </label>
      `
      }
    </section>
    <section class="panel">
      <div class="panel-head"><h2>${t("profile.changePassword")}</h2></div>
      ${state.profileError ? `<p class="notice-row auth-error">${escapeHtml(state.profileError)}</p>` : ""}
      ${state.profileNotice ? `<p class="notice-row m-success">${escapeHtml(state.profileNotice)}</p>` : ""}
      <form onsubmit="handleChangePassword(event)">
        <label>${t("profile.newPassword")}<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required /></label>
        <label>${t("profile.confirmPassword")}<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required /></label>
        <div class="modal-actions">
          <button type="submit" ${state.profileBusy ? "disabled" : ""}>${state.profileBusy ? t("common.saving") : t("profile.updatePassword")}</button>
        </div>
      </form>
    </section>
  `;
}

async function handleChangePassword(event) {
  event.preventDefault();
  const form = event.target;
  const next = form.newPassword.value;
  const confirmValue = form.confirmPassword.value;
  state.profileError = "";
  state.profileNotice = "";
  if (next.length < 8) {
    state.profileError = t("auth.passwordTooShort");
    renderContentOnly();
    return;
  }
  if (next !== confirmValue) {
    state.profileError = t("auth.passwordMismatch");
    renderContentOnly();
    return;
  }
  state.profileBusy = true;
  renderContentOnly();
  try {
    await authChangePassword(config, state.session.access_token, next);
    state.profileNotice = t("profile.updated");
    form.reset();
  } catch (error) {
    state.profileError = error.message || t("errors.generic");
  } finally {
    state.profileBusy = false;
    renderContentOnly();
  }
}

function reportsView() {
  const activeStudents = people.students.filter((s) => s.status === "Active").length;
  const pausedStudents = people.students.filter((s) => s.status === "Paused").length;
  const attendanceAlerts = people.students.filter((s) => s.absences >= school.settings.absenceThreshold).length;
  const lateArrivals = people.students.reduce((sum, s) => sum + (s.late || 0), 0);
  const pending = assignments.reduce((sum, a) => sum + Math.max(a.total - a.submissions, 0), 0);

  return `
    <div class="toolbar"><button onclick="exportReportsCsv()">${t("common.exportCsv")}</button></div>
    <div class="report-grid">
      <section class="panel">${reportBlock(t("reports.enrollment"), [[t("reports.active"), activeStudents], [t("reports.paused"), pausedStudents], [t("common.total"), people.students.length]])}</section>
      <section class="panel">${reportBlock(t("reports.attendance"), [[t("reports.average"), `${average(people.students.map((s) => s.attendance))}%`], [t("reports.atRisk"), attendanceAlerts], [t("reports.lateArrivals"), lateArrivals]])}</section>
      <section class="panel">${reportBlock(t("reports.academic"), [[t("reports.completion"), `${average(groups.map((g) => g.completion))}%`], [t("reports.avgGrade"), `${average(people.students.map((s) => s.avgGrade))}%`], [t("reports.ungraded"), pending]])}</section>
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
    [t("reports.csv.section"), t("reports.csv.metric"), t("reports.csv.value")],
    [t("reports.enrollment"), t("reports.active"), activeStudents],
    [t("reports.enrollment"), t("reports.paused"), pausedStudents],
    [t("reports.enrollment"), t("common.total"), people.students.length],
    [t("reports.attendance"), t("reports.average"), `${average(people.students.map((s) => s.attendance))}%`],
    [t("reports.attendance"), t("reports.atRisk"), attendanceAlerts],
    [t("reports.attendance"), t("reports.lateArrivals"), lateArrivals],
    [t("reports.academic"), t("reports.completion"), `${average(groups.map((g) => g.completion))}%`],
    [t("reports.academic"), t("reports.avgGrade"), `${average(people.students.map((s) => s.avgGrade))}%`],
    [t("reports.academic"), t("reports.ungraded"), pending],
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
      <section class="panel"><h2>${t("settings.school.heading")}</h2><label>${t("settings.school.name")}<input name="schoolName" value="${escapeHtml(school.name)}" required /></label><label>${t("settings.school.portalUrl")}<input name="portalUrl" value="${escapeHtml(school.portalUrl)}" /></label></section>
      <section class="panel"><h2>${t("settings.attendance.heading")}</h2><label>${t("settings.attendance.threshold")}<input name="absenceThreshold" type="number" min="1" value="${school.settings.absenceThreshold}" required /></label><label>${t("settings.attendance.dueSoon")}<input name="dueSoonHours" type="number" min="1" value="${school.settings.dueSoonHours}" required /></label><label class="switch"><span>${t("settings.attendance.familyEmails")}</span><input name="parentAssignmentEmails" type="checkbox" ${school.settings.parentAssignmentEmails ? "checked" : ""} /><span class="switch-track"></span></label></section>
      <section class="panel"><h2>${t("settings.uploads.heading")}</h2><label>${t("settings.uploads.limit")}<input name="maxUploadMb" type="number" min="1" value="${school.settings.maxUploadMb}" required /></label><p class="hint">${t("settings.uploads.hint", { link: `<button type="button" onclick="navigate('accounts')">${t("nav.accounts")}</button>` })}</p></section>
      <section class="panel"><h2>${t("settings.careers.heading")}</h2><label>${t("settings.careers.email")}<input name="careersEmail" type="email" value="${escapeHtml(school.settings.careersEmail)}" placeholder="careers@yourschool.com" /></label><p class="hint">${t("settings.careers.hint")}</p></section>
      <div class="toolbar"><button type="submit" ${state.settingsBusy ? "disabled" : ""}>${state.settingsBusy ? t("common.saving") : t("settings.save")}</button></div>
    </form>
  `;
}

function searchResults() {
  const term = state.query;
  const viewer = currentViewer();
  const rows = safeSearchRowsForViewer(viewer, [
    ...people.students.map((s) => ({ type: t("search.type.student"), title: fullName(s), detail: `${s.email} · ${groupName(s.groupId)}`, student: s, moduleId: "students" })),
    ...people.instructors.map((i) => ({ type: t("search.type.instructor"), title: i.name, detail: `${i.email} · ${(i.classes || []).join(", ")}`, staffOnly: true })),
    ...groups.map((g) => ({ type: t("search.type.group"), title: g.name, detail: `${g.course} · ${g.instructor || ""}`, moduleId: "groups" })),
    // moduleId "groups", not "assignments" — an assignment now lives on
    // its group's own page (see groupDetailView()), there's no standalone
    // Assignments tab to gate this against anymore.
    ...assignments.map((a) => ({ type: t("search.type.assignment"), title: a.title, detail: `${a.course} · ${a.due || ""}`, moduleId: "groups" })),
  ]).filter((row) => `${row.type} ${row.title} ${row.detail}`.toLowerCase().includes(term));

  return `
    <section class="panel">
      <div class="panel-head"><h2>${t("search.title")}</h2><span>${t("search.matches", { count: rows.length })}</span></div>
      <div class="results">${rows.map((row) => `<article><span>${escapeHtml(row.type)}</span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.detail)}</small></article>`).join("") || `<p class="empty">${t("search.noMatches")}</p>`}</div>
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
// Supabase migrations to decide who is actually allowed to do what — the
// same policies that already govern reads.
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

// PATCHes an existing row, filtered by one column/value pair (almost
// always the row's own id/ref column). Used by every "Edit ..." form
// below — RLS (and, for groups/students, the column-restricting triggers
// in supabase/migrations/0012_...sql) is what actually decides whether a
// given viewer's edit is allowed; this is just the HTTP call.
async function supabaseUpdate(table, filterColumn, filterValue, patch) {
  if (!state.session) throw new Error("Sign in and try again.");
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/rest/v1/${table}?${encodeURIComponent(filterColumn)}=eq.${encodeURIComponent(filterValue)}`, {
    method: "PATCH",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session.access_token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error(friendlyDuplicateMessage(body) || `That already exists in ${table} — check for a duplicate entry.`);
    }
    throw new Error(body?.message || body?.hint || `Could not save changes to ${table}.`);
  }
  if (Array.isArray(body) && body.length === 0) {
    throw new Error(`No matching ${table} row was updated — you may not have permission to change it.`);
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
// attendance/grades, where re-submitting should overwrite existing rows
// instead of creating duplicates (see the `unique` constraints in the
// Supabase migrations).
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

async function supabaseUploadFile(path, file, bucket = "materials") {
  if (!state.session) throw new Error("Sign in and try again.");
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
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

// Best-effort: used when deleting a group, to clean up that group's
// uploaded material files from storage before the DB row cascade-deletes
// the `materials` table rows themselves (deleting the `groups` row alone
// doesn't touch Storage — see handleRemoveGroup()). A failed delete here
// is swallowed by the caller rather than blocking the group deletion; an
// orphaned file is a much smaller problem than a group that won't delete.
async function supabaseDeleteFile(path, bucket = "materials") {
  if (!state.session) return;
  if (config.r2Enabled) {
    // Best-effort, same as the Supabase branch below — a failed delete
    // here just leaves an orphaned R2 object, not a broken group deletion.
    await fetch("/api/storage-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.session.access_token}` },
      body: JSON.stringify({ purpose: bucket, key: path }),
    }).catch(() => {});
    return;
  }
  const base = config.supabaseUrl.replace(/\/$/, "");
  await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    method: "DELETE",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session.access_token}`,
    },
  });
}

async function supabaseDownloadFile(path, fileName, bucket = "materials") {
  if (!state.session) return;
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
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

// Same idea as supabaseDownloadFile(), but opens the blob in a new tab
// instead of forcing a save — used as the pre-R2 fallback for "View" (see
// openStorageFile() below). A blob: URL renders natively for anything the
// browser already knows how to display (images, PDFs, video, audio); for
// anything else the browser's own download-prompt behavior for an
// unrecognized type is exactly the same fallback a plain Supabase Storage
// URL would have given anyway.
async function viewPrivateFileBlob(path, bucket = "materials") {
  if (!state.session) return;
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session.access_token}`,
    },
  });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------------------------------------------------------------
// Cloudflare R2 file storage. See api/_lib/r2.js, api/storage-upload-url.js,
// api/storage-view-url.js, and scripts/migrate-storage-to-r2.mjs. Every
// call site that used to go straight at Supabase Storage (materials,
// assignment attachments, and student submissions — never gallery, which
// is public and handled separately by galleryPublicUrl() below) now goes
// through openStorageFile()/uploadStorageFile() instead, which pick
// between R2 and the original Supabase Storage path based on
// config.r2Enabled (see build.mjs) — so the app keeps working exactly as
// it always did right up until R2 is configured and the one-time
// migration script has run, with no user-visible transition at all.
// ---------------------------------------------------------------------

async function uploadStorageFile(purpose, key, file) {
  if (!config.r2Enabled) {
    await supabaseUploadFile(key, file, purpose);
    return;
  }
  if (!state.session) throw new Error("Sign in and try again.");
  const presignResponse = await fetch("/api/storage-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.session.access_token}` },
    body: JSON.stringify({ purpose, key, contentType: file.type || "application/octet-stream" }),
  });
  const presignBody = await presignResponse.json().catch(() => ({}));
  if (!presignResponse.ok) throw new Error(presignBody?.error || "Could not prepare the upload.");
  const uploadResponse = await fetch(presignBody.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error("Could not upload the file.");
}

// mode: "view" opens the file in a new tab (browsers render images, PDFs,
// video, and audio inline; anything else falls back to their own default
// handling for an unrecognized type). "download" forces a save-as. Both
// go through the exact same authorization check server-side — this only
// ever changes how the browser presents bytes it was already allowed to
// read.
async function openStorageFile(purpose, key, fileName, mode = "view") {
  if (!config.r2Enabled) {
    if (mode === "download") await supabaseDownloadFile(key, fileName, purpose);
    else await viewPrivateFileBlob(key, purpose);
    return;
  }
  if (!state.session) return;
  const response = await fetch("/api/storage-view-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.session.access_token}` },
    body: JSON.stringify({ purpose, key, mode, fileName }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) return;
  if (mode === "download") {
    const link = document.createElement("a");
    link.href = body.url;
    link.download = fileName || "file";
    link.click();
  } else {
    window.open(body.url, "_blank");
  }
}

// ---------------------------------------------------------------------
// Web Push notifications. See supabase/migrations/0015_push_subscriptions.sql
// and api/send-notification.js — this is the client half: opting in/out
// from profileView(), and a fire-and-forget helper every mutation handler
// below calls after its own write succeeds. A notification is always a
// side effect of something that already happened; if it fails (no VAPID
// keys configured yet, offline, browser doesn't support push, nobody
// subscribed), the real action it's reporting on has already gone through,
// so every call site below wraps this in a try/catch and never lets a
// notification failure surface as an error to the person who just, say,
// saved a grade.
// ---------------------------------------------------------------------

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Boolean(config.vapidPublicKey);
}

// PushManager wants the VAPID public key as a raw Uint8Array, not the
// base64url string everything else here hands around.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

// Reflects whatever this browser is actually subscribed with into
// state.pushSubscribed, so the Profile toggle shows the real state on
// load rather than assuming "off". Silent no-op if push isn't supported
// or no service worker is registered yet.
async function refreshPushSubscriptionState() {
  if (!pushSupported()) {
    state.pushSubscribed = false;
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    state.pushSubscribed = Boolean(subscription);
  } catch {
    state.pushSubscribed = false;
  }
}

async function enableNotifications() {
  if (!pushSupported()) {
    state.pushError = t("profile.notifications.unsupported");
    renderContentOnly();
    return;
  }
  state.pushBusy = true;
  state.pushError = "";
  renderContentOnly();
  try {
    if (Notification.permission === "denied") {
      throw new Error(t("profile.notifications.denied"));
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(t("profile.notifications.denied"));
    }
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
      });
    }
    const json = subscription.toJSON();
    await supabaseUpsert(
      "push_subscriptions",
      [
        {
          user_id: state.session.user.id,
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth_key: json.keys?.auth,
          user_agent: navigator.userAgent,
        },
      ],
      "endpoint",
    );
    state.pushSubscribed = true;
  } catch (error) {
    state.pushError = error.message || t("profile.notifications.error");
  } finally {
    state.pushBusy = false;
    renderContentOnly();
  }
}

async function disableNotifications() {
  state.pushBusy = true;
  state.pushError = "";
  renderContentOnly();
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      const base = config.supabaseUrl.replace(/\/$/, "");
      await fetch(`${base}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: "DELETE",
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${state.session.access_token}`,
        },
      });
    }
    state.pushSubscribed = false;
  } catch (error) {
    state.pushError = error.message || t("profile.notifications.error");
  } finally {
    state.pushBusy = false;
    renderContentOnly();
  }
}

// Fire-and-forget: tells api/send-notification.js something happened so it
// can push whoever needs to know. Every call site awaits this (so a slow
// network doesn't reorder it after the next action) but always inside its
// own try/catch — see the callers below — so a notification failure is
// never allowed to look like the actual save failed.
async function notifyEvent(eventType, payload) {
  if (!state.session) return;
  await fetch("/api/send-notification", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.access_token}`,
    },
    body: JSON.stringify({ eventType, ...payload }),
  });
}

// The one event with no signed-in caller — see api/send-notification.js's
// comment on resolveReviewSubmitted for why this is safe unauthenticated.
async function notifyPublicEvent(eventType, payload) {
  await fetch("/api/send-notification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType, ...payload }),
  });
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
      groupRows,
      assignmentRows,
      materialRows,
      attendanceRows,
      staffRequestRows,
      gradeRows,
      submissionRows,
    ] = await Promise.all([
      safeSelect("school_settings"),
      safeSelect("students"),
      safeSelect("instructors"),
      safeSelect("groups"),
      safeSelect("assignments"),
      safeSelect("materials"),
      safeSelect("attendance_records"),
      safeSelect("staff_requests"),
      safeSelect("grades"),
      safeSelect("submissions"),
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
        groupId: student.group_id,
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

    groups = groupRows === null ? groups : groupRows.map((item) => ({
      id: item.group_id,
      name: item.name,
      course: item.course,
      instructor: item.instructor,
      schedule: item.schedule,
      room: item.room,
      status: item.status,
      completion: item.completion,
    }));

    assignments = assignmentRows === null ? assignments : assignmentRows.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      course: assignment.course,
      groupId: assignment.group_id,
      due: assignment.due_date,
      status: assignment.status,
      submissions: assignment.submissions,
      total: assignment.total,
      maxGrade: assignment.max_grade,
      difficulty: assignment.difficulty,
      attachmentPath: assignment.attachment_path,
      attachmentName: assignment.attachment_name,
    }));

    materials = materialRows === null ? materials : materialRows.map((material) => ({
      id: material.id,
      title: material.title,
      groupId: material.group_id,
      filePath: material.file_path,
      fileName: material.file_name,
      createdAt: material.created_at,
    }));

    attendanceRecords = attendanceRows === null ? attendanceRecords : attendanceRows.map((record) => ({
      id: record.id,
      studentId: record.student_id,
      groupId: record.group_id,
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

    grades = gradeRows === null ? grades : gradeRows.map((grade) => ({
      id: grade.id,
      assignmentId: grade.assignment_id,
      studentId: grade.student_id,
      score: grade.score,
      maxScore: grade.max_score,
      feedback: grade.feedback,
      updatedAt: grade.updated_at,
    }));

    submissions = submissionRows === null ? submissions : submissionRows.map((submission) => ({
      id: submission.id,
      assignmentId: submission.assignment_id,
      studentId: submission.student_id,
      filePath: submission.file_path,
      fileName: submission.file_name,
      submittedAt: submission.submitted_at,
    }));

    // Keeping this in plain, friendly language on purpose — dataSource.label
    // and .status are shown directly in the sidebar and top bar, so nothing
    // here should read like a developer log. The technical breakdown (which
    // table failed and why) still goes into dataSource.error, which is never
    // rendered anywhere in the UI — it's there only if someone inspects the
    // app from the browser console while troubleshooting.
    if (failures.length === 0) {
      dataSource.label = "Live";
      dataSource.status = "Your school's data is up to date.";
      dataSource.error = "";
    } else {
      const failedTables = failures.map((item) => item.table).join(", ");
      dataSource.label = failures.length === TOTAL_TABLES ? "Offline" : "Partially loaded";
      dataSource.status =
        failures.length === TOTAL_TABLES
          ? "We couldn't reach your school's live data — showing the last data loaded successfully."
          : "Most of your school's data is up to date — a few sections are showing the last data loaded successfully.";
      dataSource.error = failures.map((item) => `${item.table}: ${item.message}`).join(" · ");
    }
  } catch (error) {
    dataSource.label = "Offline";
    dataSource.status = "We couldn't reach your school's live data right now.";
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
// Dashboard modals: Add Group, Add Instructor, Add Student, Add Manager,
// Add Material, Add Assignment, Take Attendance, Grade Student, Staff
// Request, Add Opportunity. One small overlay system reused by all of
// them instead of a separate dialog implementation each.
// ---------------------------------------------------------------------

function openModal(type, extra = {}) {
  state.modal = { type, ...extra };
  state.modalBusy = false;
  state.modalError = "";
  state.modalNotice = "";
  if (type === "addExistingStudent") state.addStudentSearchQuery = "";
  render();
}

// Updates just the results list inside the open modal, the same way
// renderAttendanceRoster() does for the attendance modal — the modal
// itself lives outside #content (see modalHost() in shell()), so
// renderContentOnly() would never reach it, and a full render() on every
// keystroke would drop focus from the search input.
function setAddStudentSearchQuery(value) {
  state.addStudentSearchQuery = value;
  const container = document.getElementById("existing-student-results");
  if (container) container.innerHTML = existingStudentResultsRows(state.modal?.groupId);
}

function closeModal() {
  state.modal = null;
  state.modalBusy = false;
  state.modalError = "";
  state.modalNotice = "";
  render();
}

async function refreshAfterWrite() {
  await loadFromSupabase(state.session?.access_token);
  recomputeInstructorGroupIds();
  if (state.accountsDirectory) await loadAccountsDirectory();
}

function modalHost() {
  if (!state.modal) return "";
  return `
    <div class="modal-overlay" onclick="if (event.target === this) closeModal()">
      <div class="modal-box" role="dialog" aria-modal="true">
        <button type="button" class="modal-close" onclick="closeModal()" aria-label="${t("common.close")}">&times;</button>
        ${modalBody(state.modal)}
      </div>
    </div>
  `;
}

function modalMessages() {
  return `
    ${state.modalError ? `<p class="notice-row auth-error">${escapeHtml(state.modalError)}</p>` : ""}
    ${state.modalNotice ? `<p class="notice-row m-success">${escapeHtml(state.modalNotice)}</p>` : ""}
  `;
}

function modalBody(modal) {
  switch (modal.type) {
    case "addGroup":
      return addGroupModal();
    case "editGroup":
      return editGroupModal(modal);
    case "addInstructor":
      return addInstructorModal();
    case "editInstructor":
      return editInstructorModal(modal);
    case "addStudent":
      return addStudentModal(modal);
    case "editStudent":
      return editStudentModal(modal);
    case "addExistingStudent":
      return addExistingStudentModal(modal);
    case "addManager":
      return addManagerModal();
    case "addMaterial":
      return addMaterialModal(modal);
    case "addAssignment":
      return addAssignmentModal(modal);
    case "assignmentDetail":
      return assignmentDetailModal(modal);
    case "takeAttendance":
      return addAttendanceModal(modal);
    case "gradeStudent":
      return gradeStudentModal(modal);
    case "addStaffRequest":
      return addStaffRequestModal();
    case "addOpportunity":
      return addOpportunityModal();
    case "addGalleryItem":
      return addGalleryItemModal();
    default:
      return "";
  }
}

// Manager-only (see security.js's canCreateGroups) — an Instructor is
// assigned to a group here but can never create one themselves.
function addGroupModal() {
  if (people.instructors.length === 0) {
    return emptyDependencyNotice(
      t("groups.needInstructorTitle"),
      t("groups.needInstructorBody"),
      t("groups.addInstructorCta"),
      "addInstructor",
    );
  }
  const instructorOptions = people.instructors
    .map((instructor) => `<option value="${escapeHtml(instructor.name)}">${escapeHtml(instructor.name)}</option>`)
    .join("");
  return `
    <h2>${t("groups.new")}</h2>
    ${modalMessages()}
    <form onsubmit="handleAddGroup(event)">
      <label>${t("groups.form.name")}<input type="text" name="name" required /></label>
      <label>${t("groups.form.course")}<input type="text" name="course" required /></label>
      <label>${t("groups.form.instructor")}<select name="instructor" required><option value="">${t("groups.form.instructor.choose")}</option>${instructorOptions}</select></label>
      <label>${t("groups.form.schedule")}<input type="text" name="schedule" placeholder="${t("groups.form.schedule.placeholder")}" /></label>
      <label>${t("groups.form.room")}<input type="text" name="room" placeholder="${t("groups.form.room.placeholder")}" /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("groups.form.create")}</button>
      </div>
    </form>
  `;
}

// Manager sees every field, including course/instructor. That group's own
// Instructor (canManageGroup() is what gates the "Edit" button that opens
// this) only sees name/schedule/room/status — course and instructor are
// left out of the form entirely for them rather than shown disabled, so
// there's nothing to be surprised the server rejected: the column-
// restricting trigger in supabase/migrations/0012_...sql would reject
// those two fields from a non-Manager anyway.
function editGroupModal(modal) {
  const group = groups.find((g) => g.id === modal.groupId);
  if (!group) {
    return `<h2>${t("groups.edit")}</h2><p class="hint">${t("groups.notFound")}</p><div class="modal-actions"><button type="button" onclick="closeModal()">${t("common.close")}</button></div>`;
  }
  const isManager = ["Super Admin", "School Admin"].includes(state.role);
  const instructorOptions = people.instructors
    .map((instructor) => `<option value="${escapeHtml(instructor.name)}" ${instructor.name === group.instructor ? "selected" : ""}>${escapeHtml(instructor.name)}</option>`)
    .join("");
  const statusOptions = ["Active", "Paused", "Completed", "Archived"]
    .map((s) => `<option value="${s}" ${s === group.status ? "selected" : ""}>${s}</option>`)
    .join("");
  return `
    <h2>${t("groups.edit")}</h2>
    ${modalMessages()}
    <form onsubmit="handleEditGroup(event, '${escapeJs(group.id)}')">
      <label>${t("groups.form.name")}<input type="text" name="name" value="${escapeHtml(group.name)}" required /></label>
      ${isManager ? `<label>${t("groups.form.course")}<input type="text" name="course" value="${escapeHtml(group.course)}" required /></label>` : ""}
      ${isManager ? `<label>${t("groups.form.instructor")}<select name="instructor" required>${instructorOptions}</select></label>` : ""}
      <label>${t("groups.form.schedule")}<input type="text" name="schedule" value="${escapeHtml(group.schedule || "")}" placeholder="${t("groups.form.schedule.placeholder")}" /></label>
      <label>${t("groups.form.room")}<input type="text" name="room" value="${escapeHtml(group.room || "")}" placeholder="${t("groups.form.room.placeholder")}" /></label>
      <label>${t("common.status")}<select name="status">${statusOptions}</select></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("common.saveChanges")}</button>
      </div>
    </form>
  `;
}

function addInstructorModal() {
  return `
    <h2>${t("instructors.form.submit")}</h2>
    <p class="hint">${t("instructors.form.hint")}</p>
    ${modalMessages()}
    <form onsubmit="handleAddInstructor(event)">
      <label>${t("instructors.form.name")}<input type="text" name="name" required /></label>
      <label>${t("instructors.form.email")}<input type="email" name="email" required /></label>
      <label class="checkline"><input type="checkbox" name="issueLogin" checked /> ${t("instructors.form.issueLogin")}</label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("instructors.form.submit")}</button>
      </div>
    </form>
  `;
}

// Manager-only (see security.js's canEditInstructorProfiles) — an
// Instructor's own info (name/email/bio) is never self-editable from
// here; only the group info they're assigned to (see editGroupModal).
function editInstructorModal(modal) {
  const instructor = people.instructors.find((i) => i.name === modal.instructorName);
  if (!instructor) {
    return `<h2>${t("instructors.edit")}</h2><p class="hint">${t("instructors.notFound")}</p><div class="modal-actions"><button type="button" onclick="closeModal()">${t("common.close")}</button></div>`;
  }
  return `
    <h2>${t("instructors.edit")}</h2>
    ${modalMessages()}
    <form onsubmit="handleEditInstructor(event, '${escapeJs(instructor.name)}')">
      <label>${t("instructors.form.name")}<input type="text" name="name" value="${escapeHtml(instructor.name)}" required /></label>
      <label>${t("instructors.form.email")}<input type="email" name="email" value="${escapeHtml(instructor.email)}" required /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("common.saveChanges")}</button>
      </div>
    </form>
  `;
}

// `modal.groupId` is set when this is opened from a group's own page (see
// groupDetailView()'s "Add student" button) — the group picker collapses
// to a fixed, non-editable field so the new student always lands in that
// exact group, matching addMaterialModal/addAssignmentModal's pattern.
// Opened from the school-wide Students tab instead, the picker is back
// (any group the viewer can put a student into).
function addStudentModal(modal = {}) {
  const isInstructor = state.role === "Instructor";
  const availableGroups = groupsForViewer();
  const lockedGroup = modal.groupId ? groups.find((g) => g.id === modal.groupId) : null;
  if (!lockedGroup && availableGroups.length === 0) {
    return emptyDependencyNotice(
      t("students.new"),
      t("groups.needInstructorBody"),
      t("groups.new"),
      "addGroup",
    );
  }
  const groupOptions = availableGroups
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join("");
  return `
    <h2>${t("students.new")}</h2>
    ${lockedGroup ? `<p class="hint">${escapeHtml(lockedGroup.name)}</p>` : isInstructor ? `<p class="hint">${t("students.instructorHint")}</p>` : ""}
    ${modalMessages()}
    <form onsubmit="handleAddStudent(event)">
      <label>${t("students.csv.header.first")}<input type="text" name="firstName" required /></label>
      <label>${t("students.csv.header.last")}<input type="text" name="lastName" required /></label>
      <label>${t("common.email")}<input type="email" name="email" required /></label>
      ${
        lockedGroup
          ? `<input type="hidden" name="groupId" value="${escapeHtml(lockedGroup.id)}" />`
          : `<label>${t("groups.title")}<select name="groupId" required><option value="">${t("groups.form.instructor.choose")}</option>${groupOptions}</select></label>`
      }
      <label class="checkline"><input type="checkbox" name="issueLogin" checked /> ${t("instructors.form.issueLogin")}</label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("students.new")}</button>
      </div>
    </form>
  `;
}

// Manager-only (see security.js's canAddExistingStudentToGroup) — finds a
// student already enrolled elsewhere (or with no group at all) and moves
// them into this group, as an alternative to creating a brand-new student
// profile. Opened from a group's own page (see groupDetailView()).
function addExistingStudentModal(modal) {
  const group = groups.find((g) => g.id === modal.groupId);
  if (!group) {
    return `<h2>${t("groups.addExisting.title")}</h2><p class="hint">${t("groups.notFound")}</p><div class="modal-actions"><button type="button" onclick="closeModal()">${t("common.close")}</button></div>`;
  }
  return `
    <h2>${t("groups.addExisting.title")}</h2>
    <p class="hint">${escapeHtml(group.name)}</p>
    ${modalMessages()}
    <label>${t("common.search")}
      <input type="search" value="${escapeHtml(state.addStudentSearchQuery || "")}" oninput="setAddStudentSearchQuery(this.value)" placeholder="${t("groups.addExisting.searchPlaceholder")}" autofocus />
    </label>
    <div class="modal-existing-list" id="existing-student-results">${existingStudentResultsRows(modal.groupId)}</div>
  `;
}

function existingStudentResultsRows(groupId) {
  const query = (state.addStudentSearchQuery || "").trim().toLowerCase();
  if (!query) return `<p class="hint">${t("groups.addExisting.typeToSearch")}</p>`;
  const matches = people.students
    .filter((s) => s.groupId !== groupId)
    .filter((s) => `${fullName(s)} ${s.email}`.toLowerCase().includes(query))
    .slice(0, 20);
  if (!matches.length) return `<p class="empty">${t("groups.addExisting.noMatches")}</p>`;
  return matches
    .map(
      (s) => `
        <div class="modal-existing-row">
          <div>
            <strong>${escapeHtml(fullName(s))}</strong>
            <span>${escapeHtml(s.email)} · ${escapeHtml(groupName(s.groupId))}</span>
          </div>
          <button type="button" onclick="handleAddExistingStudentToGroup('${escapeJs(s.id)}', '${escapeJs(groupId)}')" ${state.modalBusy ? "disabled" : ""}>${t("groups.addExisting.add")}</button>
        </div>
      `,
    )
    .join("");
}

async function handleAddExistingStudentToGroup(studentId, groupId) {
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseUpdate("students", "student_id", studentId, { group_id: groupId });
    await refreshAfterWrite();
    closeModal();
    openGroupDetail(groupId);
    try {
      await notifyEvent("group_assigned", { studentRef: studentId });
    } catch {
      // notification is best-effort — the assignment itself already saved
    }
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("groups.addExisting.saveError");
    render();
  }
}

// A Manager (see security.js's canEditStudent) edits from the school-wide
// Students tab; that student's own Instructor edits the same fields from
// the group's roster (see groupDetailView()). Email/group are never in
// this form — moving a student to a different group is
// addExistingStudentModal()'s job, and changing their login email stays
// Manager-only at the server (see supabase/migrations/0012_...sql), so
// there's no point offering either field here to someone it would just
// get rejected for.
function editStudentModal(modal) {
  const student = people.students.find((s) => s.id === modal.studentId);
  if (!student) {
    return `<h2>${t("students.edit")}</h2><p class="hint">${t("students.notFound")}</p><div class="modal-actions"><button type="button" onclick="closeModal()">${t("common.close")}</button></div>`;
  }
  const isManager = ["Super Admin", "School Admin"].includes(state.role);
  const statusOptions = ["Active", "Paused", "Graduated", "Withdrawn"]
    .map((s) => `<option value="${s}" ${s === student.status ? "selected" : ""}>${s}</option>`)
    .join("");
  return `
    <h2>${t("students.edit")}</h2>
    ${modalMessages()}
    <form onsubmit="handleEditStudent(event, '${escapeJs(student.id)}')">
      <label>${t("students.csv.header.first")}<input type="text" name="firstName" value="${escapeHtml(student.first)}" required /></label>
      <label>${t("students.csv.header.last")}<input type="text" name="lastName" value="${escapeHtml(student.last)}" required /></label>
      <label>${t("students.profile.phone")}<input type="text" name="phone" value="${escapeHtml(student.phone || "")}" /></label>
      <label>${t("students.profile.level")}<input type="text" name="level" value="${escapeHtml(student.level || "")}" /></label>
      ${isManager ? `<label>${t("common.status")}<select name="status">${statusOptions}</select></label>` : ""}
      <label>${t("students.profile.notes")}<textarea name="notes" rows="3">${escapeHtml(student.notes || "")}</textarea></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("common.saveChanges")}</button>
      </div>
    </form>
  `;
}

function addManagerModal() {
  return `
    <h2>${t("addManager.title")}</h2>
    <p class="hint">${t("addManager.hint")}</p>
    ${modalMessages()}
    <form onsubmit="handleAddManager(event)">
      <label>${t("instructors.form.name")}<input type="text" name="name" required /></label>
      <label>${t("instructors.form.email")}<input type="email" name="email" required /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("addManager.submit")}</button>
      </div>
    </form>
  `;
}

// Opened from a group's own page (groupDetailView) — the group is already
// known, so there's no group picker here anymore (materials are no longer
// split across a class + an optional sub-group).
function addMaterialModal(modal) {
  const group = groups.find((g) => g.id === modal.groupId);
  return `
    <h2>${t("materials.upload")}</h2>
    <p class="hint">${escapeHtml(group?.name || "")}</p>
    ${modalMessages()}
    <form onsubmit="handleAddMaterial(event, '${escapeJs(modal.groupId)}')">
      <label>${t("materials.form.title")}<input type="text" name="title" required /></label>
      <label>${t("materials.form.file")}<input type="file" name="file" required /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.uploading") : t("materials.form.submit")}</button>
      </div>
    </form>
  `;
}

// Opened from a group's own page (groupDetailView) — same shape as
// addMaterialModal(): the group is already known, so there's no group
// picker here anymore.
function addAssignmentModal(modal) {
  const group = groups.find((g) => g.id === modal.groupId);
  return `
    <h2>${t("assignments.new")}</h2>
    <p class="hint">${escapeHtml(group?.name || "")}</p>
    ${modalMessages()}
    <form onsubmit="handleAddAssignment(event, '${escapeJs(modal.groupId)}')">
      <label>${t("assignments.form.title")}<input type="text" name="title" required /></label>
      <label>${t("assignments.form.course")}<input type="text" name="course" required value="${escapeHtml(group?.course || "")}" /></label>
      <label>${t("assignments.form.due")}<input type="date" name="dueDate" /></label>
      <label>${t("assignments.form.maxGrade")}<input type="number" name="maxGrade" value="100" min="1" /></label>
      <label>${t("assignments.form.difficulty")}
        <select name="difficulty">
          <option value="Beginner">${t("assignments.form.difficulty.beginner")}</option>
          <option value="Intermediate">${t("assignments.form.difficulty.intermediate")}</option>
          <option value="Advanced">${t("assignments.form.difficulty.advanced")}</option>
        </select>
      </label>
      <label>${t("assignments.form.attachment")}<input type="file" name="attachment" /></label>
      <p class="hint">${t("assignments.form.attachment.hint")}</p>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("assignments.form.create")}</button>
      </div>
    </form>
  `;
}

// Opened from a group's own page — that group's own Instructor (or a
// Manager) takes attendance for its own roster, per session. No class or
// group picker: this modal is always already scoped to one group (see
// security.js's canManageGroup(), which is what shows/hides the "Take
// attendance" button on groupDetailView() in the first place).
function addAttendanceModal(modal) {
  const group = groups.find((g) => g.id === modal.groupId);
  const today = new Date().toISOString().slice(0, 10);
  return `
    <h2>${t("attendance.take")} — ${escapeHtml(group?.name || "")}</h2>
    ${modalMessages()}
    <form onsubmit="handleTakeAttendance(event, '${escapeJs(modal.groupId)}')">
      <label>${t("attendance.table.date")}
        <input type="date" name="date" id="attendance-date-input" value="${today}" onchange="renderAttendanceRoster('${escapeJs(modal.groupId)}', this.value)" />
      </label>
      <div id="attendance-roster">${attendanceRosterRows(modal.groupId, today)}</div>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.saving") : t("settings.save")}</button>
      </div>
    </form>
  `;
}

// Re-rendered whenever the date changes: pre-fills each student's status
// from any attendance already saved for that exact group/date, so
// reopening the same day shows what was marked instead of resetting
// everyone back to "Present".
function attendanceRosterRows(groupId, date) {
  const roster = studentsInGroup(groupId);
  if (!roster.length) return `<p class="hint">${t("attendance.noRoster")}</p>`;
  const existing = new Map(
    attendanceRecords.filter((record) => record.groupId === groupId && record.date === date).map((record) => [record.studentId, record.status]),
  );
  return `
    <fieldset class="modal-checklist">
      <legend>${t("attendance.markEach")}</legend>
      ${roster
        .map((student) => {
          const current = existing.get(student.id) || "present";
          return `
            <div class="attendance-row">
              <span>${escapeHtml(fullName(student))}</span>
              <select name="status-${escapeHtml(student.id)}" data-student-id="${escapeHtml(student.id)}">
                <option value="present" ${current === "present" ? "selected" : ""}>${t("attendance.status.present")}</option>
                <option value="absent" ${current === "absent" ? "selected" : ""}>${t("attendance.status.absent")}</option>
                <option value="late" ${current === "late" ? "selected" : ""}>${t("attendance.status.late")}</option>
                <option value="excused" ${current === "excused" ? "selected" : ""}>${t("attendance.status.excused")}</option>
              </select>
            </div>
          `;
        })
        .join("")}
    </fieldset>
  `;
}

function renderAttendanceRoster(groupId, date) {
  const container = document.getElementById("attendance-roster");
  if (!container) return;
  container.innerHTML = attendanceRosterRows(groupId, date);
}

async function handleTakeAttendance(event, groupId) {
  event.preventDefault();
  const form = event.target;
  const date = form.date.value;
  const selects = [...form.querySelectorAll("select[data-student-id]")];
  if (!date) {
    state.modalError = t("attendance.needDate");
    render();
    return;
  }
  if (!selects.length) {
    state.modalError = t("attendance.needStudents");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const rows = selects.map((select) => ({
      student_id: select.dataset.studentId,
      group_id: groupId,
      session_date: date,
      status: select.value,
    }));
    await supabaseUpsert("attendance_records", rows, "student_id,group_id,session_date");
    await refreshAfterWrite();
    closeModal();
    openGroupDetail(groupId);
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("attendance.form.saveError");
    render();
  }
}
function addStaffRequestModal() {
  const ownStudents = filterStudentsForViewer(currentViewer(), people.students);
  const studentOptions = ownStudents
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(fullName(s))} · ${escapeHtml(groupName(s.groupId))}</option>`)
    .join("");
  return `
    <h2>${t("requests.new.toManagers")}</h2>
    <p class="hint">${t("requests.new.body")}</p>
    ${modalMessages()}
    <form onsubmit="handleAddStaffRequest(event)">
      <label>${t("requests.type")}
        <select name="kind" onchange="toggleStaffRequestFields(this.value)">
          <option value="message">${t("requests.type.message")}</option>
          <option value="holiday">${t("requests.type.holiday")}</option>
          <option value="removal">${t("requests.type.removal")}</option>
        </select>
      </label>
      <div id="staff-request-student" hidden>
        <label>${t("requests.student")}
          <select name="studentRef">
            <option value="">${t("requests.student.choose")}</option>
            ${studentOptions}
          </select>
        </label>
        ${ownStudents.length === 0 ? `<p class="hint">${t("requests.noOwnStudents")}</p>` : ""}
      </div>
      <label>${t("requests.subject")}<input type="text" name="subject" required /></label>
      <label>${t("requests.details")}<textarea name="message" rows="3"></textarea></label>
      <div id="staff-request-dates" hidden>
        <label>${t("requests.startDate")}<input type="date" name="startDate" /></label>
        <label>${t("requests.endDate")}<input type="date" name="endDate" /></label>
      </div>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.sending") : t("requests.send")}</button>
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
    state.modalError = t("requests.needSubject");
    render();
    return;
  }
  if (!instructorName) {
    state.modalError = t("requests.needInstructorLink");
    render();
    return;
  }
  let targetStudentId = null;
  let targetStudentName = null;
  if (kind === "removal") {
    if (!studentRef) {
      state.modalError = t("requests.chooseStudent");
      render();
      return;
    }
    const targetStudent = filterStudentsForViewer(currentViewer(), people.students).find((s) => s.id === studentRef);
    if (!targetStudent) {
      state.modalError = t("requests.studentNotYours");
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
    const inserted = await supabaseInsert("staff_requests", [
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
    const requestId = inserted?.[0]?.id;
    if (requestId) {
      try {
        await notifyEvent("staff_request_submitted", { requestId });
      } catch {
        // notification is best-effort — the request itself already saved
      }
    }
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("requests.form.saveError");
    render();
  }
}

function staffRequestsView() {
  const isManager = ["Super Admin", "School Admin"].includes(state.role);
  const rows = isManager ? staffRequests : staffRequests.filter((r) => r.instructorName === state.viewerContext?.instructorName);

  return `
    ${state.staffRequestNotice ? `<p class="notice-row ${state.staffRequestNotice.type === "error" ? "auth-error" : "m-success"}">${escapeHtml(state.staffRequestNotice.message)}<button type="button" class="notice-dismiss" onclick="dismissStaffRequestNotice()" aria-label="${t("common.dismiss")}">&times;</button></p>` : ""}
    <div class="toolbar">${!isManager ? `<button onclick="openModal('addStaffRequest')">${t("requests.new")}</button>` : ""}</div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>${isManager ? t("requests.title") : t("requests.titleMine")}</h2><span>${assignments.length >= 0 ? rows.length : rows.length} ${t("common.total").toLowerCase()}</span></div>
      <table>
        <thead><tr>${isManager ? `<th>${t("requests.from")}</th>` : ""}<th>${t("requests.type")}</th><th>${t("requests.subject")}</th><th>${t("requests.details")}</th><th>${t("common.status")}</th>${isManager ? `<th>${t("common.action")}</th>` : ""}</tr></thead>
        <tbody>
          ${
            rows.map((r) => staffRequestRow(r, isManager)).join("") ||
            `<tr><td colspan="${isManager ? 6 : 4}" class="empty">${isManager ? t("requests.noneYet") : t("requests.noneSent")}</td></tr>`
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
    ? `${t("requests.type.removal")}: ${escapeHtml(request.targetStudentName || request.targetStudentId || "")}${request.message ? ` · ${escapeHtml(request.message)}` : ""}`
    : request.kind === "holiday"
      ? `${request.startDate || "?"} → ${request.endDate || "?"}${request.message ? ` · ${escapeHtml(request.message)}` : ""}`
      : escapeHtml(request.message) || "—";
  const kindLabel = isRemoval ? t("requests.kind.removal") : request.kind === "holiday" ? t("requests.kind.holiday") : t("requests.kind.message");
  const approveHandler = isRemoval ? `approveRemovalRequest('${request.id}')` : `setStaffRequestStatus('${request.id}', 'approved')`;
  const approveLabel = busy ? t("common.working") : isRemoval ? t("requests.approveAndRemove") : t("common.approve");
  const statusLabel = request.status.charAt(0).toUpperCase() + request.status.slice(1);
  return `
    <tr>
      ${isManager ? `<td>${escapeHtml(request.instructorName)}</td>` : ""}
      <td>${badge(kindLabel)}</td>
      <td><strong>${escapeHtml(request.subject)}</strong></td>
      <td>${details}</td>
      <td>${badge(statusLabel)}</td>
      ${
        isManager
          ? `<td>
              <button onclick="${approveHandler}" ${busy ? "disabled" : ""}>${approveLabel}</button>
              <button onclick="setStaffRequestStatus('${request.id}', 'denied')" ${busy ? "disabled" : ""}>${t("common.deny")}</button>
              <button onclick="setStaffRequestStatus('${request.id}', 'read')" ${busy ? "disabled" : ""}>${t("common.markRead")}</button>
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
    try {
      await notifyEvent("request_status_changed", { requestId: id });
    } catch {
      // notification is best-effort — the status change itself already saved
    }
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
  const label = request.targetStudentName || request.targetStudentId || "";
  if (!window.confirm(t("requests.confirmRemove", { name: label }))) return;
  state.staffRequestBusy = request.id;
  state.staffRequestNotice = null;
  renderContentOnly();
  try {
    await removeAccountApi({ role: "Student", ref: request.targetStudentId });
    await setStaffRequestStatus(request.id, "approved");
    state.staffRequestNotice = { type: "success", message: t("requests.removedNotice", { name: label }) };
  } catch (error) {
    state.staffRequestNotice = { type: "error", message: error.message || t("students.removeError") };
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

// A "back" arrow points the way the reader's eye actually goes back —
// left in English/Italian, right in Arabic — so it's derived from the
// current language rather than hardcoded, unlike a plain "&larr;" would
// be. Used on every "&larr; Back to ..." button across the auth screens
// and the group detail page.
function backArrow() {
  return isRtl(state.lang) ? "→" : "←";
}

// Several "Add ..." forms depend on another kind of record existing first
// (a group needs an instructor to assign; a student/assignment needs a
// group to belong to). On a brand-new school with nothing created yet,
// showing a required dropdown with zero options is a dead end — this
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

async function handleAddGroup(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const course = form.course.value.trim();
  const instructor = form.instructor.value.trim();
  const schedule = form.schedule.value.trim();
  const room = form.room.value.trim();
  if (!name || !course || !instructor) {
    state.modalError = t("groups.form.missingFields");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const groupId = nextRefId("GRP", groups.map((item) => item.id));
    await supabaseInsert("groups", [
      {
        group_id: groupId,
        name,
        course,
        instructor,
        schedule: schedule || null,
        room: room || null,
        status: "Active",
        completion: 0,
      },
    ]);
    await refreshAfterWrite();
    closeModal();
    navigate("groups");
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("groups.form.saveError");
    render();
  }
}

async function handleEditGroup(event, groupId) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const schedule = form.schedule.value.trim();
  const room = form.room.value.trim();
  const status = form.status.value;
  if (!name) {
    state.modalError = t("groups.form.missingFields");
    render();
    return;
  }
  const patch = { name, schedule: schedule || null, room: room || null, status };
  // Only present in the form at all for a Manager (see editGroupModal) —
  // an Instructor editing their own group never sends these two fields,
  // so there's nothing here for the server-side trigger to even need to
  // reject.
  if (form.course) patch.course = form.course.value.trim();
  if (form.instructor) patch.instructor = form.instructor.value.trim();
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseUpdate("groups", "group_id", groupId, patch);
    await refreshAfterWrite();
    closeModal();
    openGroupDetail(groupId);
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("groups.form.saveError");
    render();
  }
}

// Manager-only (see security.js's canRemoveGroups) and irreversible: the
// group row cascade-deletes its attendance records, materials, chat
// messages, and assignments (see the FK constraints in
// supabase/migrations/0011_...sql); students in the group are kept, just
// unassigned (group_id set to null). Storage files for this group's
// materials are cleaned up best-effort first, since deleting the DB row
// doesn't touch actual files sitting in the storage bucket.
async function handleRemoveGroup(groupId, name) {
  if (!state.session) return;
  if (!window.confirm(t("groups.confirmRemove", { name }))) return;
  state.groupActionBusy = groupId;
  state.groupActionError = "";
  renderContentOnly();
  try {
    const groupMaterials = materials.filter((m) => m.groupId === groupId);
    await Promise.all(groupMaterials.map((m) => supabaseDeleteFile(m.filePath).catch(() => {})));
    const base = config.supabaseUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/rest/v1/groups?group_id=eq.${encodeURIComponent(groupId)}`, {
      method: "DELETE",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        Prefer: "return=minimal",
      },
    });
    if (!response.ok) throw new Error(t("groups.form.removeError"));
    await refreshAfterWrite();
    state.groupActionBusy = null;
    backToGroups();
  } catch (error) {
    state.groupActionBusy = null;
    state.groupActionError = error.message || t("groups.form.removeError");
    renderContentOnly();
  }
}

async function handleAddInstructor(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  const issueLogin = form.issueLogin.checked;
  if (!name || !email) {
    state.modalError = t("instructors.form.missingFields");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseInsert("instructors", [{ name, email, classes: [], status: "Active" }]);
    let notice = t("instructors.addedNotice", { name });
    if (issueLogin) {
      const result = await callAccountApi({ role: "Instructor", email, fullName: name, instructorRef: name });
      notice += t("credentials.suffix", { email: result.email, password: result.password });
    }
    await refreshAfterWrite();
    state.modalBusy = false;
    state.modalError = "";
    state.modalNotice = notice;
    render();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("instructors.form.saveError");
    render();
  }
}

// Renaming an instructor cascades server-side (see
// supabase/migrations/0012_...sql's instructors_cascade_rename trigger) to
// every group they're assigned to and their own account's RLS matching —
// nothing extra to do here beyond the one PATCH and a refetch. Editing
// their login email only updates this profile record, not the Supabase
// Auth email itself — a known gap, same as everywhere else in this app
// that doesn't yet offer changing a login's email after it's issued.
async function handleEditInstructor(event, name) {
  event.preventDefault();
  const form = event.target;
  const newName = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  if (!newName || !email) {
    state.modalError = t("instructors.form.missingFields");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseUpdate("instructors", "name", name, { name: newName, email });
    await refreshAfterWrite();
    state.modalBusy = false;
    state.modalNotice = t("instructors.savedNotice", { name: newName });
    render();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("instructors.form.saveError");
    render();
  }
}

async function handleAddStudent(event) {
  event.preventDefault();
  const form = event.target;
  const firstName = form.firstName.value.trim();
  const lastName = form.lastName.value.trim();
  const email = form.email.value.trim().toLowerCase();
  const groupId = form.groupId.value;
  const issueLogin = form.issueLogin.checked;
  if (!firstName || !lastName || !email || !groupId) {
    state.modalError = t("students.form.missingFields");
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
        group_id: groupId,
        progress: 0,
        attendance: 0,
        avg_grade: 0,
        absences: 0,
        late: 0,
      },
    ]);
    let notice = t("students.addedNotice", { name: `${firstName} ${lastName}` });
    if (issueLogin) {
      const result = await callAccountApi({ role: "Student", email, fullName: `${firstName} ${lastName}`, studentRef: studentId });
      notice += t("credentials.suffix", { email: result.email, password: result.password });
    }
    await refreshAfterWrite();
    state.modalBusy = false;
    state.modalError = "";
    state.modalNotice = notice;
    render();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("students.form.saveError");
    render();
  }
}

// Manager can edit any student; that student's own Instructor can edit
// one in their own group (see security.js's canEditStudent, which gates
// the "Edit" button — the server re-checks the same boundary via RLS, and
// further narrows an Instructor's edit to these exact fields via the
// column-restricting trigger in supabase/migrations/0012_...sql, so
// there's nothing here the server wouldn't also allow).
async function handleEditStudent(event, studentId) {
  event.preventDefault();
  const form = event.target;
  const firstName = form.firstName.value.trim();
  const lastName = form.lastName.value.trim();
  const phone = form.phone.value.trim();
  const level = form.level.value.trim();
  const notes = form.notes.value.trim();
  if (!firstName || !lastName) {
    state.modalError = t("students.form.missingFields");
    render();
    return;
  }
  const patch = {
    first_name: firstName,
    last_name: lastName,
    phone: phone || null,
    level: level || null,
    notes: notes || null,
  };
  if (form.status) patch.status = form.status.value;
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    await supabaseUpdate("students", "student_id", studentId, patch);
    await refreshAfterWrite();
    closeModal();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("students.form.saveError");
    render();
  }
}

async function handleAddManager(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  if (!name || !email) {
    state.modalError = t("managers.form.missingFields");
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
    state.modalNotice = t("managers.addedNotice", { name }) + t("credentials.suffix", { email: result.email, password: result.password });
    render();
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("managers.form.saveError");
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
    state.settingsError = t("settings.error.nameRequired");
    render();
    return;
  }
  if (!Number.isFinite(absenceThreshold) || absenceThreshold < 1) {
    state.settingsError = t("settings.error.thresholdInvalid");
    render();
    return;
  }
  if (careersEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(careersEmail)) {
    state.settingsError = t("settings.error.careersEmailInvalid");
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
      throw new Error(body?.message || body?.hint || t("errors.generic"));
    }
    if (Array.isArray(body) && body.length === 0) {
      throw new Error("No school settings row was updated — is more than one row present, or none at all?");
    }
    school = { ...school, name, portalUrl, settings: nextSettings };
    state.settingsNotice = t("settings.saved");
  } catch (error) {
    state.settingsError = error.message || t("errors.generic");
  } finally {
    state.settingsBusy = false;
    render();
  }
}

async function handleAddMaterial(event, groupId) {
  event.preventDefault();
  const form = event.target;
  const title = form.title.value.trim();
  const file = form.file.files[0];
  if (!title || !file) {
    state.modalError = t("materials.form.missingFields");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${groupId}/${Date.now()}-${safeName}`;
    await uploadStorageFile("materials", path, file);
    await supabaseInsert("materials", [
      {
        title,
        group_id: groupId,
        file_path: path,
        file_name: file.name,
        uploaded_by: state.profile?.user_id || null,
      },
    ]);
    await refreshAfterWrite();
    closeModal();
    openGroupDetail(groupId);
    try {
      await notifyEvent("material_added", { groupId, title });
    } catch {
      // notification is best-effort — the material itself already saved
    }
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("materials.form.saveError");
    render();
  }
}

async function handleAddAssignment(event, groupId) {
  event.preventDefault();
  const form = event.target;
  const title = form.title.value.trim();
  const course = form.course.value.trim();
  const dueDate = form.dueDate.value || null;
  const maxGrade = Number(form.maxGrade.value) || 100;
  const difficulty = form.difficulty.value;
  const attachment = form.attachment.files[0];
  const group = groups.find((item) => item.id === groupId);
  if (!title || !course || !group) {
    state.modalError = t("assignments.form.missingFields");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    // The attachment lives in the same private "materials" bucket used
    // for a group's other files (see 0014_assignment_attachments_and_
    // submissions.sql's comment) — anyone who can already see this
    // group's materials can read it, no new bucket needed.
    let attachmentPath = null;
    let attachmentName = null;
    if (attachment) {
      const safeName = attachment.name.replace(/[^\w.\-]+/g, "_");
      attachmentPath = `${groupId}/assignment-attachments/${Date.now()}-${safeName}`;
      await uploadStorageFile("materials", attachmentPath, attachment);
      attachmentName = attachment.name;
    }
    const total = studentsInGroup(groupId).length;
    await supabaseInsert("assignments", [
      {
        title,
        course,
        group_id: groupId,
        due_date: dueDate,
        status: "Assigned",
        submissions: 0,
        total,
        max_grade: maxGrade,
        difficulty,
        attachment_path: attachmentPath,
        attachment_name: attachmentName,
      },
    ]);
    await refreshAfterWrite();
    closeModal();
    openGroupDetail(groupId);
    try {
      await notifyEvent("assignment_added", { groupId, title, dueDate });
    } catch {
      // notification is best-effort — the assignment itself already saved
    }
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("assignments.form.saveError");
    render();
  }
}

// Opened by a student from their own group's Assignments section (see
// groupAssignmentsSection()'s "Open" button) — shows the brief, the
// instructor's attachment if any, this student's own submission status,
// a form to submit/resubmit a file, and their grade + feedback once one
// exists. Always scoped to the signed-in student's own record
// (people.students[0], same convention gradesView()'s student branch and
// studentDashboard() already use) — nothing here takes a studentId
// parameter, so there's no way to open another student's assignment.
function assignmentDetailModal(modal) {
  const assignment = assignments.find((a) => a.id === modal.assignmentId);
  const student = people.students[0];
  if (!assignment || !student) {
    return `
      <h2>${t("assignments.panelTitle")}</h2>
      <p class="hint">${t("grades.modal.notFound")}</p>
      <div class="modal-actions"><button type="button" onclick="closeModal()">${t("common.close")}</button></div>
    `;
  }
  const status = assignmentStatusForStudent(assignment, student.id);
  const mySubmission = submissionFor(assignment.id, student.id);
  const myGrade = grades.find((g) => g.assignmentId === assignment.id && g.studentId === student.id);

  return `
    <h2>${escapeHtml(assignment.title)}</h2>
    <p class="hint">${escapeHtml(assignment.course)} · ${t("assignments.table.due")}: ${assignment.due || "—"} · ${assignment.maxGrade} ${t("grades.table.score")}</p>
    ${modalMessages()}
    <dl>
      <div><dt>${t("common.status")}</dt><dd>${gradeStatusBadge(status)}</dd></div>
      ${
        assignment.attachmentPath
          ? `<div><dt>${t("assignments.form.attachment")}</dt><dd><button type="button" onclick="openStorageFile('materials', '${escapeJs(assignment.attachmentPath)}', '${escapeJs(assignment.attachmentName || "")}', 'view')">${t("common.view")}</button> <button type="button" onclick="openStorageFile('materials', '${escapeJs(assignment.attachmentPath)}', '${escapeJs(assignment.attachmentName || "")}', 'download')">${t("common.download")}</button></dd></div>`
          : ""
      }
      ${
        mySubmission
          ? `<div><dt>${t("submission.yourFile")}</dt><dd>${escapeHtml(mySubmission.fileName)} · ${new Date(mySubmission.submittedAt).toLocaleString()} <button type="button" onclick="openStorageFile('submissions', '${escapeJs(mySubmission.filePath)}', '${escapeJs(mySubmission.fileName)}', 'view')">${t("common.view")}</button> <button type="button" onclick="openStorageFile('submissions', '${escapeJs(mySubmission.filePath)}', '${escapeJs(mySubmission.fileName)}', 'download')">${t("common.download")}</button></dd></div>`
          : ""
      }
      ${
        myGrade
          ? `<div><dt>${t("grades.table.score")}</dt><dd>${myGrade.score}/${myGrade.maxScore}${myGrade.feedback ? ` — ${escapeHtml(myGrade.feedback)}` : ""}</dd></div>`
          : ""
      }
    </dl>
    <form onsubmit="handleSubmitAssignment(event, '${escapeJs(assignment.id)}')">
      <label>${mySubmission ? t("submission.form.resubmit") : t("submission.form.file")}<input type="file" name="file" required /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.uploading") : mySubmission ? t("submission.form.resubmitSubmit") : t("submission.form.submit")}</button>
      </div>
    </form>
  `;
}

async function handleSubmitAssignment(event, assignmentId) {
  event.preventDefault();
  const form = event.target;
  const file = form.file.files[0];
  const student = people.students[0];
  if (!file || !student) {
    state.modalError = t("submission.form.missingFile");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  state.modalNotice = "";
  render();
  try {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${assignmentId}/${student.id}/${Date.now()}-${safeName}`;
    await uploadStorageFile("submissions", path, file);
    await supabaseUpsert(
      "submissions",
      [{ assignment_id: assignmentId, student_id: student.id, file_path: path, file_name: file.name }],
      "assignment_id,student_id",
    );
    await refreshAfterWrite();
    state.modalNotice = t("submission.form.saved");
  } catch (error) {
    state.modalError = error.message || t("submission.form.saveError");
  } finally {
    state.modalBusy = false;
    render();
  }
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
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="${escapeHtml(school.name)}" />
        <p>${t("app.loading", { school: escapeHtml(school.name) })}</p>
      </div>
    </div>
  `;
}

function loginScreen() {
  if (!state.loginMode) return loginChooserScreen();
  const isStudent = state.loginMode === "student";
  return `
    <div class="auth-screen auth-screen-${state.loginMode}">
      <button type="button" class="theme-toggle auth-theme-toggle" onclick="toggleTheme()" aria-label="${t("theme.toggle")}" title="${t("theme.toggle")}">${state.theme === "dark" ? "☀" : "☾"}</button>
      ${langSwitcherHtml("auth-lang", "auth-lang-switcher")}
      <form class="auth-card" onsubmit="handleLoginSubmit(event)">
        <button type="button" class="auth-back" onclick="backToLoginChooser()">${backArrow()} ${t("common.back")}</button>
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="${escapeHtml(school.name)}" />
        <span class="auth-audience-tag">${isStudent ? t("auth.audience.student") : t("auth.audience.staff")}</span>
        <h1>${escapeHtml(school.name)}</h1>
        <p class="eyebrow">${isStudent ? t("auth.sub.student") : t("auth.sub.staff")}</p>
        ${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ""}
        <label>${t("auth.username")}<input type="email" name="email" autocomplete="username" required autofocus /></label>
        <label>${t("auth.password")}<input type="password" name="password" autocomplete="current-password" required /></label>
        <button type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? t("common.signingIn") : t("common.signIn")}</button>
        <small>${t("auth.lostCreds", {
          who: isStudent ? t("auth.lostCreds.student") : t("auth.lostCreds.staff"),
          where: isStudent ? "" : t("auth.lostCreds.whereStaff"),
        })}</small>
      </form>
    </div>
  `;
}

// Two audiences, two tiles — a Student never has to look at a form meant
// for staff (and vice versa) before choosing who they are. Signing in
// itself is unchanged underneath: the same email + password submit either
// way, and the account's real role (decided by user_profiles / RLS) is
// what actually determines what they can see next — this is only which
// welcome screen and copy they see on the way in.
function loginChooserScreen() {
  return `
    <div class="auth-screen auth-chooser">
      <button type="button" class="theme-toggle auth-theme-toggle" onclick="toggleTheme()" aria-label="${t("theme.toggle")}" title="${t("theme.toggle")}">${state.theme === "dark" ? "☀" : "☾"}</button>
      ${langSwitcherHtml("auth-lang", "auth-lang-switcher")}
      <div class="auth-chooser-card">
        <button type="button" class="auth-back" onclick="backToMarketing()">${backArrow()} ${t("common.backToHomepage")}</button>
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="${escapeHtml(school.name)}" />
        <h1>${escapeHtml(school.name)}</h1>
        <p class="eyebrow">${t("auth.chooser.title")}</p>
        <div class="auth-chooser-grid">
          <button type="button" class="auth-chooser-tile auth-chooser-student" onclick="chooseLoginMode('student')">
            <span class="auth-chooser-icon" aria-hidden="true">🎓</span>
            <strong>${t("auth.chooser.student.title")}</strong>
            <span>${t("auth.chooser.student.desc")}</span>
          </button>
          <button type="button" class="auth-chooser-tile auth-chooser-staff" onclick="chooseLoginMode('staff')">
            <span class="auth-chooser-icon" aria-hidden="true">🏫</span>
            <strong>${t("auth.chooser.staff.title")}</strong>
            <span>${t("auth.chooser.staff.desc")}</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function notConfiguredScreen() {
  return `
    <div class="auth-screen">
      <div class="auth-card">
        <button type="button" class="auth-back" onclick="backToMarketing()">${backArrow()} ${t("common.backToHomepage")}</button>
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="${escapeHtml(school.name)}" />
        <h1>${t("auth.notConfigured.title")}</h1>
        <p class="eyebrow">${t("auth.notConfigured.eyebrow")}</p>
        <p>${t("auth.notConfigured.body", { school: escapeHtml(school.name) })}</p>
      </div>
    </div>
  `;
}

function forcePasswordScreen() {
  return `
    <div class="auth-screen">
      <form class="auth-card" onsubmit="handleForcePasswordSubmit(event)">
        <img class="brand-mark" src="/src/assets/logo-icon.png" alt="${escapeHtml(school.name)}" />
        <h1>${t("auth.forcePassword.title")}</h1>
        <p class="eyebrow">${t("auth.forcePassword.eyebrow", { name: escapeHtml(state.profile?.full_name || state.profile?.email || "") })}</p>
        ${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ""}
        <label>${t("auth.forcePassword.new")}<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required /></label>
        <label>${t("auth.forcePassword.confirm")}<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required /></label>
        <button type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? t("common.saving") : t("auth.forcePassword.submit")}</button>
        <small>${t("auth.forcePassword.note")}</small>
      </form>
    </div>
  `;
}

// Starter testimonials shown until real, Manager-approved reviews come in
// from the "Leave a review" form — no visible "sample" labeling on the
// live site; swap these for real quotes any time in this file.
// Placeholder testimonials shown alongside real ones submitted through the
// review form (see `allReviews` in marketingScreen() — this array is just
// filler until enough real reviews come in). Written in Egyptian colloquial
// Arabic on purpose: this school's actual audience, so generic corporate-
// English copy would read as obviously fake here. Swap these out for real
// reviews as they accumulate, same as the gallery's "coming soon" note.
const sampleReviews = [
  {
    quote: "ابني كان بيكره الكمبيوتر خالص، ودلوقتي بيتحمس للحصة كل أسبوع وعمل أول لعبة بنفسه من غير ما حد يساعده. تسلم إيديكو.",
    name: "والدة يوسف، طالب في Junior Coders",
  },
  {
    quote: "معرفش حاجة في البرمجة أصلاً، ودلوقتي عملت أول موقع ليا وعرضته على زمايلي في المدرسة. المدربين صبورين جدًا وبيشرحوا خطوة خطوة.",
    name: "مصطفى، طالب في Code Builders، 12 سنة",
  },
  {
    quote: "بنتي كانت بتقول ده صعب عليها وحاسة إنها مش هتفهم، ودلوقتي بقت هي اللي بتعلّم أخوها الصغير في البيت. حسّيت إن الفلوس دي اتصرفت صح.",
    name: "والد مريم، طالبة في Young Developers",
  },
  {
    quote: "جربنا مراكز كتير قبل كده وملقيناش زي هنا. المتابعة مع الولد أول بأول، وشفنا فرق واضح من أول شهر بس.",
    name: "والد كريم، طالب في Junior Coders",
  },
  {
    quote: "عملت مشروع بايثون بنفسي وعرضته في آخر الترم، ولسه مستنية الموديول الجديد يبدأ إمتى عشان أتعلم أكتر.",
    name: "طالبة في Code Builders، 13 سنة",
  },
];

// The homepage Gallery ("previous experience" photos/videos) is managed by
// a Manager from the dashboard's own "Gallery" tab (see galleryView()) and
// stored in Supabase's public `gallery_items` table + `gallery` storage
// bucket (supabase/migrations/0013_gallery.sql) — it's no longer a
// hardcoded list here. state.publicGalleryItems is populated by
// loadPublicGalleryItems() and rendered below via galleryPublicUrl().

// The `gallery` storage bucket is public (public = true), so an object's
// URL needs no access token — this just builds that stable public path.
function galleryPublicUrl(path) {
  if (!path) return "";
  if (config.r2PublicBaseUrl) return `${config.r2PublicBaseUrl.replace(/\/$/, "")}/gallery/${path}`;
  const base = config.supabaseUrl ? config.supabaseUrl.replace(/\/$/, "") : "";
  return `${base}/storage/v1/object/public/gallery/${path}`;
}

const trustStats = [
  { valueKey: "marketing.stat.students", labelKey: "marketing.stat.students", isCount: true },
  { valueKey: "marketing.stat.ages.value", labelKey: "marketing.stat.ages" },
  { valueKey: "marketing.stat.live.value", labelKey: "marketing.stat.live" },
];

const programTracks = [
  { key: "junior", skillCount: 3 },
  { key: "builders", skillCount: 3 },
  { key: "young", skillCount: 3 },
];

const howItWorks = [
  { step: "1", key: "step1" },
  { step: "2", key: "step2" },
  { step: "3", key: "step3" },
];

const compareRows = [
  ["compare.row1", "check", "cross", "partial"],
  ["compare.row2", "check", "cross", "partial"],
  ["compare.row3", "check", "partial", "cross"],
  ["compare.row4", "check", "partial", "partial"],
  ["compare.row5", "check", "cross", "cross"],
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
    <a class="m-social-link" href="${escapeHtml(school.social.facebook)}" target="_blank" rel="noopener">${socialIcons.facebook}<span>Facebook</span></a>
    <a class="m-social-link" href="https://wa.me/${wa}" target="_blank" rel="noopener">${socialIcons.whatsapp}<span>WhatsApp</span></a>
  `;
}

// The language switcher — three flags-free text buttons (ar / it / en) —
// appears in the marketing nav, the auth screens, and the signed-in
// topbar, mirroring the existing theme-toggle button's placement pattern.
// `extraClass` lets a caller position it (see the auth screens above,
// which float it in a fixed corner rather than inline).
function langSwitcherHtml(idPrefix, extraClass) {
  return `
    <div class="lang-switcher ${extraClass || ""}" role="group" aria-label="${t("common.language")}">
      ${LANGS.map(
        (code) => `<button type="button" class="lang-option ${state.lang === code ? "active" : ""}" onclick="setLanguage('${code}')" aria-pressed="${state.lang === code}">${LANG_LABELS[code]}</button>`,
      ).join("")}
    </div>
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
          <img class="brand-mark" src="/src/assets/logo-icon.png" alt="${escapeHtml(school.name)}" />
          <strong>${escapeHtml(school.name)}</strong>
        </div>
        <div class="m-nav-social">${socialLinksHtml()}</div>
        ${langSwitcherHtml("m-lang")}
        <button type="button" class="theme-toggle" onclick="toggleTheme()" aria-label="${t("theme.toggle")}" title="${t("theme.toggle")}">${state.theme === "dark" ? "☀" : "☾"}</button>
        <button class="m-login-button" onclick="beginLogin()">${t("footer.login")}</button>
      </header>

      <section class="m-section reveal">
        <button type="button" class="auth-back" onclick="closeOpportunityDetail()">${backArrow()} ${t("marketing.careers.backToList")}</button>
        <p class="eyebrow">${t("marketing.careers.openPosition")}</p>
        <h1>${escapeHtml(op.title)}</h1>
        <p class="m-sub">${escapeHtml([op.employment_type, op.location].filter(Boolean).join(" · ")) || t("marketing.careers.detailsOnRequest")}</p>

        <div class="panel">
          ${op.description ? `<p>${escapeHtml(op.description)}</p>` : `<p class="empty">${t("marketing.careers.noDetails")}</p>`}
        </div>

        <div class="panel">
          <h2>${t("marketing.careers.howToApply")}</h2>
          ${
            careersEmail
              ? `<p>${t("marketing.careers.emailInstructions", {
                  email: `<a href="mailto:${escapeHtml(careersEmail)}?subject=${mailSubject}&body=${mailBody}">${escapeHtml(careersEmail)}</a>`,
                  title: escapeHtml(op.title),
                })}</p>`
              : `<p>${t("marketing.careers.noEmail", { title: escapeHtml(op.title), link: `<a href="#contact" onclick="closeOpportunityDetail()">${t("marketing.careers.noEmail.linkText")}</a>` })}</p>`
          }
        </div>
      </section>

      <footer class="m-footer">
        <span>&copy; ${new Date().getFullYear()} ${escapeHtml(school.name)}</span>
        <div class="m-footer-social">${socialLinksHtml()}</div>
        <button class="m-login-button" onclick="beginLogin()">${t("footer.login")}</button>
      </footer>
    </div>
  `;
}

function marketingScreen() {
  const notice = state.contactNotice;
  const reviewNotice = state.reviewNotice;
  const allReviews = [...state.publicReviews, ...sampleReviews];
  const showPromo = !state.promoModalDismissed;
  const showReviewForm = state.reviewFormOpen;
  return `
    <div class="marketing">
      ${showPromo ? `
        <div class="promo-overlay" onclick="if (event.target === this) dismissPromoModal()">
          <div class="promo-modal" role="dialog" aria-modal="true" aria-label="${t("promo.title")}">
            <button type="button" class="promo-close" onclick="dismissPromoModal()" aria-label="${t("common.close")}">&times;</button>
            <img src="/src/assets/promo-different-start.jpg" alt="${t("promo.imgAlt", { school: escapeHtml(school.name) })}" />
            <div class="promo-modal-body">
              <h3>${t("promo.title")}</h3>
              <p>${t("promo.body")}</p>
              <button type="button" class="promo-cta" onclick="openPromoForm()">${t("promo.cta")}</button>
            </div>
          </div>
        </div>
      ` : ""}
      ${showReviewForm ? `
        <div class="promo-overlay" onclick="if (event.target === this) closeReviewForm()">
          <div class="review-modal" role="dialog" aria-modal="true" aria-label="${t("marketing.reviews.form.title")}">
            <button type="button" class="promo-close" onclick="closeReviewForm()" aria-label="${t("common.close")}">&times;</button>
            <form class="m-review-form" onsubmit="handleReviewSubmit(event)">
              <h3>${t("marketing.reviews.form.title")}</h3>
              <p class="m-sub">${t("marketing.reviews.form.sub")}</p>
              ${reviewNotice ? `<p class="notice-row ${reviewNotice.type === "error" ? "auth-error" : "m-success"}">${escapeHtml(reviewNotice.message)}<button type="button" class="notice-dismiss" onclick="dismissReviewNotice()" aria-label="${t("common.dismiss")}">&times;</button></p>` : ""}
              <div class="m-review-form-grid">
                <label>${t("marketing.reviews.form.name")}<input type="text" name="name" required /></label>
                <label>${t("marketing.reviews.form.roleOrSchool")}<input type="text" name="roleOrSchool" placeholder="${t("marketing.reviews.form.roleOrSchool.placeholder")}" /></label>
              </div>
              <label>${t("marketing.reviews.form.rating")}
                <select name="rating">
                  <option value="5">★★★★★ (5)</option>
                  <option value="4">★★★★☆ (4)</option>
                  <option value="3">★★★☆☆ (3)</option>
                  <option value="2">★★☆☆☆ (2)</option>
                  <option value="1">★☆☆☆☆ (1)</option>
                </select>
              </label>
              <label>${t("marketing.reviews.form.quote")}<textarea name="quote" rows="3" required></textarea></label>
              <button type="submit" ${state.reviewBusy ? "disabled" : ""}>${state.reviewBusy ? t("common.sending") : t("marketing.reviews.form.submit")}</button>
              <small>${t("marketing.reviews.form.note")}</small>
            </form>
          </div>
        </div>
      ` : ""}
      <header class="m-nav">
        <div class="brand">
          <img class="brand-mark" src="/src/assets/logo-icon.png" alt="${escapeHtml(school.name)}" />
          <strong>${escapeHtml(school.name)}</strong>
        </div>
        <nav class="m-nav-links" aria-label="Marketing navigation">
          <a href="#how">${t("marketing.nav.how")}</a>
          <a href="#features">${t("marketing.nav.features")}</a>
          <a href="#compare">${t("marketing.nav.compare")}</a>
          <a href="#gallery">${t("marketing.nav.gallery")}</a>
          <a href="#reviews">${t("marketing.nav.reviews")}</a>
          <a href="#careers">${t("marketing.nav.careers")}</a>
          <a href="#contact">${t("marketing.nav.contact")}</a>
        </nav>
        <div class="m-nav-social">${socialLinksHtml()}</div>
        ${langSwitcherHtml("m-lang")}
        <button type="button" class="theme-toggle" onclick="toggleTheme()" aria-label="${t("theme.toggle")}" title="${t("theme.toggle")}">${state.theme === "dark" ? "☀" : "☾"}</button>
        <button class="m-login-button" onclick="beginLogin()">${t("footer.login")}</button>
      </header>

      <section class="m-hero">
        <p class="eyebrow">${t("marketing.hero.eyebrow")}</p>
        <h1>${t("marketing.hero.title")}</h1>
        <p class="m-sub">${t("marketing.hero.sub")}</p>
        <div class="m-hero-actions">
          <button type="button" class="m-cta-primary" onclick="openPromoModal()">${t("marketing.hero.cta.primary")}</button>
          <a class="m-cta-secondary" href="#features">${t("marketing.hero.cta.secondary")}</a>
        </div>
        <div class="m-stats">
          ${trustStats.map((stat) => `<div class="m-stat reveal"><strong>${stat.isCount ? "60+" : t(stat.valueKey)}</strong><span>${stat.isCount ? t(stat.labelKey, { count: "" }).replace("  ", " ").trim() : t(stat.labelKey)}</span></div>`).join("")}
        </div>
      </section>

      <section id="how" class="m-section reveal">
        <h2>${t("marketing.how.title")}</h2>
        <p class="m-sub">${t("marketing.how.sub")}</p>
        <div class="m-cards">
          ${howItWorks.map((item) => `
            <article class="m-card reveal">
              <span class="m-step">${item.step}</span>
              <h3>${t(`marketing.how.${item.key}.title`)}</h3>
              <p>${t(`marketing.how.${item.key}.desc`)}</p>
            </article>
          `).join("")}
        </div>
      </section>

      <section id="features" class="m-section reveal">
        <h2>${t("marketing.programs.title")}</h2>
        <p class="m-sub">${t("marketing.programs.sub")}</p>
        <div class="m-cards">
          ${programTracks.map((track) => `
            <article class="m-card reveal">
              <h3>${t(`program.${track.key}.name`)} <span class="m-age">${t(`program.${track.key}.age`)}</span></h3>
              <p>${t(`program.${track.key}.desc`)}</p>
              <div class="m-skills">${Array.from({ length: track.skillCount }, (_, i) => `<span class="m-skill-tag">${t(`program.${track.key}.skill${i + 1}`)}</span>`).join("")}</div>
            </article>
          `).join("")}
        </div>
        <p class="m-sub">${t("marketing.programs.footnote")}</p>
      </section>

      <section id="compare" class="m-section reveal">
        <h2>${t("marketing.compare.title")}</h2>
        <p class="m-sub">${t("marketing.compare.sub", { school: escapeHtml(school.name) })}</p>
        <div class="m-compare-grid">
          ${[
            { name: school.name, highlight: true, index: 0 },
            { nameKey: "marketing.compare.videoCourses", highlight: false, index: 1 },
            { nameKey: "marketing.compare.workshops", highlight: false, index: 2 },
          ].map(
            (col) => `
            <article class="m-compare-card ${col.highlight ? "m-compare-highlight" : ""} reveal">
              ${col.highlight ? `<span class="m-compare-badge">${t("marketing.compare.us")}</span>` : ""}
              <h3>${col.highlight ? escapeHtml(col.name) : t(col.nameKey)}</h3>
              <ul class="m-compare-list">
                ${compareRows
                  .map((row) => {
                    const labelKey = row[0];
                    const status = row[col.index + 1];
                    return `<li class="m-compare-row m-compare-${status}">${compareIcon(status)}<span>${t(labelKey)}</span></li>`;
                  })
                  .join("")}
              </ul>
            </article>
          `,
          ).join("")}
        </div>
      </section>

      <section id="gallery" class="m-section reveal">
        <h2>${t("marketing.gallery.title")}</h2>
        <p class="m-sub">${t("marketing.gallery.sub")}</p>
        ${
          state.publicGalleryItems.length
            ? `<div class="m-gallery-grid">${state.publicGalleryItems
                .map((item) =>
                  item.type === "video"
                    ? `<div class="m-gallery-item reveal"><video controls preload="metadata" ${item.poster_path ? `poster="${escapeHtml(galleryPublicUrl(item.poster_path))}"` : ""}><source src="${escapeHtml(galleryPublicUrl(item.file_path))}" /></video></div>`
                    : `<div class="m-gallery-item reveal"><img src="${escapeHtml(galleryPublicUrl(item.file_path))}" alt="${escapeHtml(item.caption || "")}" loading="lazy" /></div>`,
                )
                .join("")}</div>`
            : `<div class="m-gallery-empty reveal"><p class="empty">${t("marketing.gallery.empty")}</p></div>`
        }
      </section>

      <section id="reviews" class="m-section reveal">
        <div class="m-section-head">
          <div>
            <h2>${t("marketing.reviews.title")}</h2>
            <p class="m-sub">${t("marketing.reviews.sub", { count: "60" })}</p>
          </div>
          <button type="button" class="m-review-cta" onclick="openReviewForm()"><span aria-hidden="true">★</span> ${t("marketing.reviews.cta")}</button>
        </div>
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
      </section>

      <section id="careers" class="m-section reveal">
        <h2>${t("marketing.careers.title")}</h2>
        <p class="m-sub">${t("marketing.careers.sub", { school: escapeHtml(school.name) })}</p>
        <div class="m-cards">
          ${
            state.publicOpportunities.length
              ? state.publicOpportunities
                  .map(
                    (op) => `
              <article class="m-card reveal">
                <h3>${escapeHtml(op.title)}</h3>
                <p class="m-sub">${escapeHtml([op.employment_type, op.location].filter(Boolean).join(" · ")) || t("marketing.careers.detailsOnRequest")}</p>
                ${op.description ? `<p>${escapeHtml(op.description.length > 160 ? `${op.description.slice(0, 160)}…` : op.description)}</p>` : ""}
                <button type="button" class="m-cta-secondary" onclick="openOpportunityDetail('${escapeJs(op.id)}')">${t("marketing.careers.viewDetails")}</button>
              </article>
            `,
                  )
                  .join("")
              : `<p class="empty">${t("marketing.careers.empty")}</p>`
          }
        </div>
        <a class="m-cta-secondary" href="#contact">${t("marketing.careers.interested")}</a>
      </section>

      <section id="contact" class="m-section m-contact reveal">
        <div class="m-contact-grid">
          <div>
            <h2>${t("marketing.contact.title")}</h2>
            <p class="m-sub">${t("marketing.contact.sub")}</p>
            <div class="m-contact-social">${socialLinksHtml()}</div>
          </div>
          <form class="m-contact-form" onsubmit="handleContactSubmit(event)">
            ${notice ? `<p class="notice-row ${notice.type === "error" ? "auth-error" : "m-success"}">${escapeHtml(notice.message)}<button type="button" class="notice-dismiss" onclick="dismissContactNotice()" aria-label="${t("common.dismiss")}">&times;</button></p>` : ""}
            <label>${t("marketing.contact.name")}<input type="text" name="name" required /></label>
            <label>${t("marketing.contact.email")}<input type="email" name="email" required /></label>
            <label>${t("marketing.contact.phone")}<input type="tel" name="phone" /></label>
            <label>${t("marketing.contact.message")}<textarea name="message" rows="4"></textarea></label>
            <label class="checkline"><input type="checkbox" name="wantsCall" /> ${t("marketing.contact.wantsCall")}</label>
            <button type="submit" ${state.contactBusy ? "disabled" : ""}>${state.contactBusy ? t("common.sending") : t("marketing.contact.submit")}</button>
          </form>
        </div>
      </section>

      <footer class="m-footer">
        <span>&copy; ${new Date().getFullYear()} ${escapeHtml(school.name)}</span>
        <div class="m-footer-social">${socialLinksHtml()}</div>
        <button class="m-login-button" onclick="beginLogin()">${t("footer.login")}</button>
      </footer>
    </div>
  `;
}

// The "group offer" popup shows on every visit to the homepage (including
// a plain page refresh) — dismissing it only clears the in-memory flag
// for the rest of this page load, nothing is remembered in storage, so
// reloading the page brings it back.
function dismissPromoModal() {
  state.promoModalDismissed = true;
  render();
}

// Re-opens the offer popup — used by the hero's "Book a free trial class"
// button (see marketingScreen()) so a visitor who already dismissed it (or
// is on a fresh reload where it hasn't shown yet) still sees the group
// offer first, same popup either way.
function openPromoModal() {
  state.promoModalDismissed = false;
  render();
}

// Closes the popup and takes the visitor straight to the real Contact
// form, pre-set to "request a call back" (checks that box and focuses the
// phone field) rather than the default write-a-message mode — submissions
// there already land in the Contact Requests panel every Manager can see,
// so there's no separate inbox to check.
function openPromoForm() {
  dismissPromoModal();
  requestAnimationFrame(() => {
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const form = document.querySelector(".m-contact-form");
    const wantsCall = form?.querySelector("input[name='wantsCall']");
    if (wantsCall) wantsCall.checked = true;
    (form?.querySelector("input[name='phone']") || form?.querySelector("input[name='name']"))?.focus();
  });
}

function beginLogin() {
  state.authMode = hasSupabaseConfig() ? "signed-out" : "not-configured";
  state.authError = "";
  state.loginMode = null;
  state.view = "dashboard";
  render();
}

function backToMarketing() {
  state.authMode = "marketing";
  state.authError = "";
  state.loginMode = null;
  render();
}

function chooseLoginMode(mode) {
  state.loginMode = mode;
  state.authError = "";
  render();
}

function backToLoginChooser() {
  state.loginMode = null;
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
    state.contactNotice = { type: "error", message: t("marketing.contact.needFields") };
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
      if (!response.ok) throw new Error(t("marketing.contact.sendError"));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    state.contactNotice = {
      type: "success",
      message: wantsCall ? t("marketing.contact.thanksCall") : t("marketing.contact.thanksMessage"),
    };
  } catch (error) {
    state.contactNotice = { type: "error", message: error.message || t("marketing.contact.error") };
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
    state.reviewNotice = { type: "error", message: t("marketing.reviews.needFields") };
    render();
    return;
  }

  state.reviewBusy = true;
  state.reviewNotice = null;
  render();

  try {
    if (hasSupabaseConfig()) {
      // Supplied here (rather than left to the column's own default)
      // purely so this signed-out form knows the new row's id afterward —
      // the "reviews public read approved" policy in
      // supabase/migrations/0005_reviews.sql only lets anyone read back
      // *approved* rows, so a brand-new 'pending' row can't be read back
      // via Prefer: return=representation the way an authenticated insert
      // elsewhere in this file would.
      const reviewId = crypto.randomUUID();
      const base = config.supabaseUrl.replace(/\/$/, "");
      const response = await fetch(`${base}/rest/v1/reviews`, {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${config.supabaseAnonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify([{ id: reviewId, name, role_or_school: roleOrSchool || null, quote, rating }]),
      });
      if (!response.ok) throw new Error(t("marketing.reviews.error"));
      try {
        await notifyPublicEvent("review_submitted", { reviewId });
      } catch {
        // notification is best-effort — the review itself already saved
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    state.reviewNotice = { type: "success", message: t("marketing.reviews.thanks") };
    form.reset();
  } catch (error) {
    state.reviewNotice = { type: "error", message: error.message || t("marketing.reviews.error") };
  } finally {
    state.reviewBusy = false;
    render();
  }
}

function dismissReviewNotice() {
  state.reviewNotice = null;
  render();
}

function openReviewForm() {
  state.reviewFormOpen = true;
  render();
}

function closeReviewForm() {
  state.reviewFormOpen = false;
  state.reviewNotice = null;
  render();
}
function canManageAccounts() {
  return ["Super Admin", "School Admin", "Instructor"].includes(state.role);
}

// A dedicated Instructors directory for Managers — separate from the
// generic Accounts & Logins list — so adding a new instructor profile and
// issuing their first login both happen from one obvious place, before a
// Manager ever needs to think about groups or students.
function instructorRow(instructor) {
  const directory = state.accountsDirectory;
  const account = directory?.find((row) => row.instructor_name === instructor.name);
  const ownGroups = groups.filter((item) => item.instructor === instructor.name);
  const key = `instructor-${instructor.name}`;
  const busy = state.accountsBusy === key;
  const status = account
    ? account.must_change_password
      ? badge(t("accounts.status.invited"))
      : badge(t("accounts.status.active"))
    : `<span class="muted-pill">${t("accounts.status.notSetUp")}</span>`;
  const actionLabel = account ? t("accounts.resetPassword") : t("accounts.generateLogin");
  const handlerName = account ? "resetCredentials" : "generateCredentials";
  const handler = `${handlerName}('${key}', 'Instructor', '${escapeJs(instructor.email)}', '${escapeJs(instructor.name)}', '${escapeJs(instructor.name)}')`;
  const canRemove = canRemoveAccounts(state.role);
  const canEdit = canEditInstructorProfiles(state.role);
  const removeKey = `remove-instructor-${instructor.name}`;
  const removeBusy = state.accountsBusy === removeKey;

  return `
    <tr>
      <td><strong>${escapeHtml(instructor.name)}</strong></td>
      <td>${escapeHtml(instructor.email)}</td>
      <td>${ownGroups.length ? ownGroups.map((g) => escapeHtml(g.name)).join(", ") : t("instructors.noGroupsYet")}</td>
      <td>${status}</td>
      <td>
        <button onclick="${handler}" ${busy ? "disabled" : ""}>${busy ? t("common.working") : actionLabel}</button>
        ${canEdit ? `<button onclick="openModal('editInstructor', { instructorName: '${escapeJs(instructor.name)}' })">${t("common.edit")}</button>` : ""}
        ${canRemove ? `<button onclick="handleRemoveInstructor('${escapeJs(instructor.name)}')" ${removeBusy ? "disabled" : ""}>${removeBusy ? t("common.removing") : t("common.remove")}</button>` : ""}
      </td>
    </tr>
  `;
}

function instructorsView() {
  const rows = people.instructors.map(instructorRow);

  return `
    ${state.accountsNotice ? accountsNoticeBanner(state.accountsNotice) : ""}
    <div class="toolbar">
      ${canCreateInstructorProfiles(state.role) ? `<button onclick="openModal('addInstructor')">${t("instructors.add")}</button>` : ""}
    </div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("nav.instructors")}</h2><span>${t("instructors.onStaff", { count: people.instructors.length })}</span></div>
      <table>
        <thead><tr><th>${t("instructors.table.name")}</th><th>${t("instructors.table.email")}</th><th>${t("instructors.table.groups")}</th><th>${t("instructors.table.access")}</th><th>${t("common.action")}</th></tr></thead>
        <tbody>${rows.join("") || `<tr><td colspan="5" class="empty">${t("instructors.noneYet")}</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

// Removing an instructor is Manager-only and irreversible: it deletes both
// the instructor's school record and their portal login (if one was ever
// issued), via api/remove-account.js. The server itself refuses if the
// instructor still owns groups, so a Manager sees that reason directly
// rather than a generic failure.
async function handleRemoveInstructor(name) {
  if (!window.confirm(t("instructors.confirmRemove", { name }))) return;
  const key = `remove-instructor-${name}`;
  state.accountsBusy = key;
  state.accountsNotice = null;
  renderContentOnly();
  try {
    await removeAccountApi({ role: "Instructor", ref: name });
    await refreshAfterWrite();
    state.accountsNotice = { type: "removed", message: t("instructors.removedNotice", { name }) };
  } catch (error) {
    state.accountsNotice = { type: "error", message: error.message || t("instructors.removeError") };
  } finally {
    state.accountsBusy = null;
    renderContentOnly();
  }
}

function accountsView() {
  const isInstructor = state.role === "Instructor";
  const directory = state.accountsDirectory;
  const accountFor = (refId) => directory?.find((row) => row.student_id === refId);

  // Instructor logins live on their own "Instructors" tab (above Students
  // in the sidebar) so a Manager doesn't have to hunt for them here —
  // this panel is Student logins plus, for a Manager, adding another
  // Manager.
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
    ${isInstructor ? `<p class="hint">${t("accounts.hint.instructor")}</p>` : `<p class="hint">${t("accounts.hint.other", { link: `<button type="button" onclick="navigate('instructors')">${t("nav.instructors")}</button>` })}</p>`}
    <div class="toolbar">
      ${isManager ? `<button onclick="openModal('addManager')">${t("accounts.addManager")}</button>` : ""}
      ${canCreateStudentProfiles(state.role) ? `<button onclick="openModal('addStudent')">${t("accounts.addStudent")}</button>` : ""}
    </div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("accounts.studentLogins")}</h2><span>${t("accounts.issued", { count: directory ? directory.length : 0 })}</span></div>
      <table>
        <thead><tr><th>${t("accounts.table.name")}</th><th>${t("accounts.table.role")}</th><th>${t("accounts.table.username")}</th><th>${t("accounts.table.access")}</th><th>${t("common.action")}</th></tr></thead>
        <tbody>${studentRows.join("") || `<tr><td colspan="5" class="empty">${t("accounts.none")}</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function leadsView() {
  const leads = state.leadsDirectory || [];
  return `
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("leads.title")}</h2><span>${t("leads.received", { count: leads.length })}</span></div>
      <table>
        <thead><tr><th>${t("leads.table.received")}</th><th>${t("leads.table.type")}</th><th>${t("leads.table.name")}</th><th>${t("leads.table.email")}</th><th>${t("leads.table.phone")}</th><th>${t("leads.table.message")}</th></tr></thead>
        <tbody>${
          leads
            .map(
              (lead) => `<tr><td>${new Date(lead.created_at).toLocaleString()}</td><td>${badge(lead.kind === "call_request" ? t("leads.type.call") : t("leads.type.contact"))}</td><td><strong>${escapeHtml(lead.name)}</strong></td><td>${escapeHtml(lead.email)}</td><td>${escapeHtml(lead.phone) || "—"}</td><td>${escapeHtml(lead.message) || "—"}</td></tr>`,
            )
            .join("") || `<tr><td colspan="6" class="empty">${t("leads.none")}</td></tr>`
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
    <p class="hint">${t("reviews.hint")}</p>
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("reviews.pending")}</h2><span>${t("reviews.waiting", { count: pending.length })}</span></div>
      <table>
        <thead><tr><th>${t("reviews.table.received")}</th><th>${t("reviews.table.name")}</th><th>${t("reviews.table.quote")}</th><th>${t("reviews.table.rating")}</th><th>${t("common.action")}</th></tr></thead>
        <tbody>${pending.map(reviewRow).join("") || `<tr><td colspan="5" class="empty">${t("reviews.none.pending")}</td></tr>`}</tbody>
      </table>
    </section>
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("reviews.decided")}</h2><span>${t("reviews.reviewed", { count: decided.length })}</span></div>
      <table>
        <thead><tr><th>${t("reviews.table.received")}</th><th>${t("reviews.table.name")}</th><th>${t("reviews.table.quote")}</th><th>${t("reviews.table.rating")}</th><th>${t("common.status")}</th></tr></thead>
        <tbody>${
          decided
            .map(
              (r) => `<tr><td>${new Date(r.created_at).toLocaleString()}</td><td><strong>${escapeHtml(r.name)}</strong></td><td dir="auto">${escapeHtml(r.quote)}</td><td>${"★".repeat(r.rating || 5)}</td><td>${badge(r.status === "approved" ? t("reviews.status.approved") : t("reviews.status.rejected"))}</td></tr>`,
            )
            .join("") || `<tr><td colspan="5" class="empty">${t("reviews.none.decided")}</td></tr>`
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
        <button onclick="setReviewStatus('${review.id}', 'approved')" ${busy ? "disabled" : ""}>${busy ? t("common.working") : t("common.approve")}</button>
        <button onclick="setReviewStatus('${review.id}', 'rejected')" ${busy ? "disabled" : ""}>${t("reviews.reject")}</button>
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
// openings here. Anything marked "Open" is what the public homepage
// section (see marketingScreen()) shows to signed-out visitors — enforced
// by Supabase RLS, not by this view.
// ---------------------------------------------------------------------

function opportunitiesView() {
  const rows = state.opportunitiesDirectory || [];
  return `
    ${state.opportunitiesNotice ? opportunitiesNoticeBanner(state.opportunitiesNotice) : ""}
    <p class="hint">${t("opportunities.hint")}</p>
    <div class="toolbar"><button onclick="openModal('addOpportunity')">${t("opportunities.add")}</button></div>
    <section class="panel table-panel">
      <div class="panel-head"><h2>${t("nav.opportunities")}</h2><span>${t("opportunities.total", { count: rows.length })}</span></div>
      <table>
        <thead><tr><th>${t("opportunities.table.title")}</th><th>${t("opportunities.table.location")}</th><th>${t("opportunities.table.type")}</th><th>${t("common.status")}</th><th>${t("common.action")}</th></tr></thead>
        <tbody>${rows.map(opportunityRow).join("") || `<tr><td colspan="5" class="empty">${t("opportunities.none")}</td></tr>`}</tbody>
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
      <td>${badge(isOpen ? t("opportunities.status.open") : t("opportunities.status.closed"))}</td>
      <td>
        <button onclick="setOpportunityStatus('${op.id}', '${isOpen ? "closed" : "open"}')" ${busy ? "disabled" : ""}>${busy ? t("common.working") : isOpen ? t("opportunities.close") : t("opportunities.reopen")}</button>
        <button onclick="removeOpportunity('${op.id}', '${escapeJs(op.title)}')" ${busy ? "disabled" : ""}>${t("common.remove")}</button>
      </td>
    </tr>
  `;
}

function opportunitiesNoticeBanner(notice) {
  return `
    <section class="panel credential-reveal error">
      <div class="panel-head"><h2>${t("accounts.notice.errorTitle")}</h2><button onclick="dismissOpportunitiesNotice()">${t("common.dismiss")}</button></div>
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
    <h2>${t("opportunities.form.title")}</h2>
    <p class="hint">${t("opportunities.form.hint")}</p>
    ${modalMessages()}
    <form onsubmit="handleAddOpportunity(event)">
      <label>${t("opportunities.form.titleField")}<input type="text" name="title" required /></label>
      <label>${t("opportunities.form.location")}<input type="text" name="location" placeholder="${t("opportunities.form.locationPlaceholder")}" /></label>
      <label>${t("opportunities.form.type")}
        <select name="employmentType">
          <option value="Full-time">${t("opportunities.form.type.fullTime")}</option>
          <option value="Part-time">${t("opportunities.form.type.partTime")}</option>
          <option value="Contract">${t("opportunities.form.type.contract")}</option>
          <option value="Volunteer">${t("opportunities.form.type.volunteer")}</option>
        </select>
      </label>
      <label>${t("opportunities.form.description")}<textarea name="description" rows="4"></textarea></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.working") : t("opportunities.form.submit")}</button>
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
    state.modalError = t("opportunities.form.missingFields");
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
    state.modalError = error.message || t("opportunities.form.saveError");
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
  if (!window.confirm(t("opportunities.confirmRemove", { title }))) return;
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
    if (!response.ok) throw new Error(t("opportunities.form.removeError"));
    await loadOpportunitiesDirectory();
  } catch (error) {
    state.opportunitiesNotice = { type: "error", message: error.message };
  } finally {
    state.opportunitiesBusy = null;
    renderContentOnly();
  }
}

// ---------------------------------------------------------------------
// Gallery: a Manager adds/removes the homepage's "previous experience"
// photos/videos here. Unlike Opportunities there's no draft/open-closed
// state — every row is public read the instant it's created (see
// supabase/migrations/0013_gallery.sql) — so state.publicGalleryItems,
// loaded by the single unauthenticated loadPublicGalleryItems() below,
// powers both this management view AND the homepage's public section
// (see marketingScreen()'s #gallery block).
// ---------------------------------------------------------------------

function galleryView() {
  const items = state.publicGalleryItems || [];
  return `
    ${state.galleryNotice ? galleryNoticeBanner(state.galleryNotice) : ""}
    <p class="hint">${t("gallery.hint")}</p>
    <div class="toolbar"><button onclick="openModal('addGalleryItem')">${t("gallery.add")}</button></div>
    <section class="panel">
      <div class="panel-head"><h2>${t("nav.gallery")}</h2><span>${t("gallery.total", { count: items.length })}</span></div>
      ${
        items.length
          ? `<div class="m-gallery-grid">${items.map(galleryManageCard).join("")}</div>`
          : `<div class="m-gallery-empty"><p class="empty">${t("gallery.none")}</p></div>`
      }
    </section>
  `;
}

function galleryManageCard(item) {
  const busy = state.galleryBusy === item.id;
  return `
    <div class="gallery-manage-item">
      ${
        item.type === "video"
          ? `<video controls preload="metadata" ${item.poster_path ? `poster="${escapeHtml(galleryPublicUrl(item.poster_path))}"` : ""}><source src="${escapeHtml(galleryPublicUrl(item.file_path))}" /></video>`
          : `<img src="${escapeHtml(galleryPublicUrl(item.file_path))}" alt="${escapeHtml(item.caption || "")}" loading="lazy" />`
      }
      <div class="gallery-manage-item-footer">
        ${item.caption ? `<span>${escapeHtml(item.caption)}</span>` : ""}
        <button onclick="removeGalleryItem('${item.id}')" ${busy ? "disabled" : ""}>${busy ? t("common.working") : t("common.remove")}</button>
      </div>
    </div>
  `;
}

function galleryNoticeBanner(notice) {
  return `
    <section class="panel credential-reveal error">
      <div class="panel-head"><h2>${t("accounts.notice.errorTitle")}</h2><button onclick="dismissGalleryNotice()">${t("common.dismiss")}</button></div>
      <p>${escapeHtml(notice.message)}</p>
    </section>
  `;
}

function dismissGalleryNotice() {
  state.galleryNotice = null;
  renderContentOnly();
}

function addGalleryItemModal() {
  return `
    <h2>${t("gallery.form.title")}</h2>
    <p class="hint">${t("gallery.form.hint")}</p>
    ${modalMessages()}
    <form onsubmit="handleAddGalleryItem(event)">
      <label>${t("gallery.form.file")}<input type="file" name="file" accept="image/*,video/*" required /></label>
      <label>${t("gallery.form.poster")}<input type="file" name="poster" accept="image/*" /></label>
      <label>${t("gallery.form.caption")}<input type="text" name="caption" /></label>
      <div class="modal-actions">
        <button type="submit" ${state.modalBusy ? "disabled" : ""}>${state.modalBusy ? t("common.working") : t("gallery.form.submit")}</button>
      </div>
    </form>
  `;
}

// The uploaded file's own MIME type decides "image" vs "video" — simpler
// than a manual dropdown, and it can never get out of sync with the file
// actually stored.
async function handleAddGalleryItem(event) {
  event.preventDefault();
  const form = event.target;
  const file = form.file.files[0];
  const posterFile = form.poster.files[0];
  const caption = form.caption.value.trim();
  if (!file) {
    state.modalError = t("gallery.form.missingFile");
    render();
    return;
  }
  state.modalBusy = true;
  state.modalError = "";
  render();
  try {
    const type = file.type.startsWith("video/") ? "video" : "image";
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const filePath = `${Date.now()}-${safeName}`;
    await uploadStorageFile("gallery", filePath, file);
    let posterPath = null;
    if (posterFile) {
      const safePosterName = posterFile.name.replace(/[^\w.\-]+/g, "_");
      posterPath = `${Date.now()}-poster-${safePosterName}`;
      await uploadStorageFile("gallery", posterPath, posterFile);
    }
    await supabaseInsert("gallery_items", [
      {
        type,
        file_path: filePath,
        poster_path: posterPath,
        caption: caption || null,
      },
    ]);
    await loadPublicGalleryItems();
    closeModal();
    navigate("gallery");
  } catch (error) {
    state.modalBusy = false;
    state.modalError = error.message || t("gallery.form.saveError");
    render();
  }
}

async function removeGalleryItem(id) {
  if (!state.session) return;
  if (!window.confirm(t("gallery.confirmRemove"))) return;
  const item = state.publicGalleryItems.find((g) => g.id === id);
  state.galleryBusy = id;
  renderContentOnly();
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/rest/v1/gallery_items?id=eq.${id}`, {
      method: "DELETE",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${state.session.access_token}`,
        Prefer: "return=minimal",
      },
    });
    if (!response.ok) throw new Error(t("gallery.form.removeError"));
    if (item) {
      await supabaseDeleteFile(item.file_path, "gallery").catch(() => {});
      if (item.poster_path) await supabaseDeleteFile(item.poster_path, "gallery").catch(() => {});
    }
    await loadPublicGalleryItems();
  } catch (error) {
    state.galleryNotice = { type: "error", message: error.message };
  } finally {
    state.galleryBusy = null;
    renderContentOnly();
  }
}

// Anyone, signed in or not, can see every gallery item — this is what
// powers both the homepage's public Gallery section for a signed-out
// visitor AND the Manager's own "Gallery" dashboard tab (see galleryView()
// above) — there's no separate admin-only fetch needed since nothing here
// is ever private or pending.
async function loadPublicGalleryItems() {
  if (!hasSupabaseConfig()) return;
  try {
    const base = config.supabaseUrl.replace(/\/$/, "");
    const response = await fetch(
      `${base}/rest/v1/gallery_items?select=id,type,file_path,poster_path,caption,created_at&order=created_at.desc`,
      {
        headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`, Accept: "application/json" },
      },
    );
    state.publicGalleryItems = response.ok ? await response.json() : [];
  } catch {
    state.publicGalleryItems = [];
  }
}

function accountRow({ key, role, name, email, refId, account }) {
  const busy = state.accountsBusy === key;
  const status = account
    ? account.must_change_password
      ? badge(t("accounts.status.invited"))
      : badge(t("accounts.status.active"))
    : `<span class="muted-pill">${t("accounts.status.notSetUp")}</span>`;
  const actionLabel = account ? t("accounts.resetPassword") : t("accounts.generateLogin");
  const handlerName = account ? "resetCredentials" : "generateCredentials";
  const handler = `${handlerName}('${key}', '${role}', '${escapeJs(email)}', '${escapeJs(name)}', '${escapeJs(refId)}')`;

  return `
    <tr>
      <td><strong>${name}</strong></td>
      <td>${role}</td>
      <td>${email}</td>
      <td>${status}</td>
      <td><button onclick="${handler}" ${busy ? "disabled" : ""}>${busy ? t("common.working") : actionLabel}</button></td>
    </tr>
  `;
}

function accountsNoticeBanner(notice) {
  if (notice.type === "error") {
    return `
      <section class="panel credential-reveal error">
        <div class="panel-head"><h2>${t("accounts.notice.errorTitle")}</h2><button onclick="dismissAccountsNotice()">${t("common.dismiss")}</button></div>
        <p>${escapeHtml(notice.message)}</p>
      </section>
    `;
  }

  if (notice.type === "removed") {
    return `
      <section class="panel credential-reveal">
        <div class="panel-head"><h2>${t("accounts.notice.removedTitle")}</h2><button onclick="dismissAccountsNotice()">${t("common.dismiss")}</button></div>
        <p>${escapeHtml(notice.message)}</p>
      </section>
    `;
  }

  return `
    <section class="panel credential-reveal">
      <div class="panel-head"><h2>${t(notice.reset ? "accounts.notice.resetTitle" : "accounts.notice.createdTitle", { name: notice.name })}</h2><button onclick="dismissAccountsNotice()">${t("common.dismiss")}</button></div>
      <p>${t("accounts.notice.shareNow", { name: notice.name })}</p>
      <dl>
        <div><dt>${t("accounts.notice.username")}</dt><dd><code>${notice.email}</code></dd></div>
        <div><dt>${t("accounts.notice.tempPassword")}</dt><dd><code>${notice.password}</code></dd></div>
      </dl>
      <small>${t("accounts.notice.willChoose")}</small>
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
    throw new Error(body.error || t("errors.generic"));
  }
  return body;
}

// Removing an instructor or student always goes through this server
// endpoint (never a direct table delete from the browser) so the login is
// revoked in the same step as the school record — see api/remove-account.js.
async function removeAccountApi(payload) {
  if (!state.session) throw new Error(t("errors.generic"));
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
    throw new Error(body.error || t("errors.generic"));
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

function recomputeInstructorGroupIds() {
  if (state.viewerContext?.instructorName) {
    state.viewerContext.groupIds = groups
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
    state.authError = t("auth.notLinked");
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
    groupIds: [],
  };

  state.view = "dashboard";
  state.authError = "";
  state.authMode = profile.must_change_password ? "force-password" : "signed-in";
  registerDashboardServiceWorker();
  // Fire-and-forget: reflects this browser's actual push subscription state
  // once the service worker is ready, then re-renders the Profile toggle if
  // it's already on screen. Never blocks sign-in on this.
  refreshPushSubscriptionState().then(() => {
    if (state.view === "profile") renderContentOnly();
  });
}

async function hydrateSessionFromToken(session) {
  const user = await fetchCurrentUser(config, session.access_token);
  state.session = session;
  await loadViewerProfile(user);
}

async function bootstrapAuthSession() {
  const stored = loadStoredSession();
  if (!stored?.access_token) {
    // No session yet: a normal browser tab still gets the public marketing
    // site, but someone who installed this as a PWA and opens it from their
    // home screen wants the app, not the homepage — send them straight to
    // the login chooser instead. See isStandalonePwa() further down.
    state.authMode = isStandalonePwa() ? "signed-out" : "marketing";
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
      state.authMode = isStandalonePwa() ? "signed-out" : "marketing";
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
    recomputeInstructorGroupIds();
    resetIdleTimer();
  } catch (error) {
    state.authError = error.message || t("errors.generic");
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
  // Same reasoning as bootstrapAuthSession(): inside the installed PWA,
  // signing out should land back on the login chooser, not the public
  // marketing site.
  state.authMode = isStandalonePwa() ? "signed-out" : "marketing";
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

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
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
  state.authError = t("auth.idleTimeout");
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
    state.authError = t("auth.passwordTooShort");
    render();
    return;
  }
  if (next !== confirmValue) {
    state.authError = t("auth.passwordMismatch");
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
    state.authError = error.message || t("errors.generic");
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
window.openReviewForm = openReviewForm;
window.closeReviewForm = closeReviewForm;
window.setReviewStatus = setReviewStatus;
window.handleLoginSubmit = handleLoginSubmit;
window.handleSignOut = handleSignOut;
window.handleForcePasswordSubmit = handleForcePasswordSubmit;
window.generateCredentials = generateCredentials;
window.resetCredentials = resetCredentials;
window.dismissAccountsNotice = dismissAccountsNotice;
window.dismissPromoModal = dismissPromoModal;
window.openPromoModal = openPromoModal;
window.openPromoForm = openPromoForm;
window.openModal = openModal;
window.closeModal = closeModal;
window.handleAddInstructor = handleAddInstructor;
window.handleAddStudent = handleAddStudent;
window.handleAddManager = handleAddManager;
window.handleAddGroup = handleAddGroup;
window.handleEditGroup = handleEditGroup;
window.handleRemoveGroup = handleRemoveGroup;
window.handleEditInstructor = handleEditInstructor;
window.handleEditStudent = handleEditStudent;
window.setAddStudentSearchQuery = setAddStudentSearchQuery;
window.handleAddExistingStudentToGroup = handleAddExistingStudentToGroup;
window.handleAddMaterial = handleAddMaterial;
window.handleAddAssignment = handleAddAssignment;
window.handleSubmitAssignment = handleSubmitAssignment;
window.supabaseDownloadFile = supabaseDownloadFile;
window.openStorageFile = openStorageFile;
window.selectStudent = selectStudent;
window.setStudentGroupFilter = setStudentGroupFilter;
window.exportStudentsCsv = exportStudentsCsv;
window.renderAttendanceRoster = renderAttendanceRoster;
window.handleTakeAttendance = handleTakeAttendance;
window.openGroupDetail = openGroupDetail;
window.backToGroups = backToGroups;
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
window.handleAddGalleryItem = handleAddGalleryItem;
window.removeGalleryItem = removeGalleryItem;
window.dismissGalleryNotice = dismissGalleryNotice;
window.toggleTheme = toggleTheme;
window.installApp = installApp;
window.setLanguage = setLanguage;
window.chooseLoginMode = chooseLoginMode;
window.backToLoginChooser = backToLoginChooser;
window.handleSaveGrade = handleSaveGrade;
window.setChatGroup = setChatGroup;
window.handleSendMessage = handleSendMessage;
window.deleteMessage = deleteMessage;
window.handleChangePassword = handleChangePassword;
window.enableNotifications = enableNotifications;
window.disableNotifications = disableNotifications;
window.setCodeSource = setCodeSource;
window.runPythonCode = runPythonCode;
window.clearCodeOutput = clearCodeOutput;

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.reviewFormOpen) {
    closeReviewForm();
    return;
  }
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

// ---------------------------------------------------------------------
// PWA install — dashboard only. The browser only offers to install a site
// once it has an active service worker + manifest, and registerDashboard-
// ServiceWorker() (called from loadViewerProfile() once someone is signed
// in) is the only place that ever registers one — a visitor who only sees
// the public marketing/login screens never gets a service worker, so this
// listener simply never fires for them. Registered once, top-level, since
// `beforeinstallprompt` can arrive at any time and there's no later "did I
// already have this event" to check for.
// ---------------------------------------------------------------------

// True once this page is running inside the installed app window (opened
// from a home-screen/desktop icon) rather than a normal browser tab.
// `display-mode: standalone` is what Chrome/Edge/Android set; `navigator
// .standalone` is the older iOS Safari equivalent for "added to home
// screen" — checking both covers every platform this app installs on.
// Used by bootstrapAuthSession()/handleSignOut() to send the installed app
// straight to the login chooser instead of the public marketing homepage.
function isStandalonePwa() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia unsupported/blocked in this context — fall through to the
    // iOS-specific check below rather than throwing.
  }
  return Boolean(window.navigator.standalone);
}

let swRegistered = false;

function registerDashboardServiceWorker() {
  if (swRegistered || !("serviceWorker" in navigator)) return;
  swRegistered = true;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    // Not fatal — the dashboard works fine without it, it just won't be
    // installable or keep a cached shell for a flaky connection.
    swRegistered = false;
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPromptEvent = event;
  if (isAuthenticatedMode()) render();
});

window.addEventListener("appinstalled", () => {
  state.installPromptEvent = null;
  if (isAuthenticatedMode()) render();
});

// Shows the native install prompt captured above — can only be called
// once per captured event, so it's cleared either way once answered (see
// the "Install app" button in shell()'s topbar).
async function installApp() {
  const event = state.installPromptEvent;
  if (!event) return;
  state.installPromptEvent = null;
  render();
  try {
    await event.prompt();
    await event.userChoice;
  } catch {
    // User dismissed it, or the browser revoked it — either way there's
    // nothing to recover; they can trigger it again next time the browser
    // decides to offer it.
  }
}

// ---------------------------------------------------------------------
// Light / dark mode. Applied via a `data-theme` attribute on <html> (see
// styles.css's `[data-theme="dark"]` block) so it works before any
// signed-in state exists — the marketing page, the login screens, and
// the dashboard all pick it up the same way. The choice is remembered
// per-browser (falls back to the OS preference the first time, then to
// light) — never something that needs a server round-trip.
// ---------------------------------------------------------------------

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("codenest-theme");
  } catch {
    saved = null;
  }
  if (saved !== "dark" && saved !== "light") {
    try {
      saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      saved = "light";
    }
  }
  state.theme = saved;
  applyTheme(saved);
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme(state.theme);
  try {
    localStorage.setItem("codenest-theme", state.theme);
  } catch {
    // Private browsing / storage blocked — the toggle still works for
    // the rest of this visit, it just won't be remembered next time.
  }
  render();
}

// ---------------------------------------------------------------------
// Language / direction. Applied via `lang`/`dir` attributes on <html> so
// RTL layout (Arabic) kicks in everywhere at once, including the marketing
// page and every auth screen. Remembered per-browser the same way the
// theme is; defaults to Arabic (DEFAULT_LANG) for a first-time visitor.
// ---------------------------------------------------------------------

function applyLang(lang) {
  document.documentElement.setAttribute("lang", lang);
  document.documentElement.setAttribute("dir", isRtl(lang) ? "rtl" : "ltr");
}

function initLang() {
  let saved = null;
  try {
    saved = localStorage.getItem("codenest-lang");
  } catch {
    saved = null;
  }
  if (!LANGS.includes(saved)) saved = DEFAULT_LANG;
  setLang(saved);
  state.lang = saved;
  applyLang(saved);
}

function setLanguage(lang) {
  if (!LANGS.includes(lang)) return;
  setLang(lang);
  state.lang = lang;
  applyLang(lang);
  try {
    localStorage.setItem("codenest-lang", lang);
  } catch {
    // Private browsing / storage blocked — the switch still works for
    // the rest of this visit, it just won't be remembered next time.
  }
  render();
}

async function initApp() {
  initTheme();
  initLang();
  render();
  loadPublicReviews().then(() => {
    if (state.authMode === "marketing") render();
  });
  loadPublicOpportunities().then(() => {
    applyOpportunityHash();
    if (state.authMode === "marketing") render();
  });
  loadPublicGalleryItems().then(() => {
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
  recomputeInstructorGroupIds();
  resetIdleTimer();
  render();
}

initApp();
