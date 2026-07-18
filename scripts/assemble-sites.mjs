import { access, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const workerEntry = resolve(dist, "server", "index.js");
const webBuild = resolve(root, "apps", "web", "dist");
const clientOutput = resolve(dist, "client");
const metadataOutput = resolve(dist, ".openai");
const hostingSource = resolve(root, ".openai", "hosting.json");
const migrationSource = resolve(root, "drizzle");

await access(workerEntry);
await access(resolve(webBuild, "index.html"));
const hosting = JSON.parse(await readFile(hostingSource, "utf8"));

await rm(clientOutput, { recursive: true, force: true });
await mkdir(clientOutput, { recursive: true });
await cp(webBuild, clientOutput, { recursive: true });

await rm(metadataOutput, { recursive: true, force: true });
await mkdir(metadataOutput, { recursive: true });
await cp(hostingSource, resolve(metadataOutput, "hosting.json"));

try {
  await access(migrationSource);
  const migrations = await readdir(migrationSource, { recursive: true });
  if (hosting.d1 && !migrations.some((entry) => entry.endsWith(".sql"))) {
    throw new Error("D1 is enabled, but drizzle/ has no SQL migration.");
  }
  await cp(migrationSource, resolve(metadataOutput, "drizzle"), {
    recursive: true,
  });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  if (hosting.d1) {
    throw new Error("D1 is enabled, but the drizzle/ migration directory is missing.");
  }
}

await access(workerEntry);
await access(resolve(clientOutput, "index.html"));
await access(resolve(metadataOutput, "hosting.json"));
if (hosting.d1) {
  await access(resolve(metadataOutput, "drizzle"));
}
