import { OUTPUT, clamp, computeBaseCrop, cropForFace, evaluateFacePlacement, analyzePixels, patchJpegDpi } from "./analyzer.js";
import { FaceDetector as MediaPipeFaceDetector, FilesetResolver } from "./vendor/mediapipe/vision_bundle.mjs";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = {
  image: null,
  imageUrl: null,
  sourceWidth: 0,
  sourceHeight: 0,
  baseCrop: null,
  centerX: 0,
  centerY: 0,
  zoom: 1,
  face: null,
  stream: null,
  facingMode: "user",
  analysis: null,
  pointerHistory: new Map(),
  startPinchDistance: 0,
  startPinchZoom: 1
};

const previewCanvas = $("#previewCanvas");
const previewContext = previewCanvas.getContext("2d", { alpha: false });
const resultCanvas = $("#resultCanvas");
const resultContext = resultCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
const fileInput = $("#fileInput");
const cropFrame = $("#cropFrame");
const zoomRange = $("#zoomRange");
let toastTimer;
let cameraMeterTimer;
let mediaPipeDetectorPromise;
let faceDetectionStatus = "unavailable";
let mediaPipeFailed = false;
let cameraFaceBusy = false;
let lastCameraFaceCheck = 0;
let cameraGuideWasGood = false;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function showScreen(id) {
  $$(".screen").forEach(screen => {
    const active = screen.id === id;
    screen.hidden = !active;
    screen.classList.toggle("is-active", active);
  });
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function openRules() {
  const dialog = $("#rulesDialog");
  if (!dialog.open) dialog.showModal();
}

function currentCrop() {
  const base = state.baseCrop;
  const width = base.width / state.zoom;
  const height = base.height / state.zoom;
  const centerX = clamp(state.centerX, width / 2, state.sourceWidth - width / 2);
  const centerY = clamp(state.centerY, height / 2, state.sourceHeight - height / 2);
  state.centerX = centerX;
  state.centerY = centerY;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

function drawCrop(canvas, context) {
  if (!state.image) return;
  const crop = currentCrop();
  context.save();
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(state.image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  context.restore();
}

function renderPreview() {
  drawCrop(previewCanvas, previewContext);
}

async function detectFace(target) {
  if ("FaceDetector" in window) try {
    const detector = new FaceDetector({ fastMode: false, maxDetectedFaces: 2 });
    const faces = await detector.detect(target);
    faceDetectionStatus = faces.length > 1 ? "multiple" : faces.length === 0 ? "not-found" : "ok";
    if (faces.length !== 1) return null;
    const box = faces[0].boundingBox;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  } catch { /* 로컬 모델로 다시 시도 */ }
  try {
    if (!mediaPipeDetectorPromise) {
      mediaPipeDetectorPromise = (async () => {
        const wasmPath = new URL("./vendor/mediapipe", import.meta.url).href;
        const modelPath = new URL("./models/blaze_face_short_range.tflite", import.meta.url).href;
        const vision = await FilesetResolver.forVisionTasks(wasmPath);
        return MediaPipeFaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelPath, delegate: "CPU" },
          runningMode: "IMAGE",
          minDetectionConfidence: .68,
          minSuppressionThreshold: .35
        });
      })();
    }
    const result = (await mediaPipeDetectorPromise).detect(target);
    faceDetectionStatus = result.detections.length > 1 ? "multiple" : result.detections.length === 0 ? "not-found" : "ok";
    if (result.detections.length !== 1) return null;
    const detection = result.detections[0];
    const box = detection.boundingBox;
    const [rightEye, leftEye] = detection.keypoints || [];
    const tilt = rightEye && leftEye ? Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180 / Math.PI : null;
    return { x: box.originX, y: box.originY, width: box.width, height: box.height, tilt };
  } catch (error) {
    faceDetectionStatus = "unavailable";
    mediaPipeFailed = true;
    console.warn("얼굴 감지 모델을 불러오지 못했습니다.", error);
    return null;
  }
}

function setBaseCrop(crop) {
  state.baseCrop = crop;
  state.centerX = crop.x + crop.width / 2;
  state.centerY = crop.y + crop.height / 2;
  state.zoom = 1;
  zoomRange.value = "1";
  renderPreview();
}

async function loadPhoto(file) {
  if (!file) return;
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|heic|heif)$/i.test(file.name)) {
    showToast("사진 파일만 선택할 수 있어요.");
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.onload = async () => {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = url;
    state.image = image;
    state.sourceWidth = image.naturalWidth;
    state.sourceHeight = image.naturalHeight;
    state.face = null;
    const simpleCrop = computeBaseCrop(state.sourceWidth, state.sourceHeight);
    setBaseCrop(simpleCrop);
    showScreen("editor");
    $("#analysisOverlay").classList.add("is-visible");
    const face = await detectFace(image);
    if (face) {
      state.face = face;
      setBaseCrop(cropForFace(state.sourceWidth, state.sourceHeight, face));
      showToast("얼굴 위치를 자동으로 맞췄어요.");
    }
    $("#analysisOverlay").classList.remove("is-visible");
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("이 사진을 열 수 없어요. JPG 또는 PNG로 선택해 주세요.");
  };
  image.src = url;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("이 브라우저에서는 카메라를 열 수 없어 앨범을 열었어요.");
    fileInput.click();
    return;
  }
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode, width: { ideal: 1920 }, height: { ideal: 2560 } },
      audio: false
    });
    const view = $("#cameraView");
    const video = $("#cameraVideo");
    video.style.transform = state.facingMode === "user" ? "scaleX(-1)" : "none";
    video.srcObject = state.stream;
    view.hidden = false;
    await video.play();
    startCameraMeter();
  } catch (error) {
    stopCamera();
    const denied = error?.name === "NotAllowedError";
    showToast(denied ? "카메라 권한이 꺼져 있어요. 앨범에서 사진을 선택해 주세요." : "카메라를 열 수 없어 앨범을 열었어요.");
    fileInput.click();
  }
}

function stopCamera() {
  clearInterval(cameraMeterTimer);
  if (state.stream) state.stream.getTracks().forEach(track => track.stop());
  state.stream = null;
  cameraFaceBusy = false;
  lastCameraFaceCheck = 0;
  cameraGuideWasGood = false;
  $("#cameraView").hidden = true;
  $("#cameraVideo").srcObject = null;
}

function startCameraMeter() {
  const video = $("#cameraVideo");
  const canvas = $("#cameraSampler");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const status = $("#cameraStatus");
  const tip = $("#cameraTip");
  cameraMeterTimer = setInterval(async () => {
    if (!video.videoWidth) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    const brightness = sum / (data.length / 4);
    status.classList.toggle("good", brightness >= 85 && brightness <= 205);
    if (brightness < 85) {
      status.lastChild.textContent = " 화면이 너무 어두워요";
      tip.innerHTML = "<strong>창문 쪽으로 이동하세요</strong><span>얼굴과 배경이 모두 밝게 보여야 해요</span>";
    } else if (brightness > 205) {
      status.lastChild.textContent = " 빛이 너무 강해요";
      tip.innerHTML = "<strong>강한 빛에서 조금 멀어지세요</strong><span>얼굴이 하얗게 날아가지 않게 해요</span>";
    } else {
      status.lastChild.textContent = mediaPipeFailed ? " 밝기가 좋아요" : " 얼굴 위치 확인 중";
      tip.innerHTML = "<strong>정면을 보고 입을 다물어 주세요</strong><span>휴대폰은 눈높이에서 움직이지 않게 잡아요</span>";
      if (!mediaPipeFailed && !cameraFaceBusy && Date.now() - lastCameraFaceCheck > 1300) {
        cameraFaceBusy = true;
        lastCameraFaceCheck = Date.now();
        try {
          const face = await detectFace(video);
          updateCameraFaceGuide(face, video, status, tip);
        } finally {
          cameraFaceBusy = false;
        }
      }
    }
  }, 850);
}

function updateCameraFaceGuide(face, video, status, tip) {
  if (faceDetectionStatus === "multiple") {
    cameraGuideWasGood = false;
    status.classList.remove("good");
    status.lastChild.textContent = " 한 사람만 보여야 해요";
    tip.innerHTML = "<strong>다른 사람은 화면 밖으로 이동해 주세요</strong><span>여권사진에는 본인 외 사람이나 사물이 나오면 안 돼요</span>";
    return;
  }
  if (faceDetectionStatus === "not-found" || !face) {
    cameraGuideWasGood = false;
    status.classList.remove("good");
    status.lastChild.textContent = " 얼굴을 타원 안에 맞춰주세요";
    tip.innerHTML = "<strong>얼굴 전체를 보여주세요</strong><span>눈과 턱, 얼굴 윤곽이 모두 보여야 해요</span>";
    return;
  }
  if (faceDetectionStatus === "unavailable") return;

  const guide = $(".camera-guide").getBoundingClientRect();
  const placement = evaluateFacePlacement(face, {
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    guide,
    mirrored: state.facingMode === "user"
  });

  status.classList.remove("good");
  if (placement.code === "too-small") {
    cameraGuideWasGood = false;
    status.lastChild.textContent = " 얼굴이 조금 작아요";
    tip.innerHTML = "<strong>휴대폰을 조금 가까이 가져오세요</strong><span>정수리와 턱이 타원의 위아래에 닿도록 맞춰요</span>";
  } else if (placement.code === "too-large") {
    cameraGuideWasGood = false;
    status.lastChild.textContent = " 얼굴이 너무 커요";
    tip.innerHTML = "<strong>휴대폰을 조금 멀리 두세요</strong><span>머리와 턱 주변에 여백이 보여야 해요</span>";
  } else if (placement.code === "horizontal") {
    cameraGuideWasGood = false;
    status.lastChild.textContent = " 얼굴을 중앙으로 옮겨주세요";
    tip.innerHTML = `<strong>얼굴을 조금 ${placement.direction === "right" ? "오른쪽" : "왼쪽"}으로 옮기세요</strong><span>세로선과 얼굴 중심을 맞춰요</span>`;
  } else if (placement.code === "vertical") {
    cameraGuideWasGood = false;
    status.lastChild.textContent = " 얼굴 높이를 맞춰주세요";
    tip.innerHTML = `<strong>얼굴을 조금 ${placement.direction === "down" ? "아래" : "위"}로 옮기세요</strong><span>눈높이 선을 참고해 주세요</span>`;
  } else if (placement.code === "tilted") {
    cameraGuideWasGood = false;
    status.lastChild.textContent = " 고개가 기울어졌어요";
    tip.innerHTML = "<strong>고개와 휴대폰을 수평으로 맞추세요</strong><span>양쪽 눈이 같은 높이에 오게 해요</span>";
  } else {
    status.classList.add("good");
    status.lastChild.textContent = " 위치와 밝기가 좋아요";
    tip.innerHTML = "<strong>그대로 입을 다물고 정면을 보세요</strong><span>흔들리지 않게 잡고 촬영 버튼을 눌러요</span>";
    if (!cameraGuideWasGood) navigator.vibrate?.(12);
    cameraGuideWasGood = true;
  }
}

async function capturePhoto() {
  const video = $("#cameraVideo");
  if (!video.videoWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .96));
  stopCamera();
  if (blob) await loadPhoto(new File([blob], "촬영한-여권사진.jpg", { type: "image/jpeg" }));
}

function resetCrop() {
  if (!state.image) return;
  const crop = state.face ? cropForFace(state.sourceWidth, state.sourceHeight, state.face) : computeBaseCrop(state.sourceWidth, state.sourceHeight);
  setBaseCrop(crop);
  showToast(state.face ? "얼굴을 기준으로 다시 맞췄어요." : "사진을 가운데에 맞췄어요.");
}

function clientDistance(points) {
  const [a, b] = points;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

cropFrame.addEventListener("pointerdown", event => {
  cropFrame.setPointerCapture(event.pointerId);
  state.pointerHistory.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
  if (state.pointerHistory.size === 2) {
    state.startPinchDistance = clientDistance([...state.pointerHistory.values()]);
    state.startPinchZoom = state.zoom;
  }
});

cropFrame.addEventListener("pointermove", event => {
  if (!state.pointerHistory.has(event.pointerId) || !state.image) return;
  const previous = state.pointerHistory.get(event.pointerId);
  state.pointerHistory.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
  if (state.pointerHistory.size === 2) {
    const distance = clientDistance([...state.pointerHistory.values()]);
    state.zoom = clamp(state.startPinchZoom * distance / state.startPinchDistance, 1, 3);
    zoomRange.value = String(state.zoom);
  } else {
    const crop = currentCrop();
    state.centerX -= (event.clientX - previous.clientX) / cropFrame.clientWidth * crop.width;
    state.centerY -= (event.clientY - previous.clientY) / cropFrame.clientHeight * crop.height;
  }
  renderPreview();
});

function releasePointer(event) {
  state.pointerHistory.delete(event.pointerId);
  if (state.pointerHistory.size < 2) state.startPinchDistance = 0;
}
cropFrame.addEventListener("pointerup", releasePointer);
cropFrame.addEventListener("pointercancel", releasePointer);

zoomRange.addEventListener("input", () => {
  state.zoom = Number(zoomRange.value);
  renderPreview();
});

async function analyzePhoto() {
  if (!state.image) return;
  const overlay = $("#analysisOverlay");
  overlay.classList.add("is-visible");
  drawCrop(resultCanvas, resultContext);
  await new Promise(requestAnimationFrame);
  const face = await detectFace(resultCanvas);
  const pixels = resultContext.getImageData(0, 0, OUTPUT.width, OUTPUT.height);
  state.analysis = analyzePixels(pixels, {
    sourceWidth: currentCrop().width,
    sourceHeight: currentCrop().height,
    face,
    faceStatus: faceDetectionStatus
  });
  overlay.classList.remove("is-visible");
  renderResult();
  showScreen("result");
}

function iconFor(status) {
  if (status === "pass") return '<svg viewBox="0 0 20 20"><path d="m5 10.5 3 3L15 7"/></svg>';
  if (status === "fail") return '<svg viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8"/></svg>';
  return '<svg viewBox="0 0 20 20"><path d="M10 5.5v5"/><path d="M10 14h.01"/></svg>';
}

function renderResult() {
  const { checks, score, hasFailure } = state.analysis;
  $("#scoreNumber").textContent = score;
  $("#scoreRing").style.setProperty("--score", `${score * 3.6}deg`);
  const warnings = checks.filter(item => item.status === "warn").length;
  const title = hasFailure ? "다시 찍는 편이 안전해요" : warnings ? "몇 가지를 더 확인해 주세요" : "규격에 잘 맞아 보여요";
  const summary = hasFailure ? "반려 가능성이 높은 항목이 있어요. 아래 안내대로 다시 준비해 주세요." : warnings ? "자동 확인이 어려운 부분은 직접 확인해야 해요." : "자동 점검 항목을 모두 통과했어요. 마지막 확인만 남았어요.";
  $("#scoreTitle").textContent = title;
  $("#scoreSummary").textContent = summary;
  $("#autoChecks").innerHTML = checks.map(item => `
    <div class="check-item ${item.status}">
      <span class="check-icon">${iconFor(item.status)}</span>
      <div><strong>${item.title}</strong><small>${item.detail}</small></div>
      <em>${item.status === "pass" ? "통과" : item.status === "fail" ? "다시 촬영" : "확인 필요"}</em>
    </div>`).join("");
  const stamp = $("#resultStamp");
  stamp.textContent = hasFailure ? "" : warnings ? "확인 후 사용" : "자동 점검 통과";
  stamp.classList.toggle("is-visible", !hasFailure);
  $$(".check-toggle input").forEach(input => { input.checked = false; });
  updateSelfChecks();
}

function updateSelfChecks() {
  const inputs = $$(".check-toggle input");
  const count = inputs.filter(input => input.checked).length;
  $("#selfCount").textContent = `${count}/${inputs.length}`;
  $("#downloadButton").disabled = count !== inputs.length || state.analysis?.hasFailure;
  $(".final-actions > p").textContent = state.analysis?.hasFailure
    ? "자동 점검에서 반려 가능성이 높은 항목을 먼저 해결해 주세요."
    : count === inputs.length ? "최종 제출 전 정부 사이트에서도 한 번 더 검증해 주세요." : `저장 전 직접 확인 ${inputs.length}개 항목을 모두 체크해 주세요.`;
}

function canvasBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function exportPhoto() {
  let quality = .94;
  let blob = await canvasBlob(resultCanvas, quality);
  while (blob && blob.size > OUTPUT.maxBytes && quality > .7) {
    quality -= .04;
    blob = await canvasBlob(resultCanvas, quality);
  }
  if (!blob) {
    showToast("사진 파일을 만들지 못했어요. 다시 시도해 주세요.");
    return;
  }
  const patched = patchJpegDpi(await blob.arrayBuffer(), 300);
  const output = new Blob([patched], { type: "image/jpeg" });
  const url = URL.createObjectURL(output);
  const link = document.createElement("a");
  link.href = url;
  link.download = "여권사진_413x531.jpg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`413 × 531 JPG로 저장했어요 · ${Math.round(output.size / 1024)}KB`);
}

$("#startCamera").addEventListener("click", startCamera);
$("#pickPhoto").addEventListener("click", () => fileInput.click());
$("#cameraGallery").addEventListener("click", () => { stopCamera(); fileInput.click(); });
fileInput.addEventListener("change", () => { loadPhoto(fileInput.files[0]); fileInput.value = ""; });
$("#closeCamera").addEventListener("click", stopCamera);
$("#flipCamera").addEventListener("click", async () => { state.facingMode = state.facingMode === "user" ? "environment" : "user"; await startCamera(); });
$("#captureButton").addEventListener("click", capturePhoto);
$("#resetCrop").addEventListener("click", resetCrop);
$("#analyzeButton").addEventListener("click", analyzePhoto);
$("#editorBack").addEventListener("click", () => showScreen("home"));
$("#resultBack").addEventListener("click", () => showScreen("editor"));
$("#retryButton").addEventListener("click", startCamera);
$("#downloadButton").addEventListener("click", exportPhoto);
$("#openRules").addEventListener("click", openRules);
$("#infoButton").addEventListener("click", openRules);
$("#rulesDialog .sheet-close").addEventListener("click", () => $("#rulesDialog").close());
$("#rulesDialog").addEventListener("click", event => { if (event.target === $("#rulesDialog")) $("#rulesDialog").close(); });
$$(".check-toggle input").forEach(input => input.addEventListener("change", updateSelfChecks));
document.addEventListener("visibilitychange", () => { if (document.hidden && state.stream) stopCamera(); });

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
