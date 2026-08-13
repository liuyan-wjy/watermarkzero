import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanImageMetadata } from '../../src/core/imageMetadataCleaner.js';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function concat(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
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

function pngChunk(type, payload = new Uint8Array()) {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + payload.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, payload.length);
  output.set(typeBytes, 4);
  output.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(concat(typeBytes, payload)));
  return output;
}

function pngWithMetadata() {
  const ihdr = pngChunk('IHDR', Uint8Array.from([
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0
  ]));
  const iccp = pngChunk('iCCP', new TextEncoder().encode('profile\0\0fake-profile'));
  const exif = pngChunk('eXIf', exifWithOrientationAndGps().subarray(6));
  const xmp = pngChunk('iTXt', new TextEncoder().encode('XML:com.adobe.xmp\0xmp metadata IPTC'));
  const c2pa = pngChunk('caBX', new TextEncoder().encode('contentcredentials'));
  const idat = pngChunk('IDAT', Uint8Array.from([1, 2, 3, 4, 5]));
  return {
    bytes: concat(PNG_SIGNATURE, ihdr, iccp, exif, xmp, c2pa, idat, pngChunk('IEND')),
    iccp,
    idat
  };
}

function jpegSegment(marker, payload) {
  const output = new Uint8Array(payload.length + 4);
  output[0] = 0xff;
  output[1] = marker;
  new DataView(output.buffer).setUint16(2, payload.length + 2);
  output.set(payload, 4);
  return output;
}

function exifWithOrientationAndGps(orientation = 6) {
  const payload = new Uint8Array(6 + 8 + 2 + (2 * 12) + 4);
  payload.set(new TextEncoder().encode('Exif\0\0'), 0);
  payload.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], 6);
  const view = new DataView(payload.buffer);
  view.setUint16(14, 2, true);
  view.setUint16(16, 0x0112, true);
  view.setUint16(18, 3, true);
  view.setUint32(20, 1, true);
  view.setUint16(24, orientation, true);
  view.setUint16(28, 0x8825, true);
  view.setUint16(30, 4, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, 8, true);
  view.setUint32(40, 0, true);
  return payload;
}

function jpegWithMetadata() {
  const jfif = jpegSegment(0xe0, new TextEncoder().encode('JFIF\0'));
  const frame = jpegSegment(0xc0, Uint8Array.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
  const exif = jpegSegment(0xe1, exifWithOrientationAndGps());
  const xmp = jpegSegment(0xe1, new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>private</x:xmpmeta>'));
  const icc = jpegSegment(0xe2, new TextEncoder().encode('ICC_PROFILE\0profile'));
  const c2pa = jpegSegment(0xeb, new TextEncoder().encode('JUMBF c2pa'));
  const iptc = jpegSegment(0xed, new TextEncoder().encode('Photoshop 3.0\0IPTC'));
  const comment = jpegSegment(0xfe, new TextEncoder().encode('private comment'));
  const scan = concat(
    jpegSegment(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
    Uint8Array.from([9, 8, 7, 0xff, 0x00, 6, 0xff, 0xd9])
  );
  return { bytes: concat(Uint8Array.from([0xff, 0xd8]), jfif, exif, xmp, icc, c2pa, iptc, comment, frame, scan), icc, scan };
}

test('cleans PNG metadata while preserving color and pixel chunks byte-for-byte', () => {
  const { bytes, iccp, idat } = pngWithMetadata();
  const result = cleanImageMetadata(bytes);

  assert.equal(result.format, 'png');
  assert.deepEqual(result.findings, ['c2pa', 'comments', 'exif', 'gps', 'iptc', 'xmp']);
  assert.deepEqual(result.removed, result.findings);
  assert.equal(result.preservedOrientation, null);
  assert.equal(Buffer.from(result.cleanedBytes).includes(Buffer.from(iccp)), true);
  assert.equal(Buffer.from(result.cleanedBytes).includes(Buffer.from(idat)), true);
  assert.equal(Buffer.from(result.cleanedBytes).includes(Buffer.from('private')), false);
  assert.deepEqual(cleanImageMetadata(result.cleanedBytes).findings, []);
});

test('cleans JPEG metadata without recompressing scan data and preserves only orientation EXIF', () => {
  const { bytes, icc, scan } = jpegWithMetadata();
  const result = cleanImageMetadata(bytes);

  assert.equal(result.format, 'jpeg');
  assert.deepEqual(result.findings, ['c2pa', 'comments', 'exif', 'gps', 'iptc', 'xmp']);
  assert.deepEqual(result.removed, result.findings);
  assert.equal(result.preservedOrientation, 6);
  assert.equal(Buffer.from(result.cleanedBytes).includes(Buffer.from(icc)), true);
  assert.equal(Buffer.from(result.cleanedBytes).includes(Buffer.from(scan)), true);
  assert.equal(Buffer.from(result.cleanedBytes).includes(Buffer.from('private')), false);

  const secondPass = cleanImageMetadata(result.cleanedBytes);
  assert.deepEqual(secondPass.findings, ['exif']);
  assert.deepEqual(secondPass.removed, []);
  assert.equal(secondPass.preservedOrientation, 6);
  assert.deepEqual(secondPass.cleanedBytes, result.cleanedBytes);
});

test('removes JPEG metadata between scans without changing entropy-coded bytes', () => {
  const frame = jpegSegment(0xc2, Uint8Array.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
  const firstScan = concat(
    jpegSegment(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
    Uint8Array.from([4, 0xff, 0x00, 5, 0xff, 0xd0, 6])
  );
  const xmp = jpegSegment(0xe1, new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0private'));
  const comment = jpegSegment(0xfe, new TextEncoder().encode('private comment'));
  const secondScan = concat(
    jpegSegment(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
    Uint8Array.from([7, 8, 9, 0xff, 0xd9])
  );
  const input = concat(Uint8Array.from([0xff, 0xd8]), frame, firstScan, xmp, comment, secondScan);

  const result = cleanImageMetadata(input);
  const output = new TextDecoder('latin1').decode(result.cleanedBytes);

  assert.deepEqual(result.removed, ['comments', 'xmp']);
  assert.equal(output.includes('private'), false);
  assert.equal(result.cleanedBytes.includes(4), true);
  assert.equal(result.cleanedBytes.includes(9), true);
  assert.deepEqual(cleanImageMetadata(result.cleanedBytes).cleanedBytes, result.cleanedBytes);
});

test('returns an identical copy when a supported file has no removable metadata', () => {
  const bytes = concat(
    PNG_SIGNATURE,
    pngChunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    pngChunk('IDAT', Uint8Array.from([1, 2, 3])),
    pngChunk('IEND')
  );
  const result = cleanImageMetadata(bytes);

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.cleanedBytes, bytes);
  assert.notEqual(result.cleanedBytes, bytes);
});

test('rejects unsupported signatures and truncated containers', () => {
  assert.throws(() => cleanImageMetadata(Uint8Array.from([1, 2, 3])), /Unsupported image format/);
  assert.throws(
    () => cleanImageMetadata(concat(PNG_SIGNATURE, Uint8Array.from([0, 0, 0, 20, 73, 68, 65, 84]))),
    /Invalid PNG/
  );
  assert.throws(
    () => cleanImageMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 20, 1, 2])),
    /Invalid JPEG/
  );
  assert.throws(
    () => cleanImageMetadata(Uint8Array.from([
      0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0xff, 0xd9
    ])),
    /Invalid JPEG/
  );
});
