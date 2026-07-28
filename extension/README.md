# Gemini Watermark Remover Chrome Extension

This directory contains the source for the Manifest V3 Chrome extension.
The extension is intentionally not an iframe wrapper: it bundles the local
watermark-processing code and runs without remote scripts or host permissions.

## Build

```bash
npm run build:extension
```

The command creates:

- `.artifacts/chrome-extension/` for local `Load unpacked` testing.
- `.artifacts/chrome-extension.zip` for Chrome Web Store upload.

## Store Assets

```bash
npm run generate:extension-store-assets
```

The command creates screenshots and a 128px store icon in
`extension/store-assets/`.

## Manual Test

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select `.artifacts/chrome-extension/`.
5. Upload JPG, PNG, and WebP Gemini images and verify the processed download.

The popup links to:

- `https://watermarkzero.org`
- `https://watermarkzero.org/privacy/`
