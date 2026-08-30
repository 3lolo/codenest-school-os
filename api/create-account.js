import { generatePassword } from "./_lib/password.js";

const ISSUABLE_ROLES = ["Student", "Instructor"];

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonError(res, 405, "Method not allowed.");
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    jsonError(
      res,
      500,
      "This server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. An admin needs to add them in Vercel project settings.",
    );
    return;
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!callerToken) {
    jsonError(res, 401, "Sign in and try again.");
    return;
  }

  const serviceHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  // 1. Who is calling?
  const callerResponse = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${callerToken}` },
  });
  if (!callerResponse.ok) {
    jsonError(res, 401, "Your session has expired. Sign in again.");
    return;
  }
  const caller = await callerResponse.json();

  // 2. Is the caller actually allowed to issue logins? (checked server-side,
  // never trust the client). Managers (Super Admin / School Admin) can issue
  // Instructor and Student logins. Instructors can only issue Student
  // logins, and only for students in their own classes (checked in step 3b).
  const callerProfileResponse = await fetch(
    `${base}/rest/v1/user_profiles?user_id=eq.${caller.id}&select=role,instructor_name`,
    { headers: serviceHeaders },
  );
  const callerProfileRows = callerProfileResponse.ok ? await callerProfileResponse.json() : [];
  const callerRole = callerProfileRows[0]?.role;
  const callerInstructorName = callerProfileRows[0]?.instructor_name;
  const callerIsManager = ["Super Admin", "School Admin"].includes(callerRole);
  const callerIsInstructor = callerRole === "Instructor";

  if (!callerIsManager && !callerIsInstructor) {
    jsonError(res, 403, "Only a Manager or Instructor can issue portal logins.");
    return;
  }

  // 3. Validate the request.
  const body = await readJsonBody(req);
  const role = body.role;
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = body.fullName ? String(body.fullName).trim() : null;
  const studentRef = role === "Student" ? String(body.studentRef || "").trim() : null;
  const instructorRef = role === "Instructor" ? String(body.instructorRef || "").trim() : null;

  if (!ISSUABLE_ROLES.includes(role)) {
    jsonError(res, 400, "role must be 'Student' or 'Instructor'.");
    return;
  }
  if (callerIsInstructor && role !== "Student") {
    jsonError(res, 403, "Instructors can only issue or reset Student logins.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    jsonError(res, 400, "Enter a valid email address to use as the username.");
    return;
  }
  if (role === "Student" && !studentRef) {
    jsonError(res, 400, "studentRef is required for a Student account.");
    return;
  }
  if (role === "Instructor" && !instructorRef) {
    jsonError(res, 400, "instructorRef is required for an Instructor account.");
    return;
  }

  // 3b. An instructor may only issue/reset logins for students in one of
  // their own classes — re-verified here with the service key rather than
  // trusted from the browser.
  if (callerIsInstructor) {
    if (!callerInstructorName) {
      jsonError(res, 403, "Your account is not linked to an instructor record yet. Ask a Manager to fix this.");
      return;
    }
    const [studentResponse, classesResponse] = await Promise.all([
      fetch(`${base}/rest/v1/students?student_id=eq.${encodeURIComponent(studentRef)}&select=class_id`, {
        headers: serviceHeaders,
      }),
      fetch(
        `${base}/rest/v1/classes?instructor=eq.${encodeURIComponent(callerInstructorName)}&select=class_id`,
        { headers: serviceHeaders },
      ),
    ]);
    const studentRows = studentResponse.ok ? await studentResponse.json() : [];
    const classRows = classesResponse.ok ? await classesResponse.json() : [];
    const studentClassId = studentRows[0]?.class_id;
    const ownClassIds = new Set(classRows.map((row) => row.class_id));

    if (!studentClassId || !ownClassIds.has(studentClassId)) {
      jsonError(res, 403, "You can only issue logins for students in your own classes.");
      return;
    }
  }

  // 4. Is this a brand-new login, or a password reset for an existing one?
  const existingFilter =
    role === "Student"
      ? `student_id=eq.${encodeURIComponent(studentRef)}`
      : `instructor_name=eq.${encodeURIComponent(instructorRef)}`;
  const existingResponse = await fetch(
    `${base}/rest/v1/user_profiles?${existingFilter}&select=user_id,email`,
    { headers: serviceHeaders },
  );
  const existingRows = existingResponse.ok ? await existingResponse.json() : [];
  const existing = existingRows[0];

  const password = generatePassword();
  let userId = existing?.user_id;

  if (userId) {
    const updateResponse = await fetch(`${base}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: serviceHeaders,
      body: JSON.stringify({ email, password, user_metadata: { full_name: fullName, role } }),
    });
    if (!updateResponse.ok) {
      const detail = await updateResponse.text();
      jsonError(res, 502, "Could not reset the existing account's password.", detail);
      return;
    }
  } else {
    const createResponse = await fetch(`${base}/auth/v1/admin/users`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role },
      }),
    });
    if (!createResponse.ok) {
      const detail = await createResponse.text();
      const alreadyRegistered = /already.*registered|already.*exists/i.test(detail);
      jsonError(
        res,
        502,
        alreadyRegistered
          ? `${email} is already registered to a different account. Use a different email or reset that account's password instead.`
          : "Could not create the account.",
        alreadyRegistered ? undefined : detail,
      );
      return;
    }
    const created = await createResponse.json();
    userId = created.id;
  }

  // 5. Link the auth user to their role/record.
  const upsertResponse = await fetch(`${base}/rest/v1/user_profiles?on_conflict=user_id`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      {
        user_id: userId,
        role,
        student_id: role === "Student" ? studentRef : null,
        instructor_name: role === "Instructor" ? instructorRef : null,
        full_name: fullName,
        email,
        must_change_password: true,
      },
    ]),
  });
  if (!upsertResponse.ok) {
    const detail = await upsertResponse.text();
    jsonError(
      res,
      502,
      "The login was created but linking it to the school record failed. Contact support before sharing the password.",
      detail,
    );
    return;
  }

  // 6. Best-effort audit trail. Never fail the request over this.
  try {
    await fetch(`${base}/rest/v1/audit_logs`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify([
        {
          actor: caller.email || callerRole,
          action: existing ? "account.password_reset" : "account.created",
          entity: email,
          display_time: new Date().toISOString(),
          meta: `${role} portal login ${existing ? "reset" : "issued"}`,
        },
      ]),
    });
  } catch {
    // audit logging is a nice-to-have, never block the response on it
  }

  res.status(200).json({ email, password, role, mustChangePassword: true, reset: Boolean(existing) });
}
