# Gemini Watermark Remover Tracking Plan

Last updated: 2026-04-16

## Goal

Use a small set of privacy-friendly events to answer three questions:

1. Are visitors attempting to use the tool?
2. Do they reach a successful processing result?
3. Do they download the output?

The implementation intentionally avoids tracking image content itself.

## Provider Strategy

The site now emits events through a lightweight tracker in [src/analytics.js](/Users/liuyan/Desktop/cc/gemini-watermark-remover/src/analytics.js).

It always pushes events to `window.dataLayer`, then forwards them when any of these providers exist:

- `gtag`
- `zaraz.track`
- `plausible`
- `umami.track`

This means we can wire GTM, GA4, Zaraz, Plausible, or Umami later without changing the uploader logic again.

## Events

| Event name | Why it exists | Core properties | Trigger |
| --- | --- | --- | --- |
| `upload_click` | Measure first intent on the hero tool | `location`, `trigger`, `viewport_bucket` | User clicks or keyboard-opens the hero uploader |
| `file_selected` | Measure real upload attempts | `source`, `file_count`, `upload_mode`, `formats` | Files selected via picker, drag-drop, or paste |
| `batch_process_start` | Measure batch-mode starts | `source`, `file_count`, `formats` | More than one valid file enters the queue |
| `process_success` | Measure successful visible watermark removal | `processing_mode`, `file_count`, `removed_count`, `skipped_count`, `error_count`, `outcome`, `formats` | Fires when at least one supported image is actually restored |
| `image_processing_failed` | Surface blocking failures | `processing_mode`, `file_count`, `reason` | Single-image processing throws |
| `download_click` | Measure final conversion intent | `download_mode`, `file_count`, `removed_count`, `skipped_count`, `outcome`, `image_format` | Single download or ZIP download |

## Notes

- No image pixels, filenames, prompts, or user identifiers are intentionally tracked.
- `viewport_bucket` is added automatically to help compare mobile vs desktop conversion.
- Pageview collection should come from the analytics vendor itself rather than custom code.

## Recommended Next Activation Step

For the fastest live setup, connect one of these:

1. GTM or GA4 if you want marketing reporting and funnels.
2. Cloudflare Zaraz if you want a Cloudflare-native tag layer.
3. Plausible or Umami if you want lighter privacy-friendly analytics.

## GA4 Activation

The site is now GA4-ready without changing the uploader code again.

Current production config:

- Site origin: `https://watermarkzero.org`
- GA4 measurement ID: `G-XV8TF2MBMM`

Production setup:

1. Keep `SITE_ORIGIN` aligned with the production hostname.
2. Keep `GA4_MEASUREMENT_ID` aligned with the live GA4 data stream.
3. Redeploy. The production HTML bootstraps the Google tag only when the hostname matches the canonical production host.

What happens after activation:

- Default pageviews are handled by GA4 itself.
- Preview hosts are marked `noindex` and do not inject GA4, which avoids polluting production reports.
- Custom uploader events already forward to `gtag(...)`:
  - `upload_click`
  - `file_selected`
  - `batch_process_start`
  - `process_success`
  - `image_processing_failed`
  - `download_click`

Recommended GA4 conversions for MVP:

1. Mark `process_success` as the primary activation conversion.
2. Mark `download_click` as the output conversion.
3. Keep `upload_click`, `file_selected`, and `batch_process_start` for funnel drop-off analysis.
