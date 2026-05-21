// Image pipeline for vision endpoints.
// Responsibilities:
//   1. Detect + convert DICOM (.dcm) → 8-bit PNG with window/level applied
//   2. Pixel-level deidentification: blank top/bottom strips (where burned-in
//      overlays — patient name, MRN, date — typically live)
//   3. Return a PNG buffer + a sha256 hash for audit logging
//
// Heavy lifting:
//   sharp (libvips)  — raster decode/resize/composite
//   dicom-parser     — read DICOM tags + pixel data

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const dicomParser = require('dicom-parser');

const DICOM_EXTENSIONS = new Set(['.dcm', '.dicom']);
const DEID_STRIP_RATIO = 0.08; // blank top 8% + bottom 8% of image

function isDicomFile(filePath, originalName, mimeType) {
  const ext = path.extname((originalName || filePath || '').toLowerCase());
  if (DICOM_EXTENSIONS.has(ext)) return true;
  if (mimeType && /application\/dicom/i.test(mimeType)) return true;
  // sniff DICOM magic (DICM at byte 128)
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 128);
    fs.closeSync(fd);
    return buf.toString('latin1') === 'DICM';
  } catch (_) { return false; }
}

// Decode a DICOM file → PNG buffer (greyscale or RGB, 8-bit).
async function dicomToPng(filePath) {
  const fileBuf = fs.readFileSync(filePath);
  const dataSet = dicomParser.parseDicom(fileBuf);

  const rows = dataSet.uint16('x00280010');
  const cols = dataSet.uint16('x00280011');
  const bitsAllocated = dataSet.uint16('x00280100') || 16;
  const samplesPerPixel = dataSet.uint16('x00280002') || 1;
  const pixelElement = dataSet.elements.x7fe00010;
  if (!rows || !cols || !pixelElement) {
    throw new Error('DICOM missing pixel data or dimensions');
  }
  const pixelDataOffset = pixelElement.dataOffset;
  const pixelDataLength = pixelElement.length;
  const pixelDataBuf = Buffer.from(fileBuf.buffer, pixelDataOffset, pixelDataLength);

  // window/level — fall back to min/max stretch if absent
  let windowCenter = parseFloat(dataSet.string('x00281050')) || NaN;
  let windowWidth  = parseFloat(dataSet.string('x00281051')) || NaN;

  // Read raw samples into a typed array
  let raw;
  if (bitsAllocated === 16) {
    const pixelRepresentation = dataSet.uint16('x00280103') || 0;
    raw = pixelRepresentation === 1
      ? new Int16Array(pixelDataBuf.buffer, pixelDataBuf.byteOffset, rows * cols * samplesPerPixel)
      : new Uint16Array(pixelDataBuf.buffer, pixelDataBuf.byteOffset, rows * cols * samplesPerPixel);
  } else {
    raw = new Uint8Array(pixelDataBuf.buffer, pixelDataBuf.byteOffset, rows * cols * samplesPerPixel);
  }

  // Compute window/level if missing
  if (!isFinite(windowCenter) || !isFinite(windowWidth)) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    windowCenter = (min + max) / 2;
    windowWidth = Math.max(1, max - min);
  }

  const lo = windowCenter - windowWidth / 2;
  const hi = windowCenter + windowWidth / 2;
  const range = hi - lo || 1;

  // Map → 8-bit
  const out = Buffer.alloc(rows * cols * samplesPerPixel);
  for (let i = 0; i < raw.length; i++) {
    let v = (raw[i] - lo) / range;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    out[i] = Math.round(v * 255);
  }

  return sharp(out, {
    raw: { width: cols, height: rows, channels: samplesPerPixel === 3 ? 3 : 1 },
  }).png().toBuffer();
}

// Black-strip top and bottom of an image to obscure burned-in overlays.
async function deidentifyImage(pngBuffer, { stripRatio = DEID_STRIP_RATIO } = {}) {
  const meta = await sharp(pngBuffer).metadata();
  const stripH = Math.max(1, Math.floor(meta.height * stripRatio));
  const topStrip = await sharp({
    create: { width: meta.width, height: stripH, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  return sharp(pngBuffer)
    .composite([
      { input: topStrip, top: 0, left: 0 },
      { input: topStrip, top: meta.height - stripH, left: 0 },
    ])
    .png()
    .toBuffer();
}

// Main entry — given a file on disk + multer metadata, returns:
//   { buffer, mimeType, sha256, processing: [...steps...] }
async function processForVision(filePath, originalName, mimeType, options = {}) {
  const steps = [];
  let buffer;
  let outMime = 'image/png';

  if (isDicomFile(filePath, originalName, mimeType)) {
    buffer = await dicomToPng(filePath);
    steps.push('dicom_to_png');
  } else {
    buffer = fs.readFileSync(filePath);
    // Normalize to PNG so deid compositing has a stable format
    try {
      buffer = await sharp(buffer).png().toBuffer();
      steps.push('normalize_png');
    } catch (e) {
      // leave as-is; sharp couldn't decode (rare)
      outMime = mimeType || 'image/jpeg';
    }
  }

  if (options.deidentify !== false) {
    try {
      buffer = await deidentifyImage(buffer);
      steps.push('deid_strip_corners');
    } catch (_) {
      // non-fatal; fall through with original buffer
    }
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { buffer, mimeType: outMime, sha256, processing: steps };
}

module.exports = {
  processForVision,
  isDicomFile,
  dicomToPng,
  deidentifyImage,
};
