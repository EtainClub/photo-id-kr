import { cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "analyzer.js",
  "icon.svg",
  "manifest.webmanifest",
  "sw.js"
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const file of files) await cp(file, `dist/${file}`);
await cp("models", "dist/models", { recursive: true });
await cp("vendor", "dist/vendor", { recursive: true });

console.log("정적 사이트 빌드가 dist 폴더에 생성됐습니다.");
