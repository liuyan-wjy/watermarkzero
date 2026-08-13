/*!
 * Image container metadata handling adapted from
 * https://github.com/guillaumemeyer/watermarks-remover (MIT License).
 * Copyright (c) 2026 watermarks-remover contributors.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to inclusion of this notice. THE SOFTWARE IS
 * PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
 */

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FINDING_ORDER = ['c2pa', 'comments', 'exif', 'gps', 'iptc', 'other', 'xmp'];
const textDecoder = new TextDecoder('latin1');

function toBytes(input) {
    if (input instanceof ArrayBuffer) return new Uint8Array(input).slice();
    if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
    }
    throw new TypeError('Expected an ArrayBuffer or typed array');
}

function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function startsWith(bytes, prefix) {
    if (bytes.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
        if (bytes[i] !== prefix[i]) return false;
    }
    return true;
}

function ascii(bytes) {
    return textDecoder.decode(bytes);
}

function containsMarker(bytes, pattern) {
    return ascii(bytes).toLowerCase().includes(pattern.toLowerCase());
}

function addFinding(target, ...categories) {
    for (const category of categories) target.add(category);
}

function sortedFindings(values) {
    return [...values].sort((a, b) => FINDING_ORDER.indexOf(a) - FINDING_ORDER.indexOf(b));
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function cleanPng(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kept = [bytes.subarray(0, PNG_SIGNATURE.length)];
    const findings = new Set();
    const removed = new Set();
    let offset = PNG_SIGNATURE.length;
    let sawHeader = false;
    let sawImageData = false;
    let sawEnd = false;
    let colorType = null;
    let sawPalette = false;

    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) throw new Error('Invalid PNG: truncated chunk header');
        const length = view.getUint32(offset);
        const end = offset + 12 + length;
        if (end > bytes.length) throw new Error('Invalid PNG: truncated chunk payload');

        const typeBytes = bytes.subarray(offset + 4, offset + 8);
        const type = ascii(typeBytes);
        if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('Invalid PNG: malformed chunk type');
        const payload = bytes.subarray(offset + 8, offset + 8 + length);
        const expectedCrc = view.getUint32(offset + 8 + length);
        if (crc32(concatBytes([typeBytes, payload])) !== expectedCrc) {
            throw new Error(`Invalid PNG: bad ${type} checksum`);
        }
        if (!sawHeader && type !== 'IHDR') throw new Error('Invalid PNG: IHDR must be first');
        if (type === 'IHDR') {
            if (sawHeader || length !== 13) throw new Error('Invalid PNG: malformed IHDR');
            const width = view.getUint32(offset + 8);
            const height = view.getUint32(offset + 12);
            const bitDepth = payload[8];
            colorType = payload[9];
            const validDepths = {
                0: [1, 2, 4, 8, 16],
                2: [8, 16],
                3: [1, 2, 4, 8],
                4: [8, 16],
                6: [8, 16]
            };
            if (!width || !height || !validDepths[colorType]?.includes(bitDepth)
                || payload[10] !== 0 || payload[11] !== 0 || payload[12] > 1) {
                throw new Error('Invalid PNG: unsupported IHDR values');
            }
            sawHeader = true;
        }
        if (type === 'PLTE') {
            if (sawPalette || sawImageData || !length || length % 3 || length > 768) {
                throw new Error('Invalid PNG: malformed palette');
            }
            sawPalette = true;
        }
        if (type === 'IDAT' && colorType === 3 && !sawPalette) {
            throw new Error('Invalid PNG: indexed image is missing a palette');
        }
        if (type[0] === type[0].toUpperCase() && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) {
            throw new Error(`Invalid PNG: unknown critical chunk ${type}`);
        }
        if (type === 'IDAT' || type === 'fdAT') sawImageData = true;

        const categories = new Set();
        let drop = false;
        if (type === 'eXIf') {
            addFinding(categories, 'exif');
            const exif = inspectTiff(payload);
            if (exif.hasGps) addFinding(categories, 'gps');
            if (exif.hasIptc) addFinding(categories, 'iptc');
            if (exif.hasXmp) addFinding(categories, 'xmp');
            drop = true;
        } else if (['tEXt', 'zTXt', 'iTXt'].includes(type)) {
            addFinding(categories, 'comments');
            if (containsMarker(payload, 'iptc')) addFinding(categories, 'iptc');
            if (containsMarker(payload, 'xmp') || containsMarker(payload, 'adobe.com/xap')) {
                addFinding(categories, 'xmp');
            }
            if (containsMarker(payload, 'c2pa') || containsMarker(payload, 'contentcredentials')) {
                addFinding(categories, 'c2pa');
            }
            drop = true;
        } else if (['caBX', 'juMB', 'jumb'].includes(type) || type.toLowerCase().startsWith('c2')) {
            addFinding(categories, 'c2pa');
            drop = true;
        } else if (type[0] === type[0].toLowerCase()
            && (containsMarker(payload, 'c2pa') || containsMarker(payload, 'contentcredentials'))) {
            addFinding(categories, 'c2pa');
            drop = true;
        }

        addFinding(findings, ...categories);
        if (drop) {
            addFinding(removed, ...categories);
        } else {
            kept.push(bytes.subarray(offset, end));
        }

        offset = end;
        if (type === 'IEND') {
            if (length !== 0 || offset !== bytes.length) throw new Error('Invalid PNG: malformed IEND');
            sawEnd = true;
            break;
        }
    }

    if (!sawHeader || !sawImageData || !sawEnd) throw new Error('Invalid PNG: missing required chunks');
    return {
        cleanedBytes: removed.size ? concatBytes(kept) : bytes,
        format: 'png',
        findings: sortedFindings(findings),
        removed: sortedFindings(removed),
        preservedOrientation: null
    };
}

function readExifValue(view, offset, littleEndian, type, count, valueOffset) {
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const size = sizes[type];
    if (!size || count < 1) return null;
    const byteLength = size * count;
    const target = byteLength <= 4 ? valueOffset : view.getUint32(valueOffset, littleEndian);
    if (target < 0 || target + size > view.byteLength) return null;
    if (type === 3) return view.getUint16(target, littleEndian);
    if (type === 4) return view.getUint32(target, littleEndian);
    return view.getUint8(target);
}

function inspectTiff(tiff) {
    if (tiff.length < 8) return { orientation: null, hasGps: false, hasIptc: false, hasXmp: false, valid: false };
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const byteOrder = String.fromCharCode(tiff[0], tiff[1]);
    const littleEndian = byteOrder === 'II';
    if (!littleEndian && byteOrder !== 'MM') return { orientation: null, hasGps: false, hasIptc: false, hasXmp: false, valid: false };
    if (view.getUint16(2, littleEndian) !== 42) return { orientation: null, hasGps: false, hasIptc: false, hasXmp: false, valid: false };
    const ifdOffset = view.getUint32(4, littleEndian);
    if (ifdOffset + 2 > tiff.length) return { orientation: null, hasGps: false, hasIptc: false, hasXmp: false, valid: false };
    const count = view.getUint16(ifdOffset, littleEndian);
    if (ifdOffset + 2 + (count * 12) + 4 > tiff.length) {
        return { orientation: null, hasGps: false, hasIptc: false, hasXmp: false, valid: false };
    }

    let orientation = null;
    let hasGps = false;
    let hasIptc = false;
    let hasXmp = false;
    for (let index = 0; index < count; index += 1) {
        const entry = ifdOffset + 2 + (index * 12);
        const tag = view.getUint16(entry, littleEndian);
        const type = view.getUint16(entry + 2, littleEndian);
        const valueCount = view.getUint32(entry + 4, littleEndian);
        if (tag === 0x0112) {
            const value = readExifValue(view, entry, littleEndian, type, valueCount, entry + 8);
            if (Number.isInteger(value) && value >= 1 && value <= 8) orientation = value;
        }
        if (tag === 0x8825) hasGps = true;
        if (tag === 0x83bb || tag === 0x8649) hasIptc = true;
        if (tag === 0x02bc) hasXmp = true;
    }
    return { orientation, hasGps, hasIptc, hasXmp, valid: true };
}

function inspectExif(payload) {
    if (payload.length < 14 || ascii(payload.subarray(0, 6)) !== 'Exif\0\0') {
        return { orientation: null, hasGps: false, hasIptc: false, hasXmp: false, valid: false };
    }
    return inspectTiff(payload.subarray(6));
}

function minimalExifPayload(orientation) {
    const payload = new Uint8Array(32);
    payload.set(new TextEncoder().encode('Exif\0\0'), 0);
    payload.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], 6);
    const view = new DataView(payload.buffer);
    view.setUint16(14, 1, true);
    view.setUint16(16, 0x0112, true);
    view.setUint16(18, 3, true);
    view.setUint32(20, 1, true);
    view.setUint16(24, orientation, true);
    view.setUint32(28, 0, true);
    return payload;
}

function jpegSegment(marker, payload) {
    const output = new Uint8Array(payload.length + 4);
    output.set([0xff, marker], 0);
    new DataView(output.buffer).setUint16(2, payload.length + 2);
    output.set(payload, 4);
    return output;
}

function findNextJpegMarker(bytes, start) {
    for (let index = start; index + 1 < bytes.length;) {
        if (bytes[index] !== 0xff) {
            index += 1;
            continue;
        }
        const markerStart = index;
        while (index < bytes.length && bytes[index] === 0xff) index += 1;
        if (index >= bytes.length) return -1;
        const marker = bytes[index];
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
            index += 1;
            continue;
        }
        return markerStart;
    }
    return -1;
}

function cleanJpeg(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const segments = [];
    const findings = new Set();
    const removed = new Set();
    let orientation = null;
    let hasMinimalOrientation = false;
    let offset = 2;
    let sawScan = false;
    let sawEnd = false;
    let sawFrame = false;
    let frameNeedsLines = false;
    let sawLineCount = false;

    while (offset < bytes.length) {
        const markerStart = offset;
        if (bytes[offset] !== 0xff) throw new Error('Invalid JPEG: expected marker');
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) throw new Error('Invalid JPEG: truncated marker');
        const marker = bytes[offset];
        offset += 1;

        if (marker === 0xd8) throw new Error('Invalid JPEG: unexpected marker');
        if (marker === 0xd9) {
            segments.push({ marker, bytes: bytes.subarray(markerStart, offset) });
            if (offset !== bytes.length) {
                addFinding(findings, 'other');
                addFinding(removed, 'other');
            }
            sawEnd = true;
            offset = bytes.length;
            break;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            segments.push({ marker, bytes: bytes.subarray(markerStart, offset) });
            continue;
        }
        if (offset + 2 > bytes.length) throw new Error('Invalid JPEG: truncated segment length');
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length) throw new Error('Invalid JPEG: truncated segment');
        const segmentEnd = offset + length;
        const payload = bytes.subarray(offset + 2, segmentEnd);
        const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

        if (isFrame) {
            const componentCount = payload[5];
            const frameHeight = payload.length >= 6 ? (payload[1] << 8) | payload[2] : 0;
            const frameWidth = payload.length >= 6 ? (payload[3] << 8) | payload[4] : 0;
            if (payload.length !== 6 + (3 * componentCount) || !componentCount || !frameWidth) {
                throw new Error('Invalid JPEG: malformed frame header');
            }
            sawFrame = true;
            frameNeedsLines ||= frameHeight === 0;
        }
        if (marker === 0xdc) {
            if (payload.length !== 2 || !((payload[0] << 8) | payload[1])) {
                throw new Error('Invalid JPEG: malformed line count');
            }
            sawLineCount = true;
        }

        if (marker === 0xda) {
            const scanComponents = payload[0];
            if (!sawFrame || !scanComponents || payload.length !== 4 + (2 * scanComponents)) {
                throw new Error('Invalid JPEG: malformed scan header');
            }
            const nextMarker = findNextJpegMarker(bytes, segmentEnd);
            if (nextMarker < 0) throw new Error('Invalid JPEG: missing EOI');
            segments.push({ marker, bytes: bytes.subarray(markerStart, nextMarker) });
            sawScan = true;
            offset = nextMarker;
            continue;
        }

        let keep = true;
        if (marker === 0xe1) {
            keep = false;
            if (ascii(payload.subarray(0, 6)) === 'Exif\0\0') {
                const exif = inspectExif(payload);
                addFinding(findings, 'exif');
                if (exif.hasGps) addFinding(findings, 'gps');
                if (exif.hasIptc) addFinding(findings, 'iptc');
                if (exif.hasXmp) addFinding(findings, 'xmp');
                if (exif.orientation && orientation === null) orientation = exif.orientation;
                const minimal = exif.orientation ? minimalExifPayload(exif.orientation) : null;
                if (minimal && bytesEqual(payload, minimal)) {
                    keep = true;
                    hasMinimalOrientation = true;
                } else {
                    addFinding(removed, 'exif');
                    if (exif.hasGps) addFinding(removed, 'gps');
                    if (exif.hasIptc) addFinding(removed, 'iptc');
                    if (exif.hasXmp) addFinding(removed, 'xmp');
                }
            } else if (containsMarker(payload, 'xmp') || containsMarker(payload, 'adobe.com/xap')) {
                addFinding(findings, 'xmp');
                addFinding(removed, 'xmp');
            } else {
                addFinding(findings, 'other');
                addFinding(removed, 'other');
            }
        } else if (marker === 0xeb) {
            keep = false;
            const category = containsMarker(payload, 'c2pa')
                || containsMarker(payload, 'jumbf')
                || containsMarker(payload, 'contentcredentials')
                ? 'c2pa'
                : 'other';
            addFinding(findings, category);
            addFinding(removed, category);
        } else if (marker === 0xed) {
            keep = false;
            addFinding(findings, 'iptc');
            addFinding(removed, 'iptc');
        } else if (marker === 0xfe) {
            keep = false;
            addFinding(findings, 'comments');
            addFinding(removed, 'comments');
        } else if (marker >= 0xe0 && marker <= 0xef) {
            const isJfif = marker === 0xe0 && ascii(payload.subarray(0, 5)) === 'JFIF\0';
            const isIcc = marker === 0xe2 && ascii(payload.subarray(0, 12)) === 'ICC_PROFILE\0';
            const isAdobe = marker === 0xee && ascii(payload.subarray(0, 5)) === 'Adobe';
            keep = isJfif || isIcc || isAdobe;
            if (!keep) {
                const category = containsMarker(payload, 'c2pa') || containsMarker(payload, 'jumbf')
                    ? 'c2pa'
                    : 'other';
                addFinding(findings, category);
                addFinding(removed, category);
            }
        }

        if (keep) segments.push({ marker, bytes: bytes.subarray(markerStart, segmentEnd) });
        offset = segmentEnd;
    }

    if (!sawFrame || !sawScan || !sawEnd || (frameNeedsLines && !sawLineCount)) {
        throw new Error('Invalid JPEG: missing frame, image scan, or EOI');
    }
    if (orientation && !hasMinimalOrientation) {
        let insertAt = 0;
        while (insertAt < segments.length && segments[insertAt].marker === 0xe0) insertAt += 1;
        segments.splice(insertAt, 0, { marker: 0xe1, bytes: jpegSegment(0xe1, minimalExifPayload(orientation)) });
    }

    return {
        cleanedBytes: removed.size ? concatBytes([Uint8Array.from([0xff, 0xd8]), ...segments.map((item) => item.bytes)]) : bytes,
        format: 'jpeg',
        findings: sortedFindings(findings),
        removed: sortedFindings(removed),
        preservedOrientation: orientation
    };
}

export function cleanImageMetadata(input) {
    const bytes = toBytes(input);
    if (startsWith(bytes, PNG_SIGNATURE)) return cleanPng(bytes);
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return cleanJpeg(bytes);
    throw new Error('Unsupported image format: expected PNG or JPEG signature');
}
