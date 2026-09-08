// Permanently removes an Instructor or Student — their school record *and*
// their portal login, if one was ever issued. Only a Manager can call this
// (re-verified here with the service key, never trusted from the browser —
// same rule as api/create-account.js). An Instructor never reaches this
// endpoint directly: they can only submit a "removal" staff_request, which
// a Manager approves from the Requests panel, and that approval is what
// calls this endpoint, still as the Manager's own session.

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

  // 2. Is the caller actually a Manager? Removing a person's record and
  // login is irreversible, so — unlike account issuance — an Instructor is
  // never allowed here at all, not even for their own students. Approving
  // a removal request always happens as the Manager's own session.
  const callerProfileResponse = await fetch(
    `${base}/rest/v1/user_profiles?user_id=eq.${caller.id}&select=role`,
    { headers: serviceHeaders },
  );
  const callerProfileRows = callerProfileResponse.ok ? await callerProfileResponse.json() : [];
  const callerRole = callerProfileRows[0]?.role;
  const callerIsManager = ["Super Admin", "School Admin"].includes(callerRole);

  if (!callerIsManager) {
    jsonError(res, 403, "Only a Manager can remove an instructor or student.");
    return;
  }

  // 3. Validate the request.
  const body = await readJsonBody(req);
  const role = body.role;
  const ref = String(body.ref || "").trim();

  if (!["Student", "Instructor"].includes(role)) {
    jsonError(res, 400, "role must be 'Student' or 'Instructor'.");
    return;
  }
  if (!ref) {
    jsonError(res, 400, "ref is required.");
    return;
  }

  if (role === "Instructor") {
    // Guardrail: don't leave classes pointing at an instructor who no
    // longer exists. `classes.instructor` is a plain text match, not a
    // real foreign key, so the database itself wouldn't stop this.
    const classesResponse = await fetch(
      `${base}/rest/v1/classes?instructor=eq.${encodeURIComponent(ref)}&select=class_id`,
      { headers: serviceHeaders },
    );
    const classRows = classesResponse.ok ? await classesResponse.json() : [];
    if (classRows.length > 0) {
      jsonError(
        res,
        409,
        `${ref} still has ${classRows.length} class${classRows.length === 1 ? "" : "es"} assigned. Reassign or delete ${classRows.length === 1 ? "that class" : "those classes"} first, then remove ${ref}.`,
      );
      return;
    }

    const instructorResponse = await fetch(
      `${base}/rest/v1/instructors?name=eq.${encodeURIComponent(ref)}&select=name,email`,
      { headers: serviceHeaders },
    );
    const instructorRows = instructorResponse.ok ? await instructorResponse.json() : [];
    if (instructorRows.length === 0) {
      jsonError(res, 404, `No instructor named ${ref} was found.`);
      return;
    }
    if (instructorRows.length > 1) {
      jsonError(res, 409, `More than one instructor is named ${ref} — contact support before removing either one.`);
      return;
    }
    const targetEmail = instructorRows[0].email;

    // Revoke the login, if one was ever issued (deleting the auth user
    // cascades to its user_profiles row automatically).
    const profileResponse = await fetch(
      `${base}/rest/v1/user_profiles?instructor_name=eq.${encodeURIComponent(ref)}&select=user_id`,
      { headers: serviceHeaders },
    );
    const profileRows = profileResponse.ok ? await profileResponse.json() : [];
    for (const profile of profileRows) {
      await fetch(`${base}/auth/v1/admin/users/${profile.user_id}`, { method: "DELETE", headers: serviceHeaders });
    }

    const deleteResponse = await fetch(
      `${base}/rest/v1/instructors?name=eq.${encodeURIComponent(ref)}&email=eq.${encodeURIComponent(targetEmail)}`,
      { method: "DELETE", headers: { ...serviceHeaders, Prefer: "return=minimal" } },
    );
    if (!deleteResponse.ok) {
      const detail = await deleteResponse.text();
      jsonError(res, 502, "Could not remove the instructor record.", detail);
      return;
    }
  } else {
    const studentResponse = await fetch(
      `${base}/rest/v1/students?student_id=eq.${encodeURIComponent(ref)}&select=student_id`,
      { headers: serviceHeaders },
    );
    const studentRows = studentResponse.ok ? await studentResponse.json() : [];
    if (studentRows.length === 0) {
      jsonError(res, 404, `No student with id ${ref} was found.`);
      return;
    }

    // Revoke the login, if one was ever issued. Everything else that
    // points at this student (attendance_records, group_members,
    // parent_student_links) is a real foreign key with `on delete
    // cascade`, so deleting the row below cleans those up automatically —
    // nothing else to do here.
    const profileResponse = await fetch(
      `${base}/rest/v1/user_profiles?student_id=eq.${encodeURIComponent(ref)}&select=user_id`,
      { headers: serviceHeaders },
    );
    const profileRows = profileResponse.ok ? await profileResponse.json() : [];
    for (const profile of profileRows) {
      await fetch(`${base}/auth/v1/admin/users/${profile.user_id}`, { method: "DELETE", headers: serviceHeaders });
    }

    const deleteResponse = await fetch(`${base}/rest/v1/students?student_id=eq.${encodeURIComponent(ref)}`, {
      method: "DELETE",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
    });
    if (!deleteResponse.ok) {
      const detail = await deleteResponse.text();
      jsonError(res, 502, "Could not remove the student record.", detail);
      return;
    }
  }

  // Best-effort audit trail. Never fail the request over this.
  try {
    await fetch(`${base}/rest/v1/audit_logs`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify([
        {
          actor: caller.email || callerRole,
          action: "account.removed",
          entity: ref,
          display_time: new Date().toISOString(),
          meta: `${role} record and login removed`,
        },
      ]),
    });
  } catch {
    // audit logging is a nice-to-have, never block the response on it
  }

  res.status(200).json({ removed: true, role, ref });
}
