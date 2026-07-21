import { cp, mkdir, rm } from "node:fs/promises";

const destination = "public/app";
const files = ["index.html", "styles.css", "app.js", "analyzer.js", "icon.svg", "manifest.webmanifest", "sw.js"];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of files) await cp(file, `${destination}/${file}`);
await cp("models", `${destination}/models`, { recursive: true });
await cp("vendor", `${destination}/vendor`, { recursive: true });

console.log("웹앱 정적 파일을 public/app에 준비했습니다.");
