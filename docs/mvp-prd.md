# Gemini Watermark Remover MVP PRD

## 1. Project Summary

Build a Cloudflare-deployed website focused on one job: helping users remove the **visible Gemini watermark** from Gemini-generated images directly in the browser.

This MVP should combine three strengths:

- the open-source project's technical credibility
- the commercial landing-page clarity of `pilio.ai/gemini-watermark-remover`
- an SEO-safe content structure that targets Gemini-specific search intent without creating thin duplicate pages

Reference inputs reviewed:

- Open-source README: `https://github.com/GargantuaX/gemini-watermark-remover/blob/main/README_zh.md`
- Reference site: `https://pilio.ai/gemini-watermark-remover`
- Target keyword set from user:
  - `gemini watermark remover`
  - `remove gemini watermark`
  - `gemini logo remover`
  - `gemini watermark remover online`
  - `gemini remove watermark`

## 2. Product Positioning

### Core Promise

Remove the visible Gemini watermark online with **local, browser-only processing** and **high-fidelity restoration**.

### Positioning Statement

For users who want to clean a Gemini-generated image quickly and privately, this site is a **Gemini-specific watermark remover** that runs entirely in the browser and explains exactly what it can and cannot do.

### What Makes This Product Different

- **Gemini-specific** instead of “generic AI watermark remover”
- **Local-first** instead of server upload processing
- **Algorithmic restoration** instead of vague “AI magic”
- **Open-source trust** instead of black-box claims
- **Clear limitations** instead of overpromising unsupported use cases

## 3. Users and Jobs To Be Done

### Primary Users

- Gemini users who generated images and want a clean export
- creators, marketers, designers, and indie builders repurposing Gemini images for docs, socials, or mockups
- privacy-sensitive users who do not want to upload images to a server

### Jobs To Be Done

- “I want to remove the Gemini watermark from this image in seconds.”
- “I want to know my image never leaves my device.”
- “I want a result that looks clean, not a blurry AI repaint.”
- “I want to understand whether this works on my Gemini image before wasting time.”

### Emotional Outcome

- confidence
- speed
- control
- trust

## 4. Product Scope

### MVP Goals

- Launch a production-ready landing page plus tool page for the main search intent.
- Process supported Gemini PNG/JPG images entirely in the browser.
- Support both single-image and batch workflows.
- Ship enough content to rank for the core topic without publishing doorway pages.
- Deploy on Cloudflare with static/prerendered marketing content and client-side processing.

### Non-Goals for MVP

- removing non-Gemini watermarks
- removing invisible watermarks such as SynthID
- accounts, credits, subscriptions, or billing
- server-side image processing
- full multi-tool suite or generic “all watermark remover” positioning
- automatic browser-extension or userscript integration

## 5. Product and Technical Assumptions

These assumptions come from the reviewed open-source project and should guide implementation unless changed later:

- The tool only targets the **visible Gemini logo watermark** in the lower-right corner.
- Restoration is based on **reverse alpha compositing**, not inpainting.
- Detection uses known Gemini output patterns plus local anchor checks.
- Processing should happen in **Web Workers** to keep the UI responsive.
- A static asset deployment on Cloudflare is sufficient because image handling is client-side.

## 6. Recommended MVP Architecture

### Rendering Strategy

- Use prerendered HTML for all indexable marketing content.
- Hydrate only the uploader, preview, processing queue, and download controls.
- Keep the site usable with JavaScript enabled, but ensure the indexable copy exists in HTML before hydration.

### Deployment Strategy

- **Primary recommendation for MVP:** deploy static build output to Cloudflare using Wrangler assets or Cloudflare Pages.
- Keep build output in `dist/` so the deployment path remains compatible with the original repo pattern.
- Avoid any server dependency for image uploads or processing.

### Frontend Runtime

- Web Workers for processing
- client-side queue manager for batch jobs
- local ZIP generation for batch download
- no server storage, no image persistence

## 7. Route and Page Inventory

### Must Ship in MVP

- `/gemini-watermark-remover`
  - primary money page
  - hero + upload tool in the first viewport
  - before/after proof
  - feature proof blocks
  - 3-step workflow
  - FAQ
  - internal links to support content
- `/blog/how-gemini-watermarks-work`
  - explains visible watermark logic, limits, and why local restoration can be high fidelity
- `/blog/how-to-remove-gemini-watermark`
  - practical step-by-step guide, screenshots, supported formats, limitations
- `/privacy`
- `/terms`

### Strong Recommendation

- Make `/gemini-watermark-remover` the canonical SEO target.
- Either:
  - 301 redirect `/` to `/gemini-watermark-remover`, or
  - keep `/` as a simple brand homepage and link prominently to the money page

Do **not** keep both pages with near-identical content.

## 8. Landing Page Structure

### Section Order

1. Hero with uploader
2. Trust strip
3. Real before/after proof
4. Feature proof cards
5. “How it works” 3-step flow
6. Algorithm explanation in plain English
7. Limitations and supported cases
8. FAQ
9. Open-source and privacy proof
10. Related reading / internal links

### Hero Requirements

- H1 centered on the main intent
- short subhead emphasizing:
  - browser-only processing
  - Gemini-specific support
  - fast cleanup
- primary CTA: upload / choose files
- secondary trust cues:
  - `100% local`
  - `no upload`
  - `free`
  - `open source`

### Trust Strip

Use short proof labels, not vague badges:

- `Local processing only`
- `Visible Gemini watermark only`
- `Batch friendly`
- `Open-source algorithm`
- `PNG / JPG supported`

## 9. Functional Requirements

### Upload and Processing

- drag-and-drop upload
- click-to-select upload
- support PNG and JPG/JPEG
- support multiple images in one batch
- instantly queue processing after file selection

### Result Experience

- thumbnail list for uploaded files
- per-image states:
  - waiting
  - processing
  - success
  - unsupported / failed
- single-result preview
- batch result overview
- one-click individual download
- one-click batch ZIP download

### Transparency and Safety

- explain “images never leave your device”
- explain what the tool does not support
- provide “Why this works” summary
- link to GitHub repository
- show privacy / legal disclaimer near FAQ or footer

### Error Handling

- unsupported file type
- no watermark detected
- likely non-Gemini image
- corrupted image
- worker error / browser incompatibility

### Performance Expectations

- main thread remains interactive while processing
- first result should feel near-instant on a normal desktop for one image
- batch processing should show visible progress and never freeze the UI

## 10. SEO Content Requirements

### Primary Intent

- users searching for a Gemini-specific watermark remover

### Keyword Strategy

#### Primary Keyword

- `gemini watermark remover`

#### Secondary Variants

- `remove gemini watermark`
- `gemini logo remover`
- `gemini watermark remover online`
- `gemini remove watermark`

### Usage Rules

- Use the primary keyword naturally in:
  - URL slug
  - title tag
  - H1
  - intro paragraph
  - one core section heading
- Distribute secondary variants across:
  - feature cards
  - FAQ questions
  - support article headings
  - image alt text where relevant
- Do not repeat all exact-match variants in every section.
- Do not create one thin landing page per keyword variant.
- Prefer semantic variation such as:
  - `remove the visible Gemini watermark`
  - `clean Gemini-generated images`
  - `Gemini logo cleanup`
  - `browser-based Gemini watermark removal`

### Suggested Metadata for MVP Money Page

- Title: `Gemini Watermark Remover Online | Remove Gemini Watermark Locally`
- H1: `Gemini Watermark Remover`
- Meta description: `Remove the visible Gemini watermark online with local browser processing. No upload, no signup, batch-friendly, and designed specifically for Gemini-generated images.`

## 11. Content and Trust Requirements

The site must make these points crystal clear:

- this tool targets the **visible** Gemini watermark only
- it does **not** remove hidden or invisible watermarking systems
- processing is local to the browser
- the restoration logic is deterministic and Gemini-specific
- the product is open source or open-source-backed
- users remain responsible for lawful use

### Trust Content Modules

- “Why local processing matters”
- “Why Gemini-specific detection is more reliable than generic AI repair”
- “What images are supported”
- “What happens when detection fails”

## 12. Analytics and Measurement

### Product Metrics

- upload start rate
- successful processing completion rate
- download completion rate
- batch usage rate
- error rate by failure type

### SEO Metrics

- indexed status of money page and support articles
- impressions and clicks for the main query cluster
- CTR of `/gemini-watermark-remover`
- internal link clicks from money page to articles

### Tooling

- Google Search Console
- Cloudflare Web Analytics
- optional GA4 if needed for deeper event analysis

## 13. MVP Content Backlog

Create these content assets during or immediately after launch:

- annotated before/after screenshots
- one short diagram explaining reverse alpha restoration
- FAQ answers based on actual edge cases
- one legal / limitation section written in plain English

## 14. V2 Backlog

- multilingual landing pages after English page proves traction
- userscript / browser extension companion page
- comparison pages only if they can be made genuinely distinct
- saved local settings
- drag-sort batch queue
- offline demo mode / sample image playground

## 15. Build Order

1. Build `/gemini-watermark-remover` with working uploader and local processing.
2. Add before/after proof and FAQ on the same page.
3. Add privacy, terms, and GitHub trust links.
4. Publish 2 support articles.
5. Connect sitemap, robots, Search Console, and analytics.

