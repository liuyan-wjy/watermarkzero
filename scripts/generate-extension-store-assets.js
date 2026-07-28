import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(rootDir, ".artifacts", "chrome-extension");
const popupUrl = pathToFileURL(path.join(packageDir, "popup.html")).href;
const assetsDir = path.join(rootDir, "extension", "store-assets");
const sampleImage = path.join(rootDir, "src", "assets", "samples", "16-9.webp");

const screenshotStyles = `
  html,
  body {
    width: 1280px !important;
    min-width: 1280px !important;
    height: 800px !important;
    margin: 0 !important;
    overflow: hidden !important;
  }

  body {
    display: grid !important;
    place-items: center !important;
    background:
      radial-gradient(circle at 18% 14%, rgba(98, 93, 245, 0.18), transparent 30%),
      radial-gradient(circle at 82% 16%, rgba(19, 185, 129, 0.2), transparent 32%),
      linear-gradient(135deg, #f8fffc 0%, #eef7ff 100%) !important;
  }

  .popup-shell {
    transform: scale(1.08);
    transform-origin: center center;
    border: 1px solid rgba(215, 224, 234, 0.8);
    border-radius: 32px;
    background:
      radial-gradient(circle at top right, rgba(19, 185, 129, 0.14), transparent 34%),
      linear-gradient(180deg, #ffffff 0%, #f7fbfa 100%);
    box-shadow: 0 30px 90px rgba(15, 23, 42, 0.2);
  }
`;

await execFileAsync("node", ["scripts/package-chrome-extension.js", "--prod"], {
  cwd: rootDir
});

await fs.rm(assetsDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

await sharp(path.join(rootDir, "extension", "icon.svg"))
  .resize(128, 128)
  .webp()
  .toFile(path.join(assetsDir, "icon-128.webp"));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto(popupUrl);
  await page.addStyleTag({ content: screenshotStyles });
  await page.screenshot({
    path: path.join(assetsDir, "screenshot-01-upload.png"),
    clip: { x: 0, y: 0, width: 1280, height: 800 }
  });

  await page.setInputFiles("#fileInput", sampleImage);
  await page.waitForSelector("#downloadButton:not([hidden])", { timeout: 30000 });
  await page.screenshot({
    path: path.join(assetsDir, "screenshot-02-processed.png"),
    clip: { x: 0, y: 0, width: 1280, height: 800 }
  });
} finally {
  await browser.close();
}

console.log(`Chrome Web Store assets created in ${assetsDir}`);
