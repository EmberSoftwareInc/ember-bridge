import { cpSync, mkdirSync, rmSync } from "node:fs";

const outputPath = "pages-dist";

rmSync(outputPath, { recursive: true, force: true });
mkdirSync(outputPath, { recursive: true });
cpSync("site", outputPath, { recursive: true });
cpSync("docs", `${outputPath}/docs`, { recursive: true });

console.log(`GitHub Pages site assembled in ${outputPath}.`);
