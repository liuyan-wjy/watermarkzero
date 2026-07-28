# Changelog

## 1.0.10 - 2026-04-07

### Userscript

- Let preview request interception fail open for passive preview fetches so Gemini can keep rendering the original page image when request-layer preview processing fails.
- Hardened fullscreen Gemini copy so stale processed object URLs no longer fall back to CSP-blocked `fetch(blob:...)`; the clipboard hook now reprocesses Gemini's own clipboard image payload when needed.
- Stabilized fullscreen preview replacement by reusing session-stored preview source bindings for blob-backed dialog images and prioritizing fullscreen images ahead of queued preview work.

### Quality

- Added regression coverage for stale fullscreen clipboard object URLs, fullscreen preview source reuse from the shared image session, and fullscreen-priority page replacement queue behavior.
- Re-verified the release with a fresh full automated test run, production build, and Tampermonkey userscript freshness check against the fixed profile.

## 1.0.9 - 2026-03-31

### Userscript

- Removed Gemini-original source confirmation from the local app flow and now rely on the user to decide whether the input should be processed.
- Simplified local status messaging so skipped cases are described as "no removable watermark detected" instead of claiming Gemini-specific source knowledge.
- Removed the unused `exifr` dependency after deleting the abandoned original-source validation path.

### Tooling

- Disabled browser caching for the local dev static server so the active `pnpm dev` port, starting from `http://127.0.0.1:4173/`, is less likely to keep serving stale bundles during watermark validation work.

### Quality

- Added regression coverage to ensure the app no longer imports Gemini original-source validation helpers and locale files no longer ship the removed origin-confirmation copy.
- Re-verified the release with a fresh full test run, sample benchmark, and production build.

## 1.0.8 - 2026-03-31

### Userscript

- Fixed Gemini origin confirmation for metadata-stripped inputs by falling back to actual image dimensions instead of EXIF-only width and height fields.
- Expanded the recognized Gemini size catalog to cover the current tall and wide sample outputs used by the project fixtures.
- Softened the non-confirmed origin status copy so confirmed removal quality is no longer described as "not Gemini" when the source is only unconfirmed.

### Tooling

- Removed the local-browser dependency from `benchmark:samples` and `export:samples`; both scripts now decode and encode fixtures through the Node pipeline directly.
- Updated local regression fixtures and tests to use the remaining WebP sample set as the active release baseline.

### Quality

- Added regression coverage for no-EXIF origin fallback and Node-only sample decoding/export flows.
- Re-verified the release with full automated tests, SDK smoke validation, sample benchmark/export runs, and a production build.

## 1.0.7 - 2026-03-31

### Userscript

- Improved watermark anchor recovery for near-official portrait outputs and preview-sized Gemini images that drift away from the default anchor.
- Stopped harmful extra removal passes earlier when the first pass already clears the watermark-shaped residual well enough.
- Kept preview-anchor cleanup on the cheaper edge-cleanup path instead of reintroducing expensive no-op subpixel sweeps.

### Quality

- Added regression coverage for anchor recovery, pass stopping, and release metadata consistency.
- Added the single-pass versus multipass tradeoff note used during this release cycle.

## 1.0.6 - 2026-03-30

### Userscript

- Unified Gemini preview, fullscreen, clipboard, and download actions around a shared image-session and `actionContext` pipeline.
- Reused processed session resources across surfaces so fullscreen copy/download can resolve the same processed image identity more reliably.
- Removed deprecated userscript legacy intent aliases from the active runtime path to simplify release behavior before shipping.

### Quality

- Added focused coverage for `actionContext`, shared image-session resolution, and userscript hook behavior after the release cleanup.
- Re-verified the release with a fresh full test run and production build.

## 1.0.2 - 2026-03-20

### Userscript

- Simplified Gemini page-image replacement into smaller shared helpers for processing preparation, mutation routing, source dispatch, and result application.
- Simplified Gemini original-blob acquisition so preview urls use rendered capture, download urls use background fetch, and inline urls stay on direct fetch.
- Simplified Gemini download interception to keep only in-flight request deduplication instead of retaining processed response cache entries.

### Quality

- Added focused regression coverage for preview/original source dispatch, candidate image collection, mutation scheduling, and self-written processed blob detection.
- Re-verified the release with full automated tests and a fresh production build.

## 1.0.1 - 2026-03-19

### Userscript

- Added in-page Gemini preview replacement so page images can be processed before manual download.
- Routed preview fetching through `GM_xmlhttpRequest` when available, avoiding fallback CORS failures in userscript sandboxes.
- Added a restrained `Processing...` overlay during preview processing and made failures fail-open so the original image remains visible.
- Hardened overlay lifecycle cleanup to avoid stale fade callbacks removing a new processing state.

### Shared Display Path

- Kept page-image replacement behavior aligned with the userscript preview pipeline and processing-state UX.

### Quality

- Added regression tests for userscript version sync and processing overlay lifecycle edge cases.
- Verified release build with full automated test coverage and production bundle generation.
