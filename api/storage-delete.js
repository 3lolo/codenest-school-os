import { deleteObject, r2Config } from "./_lib/r2.js";

// Deletes one R2 object — used when a group's materials are cleaned up
// ahead of the group row itself cascading (see handleRemoveGroup() in
// src/app.js) and when a Manager removes a gallery item. Never used for
// "submissions" — nothing in this app ever deletes a delivered submission.
// Same authorization rules as storage-upload-url.js's write checks, which
// mirror the original Supabase Storage "... bucket delete ..." policies
// (supabase/migrations/0011_...sql for materials, 0013_gallery.sql for
// gallery) — a failed delete here is always best-effort from the caller's
// side (see supabaseDeleteFile() in src/app.js), so this only ever needs
// to get authorization right, not be forgiving about missing objects.

const MANAGER_ROLES = ["Super Admin", "School Admin"];
const PURPOSES = ["materials", "gallery"];

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
    `${base}/rest/v1/user_profiles?user_id=eq.${callerUser.id}&select=role,instructor_name`,
    serviceHeaders,
  );
  const caller = callerProfileRows[0];
  if (!caller) {
    jsonError(res, 403, "Your account isn't linked to a school record yet.");
    return;
  }

  const body = await readJsonBody(req);
  const purpose = String(body.purpose || "");
  const key = String(body.key || "");

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
    const groupId = key.split("/")[0];
    if (MANAGER_ROLES.includes(caller.role)) {
      allowed = true;
    } else if (caller.role === "Instructor" && caller.instructor_name && groupId) {
      const rows = await getJson(`${base}/rest/v1/groups?group_id=eq.${encodeURIComponent(groupId)}&select=instructor`, serviceHeaders);
      allowed = rows[0]?.instructor === caller.instructor_name;
    }
  }

  if (!allowed) {
    jsonError(res, 403, "You don't have permission to delete that file.");
    return;
  }

  const ok = await deleteObject(config, purpose, key);
  res.status(200).json({ deleted: ok });
}
