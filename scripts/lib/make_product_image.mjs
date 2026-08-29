// Generates a real, visible PNG placeholder photo for evidence uploads —
// NOT a 1x1 transparent test pixel. That mistake (reusing
// full_contract_test_suite.mjs's TEST_PNG fixture, a real 1x1 transparent
// pixel, for what was meant to be a "real detailed data" showcase) is
// exactly why every evidence photo in the first four-product run
// rendered as a solid black box: a 1x1 transparent pixel stretched to
// fill a large `object-cover` container shows through to the page's own
// dark background, which reads as pure black. This generator draws an
// actual visible image (a labeled placeholder with real contrast/shape),
// hand-rolled with zero external dependencies (manual CRC32, zlib
// deflate via Node's built-in zlib, IHDR/IDAT/IEND chunks) the same way
// the very first "is the evidence-photo pipeline broken" investigation
// in this project proved a real photo renders correctly.
import zlib from "node:zlib";

function crc32Table() {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Draws a simple, real, visible placeholder photo: a solid brand-colored
 * background with a lighter rounded "device" silhouette in the middle,
 * distinguishable per-product via the `seed` color. Returns a Buffer of
 * real PNG bytes.
 */
export function makeProductImage({ width = 480, height = 320, seed = [70, 90, 140] } = {}) {
  const [r0, g0, b0] = seed;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const raw = Buffer.alloc((width * 3 + 1) * height);
  let pos = 0;
  const cx = width / 2, cy = height / 2;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0;
    for (let x = 0; x < width; x++) {
      let r = Math.max(0, r0 - 30), g = Math.max(0, g0 - 30), b = Math.max(0, b0 - 30);
      const dx = (x - cx) / (width * 0.32);
      const dy = (y - cy) / (height * 0.32);
      if (dx * dx + dy * dy < 1) { r = r0 + 60; g = g0 + 60; b = b0 + 60; }
      // simple corner label stripe so images are visually distinguishable from each other
      if (y < 24) { r = r0; g = g0; b = b0; }
      raw[pos++] = Math.min(255, r);
      raw[pos++] = Math.min(255, g);
      raw[pos++] = Math.min(255, b);
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
