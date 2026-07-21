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
await mkdir("dist/client", { recursive: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });

for (const file of files) await cp(file, `dist/client/${file}`);
await cp("models", "dist/client/models", { recursive: true });
await cp("vendor", "dist/client/vendor", { recursive: true });
await cp("server/index.js", "dist/server/index.js");
await cp(".openai/hosting.json", "dist/.openai/hosting.json");

console.log("정적 사이트 빌드가 dist 폴더에 생성됐습니다.");
