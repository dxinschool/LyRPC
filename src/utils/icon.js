const zlib = require('zlib');

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

function makeIcon(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0);
    for (let x = 0; x < size; x++) raw.push(r, g, b);
  }
  const compressed = zlib.deflateSync(Buffer.from(raw));
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function ensureRgbaPng(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.slice(0, 8).compare(sig) !== 0) return buf;

  let offset = 8;
  let width;
  let height;
  let colorType;
  let palette = null;
  let transparency = null;
  const rawData = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString();
    const data = buf.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      rawData.push(data);
    }
  }

  if (colorType !== 3 || !palette) return buf;

  const pixels = zlib.inflateSync(Buffer.concat(rawData));
  const rowSize = 1 + width;
  const indices = Buffer.alloc(height * width);

  for (let y = 0; y < height; y++) {
    const filterType = pixels[y * rowSize];
    for (let x = 0; x < width; x++) {
      const raw = pixels[y * rowSize + 1 + x];
      const left = x > 0 ? indices[y * width + x - 1] : 0;
      const up = y > 0 ? indices[(y - 1) * width + x] : 0;
      const upLeft = x > 0 && y > 0 ? indices[(y - 1) * width + x - 1] : 0;
      let val;

      switch (filterType) {
        case 0:
          val = raw;
          break;
        case 1:
          val = (raw + left) & 0xff;
          break;
        case 2:
          val = (raw + up) & 0xff;
          break;
        case 3:
          val = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pL = Math.abs(p - left);
          const pU = Math.abs(p - up);
          const pUL = Math.abs(p - upLeft);
          val = (raw + (pL <= pU && pL <= pUL ? left : pU <= pUL ? up : upLeft)) & 0xff;
          break;
        }
        default:
          val = raw;
      }

      indices[y * width + x] = val;
    }
  }

  const outRaw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    outRaw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const idx = indices[y * width + x];
      const off = y * (1 + width * 4) + 1 + x * 4;
      outRaw[off] = palette[idx * 3] || 0;
      outRaw[off + 1] = palette[idx * 3 + 1] || 0;
      outRaw[off + 2] = palette[idx * 3 + 2] || 0;
      outRaw[off + 3] = transparency?.[idx] ?? 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(outRaw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function toIco(pngBuf) {
  const width = pngBuf.readUInt32BE(16);
  const height = pngBuf.readUInt32BE(20);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(0, 4);
  entry.writeUInt16LE(0, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, pngBuf]);
}

module.exports = {
  makeIcon,
  ensureRgbaPng,
  toIco,
};
