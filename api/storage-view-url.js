import { presignGetUrl, r2Config } from "./_lib/r2.js";

// Hands back a short-lived presigned GET URL for a materials/submissions
// object — the two purposes that were ever private in the first place
// (see supabase/migrations/0006, 0011, 0014's "... bucket scoped read ..."
// policies). Gallery objects are public by design (0013_gallery.sql) and
// are read straight from R2's public bucket URL client-side (see
// galleryPublicUrl() in src/app.js) — they never need to come through
// here at all.
//
// `mode: "view"` signs the URL with response-content-disposition: inline,
// so a browser tab renders whatever it can (images, PDFs, video, audio)
// instead of downloading it; `mode: "download"` signs the same object
// with `attachment; filename="..."` to force a save-as. Same
// authorization check either way — this only ever changes how the
// browser presents bytes it was already allowed to read.

const MANAGER_ROLES = ["Super Admin", "School Admin"];
const PURPOSES = ["materials", "submissions"];

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

async function getJson(url, headers) {
  const response = await fetch(url, { headers });
  return response.ok ? response.json() : [];
}

function isSafeKey(key) {
  if (typeof key !== "string" || !key || key.startsWith("/")) return false;
  const segments = key.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

// Mirrors can_view_group() from supabase/migrations/0011_...sql: a
// Manager, that group's own Instructor, or a student in that group.
async function authorizeMaterials(base, serviceHeaders, caller, key) {
  const groupId = key.split("/")[0];
  if (!groupId) return false;
  if (MANAGER_ROLES.includes(caller.role)) return true;
  if (caller.role === "Instructor" && caller.instructorName) {
    const rows = await getJson(`${base}/rest/v1/groups?group_id=eq.${encodeURIComponent(groupId)}&select=instructor`, serviceHeaders);
    if (rows[0]?.instructor === caller.instructorName) return true;
  }
  if (caller.role === "Student" && caller.studentGroupId === groupId) return true;
  return false;
}

// Mirrors can_view_student() applied to a submission's own
// "<assignment_id>/<student_id>/..." path, exactly like
// supabase/migrations/0014_...sql's "submissions bucket scoped read".
async function authorizeSubmissions(base, serviceHeaders, caller, key) {
  const [assignmentId, studentId] = key.split("/");
  if (!assignmentId || !studentId) return false;
  if (MANAGER_ROLES.includes(caller.role)) return true;
  const rows = await getJson(`${base}/rest/v1/assignments?id=eq.${encodeURIComponent(assignmentId)}&select=group_id`, serviceHeaders);
  const groupId = rows[0]?.group_id;
  if (!groupId) return false;
  if (caller.role === "Instructor" && caller.instructorName) {
    const groupRows = await getJson(`${base}/rest/v1/groups?group_id=eq.${encodeURIComponent(groupId)}&select=instructor`, serviceHeaders);
    if (groupRows[0]?.instructor === caller.instructorName) return true;
  }
  if (caller.role === "Student" && caller.studentId === studentId) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonError(res, 405, "Method not allowed.");
    return;
  }

  const config = r2Config();
  if (!config) {
    jsonError(res, 500, "This server is missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, or R2_BUCKET_NAME. An admin needs to add them in Vercel project settings.");
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    jsonError(res, 500, "This server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. An admin needs to add them in Vercel project settings.");
    return;
  }
  const base = SUPABASE_URL.replace(/\/$/, "");
  const serviceHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

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
    `${base}/rest/v1/user_profiles?user_id=eq.${callerUser.id}&select=role,student_id,instructor_name`,
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
  const caller = {
    role: callerProfile.role,
    studentId: callerProfile.student_id,
    studentGroupId,
    instructorName: callerProfile.instructor_name,
  };

  const body = await readJsonBody(req);
  const purpose = String(body.purpose || "");
  const key = String(body.key || "");
  const mode = body.mode === "download" ? "download" : "view";
  const fileName = body.fileName ? String(body.fileName).replace(/"/g, "'") : "file";

  if (!PURPOSES.includes(purpose)) {
    jsonError(res, 400, `purpose must be one of: ${PURPOSES.join(", ")}.`);
    return;
  }
  if (!isSafeKey(key)) {
    jsonError(res, 400, "key must be a plain relative path.");
    return;
  }

  const allowed =
    purpose === "materials" ? await authorizeMaterials(base, serviceHeaders, caller, key) : await authorizeSubmissions(base, serviceHeaders, caller, key);

  if (!allowed) {
    jsonError(res, 403, "You don't have permission to view that file.");
    return;
  }

  const disposition = mode === "download" ? `attachment; filename="${fileName}"` : "inline";
  const url = await presignGetUrl(config, purpose, key, { disposition, expiresInSeconds: 600 });
  res.status(200).json({ url, mode });
}
