import { copyFile, mkdir, stat } from "node:fs/promises";

await stat("dist/server/index.js");
await stat(".openai/hosting.json");
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");

console.log("ChatGPT 사이트 배포 번들을 준비했습니다.");
