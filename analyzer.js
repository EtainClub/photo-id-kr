export const OUTPUT = Object.freeze({ width: 413, height: 531, maxBytes: 500 * 1024 });
export const HEAD_RATIO = Object.freeze({ min: 32 / 45, max: 36 / 45, target: 34 / 45 });

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function computeBaseCrop(imageWidth, imageHeight, targetRatio = OUTPUT.width / OUTPUT.height) {
  const sourceRatio = imageWidth / imageHeight;
  if (sourceRatio > targetRatio) {
    const height = imageHeight;
    const width = height * targetRatio;
    return { x: (imageWidth - width) / 2, y: 0, width, height };
  }
  const width = imageWidth;
  const height = width / targetRatio;
  return { x: 0, y: (imageHeight - height) / 2, width, height };
}

export function cropFromView(imageWidth, imageHeight, zoom = 1, offsetX = 0, offsetY = 0) {
  const base = computeBaseCrop(imageWidth, imageHeight);
  const width = base.width / zoom;
  const height = base.height / zoom;
  return {
    x: clamp(base.x + (base.width - width) / 2 - offsetX * width, 0, imageWidth - width),
    y: clamp(base.y + (base.height - height) / 2 - offsetY * height, 0, imageHeight - height),
    width,
    height
  };
}

export function cropForFace(imageWidth, imageHeight, face) {
  const ratio = OUTPUT.width / OUTPUT.height;
  const estimatedHeadHeight = face.height * 1.32;
  let cropHeight = estimatedHeadHeight / HEAD_RATIO.target;
  let cropWidth = cropHeight * ratio;
  if (cropWidth > imageWidth || cropHeight > imageHeight) {
    const scale = Math.min(imageWidth / cropWidth, imageHeight / cropHeight);
    cropWidth *= scale;
    cropHeight *= scale;
  }
  const faceCenterX = face.x + face.width / 2;
  const estimatedHeadTop = face.y - face.height * 0.18;
  const desiredTopGap = cropHeight * 0.11;
  return {
    x: clamp(faceCenterX - cropWidth / 2, 0, imageWidth - cropWidth),
    y: clamp(estimatedHeadTop - desiredTopGap, 0, imageHeight - cropHeight),
    width: cropWidth,
    height: cropHeight
  };
}

export function evaluateFacePlacement(face, geometry) {
  const { videoWidth, videoHeight, viewportWidth, viewportHeight, guide, mirrored = false } = geometry;
  const scale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight);
  const offsetX = (viewportWidth - videoWidth * scale) / 2;
  const offsetY = (viewportHeight - videoHeight * scale) / 2;
  const rawCenterX = offsetX + (face.x + face.width / 2) * scale;
  const centerX = mirrored ? viewportWidth - rawCenterX : rawCenterX;
  const centerY = offsetY + (face.y + face.height / 2) * scale;
  const headRatio = face.height * 1.32 * scale / guide.height;
  const targetX = guide.left + guide.width / 2;
  const targetY = guide.top + guide.height * .47;

  if (headRatio < HEAD_RATIO.min) return { code: "too-small", headRatio, centerX, centerY };
  if (headRatio > HEAD_RATIO.max) return { code: "too-large", headRatio, centerX, centerY };
  if (Math.abs(centerX - targetX) > guide.width * .08) {
    return { code: "horizontal", direction: centerX < targetX ? "right" : "left", headRatio, centerX, centerY };
  }
  if (Math.abs(centerY - targetY) > guide.height * .08) {
    return { code: "vertical", direction: centerY < targetY ? "down" : "up", headRatio, centerX, centerY };
  }
  if (face.tilt != null && Math.abs(face.tilt) > 4.5) return { code: "tilted", headRatio, centerX, centerY };
  return { code: "good", headRatio, centerX, centerY };
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function pixelStats(data, width, height, include) {
  let count = 0;
  let sum = 0;
  let squareSum = 0;
  let chromaSum = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (!include(x, y, width, height)) continue;
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const value = luminance(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      sum += value;
      squareSum += value * value;
      chromaSum += chroma;
      count++;
    }
  }
  const mean = count ? sum / count : 0;
  return {
    mean,
    deviation: count ? Math.sqrt(Math.max(0, squareSum / count - mean * mean)) : 0,
    chroma: count ? chromaSum / count : 0
  };
}

function sharpnessScore(data, width, height) {
  const values = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 220));
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const center = luminance(...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
      const left = luminance(...data.slice((y * width + x - step) * 4, (y * width + x - step) * 4 + 3));
      const right = luminance(...data.slice((y * width + x + step) * 4, (y * width + x + step) * 4 + 3));
      const top = luminance(...data.slice(((y - step) * width + x) * 4, ((y - step) * width + x) * 4 + 3));
      const bottom = luminance(...data.slice(((y + step) * width + x) * 4, ((y + step) * width + x) * 4 + 3));
      values.push(Math.abs(left + right + top + bottom - 4 * center));
    }
  }
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function check(id, title, status, detail, weight) {
  return { id, title, status, detail, weight };
}

export function analyzePixels(imageData, options = {}) {
  const { data, width, height } = imageData;
  const { sourceWidth = width, sourceHeight = height, face = null, faceStatus = "unavailable" } = options;
  const background = pixelStats(data, width, height, (x, y, w, h) =>
    y < h * 0.09 || x < w * 0.06 || x > w * 0.94 || ((x < w * 0.13 || x > w * 0.87) && y < h * 0.82)
  );
  const center = pixelStats(data, width, height, (x, y, w, h) =>
    x > w * 0.28 && x < w * 0.72 && y > h * 0.18 && y < h * 0.69
  );
  const faceLeft = pixelStats(data, width, height, (x, y, w, h) =>
    x > w * .28 && x < w * .49 && y > h * .25 && y < h * .65
  );
  const faceRight = pixelStats(data, width, height, (x, y, w, h) =>
    x > w * .51 && x < w * .72 && y > h * .25 && y < h * .65
  );
  const sharpness = sharpnessScore(data, width, height);
  const checks = [];

  const enoughPixels = sourceWidth >= OUTPUT.width && sourceHeight >= OUTPUT.height;
  checks.push(check("resolution", "해상도", enoughPixels ? "pass" : "fail",
    enoughPixels ? `${Math.round(sourceWidth)} × ${Math.round(sourceHeight)} 픽셀로 선명하게 저장할 수 있어요` : "원본 해상도가 낮아요. 카메라로 다시 찍는 것이 안전해요", 18));

  const backgroundWhite = background.mean >= 218 && background.chroma <= 24;
  const backgroundEven = background.deviation <= 30;
  checks.push(check("background", "흰색 배경", backgroundWhite && backgroundEven ? "pass" : background.mean >= 195 ? "warn" : "fail",
    backgroundWhite && backgroundEven ? "가장자리 배경이 밝고 고르게 보여요" : background.mean < 195 ? "배경이 흰색으로 보이지 않아요. 흰 벽 앞에서 다시 찍어주세요" : "배경에 색이나 음영이 보여요. 그림자가 없는지 확인해 주세요", 22));

  const lightingDifference = Math.abs(faceLeft.mean - faceRight.mean);
  const wellLit = center.mean >= 72 && center.mean <= 225 && lightingDifference <= 34;
  checks.push(check("lighting", "밝기와 조명", wellLit ? "pass" : "warn",
    wellLit ? "얼굴 양쪽의 밝기가 고르고 적절해 보여요" : center.mean < 72 ? "얼굴이 어두워요. 창문을 정면으로 바라보고 다시 찍어주세요" : center.mean > 225 ? "얼굴이 너무 밝아요. 강한 조명에서 조금 멀어져 주세요" : "얼굴 한쪽에 그림자가 보여요. 빛을 정면에서 받도록 위치를 바꿔주세요", 18));

  const sharp = sharpness >= 8.5;
  checks.push(check("sharpness", "선명도", sharp ? "pass" : sharpness >= 5.5 ? "warn" : "fail",
    sharp ? "윤곽이 비교적 선명해요" : "사진이 흐리거나 흔들려 보여요. 렌즈를 닦고 휴대폰을 고정해 주세요", 18));

  if (face) {
    const centerX = (face.x + face.width / 2) / width;
    const centerY = (face.y + face.height / 2) / height;
    const estimatedHeadRatio = face.height * 1.32 / height;
    const centered = Math.abs(centerX - .5) <= .065 && centerY >= .35 && centerY <= .52;
    const sized = estimatedHeadRatio >= HEAD_RATIO.min && estimatedHeadRatio <= HEAD_RATIO.max;
    checks.push(check("position", "얼굴 위치", centered ? "pass" : "fail", centered ? "얼굴이 사진 중앙에 있어요" : "얼굴이 중앙에서 벗어났어요. 위치를 다시 맞춰주세요", face.tilt == null ? 12 : 9));
    checks.push(check("headSize", "머리 길이", sized ? "pass" : "fail", sized ? "정수리부터 턱까지 권장 범위에 가까워요" : estimatedHeadRatio < .68 ? "얼굴이 너무 작아요. 사진을 조금 확대해 주세요" : "얼굴이 너무 커요. 사진을 조금 축소해 주세요", face.tilt == null ? 12 : 9));
    if (face.tilt != null) {
      const level = Math.abs(face.tilt) <= 4.5;
      checks.push(check("headLevel", "고개 수평", level ? "pass" : "fail", level ? "두 눈이 수평에 가깝고 고개가 곧아 보여요" : "고개가 기울어져 보여요. 카메라와 얼굴을 수평으로 맞춰주세요", 6));
    }
  } else {
    const status = faceStatus === "unavailable" ? "warn" : "fail";
    const detail = faceStatus === "multiple"
      ? "얼굴이 두 명 이상 보여요. 사진에는 본인만 나와야 해요"
      : faceStatus === "not-found"
        ? "얼굴을 찾지 못했어요. 얼굴 전체가 보이는 정면 사진으로 다시 확인해 주세요"
        : "이 기기에서는 얼굴 위치를 자동 측정할 수 없어요. 점선 타원에 정수리와 턱을 직접 맞춰주세요";
    checks.push(check("position", "얼굴 위치·크기", status, detail, 24));
  }

  const earned = checks.reduce((sum, item) => sum + (item.status === "pass" ? item.weight : item.status === "warn" ? item.weight * .45 : 0), 0);
  const total = checks.reduce((sum, item) => sum + item.weight, 0);
  return {
    checks,
    score: Math.round(earned / total * 100),
    hasFailure: checks.some(item => item.status === "fail"),
    metrics: { background, center, lightingDifference, sharpness }
  };
}

export function patchJpegDpi(buffer, dpi = 300) {
  const bytes = new Uint8Array(buffer.slice(0));
  for (let i = 2; i < Math.min(bytes.length - 14, 256); i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xe0 &&
        bytes[i + 4] === 0x4a && bytes[i + 5] === 0x46 && bytes[i + 6] === 0x49 && bytes[i + 7] === 0x46) {
      bytes[i + 11] = 1;
      bytes[i + 12] = (dpi >> 8) & 0xff;
      bytes[i + 13] = dpi & 0xff;
      bytes[i + 14] = (dpi >> 8) & 0xff;
      bytes[i + 15] = dpi & 0xff;
      break;
    }
  }
  return bytes.buffer;
}
