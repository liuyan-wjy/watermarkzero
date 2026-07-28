import { processWatermarkBlob } from "../../src/shared/imageProcessing.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const dropZone = document.querySelector("#dropZone");
const fileInput = document.querySelector("#fileInput");
const uploadButton = document.querySelector("#uploadButton");
const statusEl = document.querySelector("#status");
const previewGrid = document.querySelector("#previewGrid");
const originalPreview = document.querySelector("#originalPreview");
const processedPreview = document.querySelector("#processedPreview");
const downloadButton = document.querySelector("#downloadButton");

let originalUrl = "";
let processedUrl = "";
let processedBlob = null;
let downloadName = "gemini-watermark-removed.png";

const setStatus = (message, type = "info") => {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", type === "error");
};

const revokePreviews = () => {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (processedUrl) URL.revokeObjectURL(processedUrl);
  originalUrl = "";
  processedUrl = "";
};

const resetResult = () => {
  processedBlob = null;
  downloadButton.hidden = true;
  previewGrid.hidden = true;
  revokePreviews();
};

const makeDownloadName = (fileName) => {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "gemini-image";
  return `${baseName}-watermarkzero.png`;
};

const assertSupportedFile = (file) => {
  if (!file) throw new Error("No image file was selected.");
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error("Please choose a JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Please choose an image smaller than 25 MB.");
  }
};

const setBusy = (isBusy) => {
  uploadButton.disabled = isBusy;
  downloadButton.disabled = isBusy;
};

const processFile = async (file) => {
  resetResult();
  assertSupportedFile(file);

  setBusy(true);
  originalUrl = URL.createObjectURL(file);
  originalPreview.src = originalUrl;
  previewGrid.hidden = false;
  setStatus("Processing locally. Your image is not uploaded.");

  try {
    const { processedBlob: nextBlob, processedMeta } = await processWatermarkBlob(file, {
      outputType: "image/png",
      forceApply: false,
      verifyWatermark: true
    });

    if (!nextBlob) {
      throw new Error("The image could not be processed.");
    }

    processedBlob = nextBlob;
    processedUrl = URL.createObjectURL(processedBlob);
    processedPreview.src = processedUrl;
    downloadName = makeDownloadName(file.name);
    downloadButton.hidden = false;

    const decision = processedMeta?.verification?.decision;
    if (decision === "reject") {
      setStatus(
        "Finished, but this image may not match a supported Gemini visible watermark pattern."
      );
      return;
    }

    setStatus("Done. Review the processed image, then download the result.");
  } catch (error) {
    resetResult();
    setStatus(error?.message || "The image could not be processed.", "error");
  } finally {
    setBusy(false);
  }
};

uploadButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) processFile(file);
});

dropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (file) processFile(file);
});

downloadButton.addEventListener("click", () => {
  if (!processedBlob) return;
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(processedBlob);
  anchor.download = downloadName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
});

window.addEventListener("unload", revokePreviews);
