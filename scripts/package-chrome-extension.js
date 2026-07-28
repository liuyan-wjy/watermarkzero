import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import sharp from "sharp";
import { build } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(rootDir, "extension");
const outputDir = path.join(rootDir, ".artifacts", "chrome-extension");
const zipPath = path.join(rootDir, ".artifacts", "chrome-extension.zip");
const isProd = process.argv.includes("--prod");

const copyTextAsset = async (fileName) => {
  await fs.copyFile(path.join(sourceDir, fileName), path.join(outputDir, fileName));
};

const walkFiles = async (dir, prefix = "") => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const nextPrefix = path.join(prefix, entry.name);
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(nextPath, nextPrefix)));
    } else {
      files.push(nextPrefix);
    }
  }
  return files;
};

const createZip = async () => {
  const zip = new JSZip();
  const files = await walkFiles(outputDir);

  for (const file of files) {
    const content = await fs.readFile(path.join(outputDir, file));
    zip.file(file.replaceAll(path.sep, "/"), content);
  }

  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });
  await fs.writeFile(zipPath, archive);

  const loadedZip = await JSZip.loadAsync(archive);
  if (!loadedZip.file("manifest.json")) {
    throw new Error("Packaged extension ZIP is missing root manifest.json");
  }
};

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "icons"), { recursive: true });

await Promise.all([
  copyTextAsset("manifest.json"),
  copyTextAsset("popup.html"),
  copyTextAsset("popup.css")
]);

await build({
  entryPoints: [path.join(sourceDir, "src", "popup.js")],
  outfile: path.join(outputDir, "popup.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: isProd,
  sourcemap: false,
  legalComments: "none"
});

const iconSource = path.join(sourceDir, "icon.svg");
await Promise.all(
  [16, 32, 48, 128].map((size) =>
    sharp(iconSource)
      .resize(size, size)
      .png()
      .toFile(path.join(outputDir, "icons", `icon-${size}.png`))
  )
);

await createZip();

console.log(`Chrome extension package created at ${zipPath}`);
console.log(`Load unpacked from ${outputDir}`);
