import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const dist = join(root, "dist");

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
// Public half of the VAPID keypair used for Web Push (see
// api/send-notification.js and the "Enable notifications" toggle in
// profileView() in src/app.js) — safe to ship to the client, same as the
// Supabase anon key above. The private half never leaves the server; it's
// read directly from VAPID_PRIVATE_KEY by api/send-notification.js.
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
// Whether Cloudflare R2 is configured for uploads (see api/_lib/r2.js and
// api/storage-upload-url.js/storage-view-url.js) — the client only ever
// gets this boolean, never the R2 credentials themselves, which stay
// server-side. Materials/assignment attachments/submissions fall back to
// the original direct-to-Supabase-Storage path (supabaseUploadFile() in
// src/app.js) until this is true, so the app keeps working before R2 is
// set up and through the one-time migration (see
// scripts/migrate-storage-to-r2.mjs).
const r2Enabled = Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
// Public base URL for the R2 bucket's own public access (Cloudflare
// dashboard → the bucket → Settings → Public Access → "Public Development
// URL", or a custom domain bound to the bucket) — used only for the
// public Gallery, which never needs the private presigned-URL flow the
// two purposes above use (see supabase/migrations/0013_gallery.sql's
// comment on why gallery reads skip RLS entirely). Falls back to
// Supabase's own public gallery URL (galleryPublicUrl() in src/app.js)
// when this isn't set, same as the boolean above.
const r2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL || "";

await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });

await cp(join(root, "index.html"), join(dist, "index.html"));
await cp(join(root, "src"), join(dist, "src"), { recursive: true });
await cp(join(root, "manifest.json"), join(dist, "manifest.json"));
await cp(join(root, "sw.js"), join(dist, "sw.js"));
// Self-hosted Scratch 3.0 editor (the real scratchfoundation/scratch-gui,
// built offline and committed as static output — see scratch/README in
// that folder for how it was built) — served as-is at /scratch/, embedded
// via an iframe from the "Scratch" nav tab (see scratchView() in
// src/app.js). Not part of the SPA build itself, just copied through.
await cp(join(root, "scratch"), join(dist, "scratch"), { recursive: true });

const config = `window.CODENEST_CONFIG = ${JSON.stringify(
  {
    supabaseUrl,
    supabaseAnonKey,
    vapidPublicKey,
    r2Enabled,
    r2PublicBaseUrl,
  },
  null,
  2,
)};\n`;

await writeFile(join(dist, "src", "config.js"), config);

const html = await readFile(join(dist, "index.html"), "utf8");
await writeFile(join(dist, "index.html"), html.replaceAll("./src/", "/src/"));

console.log("Built Hero Tech Academy into dist/");
