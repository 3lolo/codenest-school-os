#!/usr/bin/env node
// One-time migration: copies every object out of this project's three
// Supabase Storage buckets (materials, gallery, submissions) into the
// single Cloudflare R2 bucket the app now reads/writes through
// api/storage-upload-url.js and api/storage-view-url.js — see r2Config()
// in api/_lib/r2.js for the object-key convention ("<purpose>/<path>").
//
// Safe to re-run: it HEADs each destination key first and skips any file
// already present in R2, so an interrupted run just picks up where it
// left off rather than re-uploading everything.
//
// Nothing in the `students`/`materials`/`gallery_items`/`submissions`
// tables changes — every row's own `file_path` column is untouched; only
// where the bytes physically live changes, from a Supabase bucket to this
// R2 bucket under the matching purpose prefix.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=... \
//   node scripts/migrate-storage-to-r2.mjs

import { AwsClient } from "aws4fetch";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const missing = [
  ["SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["R2_ACCOUNT_ID", R2_ACCOUNT_ID],
  ["R2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID],
  ["R2_SECRET_ACCESS_KEY", R2_SECRET_ACCESS_KEY],
  ["R2_BUCKET_NAME", R2_BUCKET_NAME],
].filter(([, value]) => !value);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.map(([name]) => name).join(", ")}`);
  process.exit(1);
}

const r2Endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });

const serviceHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// Supabase Storage's list endpoint returns one folder level at a time — a
// "folder" entry has `id: null` and no `metadata`. Every bucket here only
// ever nests a couple of levels deep (e.g. "<group_id>/<file>" or
// "<assignment_id>/<student_id>/<file>"), but this walks arbitrarily deep
// just in case.
async function listAllObjects(bucket, prefix = "") {
  const results = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!response.ok) {
      console.error(`  list failed for ${bucket}/${prefix}: ${response.status} ${await response.text().catch(() => "")}`);
      break;
    }
    const entries = await response.json();
    if (!entries.length) break;
    for (const entry of entries) {
      const path = prefix ? `${prefix}${entry.name}` : entry.name;
      if (entry.id === null) {
        results.push(...(await listAllObjects(bucket, `${path}/`)));
      } else {
        results.push(path);
      }
    }
    if (entries.length < limit) break;
    offset += limit;
  }
  return results;
}

async function objectExistsInR2(purpose, path) {
  const response = await r2.fetch(`${r2Endpoint}/${R2_BUCKET_NAME}/${purpose}/${path}`, { method: "HEAD" });
  return response.ok;
}

async function migrateOne(bucket, purpose, path) {
  if (await objectExistsInR2(purpose, path)) return "skipped";
  const downloadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    headers: serviceHeaders,
  });
  if (!downloadResponse.ok) {
    console.error(`  download failed for ${bucket}/${path}: ${downloadResponse.status}`);
    return "failed";
  }
  const bytes = await downloadResponse.arrayBuffer();
  const contentType = downloadResponse.headers.get("content-type") || "application/octet-stream";
  const uploadResponse = await r2.fetch(`${r2Endpoint}/${R2_BUCKET_NAME}/${purpose}/${path}`, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: Buffer.from(bytes),
  });
  if (!uploadResponse.ok) {
    console.error(`  upload failed for ${purpose}/${path}: ${uploadResponse.status} ${await uploadResponse.text().catch(() => "")}`);
    return "failed";
  }
  return "migrated";
}

async function migrateBucket(bucket, purpose) {
  console.log(`\n${bucket} -> ${purpose}/`);
  const paths = await listAllObjects(bucket);
  console.log(`  found ${paths.length} object(s)`);
  const counts = { migrated: 0, skipped: 0, failed: 0 };
  for (const path of paths) {
    const outcome = await migrateOne(bucket, purpose, path);
    counts[outcome] += 1;
    console.log(`  [${outcome}] ${path}`);
  }
  return counts;
}

const totals = { migrated: 0, skipped: 0, failed: 0 };
for (const [bucket, purpose] of [
  ["materials", "materials"],
  ["gallery", "gallery"],
  ["submissions", "submissions"],
]) {
  const counts = await migrateBucket(bucket, purpose);
  totals.migrated += counts.migrated;
  totals.skipped += counts.skipped;
  totals.failed += counts.failed;
}

console.log(`\nDone. migrated=${totals.migrated} skipped=${totals.skipped} failed=${totals.failed}`);
if (totals.failed > 0) {
  console.log("Re-run this script to retry the failed ones — it skips anything already migrated.");
  process.exit(1);
}
