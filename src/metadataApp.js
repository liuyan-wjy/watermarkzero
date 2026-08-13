import JSZip from 'jszip';

import { cleanImageMetadata } from './core/imageMetadataCleaner.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const CATEGORY_LABELS = {
    c2pa: 'C2PA / Content Credentials',
    comments: 'Comments and text fields',
    exif: 'EXIF',
    gps: 'GPS location data',
    iptc: 'IPTC',
    other: 'Other application metadata',
    xmp: 'XMP'
};

const uploadArea = document.getElementById('metadataUploadArea');
const fileInput = document.getElementById('metadataFileInput');
const resultsSection = document.getElementById('metadataResults');
const resultsList = document.getElementById('metadataResultsList');
const progress = document.getElementById('metadataProgress');
const downloadAllButton = document.getElementById('metadataDownloadAll');
const resetButton = document.getElementById('metadataReset');

let items = [];

function safeBaseName(name) {
    const base = String(name || 'image').replace(/[\\/\0-\x1f\x7f]/g, '_').replace(/\.[^.]+$/, '');
    return base || 'image';
}

function outputName(file, format) {
    return `${safeBaseName(file.name)}.cleaned.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearItems() {
    items = [];
    resultsList.replaceChildren();
    resultsSection.hidden = true;
    downloadAllButton.hidden = true;
    fileInput.value = '';
    progress.textContent = '';
}

function createResultCard(item) {
    const card = document.createElement('article');
    card.className = 'result-card';

    const heading = document.createElement('div');
    heading.className = 'result-head';
    const copy = document.createElement('div');
    const name = document.createElement('h3');
    name.className = 'result-name';
    name.textContent = item.file.name;
    const status = document.createElement('p');
    status.className = `result-status ${item.error ? 'is-error' : 'is-success'}`;
    status.textContent = item.error
        ? item.error
        : item.result.removed.length
            ? 'Metadata cleaned'
            : 'No removable metadata found';
    copy.append(name, status);
    heading.append(copy);

    if (!item.error) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button-dark';
        button.textContent = 'Download';
        button.addEventListener('click', () => downloadBlob(item.blob, item.outputName));
        heading.append(button);
    }

    card.append(heading);
    if (!item.error) {
        const list = document.createElement('ul');
        list.className = 'category-list';
        const categories = item.result.findings.length ? item.result.findings : ['none'];
        for (const category of categories) {
            const entry = document.createElement('li');
            entry.className = 'category';
            entry.textContent = category === 'none'
                ? 'No metadata detected'
                : `${CATEGORY_LABELS[category]}: ${item.result.removed.includes(category) ? 'removed' : 'orientation retained'}`;
            list.append(entry);
        }
        card.append(list);

        if (item.result.preservedOrientation) {
            const note = document.createElement('p');
            note.className = 'result-note';
            note.textContent = 'The JPEG orientation tag was retained so the image continues to display correctly.';
            card.append(note);
        }
    }
    return card;
}

async function processFile(file) {
    if (file.size > MAX_FILE_SIZE) {
        return { file, error: 'File exceeds the 20 MB limit.' };
    }
    try {
        const result = cleanImageMetadata(await file.arrayBuffer());
        const type = result.format === 'jpeg' ? 'image/jpeg' : 'image/png';
        return {
            file,
            result,
            blob: new Blob([result.cleanedBytes], { type }),
            outputName: outputName(file, result.format)
        };
    } catch (error) {
        return {
            file,
            error: error instanceof Error ? error.message : 'Unable to process this file.'
        };
    }
}

async function handleFiles(files) {
    const selected = Array.from(files);
    if (!selected.length) return;
    clearItems();
    resultsSection.hidden = false;
    progress.textContent = `Processing 0 of ${selected.length} files…`;

    for (let index = 0; index < selected.length; index += 1) {
        const item = await processFile(selected[index]);
        items.push(item);
        resultsList.append(createResultCard(item));
        progress.textContent = `Processed ${index + 1} of ${selected.length} files.`;
    }

    const completed = items.filter((item) => !item.error);
    downloadAllButton.hidden = completed.length < 2;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
    }
});
fileInput.addEventListener('change', (event) => handleFiles(event.target.files));

for (const eventName of ['dragenter', 'dragover']) {
    uploadArea.addEventListener(eventName, (event) => {
        event.preventDefault();
        uploadArea.classList.add('is-dragging');
    });
}
for (const eventName of ['dragleave', 'drop']) {
    uploadArea.addEventListener(eventName, (event) => {
        event.preventDefault();
        uploadArea.classList.remove('is-dragging');
    });
}
uploadArea.addEventListener('drop', (event) => handleFiles(event.dataTransfer.files));

downloadAllButton.addEventListener('click', async () => {
    const completed = items.filter((item) => !item.error);
    if (completed.length < 2) return;
    const zip = new JSZip();
    for (const item of completed) zip.file(item.outputName, item.blob);
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `ai-metadata-cleaned-${Date.now()}.zip`);
});

resetButton.addEventListener('click', () => {
    clearItems();
    uploadArea.focus();
});
