import { presignPutUrl, r2Config } from "./_lib/r2.js";

// Hands back a short-lived presigned URL the browser can PUT a file to
// directly — R2 never sees a request that didn't come from here, and this
// endpoint never sees the file's bytes (they go straight from the
// browser to R2, same round-trip shape as the old direct-to-Supabase-
// Storage upload it replaces — see supabaseUploadFile() in src/app.js).
//
// R2 has no row-level security of its own, so every rule the three old
// Supabase Storage buckets enforced (see supabase/migrations/0006, 0011,
// 0013, 0014's "... bucket write ..." policies) is re-implemented here by
// hand, gated on the caller's own service-key-verified profile — never
// trusted from the browser, same rule as every other endpoint in api/.
//
// `key` is validated per purpose against the exact folder convention the
// matching Supabase bucket already used, so an existing row's file_path
// (unchanged by the R2 migration — see scripts/migrate-storage-to-r2.mjs)
// still resolves to the same object layout after this replaces the bucket
// it lives in.

const MANAGER_ROLES = ["Super Admin", "School Admin"];
const PURPOSES = ["materials", "gallery", "submissions"];

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

// A key can only ever be a plain relative path — no leading slash, no
// ".." segments that could escape its purpose's own folder, no querying
// into someone else's object by construction.
function isSafeKey(key) {
  if (typeof key !== "string" || !key || key.startsWith("/")) return false;
  const segments = key.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function authorizeMaterials(base, serviceHeaders, caller, key) {
  const groupId = key.split("/")[0];
  if (!groupId) return false;
  if (MANAGER_ROLES.includes(caller.role)) return true;
  if (caller.role !== "Instructor" || !caller.instructorName) return false;
  const rows = await getJson(`${base}/rest/v1/groups?group_id=eq.${encodeURIComponent(groupId)}&select=instructor`, serviceHeaders);
  return rows[0]?.instructor === caller.instructorName;
}

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
  const caller = { role: callerProfile.role, studentId: callerProfile.student_id, instructorName: callerProfile.instructor_name };

  const body = await readJsonBody(req);
  const purpose = String(body.purpose || "");
  const key = String(body.key || "");
  const contentType = body.contentType ? String(body.contentType) : "application/octet-stream";

  if (!PURPOSES.includes(purpose)) {
    jsonError(res, 400, `purpose must be one of: ${PURPOSES.join(", ")}.`);
    return;
  }
  if (!isSafeKey(key)) {
    jsonError(res, 400, "key must be a plain relative path.");
    return;
  }

  let allowed = false;
  if (purpose === "gallery") {
    allowed = MANAGER_ROLES.includes(caller.role);
  } else if (purpose === "materials") {
    allowed = await authorizeMaterials(base, serviceHeaders, caller, key);
  } else if (purpose === "submissions") {
    allowed = await authorizeSubmissions(base, serviceHeaders, caller, key);
  }

  if (!allowed) {
    jsonError(res, 403, "You don't have permission to upload there.");
    return;
  }

  const uploadUrl = await presignPutUrl(config, purpose, key, { expiresInSeconds: 300 });
  res.status(200).json({ uploadUrl, purpose, key, contentType });
}
