// Thin fetch-based wrapper around Supabase's Auth (GoTrue) REST API.
// Kept dependency-free to match the rest of this project (see app.js's
// existing supabaseSelect helper), rather than pulling in @supabase/supabase-js.

const STORAGE_KEY = "codenest.session";

function authUrl(config, path) {
  return `${config.supabaseUrl.replace(/\/$/, "")}/auth/v1${path}`;
}

export function loadStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeSession(session) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private browsing, etc.); sessions just
    // won't persist across reloads in that case.
  }
}

export async function signInWithPassword(config, email, password) {
  const response = await fetch(authUrl(config, "/token?grant_type=password"), {
    method: "POST",
    headers: { apikey: config.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error_description || body.msg || "Incorrect email or password.");
  }
  storeSession(body);
  return body;
}

export async function refreshSession(config, refreshToken) {
  const response = await fetch(authUrl(config, "/token?grant_type=refresh_token"), {
    method: "POST",
    headers: { apikey: config.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error("Session refresh failed.");
  }
  storeSession(body);
  return body;
}

export async function signOut(config, session) {
  if (session?.access_token) {
    try {
      await fetch(authUrl(config, "/logout"), {
        method: "POST",
        headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${session.access_token}` },
      });
    } catch {
      // best effort: still clear the local session below
    }
  }
  storeSession(null);
}

export async function fetchCurrentUser(config, accessToken) {
  const response = await fetch(authUrl(config, "/user"), {
    headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Session expired.");
  return response.json();
}

export async function changePassword(config, accessToken, newPassword) {
  const response = await fetch(authUrl(config, "/user"), {
    method: "PUT",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error_description || body.msg || "Could not update your password.");
  }
  return body;
}
