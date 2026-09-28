import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const outputPath = "dist/index.html";

if (!existsSync(outputPath)) {
  console.error(`${outputPath} does not exist; run the frontend build first.`);
  process.exit(1);
}

const html = readFileSync(outputPath, "utf8");

if (!/<div\s+id=["']root["']/.test(html)) {
  console.error(`${outputPath} does not contain the React root element.`);
  process.exit(1);
}

const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
const moduleScript = scriptTags.find(
  (tag) => /\btype=["']module["']/.test(tag) && /\bsrc=["'][^"']+["']/.test(tag),
);

if (!moduleScript) {
  console.error(`${outputPath} does not load a compiled JavaScript module.`);
  process.exit(1);
}

const assetUrl = moduleScript.match(/\bsrc=["']([^"']+)["']/)?.[1];
const assetPath = join("dist", assetUrl.replace(/^\//, ""));

if (!existsSync(assetPath)) {
  console.error(`${outputPath} references missing application bundle ${assetPath}.`);
  process.exit(1);
}

console.log(`Desktop frontend bundle verified: ${assetPath}`);
