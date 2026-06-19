import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2]?.trim();

if (!version || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
  console.error("Usage: npm run version:bump -- 0.2.0");
  console.error("Chrome extension versions must be numeric, for example 0.2.0 or 1.2.3.4.");
  process.exit(1);
}

const files = [
  resolve("package.json"),
  resolve("apps/extension/package.json"),
  resolve("apps/extension/public/manifest.json"),
];

for (const file of files) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

console.log(`Updated Clapback extension version to ${version}`);
