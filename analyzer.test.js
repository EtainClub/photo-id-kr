import test from "node:test";
import assert from "node:assert/strict";
import { OUTPUT, computeBaseCrop, cropFromView, cropForFace, evaluateFacePlacement, analyzePixels, patchJpegDpi } from "./analyzer.js";

test("출력 규격은 온라인 여권사진 권장값이다", () => {
  assert.deepEqual(OUTPUT, { width: 413, height: 531, maxBytes: 512000 });
});

test("가로 사진을 35:45 비율로 중앙 자른다", () => {
  const crop = computeBaseCrop(1600, 1200);
  assert.equal(Math.round(crop.height), 1200);
  assert.equal(Math.round(crop.width / crop.height * 1000), Math.round(413 / 531 * 1000));
  assert.ok(crop.x > 0);
});

test("확대와 이동 후 자르기 영역은 원본을 벗어나지 않는다", () => {
  const crop = cropFromView(1200, 1600, 2, 9, -9);
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.width <= 1200.001);
  assert.ok(crop.y + crop.height <= 1600.001);
});

test("얼굴 자동 맞춤은 머리 길이를 사진 높이의 약 75%로 둔다", () => {
  const face = { x: 420, y: 330, width: 300, height: 390 };
  const crop = cropForFace(1200, 1600, face);
  assert.ok(face.height * 1.32 / crop.height > .73);
  assert.ok(face.height * 1.32 / crop.height < .77);
});

test("촬영 중 얼굴 크기와 중앙 위치를 판정한다", () => {
  const geometry = {
    videoWidth: 1200,
    videoHeight: 1600,
    viewportWidth: 390,
    viewportHeight: 844,
    guide: { left: 47, top: 120, width: 296, height: 380 },
    mirrored: false
  };
  assert.equal(evaluateFacePlacement({ x: 510, y: 540, width: 180, height: 280 }, geometry).code, "too-small");
  assert.equal(evaluateFacePlacement({ x: 360, y: 360, width: 480, height: 700 }, geometry).code, "too-large");
  const side = evaluateFacePlacement({ x: 250, y: 450, width: 290, height: 430 }, geometry);
  assert.equal(side.code, "horizontal");
  assert.equal(side.direction, "right");
  assert.equal(evaluateFacePlacement({ x: 455, y: 351, width: 290, height: 430 }, geometry).code, "good");
  assert.equal(evaluateFacePlacement({ x: 455, y: 351, width: 290, height: 430, tilt: 7 }, geometry).code, "tilted");
});

test("밝고 균일한 흰 배경과 선명한 중앙을 통과시킨다", () => {
  const width = 100;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const center = x > 28 && x < 72 && y > 20 && y < 84;
    const value = center ? ((x + y) % 2 ? 110 : 180) : 245;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  const result = analyzePixels({ data, width, height }, { sourceWidth: 1200, sourceHeight: 1600 });
  assert.equal(result.checks.find(item => item.id === "background").status, "pass");
  assert.equal(result.checks.find(item => item.id === "resolution").status, "pass");
});

test("얼굴을 찾지 못하면 안전하게 다시 촬영을 안내한다", () => {
  const width = 40;
  const height = 50;
  const data = new Uint8ClampedArray(width * height * 4).fill(245);
  const result = analyzePixels({ data, width, height }, { sourceWidth: 1000, sourceHeight: 1300, faceStatus: "not-found" });
  assert.equal(result.checks.find(item => item.id === "position").status, "fail");
  assert.equal(result.hasFailure, true);
});

test("어두운 배경과 낮은 해상도는 통과시키지 않는다", () => {
  const width = 80;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 80;
    data[i + 3] = 255;
  }
  const result = analyzePixels({ data, width, height }, { sourceWidth: 300, sourceHeight: 400, faceStatus: "not-found" });
  assert.equal(result.checks.find(item => item.id === "resolution").status, "fail");
  assert.equal(result.checks.find(item => item.id === "background").status, "fail");
  assert.equal(result.hasFailure, true);
});

test("얼굴 중앙·크기와 고개 기울기를 별도로 판정한다", () => {
  const width = 413;
  const height = 531;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const value = x > 115 && x < 298 && y > 90 && y < 420 ? ((x + y) % 2 ? 105 : 185) : 245;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  const result = analyzePixels({ data, width, height }, {
    sourceWidth: 1200,
    sourceHeight: 1600,
    face: { x: 120, y: 100, width: 173, height: 300, tilt: 7 }
  });
  assert.equal(result.checks.find(item => item.id === "position").status, "pass");
  assert.equal(result.checks.find(item => item.id === "headSize").status, "pass");
  assert.equal(result.checks.find(item => item.id === "headLevel").status, "fail");
});

test("JPG 메타데이터에 300dpi를 기록한다", () => {
  const bytes = new Uint8Array(32);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00], 0);
  const patched = new Uint8Array(patchJpegDpi(bytes.buffer, 300));
  assert.equal(patched[13], 1);
  assert.deepEqual([...patched.slice(14, 18)], [1, 44, 1, 44]);
});
