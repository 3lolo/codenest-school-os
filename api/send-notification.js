import webpush from "web-push";

// Fans a single app event out to every Web Push subscription (see
// supabase/migrations/0015_push_subscriptions.sql and the "Enable
// notifications" toggle in profileView() in src/app.js) that should hear
// about it. Follows the exact same trust model as api/create-account.js and
// api/remove-account.js: the browser tells us *what happened*, never *who's
// allowed to know about it* — every authorization decision here is
// re-derived server-side from the caller's own user_profiles row (or, for
// the one public event below, from the row it's actually about), using the
// service-role key.
//
// One exception: "review_submitted" fires from the anonymous public review
// form (see handleReviewSubmit() in src/app.js), which has no signed-in
// caller at all. That's safe to allow unauthenticated because it grants
// nothing beyond what public RLS already grants — anyone can already insert
// a pending review row (see supabase/migrations/0005_reviews.sql); this
// just also pings Managers about a row that's already sitting there. The
// handler still re-reads that exact row before notifying anyone, so it
// can't be used to send an arbitrary message.

const MANAGER_ROLES = ["Super Admin", "School Admin"];

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonError(res, status, error, detail) {
  res.status(status).json(detail ? { error, detail } : { error });
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

function truncate(text, max) {
  const value = String(text || "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ---------------------------------------------------------------------
// Per-event resolution: given the caller's profile (or null, for the one
// public event) and the request body, decide whether this is allowed and
// who should be notified about what. Every function below either returns
// {title, body, url, targetUserIds} or throws an ApiError.
// ---------------------------------------------------------------------

async function resolveGroupAssigned(base, headers, caller, body) {
  const studentRef = String(body.studentRef || "").trim();
  if (!studentRef) throw new ApiError(400, "studentRef is required.");

  const studentRows = await getJson(`${base}/rest/v1/students?student_id=eq.${encodeURIComponent(studentRef)}&select=student_id,first_name,last_name,group_id`, headers);
  const student = studentRows[0];
  if (!student?.group_id) throw new ApiError(404, "That student isn't in a group.");

  await assertCallerOwnsGroup(base, headers, caller, student.group_id);

  const group = await getGroup(base, headers, student.group_id);
  const targetUserIds = await userIdsForStudents(base, headers, [studentRef]);
  return {
    title: "Added to a group",
    body: `You've been added to ${group?.name || "a group"}.`,
    url: "/",
    targetUserIds,
  };
}

async function resolveMaterialOrAssignmentAdded(kind, base, headers, caller, body) {
  const groupId = String(body.groupId || "").trim();
  const title = truncate(body.title, 120);
  if (!groupId || !title) throw new ApiError(400, "groupId and title are required.");

  await assertCallerOwnsGroup(base, headers, caller, groupId);
  const group = await getGroup(base, headers, groupId);
  const targetUserIds = await userIdsForGroupStudents(base, headers, groupId);

  return kind === "material"
    ? {
        title: "New material added",
        body: `"${title}" was added to ${group?.name || "your group"}.`,
        url: "/",
        targetUserIds,
      }
    : {
        title: "New assignment",
        body: `"${title}" was assigned in ${group?.name || "your group"}${body.dueDate ? ` · due ${body.dueDate}` : ""}.`,
        url: "/",
        targetUserIds,
      };
}

async function resolveGradeAdded(base, headers, caller, body) {
  const studentRef = String(body.studentRef || "").trim();
  const assignmentTitle = truncate(body.assignmentTitle, 120);
  if (!studentRef || !assignmentTitle) throw new ApiError(400, "studentRef and assignmentTitle are required.");

  const studentRows = await getJson(`${base}/rest/v1/students?student_id=eq.${encodeURIComponent(studentRef)}&select=group_id`, headers);
  const groupId = studentRows[0]?.group_id;
  if (!groupId) throw new ApiError(404, "That student isn't in a group.");
  await assertCallerOwnsGroup(base, headers, caller, groupId);

  const targetUserIds = await userIdsForStudents(base, headers, [studentRef]);
  const score = Number.isFinite(Number(body.score)) ? Number(body.score) : null;
  const maxScore = Number.isFinite(Number(body.maxScore)) ? Number(body.maxScore) : null;
  return {
    title: "Grade posted",
    body: score !== null && maxScore !== null ? `${assignmentTitle}: ${score}/${maxScore}` : `A grade was posted for ${assignmentTitle}.`,
    url: "/",
    targetUserIds,
  };
}

async function resolveChatMessage(base, headers, caller, body) {
  const groupId = String(body.groupId || "").trim();
  const preview = truncate(body.preview, 140);
  if (!groupId) throw new ApiError(400, "groupId is required.");

  const group = await getGroup(base, headers, groupId);
  if (!group) throw new ApiError(404, "Group not found.");

  const isManager = MANAGER_ROLES.includes(caller.role);
  const isOwningInstructor = caller.role === "Instructor" && caller.instructorName && caller.instructorName === group.instructor;
  const isMemberStudent = caller.role === "Student" && caller.studentGroupId === groupId;
  if (!isManager && !isOwningInstructor && !isMemberStudent) {
    throw new ApiError(403, "You don't have access to this group's chat.");
  }

  const studentUserIds = await userIdsForGroupStudents(base, headers, groupId);
  const instructorUserIds = group.instructor ? await userIdsForInstructor(base, headers, group.instructor) : [];
  const allTargets = new Set([...studentUserIds, ...instructorUserIds]);
  allTargets.delete(caller.userId);

  const senderName = caller.fullName || caller.instructorName || "Someone";
  return {
    title: `${senderName} · ${group.name || "Group chat"}`,
    body: preview || "sent a new message.",
    url: "/",
    targetUserIds: [...allTargets],
  };
}

async function resolveRequestStatusChanged(base, headers, caller, body) {
  if (!MANAGER_ROLES.includes(caller.role)) throw new ApiError(403, "Only a Manager can do this.");
  const requestId = String(body.requestId || "").trim();
  if (!requestId) throw new ApiError(400, "requestId is required.");

  const rows = await getJson(`${base}/rest/v1/staff_requests?id=eq.${encodeURIComponent(requestId)}&select=instructor_name,subject,status`, headers);
  const request = rows[0];
  if (!request) throw new ApiError(404, "Request not found.");

  const targetUserIds = await userIdsForInstructor(base, headers, request.instructor_name);
  return {
    title: "Your request was updated",
    body: `"${request.subject}" is now ${request.status}.`,
    url: "/",
    targetUserIds,
  };
}

async function resolveStaffRequestSubmitted(base, headers, caller, body) {
  if (caller.role !== "Instructor") throw new ApiError(403, "Only an Instructor can submit a staff request.");
  const requestId = String(body.requestId || "").trim();
  if (!requestId) throw new ApiError(400, "requestId is required.");

  const rows = await getJson(`${base}/rest/v1/staff_requests?id=eq.${encodeURIComponent(requestId)}&select=instructor_name,subject,kind`, headers);
  const request = rows[0];
  if (!request) throw new ApiError(404, "Request not found.");
  if (request.instructor_name !== caller.instructorName) {
    throw new ApiError(403, "You can only notify about your own requests.");
  }

  const targetUserIds = await userIdsForManagers(base, headers);
  const kindLabel = request.kind === "holiday" ? "vacation request" : request.kind === "removal" ? "removal request" : "request";
  return {
    title: "New staff request",
    body: `${request.instructor_name} submitted a ${kindLabel}: ${request.subject}`,
    url: "/",
    targetUserIds,
  };
}

async function resolveReviewSubmitted(base, headers, _caller, body) {
  const reviewId = String(body.reviewId || "").trim();
  if (!reviewId) throw new ApiError(400, "reviewId is required.");

  const rows = await getJson(
    `${base}/rest/v1/reviews?id=eq.${encodeURIComponent(reviewId)}&status=eq.pending&select=name,rating,created_at`,
    headers,
  );
  const review = rows[0];
  if (!review) throw new ApiError(404, "That review isn't pending anymore.");
  // Guard against a stale/replayed id being used to re-trigger a
  // notification long after the fact — this only ever fires right after
  // handleReviewSubmit()'s own insert succeeds.
  const ageMs = Date.now() - new Date(review.created_at).getTime();
  if (ageMs > 10 * 60 * 1000) throw new ApiError(410, "That review is too old to notify about.");

  const targetUserIds = await userIdsForManagers(base, headers);
  return {
    title: "New review submitted",
    body: `${review.name} left a ${review.rating}★ review — take a look.`,
    url: "/",
    targetUserIds,
  };
}

const EVENT_HANDLERS = {
  group_assigned: { requiresAuth: true, resolve: resolveGroupAssigned },
  material_added: { requiresAuth: true, resolve: (b, h, c, body) => resolveMaterialOrAssignmentAdded("material", b, h, c, body) },
  assignment_added: { requiresAuth: true, resolve: (b, h, c, body) => resolveMaterialOrAssignmentAdded("assignment", b, h, c, body) },
  grade_added: { requiresAuth: true, resolve: resolveGradeAdded },
  chat_message: { requiresAuth: true, resolve: resolveChatMessage },
  request_status_changed: { requiresAuth: true, resolve: resolveRequestStatusChanged },
  staff_request_submitted: { requiresAuth: true, resolve: resolveStaffRequestSubmitted },
  review_submitted: { requiresAuth: false, resolve: resolveReviewSubmitted },
};

// ---------------------------------------------------------------------
// Small REST helpers, all against PostgREST with the service-role key —
// this endpoint is the one place allowed to read across every user's
// records to figure out who to notify.
// ---------------------------------------------------------------------

async function getJson(url, headers) {
  const response = await fetch(url, { headers });
  return response.ok ? response.json() : [];
}

async function getGroup(base, headers, groupId) {
  const rows = await getJson(`${base}/rest/v1/groups?group_id=eq.${encodeURIComponent(groupId)}&select=group_id,name,instructor`, headers);
  return rows[0] || null;
}

// A Manager may act on any group; an Instructor only on a group they own —
// same boundary as canManageGroup() in security.js, re-derived here from
// the service-role-verified caller profile rather than trusted from the
// browser.
async function assertCallerOwnsGroup(base, headers, caller, groupId) {
  if (MANAGER_ROLES.includes(caller.role)) return;
  if (caller.role === "Instructor") {
    const group = await getGroup(base, headers, groupId);
    if (group?.instructor && group.instructor === caller.instructorName) return;
  }
  throw new ApiError(403, "You don't have access to that group.");
}

async function userIdsForInstructor(base, headers, instructorName) {
  if (!instructorName) return [];
  const rows = await getJson(`${base}/rest/v1/user_profiles?instructor_name=eq.${encodeURIComponent(instructorName)}&select=user_id`, headers);
  return rows.map((row) => row.user_id);
}

async function userIdsForStudents(base, headers, studentRefs) {
  if (!studentRefs.length) return [];
  const list = studentRefs.map((ref) => encodeURIComponent(ref)).join(",");
  const rows = await getJson(`${base}/rest/v1/user_profiles?student_id=in.(${list})&select=user_id`, headers);
  return rows.map((row) => row.user_id);
}

async function userIdsForGroupStudents(base, headers, groupId) {
  const studentRows = await getJson(`${base}/rest/v1/students?group_id=eq.${encodeURIComponent(groupId)}&select=student_id`, headers);
  return userIdsForStudents(base, headers, studentRows.map((row) => row.student_id));
}

async function userIdsForManagers(base, headers) {
  const rows = await getJson(`${base}/rest/v1/user_profiles?role=in.(${MANAGER_ROLES.map((r) => encodeURIComponent(r)).join(",")})&select=user_id`, headers);
  return rows.map((row) => row.user_id);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonError(res, 405, "Method not allowed.");
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || "mailto:admin@example.com";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    jsonError(res, 500, "This server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. An admin needs to add them in Vercel project settings.");
    return;
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    // Not a hard failure the caller needs to see as an error banner — push
    // just isn't configured yet. Every call site in app.js already wraps
    // this in a try/catch and ignores failures, so this only ever shows up
    // in Vercel's own function logs for whoever is setting this up.
    jsonError(res, 500, "This server is missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY. An admin needs to add them in Vercel project settings.");
    return;
  }

  const body = await readJsonBody(req);
  const eventType = String(body.eventType || "");
  const eventHandler = EVENT_HANDLERS[eventType];
  if (!eventHandler) {
    jsonError(res, 400, `Unknown eventType. Expected one of: ${Object.keys(EVENT_HANDLERS).join(", ")}.`);
    return;
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const serviceHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  let caller = null;
  if (eventHandler.requiresAuth) {
    const authHeader = req.headers.authorization || "";
    const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!callerToken) {
      jsonError(res, 401, "Sign in and try again.");
      return;
    }
    const callerResponse = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${callerToken}` },
    });
    if (!callerResponse.ok) {
      jsonError(res, 401, "Your session has expired. Sign in again.");
      return;
    }
    const callerUser = await callerResponse.json();
    const callerProfileRows = await getJson(
      `${base}/rest/v1/user_profiles?user_id=eq.${callerUser.id}&select=role,student_id,instructor_name,full_name`,
      serviceHeaders,
    );
    const callerProfile = callerProfileRows[0];
    if (!callerProfile) {
      jsonError(res, 403, "Your account isn't linked to a school record yet.");
      return;
    }
    let studentGroupId = null;
    if (callerProfile.role === "Student" && callerProfile.student_id) {
      const studentRows = await getJson(
        `${base}/rest/v1/students?student_id=eq.${encodeURIComponent(callerProfile.student_id)}&select=group_id`,
        serviceHeaders,
      );
      studentGroupId = studentRows[0]?.group_id || null;
    }
    caller = {
      userId: callerUser.id,
      role: callerProfile.role,
      studentId: callerProfile.student_id,
      studentGroupId,
      instructorName: callerProfile.instructor_name,
      fullName: callerProfile.full_name,
    };
  }

  let notification;
  try {
    notification = await eventHandler.resolve(base, serviceHeaders, caller, body);
  } catch (error) {
    if (error instanceof ApiError) {
      jsonError(res, error.status, error.message);
    } else {
      jsonError(res, 500, "Could not prepare that notification.", String(error?.message || error));
    }
    return;
  }

  const targetUserIds = [...new Set((notification.targetUserIds || []).filter(Boolean))];
  if (!targetUserIds.length) {
    res.status(200).json({ sent: 0, reason: "no eligible recipients" });
    return;
  }

  const list = targetUserIds.map((id) => encodeURIComponent(id)).join(",");
  const subscriptions = await getJson(
    `${base}/rest/v1/push_subscriptions?user_id=in.(${list})&select=id,endpoint,p256dh,auth_key`,
    serviceHeaders,
  );

  if (!subscriptions.length) {
    res.status(200).json({ sent: 0, reason: "no subscriptions" });
    return;
  }

  webpush.setVapidDetails(VAPID_CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({ title: notification.title, body: notification.body, url: notification.url || "/" });

  let sent = 0;
  const deadIds = [];
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
          },
          payload,
        );
        sent += 1;
      } catch (error) {
        // 404/410 means the browser/OS has permanently invalidated this
        // subscription (uninstalled, permission revoked, etc.) — prune it
        // so future events don't keep retrying a dead endpoint.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          deadIds.push(subscription.id);
        }
      }
    }),
  );

  if (deadIds.length) {
    const idList = deadIds.map((id) => encodeURIComponent(id)).join(",");
    await fetch(`${base}/rest/v1/push_subscriptions?id=in.(${idList})`, {
      method: "DELETE",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
    }).catch(() => {});
  }

  res.status(200).json({ sent, pruned: deadIds.length });
}
