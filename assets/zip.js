/**
 * 의존성 없는 ZIP 생성기.
 * 브라우저 내장 CompressionStream('deflate-raw') 로 실제 압축까지 한다.
 * (라이브러리 CDN 을 쓰지 않으므로 오프라인/CSP 환경에서도 동작)
 *
 * 제약: ZIP64 미지원 → 결과물이 4GB 를 넘으면 예외를 던진다.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const HAS_DEFLATE = typeof CompressionStream !== "undefined";

async function deflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(date) {
  const y = date.getFullYear();
  // ZIP 은 1980년 이전을 표현하지 못한다.
  const year = y < 1980 ? 0 : y - 1980;
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * @param {Array<{path: string, getFile: () => Promise<File>}>} entries
 * @param {(done: number, total: number, name: string) => void} onProgress
 * @returns {Promise<Blob>}
 */
export async function createZip(entries, onProgress) {
  const parts = [];
  const central = [];
  const encoder = new TextEncoder();
  let offset = 0;

  const push = (u8) => {
    parts.push(u8);
    offset += u8.length;
    if (offset > 0xffffffff) throw new Error("ZIP 이 4GB 를 넘었습니다. 폴더를 나눠서 백업해 주세요.");
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    onProgress?.(i, entries.length, entry.path);

    const file = await entry.getFile();
    const raw = new Uint8Array(await file.arrayBuffer());
    const crc = crc32(raw);

    let method = 0;
    let body = raw;
    if (HAS_DEFLATE && raw.length > 0) {
      const packed = await deflateRaw(raw);
      // 압축이 오히려 커지는 파일(이미 압축된 미디어 등)은 저장만 한다.
      if (packed.length < raw.length) {
        method = 8;
        body = packed;
      }
    }

    const nameBytes = encoder.encode(entry.path);
    const { time, day } = dosDateTime(new Date(file.lastModified || Date.now()));
    const localOffset = offset;

    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true); // version needed
    hv.setUint16(6, 0x0800, true); // UTF-8 파일명 플래그
    hv.setUint16(8, method, true);
    hv.setUint16(10, time, true);
    hv.setUint16(12, day, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, body.length, true);
    hv.setUint32(22, raw.length, true);
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    push(header);
    push(body);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, localOffset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
  }

  const cdOffset = offset;
  for (const cd of central) push(cd);
  const cdSize = offset - cdOffset;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);
  push(eocd);

  onProgress?.(entries.length, entries.length, "");
  return new Blob(parts, { type: "application/zip" });
}
