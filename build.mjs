import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const dist = join(root, "dist");

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

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
  },
  null,
  2,
)};\n`;

await writeFile(join(dist, "src", "config.js"), config);

const html = await readFile(join(dist, "index.html"), "utf8");
await writeFile(join(dist, "index.html"), html.replaceAll("./src/", "/src/"));

console.log("Built Hero Tech Academy into dist/");
