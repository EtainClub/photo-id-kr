const CACHE = "여권사진-준비-3";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./analyzer.js", "./icon.svg", "./manifest.webmanifest",
  "./vendor/mediapipe/vision_bundle.mjs", "./vendor/mediapipe/vision_wasm_internal.js",
  "./vendor/mediapipe/vision_wasm_internal.wasm", "./vendor/mediapipe/vision_wasm_nosimd_internal.js",
  "./vendor/mediapipe/vision_wasm_nosimd_internal.wasm", "./models/blaze_face_short_range.tflite"
];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  })));
});
