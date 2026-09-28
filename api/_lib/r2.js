// Thin wrapper around Cloudflare R2's S3-compatible API, using aws4fetch
// (a few KB, no AWS SDK) to sign requests — kept dependency-light to match
// the rest of this project (see src/supabaseAuth.js's own comment on why
// it's a plain fetch wrapper rather than a full SDK).
//
// R2 has no equivalent of Supabase's row-level security on objects, so
// every endpoint that calls into this file is responsible for doing its
// own authorization first (see storage-upload-url.js and
// storage-view-url.js) — this module only ever signs the URL it's asked
// to sign, it never decides who's allowed to ask for one.
import { AwsClient } from "aws4fetch";

export function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    accountId,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
  };
}

// R2 object keys are namespaced by purpose so one bucket can hold what
// used to be three separate Supabase Storage buckets — see the comment atop
// storage-upload-url.js for how each purpose's own `key` is validated
// before it ever reaches here.
export function objectKey(purpose, key) {
  return `${purpose}/${key}`;
}

export async function presignPutUrl(config, purpose, key, { expiresInSeconds = 300 } = {}) {
  const url = new URL(`${config.endpoint}/${config.bucket}/${objectKey(purpose, key)}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await config.client.sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}

// `disposition` is the literal value of the response-content-disposition
// override R2 will send back with the object — "inline" for a browser tab
// to render the file itself (View), or `attachment; filename="..."` to
// force a save-as (Download). One presigned URL shape serves both; the
// caller (storage-view-url.js) just picks which disposition to sign.
export async function presignGetUrl(config, purpose, key, { disposition, expiresInSeconds = 600 } = {}) {
  const url = new URL(`${config.endpoint}/${config.bucket}/${objectKey(purpose, key)}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  if (disposition) url.searchParams.set("response-content-disposition", disposition);
  const signed = await config.client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

export async function deleteObject(config, purpose, key) {
  const url = `${config.endpoint}/${config.bucket}/${objectKey(purpose, key)}`;
  const response = await config.client.fetch(url, { method: "DELETE" });
  // R2 returns 204 whether or not the object existed — a delete for an
  // object that was never migrated (or already gone) isn't an error here.
  return response.ok || response.status === 404;
}
