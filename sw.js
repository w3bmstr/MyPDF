/* ════════════════════════════════════════════════════════════════════════════
   SERVICE WORKER — makes the whole app (PDF/PDF-Lib engine, OCR engine + English
   language data, fonts, icons) available with zero network calls after the very
   first load. This is what actually backs the "works entirely offline" promise
   in index.html's own <meta description> and comments.
════════════════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'pdf-editor-v1';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// Everything needed to open, view, edit, save, export and OCR (English) a PDF
// with no network connection at all. Paths are relative to this file's scope.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './fonts.css',

  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',

  './fonts/IBMPlexSans-Regular.woff2',
  './fonts/IBMPlexSans-Italic.woff2',
  './fonts/IBMPlexSans-Medium.woff2',
  './fonts/IBMPlexSans-SemiBold.woff2',
  './fonts/IBMPlexSans-Bold.woff2',
  './fonts/IBMPlexMono-Regular.woff2',
  './fonts/IBMPlexMono-Medium.woff2',

  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/pdf-lib.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/pptxgen.bundle.js',
  './vendor/tesseract.min.js',
  './vendor/tesseract-worker.min.js',
  './vendor/tesseract-core/tesseract-core-lstm.wasm.js',
  './vendor/tesseract-core/tesseract-core-lstm.wasm',
  './vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract-core/tesseract-core-simd-lstm.wasm',
  './vendor/tessdata/eng.traineddata.gz',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // Cache each file independently so one missing/renamed asset can't sink
      // the whole install — a real deployment may not always have every extra
      // (e.g. someone strips OCR language data to save space).
      Promise.allSettled(PRECACHE_URLS.map(url => cache.add(url)))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // App shell + vendor libraries: cache-first (they're versioned by filename/build,
    // not expected to change under our feet), falling back to network + caching
    // whatever we fetch so it's available next time too.
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  } else {
    // Cross-origin (e.g. a non-English Tesseract language pack fetched on demand,
    // or a CDN fallback if a vendor/ file is ever missing): try the network first
    // so users get fresh data when online, but cache successful responses and
    // serve from cache when offline — exactly what lets a language pack you've
    // already used once keep working without a connection afterwards.
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Navigations offline with nothing cached yet: fall back to the app shell
    // itself so the user still lands in the app rather than a browser error page.
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    // Opaque (no-cors, cross-origin) responses are still cacheable even though
    // their status can't be inspected — that's normal for third-party CDN assets.
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}
