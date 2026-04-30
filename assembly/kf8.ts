// ─────────────────────────────────────────────────────────────────────────────
// KF8 (AZW3) binary writer
// Produces a dual MOBI6+KF8 PalmDB file readable by all Kindle devices.
//
// Record layout (absolute PalmDB indices):
//   0   MOBI6 header   (type=2,  version=6, EXTH-121 → 4)
//   1   MOBI6 content  (minimal fallback HTML)
//   2   MOBI6 FLIS
//   3   MOBI6 FCIS
//   4   KF8  header    (type=0x101, version=8)
//   5…5+T-1   KF8 text records  (4096-byte HTML chunks)
//   5+T…5+T+I-1   image records
//   5+T+I   FDST
//   5+T+I+1   FLIS
//   5+T+I+2   FCIS
//   5+T+I+3   EOF marker
//
// Within KF8 header, all record numbers are RELATIVE to record 4 (0 = KF8 hdr).
// ─────────────────────────────────────────────────────────────────────────────

// ── Constants ────────────────────────────────────────────────────────────────

const CHUNK : usize = 4096;
const MAX_IMG: i32  = 512;

// MOBI6 fallback content: <html><body><p>KF8 reader required.</p></body></html>
const FALLBACK: StaticArray<u8> = [
  0x3C,0x68,0x74,0x6D,0x6C,0x3E,                         // <html>
  0x3C,0x62,0x6F,0x64,0x79,0x3E,                         // <body>
  0x3C,0x70,0x3E,                                         // <p>
  0x4B,0x46,0x38,0x20,0x72,0x65,0x61,0x64,0x65,0x72,    // KF8 reader
  0x20,0x72,0x65,0x71,0x75,0x69,0x72,0x65,0x64,0x2E,    //  required.
  0x3C,0x2F,0x70,0x3E,                                    // </p>
  0x3C,0x2F,0x62,0x6F,0x64,0x79,0x3E,                    // </body>
  0x3C,0x2F,0x68,0x74,0x6D,0x6C,0x3E                     // </html>
];

// ── Writer ───────────────────────────────────────────────────────────────────

class Writer {
  ptr: usize;
  pos: usize;
  cap: usize;

  constructor(init: usize = 256) {
    this.cap = init;
    this.ptr = __alloc(init);
    this.pos = 0;
    memory.fill(this.ptr, 0, init);
  }

  private grow(need: usize): void {
    let nc = this.cap;
    while (nc < this.pos + need) nc <<= 1;
    const np = __alloc(nc);
    memory.copy(np, this.ptr, this.pos);
    memory.fill(np + this.pos, 0, nc - this.pos);
    this.ptr = np;
    this.cap = nc;
  }

  @inline private ensure(n: usize): void {
    if (this.pos + n > this.cap) this.grow(n);
  }

  u8(v: u32): void {
    this.ensure(1);
    store<u8>(this.ptr + this.pos, (v & 0xFF) as u8);
    this.pos++;
  }

  // Big-endian 16-bit
  be16(v: u32): void {
    this.ensure(2);
    const p = this.ptr + this.pos;
    store<u8>(p,   ((v >> 8) & 0xFF) as u8);
    store<u8>(p+1, ( v       & 0xFF) as u8);
    this.pos += 2;
  }

  // Big-endian 32-bit
  be32(v: u32): void {
    this.ensure(4);
    const p = this.ptr + this.pos;
    store<u8>(p,   ((v >> 24) & 0xFF) as u8);
    store<u8>(p+1, ((v >> 16) & 0xFF) as u8);
    store<u8>(p+2, ((v >>  8) & 0xFF) as u8);
    store<u8>(p+3, ( v        & 0xFF) as u8);
    this.pos += 4;
  }

  zeros(n: usize): void {
    this.ensure(n);
    memory.fill(this.ptr + this.pos, 0, n);
    this.pos += n;
  }

  raw(src: usize, len: usize): void {
    if (!len) return;
    this.ensure(len);
    memory.copy(this.ptr + this.pos, src, len);
    this.pos += len;
  }

  staticBytes(arr: StaticArray<u8>): void {
    const len = arr.length as usize;
    this.raw(changetype<usize>(arr), len);
  }

  // Pad to 4-byte boundary
  pad4(): void {
    const r = this.pos & 3;
    if (r) this.zeros(4 - r);
  }

  // Back-patch a big-endian u32 at given offset
  patch32(off: usize, v: u32): void {
    const p = this.ptr + off;
    store<u8>(p,   ((v >> 24) & 0xFF) as u8);
    store<u8>(p+1, ((v >> 16) & 0xFF) as u8);
    store<u8>(p+2, ((v >>  8) & 0xFF) as u8);
    store<u8>(p+3, ( v        & 0xFF) as u8);
  }
}

// ── Global state ─────────────────────────────────────────────────────────────

let g_title_ptr : usize = 0;  let g_title_len : usize = 0;
let g_author_ptr: usize = 0;  let g_author_len: usize = 0;
let g_html_ptr  : usize = 0;  let g_html_len  : usize = 0;

let g_img_ptrs: StaticArray<usize> = new StaticArray<usize>(MAX_IMG);
let g_img_lens: StaticArray<usize> = new StaticArray<usize>(MAX_IMG);
let g_img_count: i32 = 0;

let g_result_ptr: usize = 0;
let g_result_len: usize = 0;

// Temporary record table for PalmDB assembly
const MAX_REC: i32 = 2048;
let g_rec_ptrs: StaticArray<usize> = new StaticArray<usize>(MAX_REC);
let g_rec_lens: StaticArray<usize> = new StaticArray<usize>(MAX_REC);
let g_rec_count: i32 = 0;

// ── Exported API ─────────────────────────────────────────────────────────────

export function alloc(size: i32): i32 {
  return __alloc(size as usize) as i32;
}

export function reset(): void {
  g_title_ptr  = 0; g_title_len  = 0;
  g_author_ptr = 0; g_author_len = 0;
  g_html_ptr   = 0; g_html_len   = 0;
  g_img_count  = 0;
  g_result_ptr = 0; g_result_len = 0;
  g_rec_count  = 0;
}

export function setTitle (p: i32, l: i32): void { g_title_ptr  = p as usize; g_title_len  = l as usize; }
export function setAuthor(p: i32, l: i32): void { g_author_ptr = p as usize; g_author_len = l as usize; }
export function setHtml  (p: i32, l: i32): void { g_html_ptr   = p as usize; g_html_len   = l as usize; }

export function addImage(p: i32, l: i32): void {
  if (g_img_count >= MAX_IMG) return;
  g_img_ptrs[g_img_count] = p as usize;
  g_img_lens[g_img_count] = l as usize;
  g_img_count++;
}

export function getResultLen(): i32 { return g_result_len as i32; }

export function build(): i32 {
  _build();
  return g_result_ptr as i32;
}

// ── EXTH block ───────────────────────────────────────────────────────────────
// Entries layout: [type(4), data_len(4), data(data_len)]
// Total = 12 + sum(8 + data_len), padded to 4 bytes.

function buildEXTH_mobi6(kf8StartRec: u32): Writer {
  const w = new Writer(256);
  // Magic + total_len placeholder + entry count (4 entries)
  w.u8(69); w.u8(88); w.u8(84); w.u8(72); // 'EXTH'
  const lenOff = w.pos;
  w.be32(0);   // total length – patch later
  w.be32(4);   // 4 entries

  // FIX: явные касты u32 чтобы избежать неопределённого поведения при сложении типов
  // EXTH entry format: [type u32][total_len u32][data...]
  // total_len = 8 (type+len fields) + len(data)

  // 100: author
  w.be32(100);
  w.be32(8 + (g_author_len as u32));
  w.raw(g_author_ptr, g_author_len);

  // 503: updated title
  w.be32(503);
  w.be32(8 + (g_title_len as u32));
  w.raw(g_title_ptr, g_title_len);

  // 524: language = "ru"
  w.be32(524);
  w.be32(10);        // 8 + 2 bytes data
  w.u8(114); w.u8(117); // 'r','u'

  // 121: KF8 boundary record index (absolute PalmDB record number)
  w.be32(121);
  w.be32(12);        // 8 + 4 bytes data
  w.be32(kf8StartRec);

  w.patch32(lenOff, w.pos as u32);
  w.pad4();
  return w;
}

function buildEXTH_kf8(): Writer {
  const w = new Writer(256);
  w.u8(69); w.u8(88); w.u8(84); w.u8(72); // 'EXTH'
  const lenOff = w.pos;
  w.be32(0);  // total length – patch later
  w.be32(3);  // 3 entries

  // 100: author
  w.be32(100);
  w.be32(8 + (g_author_len as u32));
  w.raw(g_author_ptr, g_author_len);

  // 503: updated title
  w.be32(503);
  w.be32(8 + (g_title_len as u32));
  w.raw(g_title_ptr, g_title_len);

  // 524: language = "ru"
  w.be32(524);
  w.be32(10);
  w.u8(114); w.u8(117);

  w.patch32(lenOff, w.pos as u32);
  w.pad4();
  return w;
}

// ── MOBI6 header record (Record 0) ───────────────────────────────────────────
// Layout: PalmDOC(16) + MOBI-hdr(232) + EXTH + full_title, padded to 4 bytes.
//
// MOBI header field offsets (from MOBI magic, verified against KindleUnpack):
//   0x00: 'MOBI' magic
//   0x04: header length = 232
//   0x08: type = 2 (Mobipocket Book)
//   0x0c: encoding = 65001 (UTF-8)
//   0x10: unique ID
//   0x14: file version = 6
//   0x18–0x3f: 10 × 0xFFFFFFFF (unused index fields)
//   0x40: first non-book record
//   0x44: fullName offset (from record 0 start)
//   0x48: fullName length
//   0x4c: locale
//   0x50: input language
//   0x54: output language
//   0x58: min version
//   0x5c: first image index
//   0x60–0x6f: huff fields (0)
//   0x70: EXTH flags (0x40 = EXTH present)
//   0x74–0x7f: reserved
//   0x80: DRM offset (0xFFFFFFFF = no DRM)
//   0x84–0x8f: DRM count/size/flags
//   0x90–0x97: reserved
//   0x98: first content record (be16)
//   0x9a: last content record (be16)
//   0x9c: unknown (1)
//   0xa0: FLIS record index  ← FLIS first, then FCIS!
//   0xa4: FLIS count
//   0xa8: FCIS record index
//   0xac: FCIS count
//   0xb0–0xb7: reserved
//   0xb8: extra record data
//   0xbc: INDX record (0xFFFFFFFF = none)
//   0xc0–0xe7: padding to MOBI_LEN=232

function buildMobi6Record0(
  kf8StartRec  : u32,   // absolute record index of KF8 header
  textLen      : u32,   // MOBI6 content byte length
  textRecCount : u32,   // number of MOBI6 text records
  flisRec      : u32,   // absolute index of MOBI6 FLIS  ← порядок: FLIS, FCIS
  fcisRec      : u32    // absolute index of MOBI6 FCIS
): Writer {
  const exth = buildEXTH_mobi6(kf8StartRec);
  const MOBI_LEN: u32 = 232;
  // FIX: явный каст usize→u32 для exth.pos
  const fullNameOff: u32 = 16 + MOBI_LEN + (exth.pos as u32);

  const w = new Writer(512 + exth.pos + g_title_len);

  // ── PalmDOC header (16 bytes) ──────────────────────────────────────────
  w.be16(1);             // compression: 1 = none
  w.be16(0);             // unused
  w.be32(textLen);       // uncompressed text length
  w.be16(textRecCount);  // text record count
  w.be16(4096);          // max record size
  w.be32(0);             // encryption = 0

  // ── MOBI header (232 bytes от моей позиции = offset 16 записи 0) ──────
  // offset 0x00 от MOBI-magic:
  w.u8(77); w.u8(79); w.u8(66); w.u8(73); // 'MOBI'
  w.be32(MOBI_LEN);      // 0x04: header length = 232
  w.be32(2);             // 0x08: type: 2 = Mobipocket Book
  w.be32(65001);         // 0x0c: encoding: UTF-8
  w.be32(0xABCD1234);    // 0x10: unique ID
  w.be32(6);             // 0x14: file version = 6
  // 0x18–0x3f: 10 × 0xFFFFFFFF
  for (let i = 0; i < 10; i++) w.be32(0xFFFFFFFF);
  // offset 0x40:
  w.be32(textRecCount + 1); // 0x40: first non-book record
  w.be32(fullNameOff);      // 0x44: full name offset (from record 0 start)
  w.be32(g_title_len as u32); // 0x48: full name length
  w.be32(0x0419);            // 0x4c: locale: Russian
  w.be32(0);                 // 0x50: input language
  w.be32(0);                 // 0x54: output language
  w.be32(6);                 // 0x58: min version
  w.be32(0xFFFFFFFF);        // 0x5c: first image index (none in MOBI6)
  // offset 0x60:
  w.zeros(16);               // 0x60–0x6f: huff fields (0)
  w.be32(0x40);              // 0x70: EXTH flags: bit 6 = EXTH present
  w.zeros(12);               // 0x74–0x7f: reserved
  w.be32(0xFFFFFFFF);        // 0x80: DRM offset = no DRM
  w.zeros(12);               // 0x84–0x8f: DRM count/size/flags
  w.zeros(8);                // 0x90–0x97: reserved
  // offset 0x98:
  w.be16(1);                 // 0x98: first content record
  w.be16(textRecCount);      // 0x9a: last content record
  w.be32(1);                 // 0x9c: unknown (always 1)
  // offset 0xa0: FIX — FLIS первый, FCIS второй (по спецификации KindleUnpack)
  w.be32(flisRec);           // 0xa0: FLIS record index
  w.be32(1);                 // 0xa4: FLIS count
  w.be32(fcisRec);           // 0xa8: FCIS record index
  w.be32(1);                 // 0xac: FCIS count
  w.zeros(8);                // 0xb0–0xb7: reserved
  w.be32(0);                 // 0xb8: extra record data
  w.be32(0xFFFFFFFF);        // 0xbc: INDX = none
  // offset 0xc0: padding до MOBI_LEN=232 (0xe8 от начала MOBI)
  // Осталось: 232 - 0xc0 + 0 = 232 - 192 = 40 bytes
  w.zeros(40);               // 0xc0–0xe7: padding to reach MOBI_LEN=232

  // EXTH block
  w.raw(exth.ptr, exth.pos);

  // Full title
  w.raw(g_title_ptr, g_title_len);
  w.pad4();

  return w;
}

// ── KF8 / MOBI8 header record (Record 4) ─────────────────────────────────────
// PalmDOC(16) + MOBI8-hdr(264) + EXTH + full_title, padded to 4 bytes.
// Все record numbers ОТНОСИТЕЛЬНЫ к record 4 (эта запись = 0).
//
// KF8 MOBI header дополнительные поля (от MOBI-magic, по KindleUnpack):
//   0xa0: FLIS record index  ← FLIS первый!
//   0xa4: FLIS count
//   0xa8: FCIS record index
//   0xac: FCIS count
//   0xb0–0xb7: reserved
//   0xb8: extra record data
//   0xbc: SKEL INDX (0xFFFFFFFF = none)
//   0xc0–0xdf: 8 × unknown u32 fields
//   0xe0: NCX INDX (0xFFFFFFFF = none)    ← NCX до extra_data_flags!
//   0xe4: extra_data_flags
//   0xe8: FDST record (relative index)
//   0xec: FDST count
//   0xf0: FRAG INDX (0xFFFFFFFF = none)
//   0xf4: GUIDE INDX (0xFFFFFFFF = none)
//   0xf8–0x107: reserved (16 bytes)
//   total from MOBI magic = 264 = MOBI_LEN ✓

function buildKf8Record0(
  textRecCount: u32,   // T
  imgCount    : u32,   // I
  fdstRel     : u32,   // T+I+1
  flisRel     : u32,   // T+I+2  ← FLIS
  fcisRel     : u32    // T+I+3  ← FCIS
): Writer {
  const exth = buildEXTH_kf8();
  const MOBI_LEN: u32 = 264;
  const firstImgRel: u32 = imgCount > 0 ? textRecCount + 1 : 0xFFFFFFFF;
  // FIX: явный каст usize→u32 для exth.pos
  const fullNameOff: u32 = 16 + MOBI_LEN + (exth.pos as u32);

  const w = new Writer(600 + exth.pos + g_title_len);

  // ── PalmDOC header (16 bytes) ──────────────────────────────────────────
  w.be16(1);              // compression: 1 = none
  w.be16(0);
  w.be32(g_html_len as u32); // full HTML size
  w.be16(textRecCount);
  w.be16(4096);
  w.be32(0);

  // ── MOBI8 header (264 bytes от offset 16) ─────────────────────────────
  // offset 0x00:
  w.u8(77); w.u8(79); w.u8(66); w.u8(73);  // 'MOBI'
  w.be32(MOBI_LEN);       // 0x04: header length = 264
  w.be32(0x101);          // 0x08: type: KF8
  w.be32(65001);          // 0x0c: encoding: UTF-8
  w.be32(0xDEAD8888);     // 0x10: unique ID
  w.be32(8);              // 0x14: file version = 8
  // 0x18–0x3f:
  for (let i = 0; i < 10; i++) w.be32(0xFFFFFFFF);
  // 0x40:
  w.be32(textRecCount + 1); // 0x40: first non-book record
  w.be32(fullNameOff);      // 0x44
  w.be32(g_title_len as u32); // 0x48
  w.be32(0x0419);           // 0x4c: locale: Russian
  w.be32(0);                // 0x50: input language
  w.be32(0);                // 0x54: output language
  w.be32(8);                // 0x58: min version = 8
  w.be32(firstImgRel);      // 0x5c: first image record (relative)
  // 0x60:
  w.zeros(16);              // 0x60–0x6f: huff fields
  w.be32(0x40);             // 0x70: EXTH flags
  w.zeros(12);              // 0x74–0x7f: reserved
  w.be32(0xFFFFFFFF);       // 0x80: DRM offset = no DRM
  w.zeros(12);              // 0x84–0x8f: DRM count/size/flags
  w.zeros(8);               // 0x90–0x97: reserved
  // 0x98:
  w.be16(1);                // 0x98: first content record
  w.be16(textRecCount);     // 0x9a: last content record
  w.be32(1);                // 0x9c: unknown
  // 0xa0: FIX — FLIS первый, FCIS второй
  w.be32(flisRel);          // 0xa0: FLIS relative record
  w.be32(1);                // 0xa4: FLIS count
  w.be32(fcisRel);          // 0xa8: FCIS relative record
  w.be32(1);                // 0xac: FCIS count
  w.zeros(8);               // 0xb0–0xb7: reserved
  w.be32(0);                // 0xb8: extra record data
  w.be32(0xFFFFFFFF);       // 0xbc: SKEL INDX = none
  // 0xc0:
  w.zeros(32);              // 0xc0–0xdf: 8 × unknown u32 fields
  // FIX: NCX до extra_data_flags (по KindleUnpack offset map)
  w.be32(0xFFFFFFFF);       // 0xe0: NCX INDX = none
  w.be32(0);                // 0xe4: extra_data_flags = 0
  // KF8 extended fields (KindleUnpack 0xe8):
  w.be32(fdstRel);          // 0xe8: FDST record (relative index)
  w.be32(1);                // 0xec: FDST count = 1 flow
  w.be32(0xFFFFFFFF);       // 0xf0: FRAG INDX = none
  w.be32(0xFFFFFFFF);       // 0xf4: GUIDE INDX = none
  w.zeros(16);              // 0xf8–0x107: reserved
  // от 0x00 до 0x107 включительно = 264 байта = MOBI_LEN ✓

  // EXTH
  w.raw(exth.ptr, exth.pos);

  // Full title
  w.raw(g_title_ptr, g_title_len);
  w.pad4();
  return w;
}

// ── FDST record ───────────────────────────────────────────────────────────────

function buildFDST(): Writer {
  const w = new Writer(20);
  w.u8(70); w.u8(68); w.u8(83); w.u8(84); // 'FDST'
  w.be32(12);                               // offset to section data
  w.be32(1);                                // 1 flow section
  w.be32(0);                                // flow 0 start = 0
  w.be32(g_html_len as u32);               // flow 0 end = html length
  return w;
}

// ── FLIS record ───────────────────────────────────────────────────────────────

function buildFLIS(): Writer {
  const w = new Writer(36);
  w.u8(70); w.u8(76); w.u8(73); w.u8(83); // 'FLIS'
  w.be32(8); w.be16(65); w.be16(0); w.be32(0); w.be32(0xFFFFFFFF);
  w.be16(1); w.be16(3);  w.be32(3); w.be32(1); w.be32(3);
  return w;
}

// ── FCIS record ───────────────────────────────────────────────────────────────

function buildFCIS(textLen: u32): Writer {
  const w = new Writer(44);
  w.u8(70); w.u8(67); w.u8(73); w.u8(83); // 'FCIS'
  w.be32(20); w.be32(16); w.be32(1);
  w.be32(textLen);
  w.be32(0); w.be32(32); w.be32(8);
  w.be32(0xFFFFFFFF);
  w.be16(1); w.be16(1);
  w.be32(8);
  return w;
}

// ── PalmDB container ──────────────────────────────────────────────────────────

function buildPalmDB(): void {
  const N = g_rec_count;
  const HEADER_SIZE: usize  = 78;
  const ENTRY_SIZE : usize  = 8;

  const now: u32 = 0; // детерминированно; Kindle не требует точного времени

  // Вычисляем смещения записей
  const data_start: usize = HEADER_SIZE + (N as usize) * ENTRY_SIZE + 2;
  const offsets_ptr = __alloc((N as usize) * 4);
  let cursor: usize = data_start;
  for (let i = 0; i < N; i++) {
    store<u32>(offsets_ptr + (i as usize) * 4, cursor as u32);
    cursor += g_rec_lens[i];
  }

  const buf = new Writer(cursor + 16);
  buf.pos = 0;

  // ── PalmDB fixed header (78 bytes) ────────────────────────────────────
  const name_len = g_title_len < 31 ? g_title_len : 31;
  buf.raw(g_title_ptr, name_len);
  buf.zeros(32 - name_len); // pad до 32 байт (incl. NUL)

  buf.be16(0);           // attributes
  buf.be16(0);           // version
  buf.be32(now);         // creation time
  buf.be32(now);         // modification time
  buf.be32(0);           // last backup
  buf.be32(0);           // modification number
  buf.be32(0);           // app info offset
  buf.be32(0);           // sort info offset
  buf.u8(66); buf.u8(79); buf.u8(79); buf.u8(75); // type    'BOOK'
  buf.u8(77); buf.u8(79); buf.u8(66); buf.u8(73); // creator 'MOBI'
  buf.be32(0x12345678);  // unique ID seed
  buf.be32(0);           // next record list
  buf.be16(N as u32);    // number of records

  // ── Record list (8 bytes × N) ─────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const off = load<u32>(offsets_ptr + (i as usize) * 4);
    buf.be32(off);                             // offset (big-endian)
    buf.u8(0);                                 // attributes
    buf.u8(((i >> 16) & 0xFF) as u32);
    buf.u8(((i >>  8) & 0xFF) as u32);
    buf.u8((i         & 0xFF) as u32);
  }

  // 2-byte gap
  buf.be16(0);

  // ── Record data ───────────────────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    buf.raw(g_rec_ptrs[i], g_rec_lens[i]);
  }

  g_result_ptr = buf.ptr;
  g_result_len = buf.pos;
}

// ── Main build orchestrator ───────────────────────────────────────────────────

function _build(): void {
  g_rec_count = 0;

  // ── Record counts ──────────────────────────────────────────────────────
  const T: i32 = ((g_html_len + CHUNK - 1) / CHUNK) as i32; // KF8 text records
  const I: i32 = g_img_count;

  // ── Absolute record indices ────────────────────────────────────────────
  const ABS_MOBI6_R0   : u32 = 0;
  const ABS_MOBI6_CNT  : u32 = 1;
  const ABS_MOBI6_FLIS : u32 = 2;  // запись 2 = FLIS
  const ABS_MOBI6_FCIS : u32 = 3;  // запись 3 = FCIS
  const ABS_KF8_R0     : u32 = 4;
  // KF8 text: 5 … 5+T-1  →  relative 1 … T
  // KF8 img : 5+T … 5+T+I-1  →  relative T+1 … T+I
  // FDST    : 5+T+I      →  relative T+I+1
  // FLIS    : 5+T+I+1    →  relative T+I+2  ← FLIS
  // FCIS    : 5+T+I+2    →  relative T+I+3  ← FCIS
  // EOF     : 5+T+I+3    →  relative T+I+4

  const kf8_fdst_rel: u32 = (T + I + 1) as u32;
  const kf8_flis_rel: u32 = (T + I + 2) as u32;  // FLIS
  const kf8_fcis_rel: u32 = (T + I + 3) as u32;  // FCIS

  // ── MOBI6 records ─────────────────────────────────────────────────────

  const fb_len = FALLBACK.length as u32;
  // FIX: передаём FLIS первым, FCIS вторым (порядок параметров изменён)
  const m6_r0 = buildMobi6Record0(ABS_KF8_R0, fb_len, 1, ABS_MOBI6_FLIS, ABS_MOBI6_FCIS);
  g_rec_ptrs[g_rec_count] = m6_r0.ptr;
  g_rec_lens[g_rec_count] = m6_r0.pos;
  g_rec_count++;

  // MOBI6 content record: fallback HTML
  const m6_cnt = new Writer(FALLBACK.length as usize + 8);
  m6_cnt.staticBytes(FALLBACK);
  g_rec_ptrs[g_rec_count] = m6_cnt.ptr;
  g_rec_lens[g_rec_count] = m6_cnt.pos;
  g_rec_count++;

  // MOBI6 FLIS (record 2 = ABS_MOBI6_FLIS)
  const m6_flis = buildFLIS();
  g_rec_ptrs[g_rec_count] = m6_flis.ptr;
  g_rec_lens[g_rec_count] = m6_flis.pos;
  g_rec_count++;

  // MOBI6 FCIS (record 3 = ABS_MOBI6_FCIS)
  const m6_fcis = buildFCIS(fb_len);
  g_rec_ptrs[g_rec_count] = m6_fcis.ptr;
  g_rec_lens[g_rec_count] = m6_fcis.pos;
  g_rec_count++;

  // ── KF8 header record (record 4) ──────────────────────────────────────
  // FIX: передаём kf8_flis_rel первым, kf8_fcis_rel вторым
  const kf8_r0 = buildKf8Record0(T as u32, I as u32, kf8_fdst_rel, kf8_flis_rel, kf8_fcis_rel);
  g_rec_ptrs[g_rec_count] = kf8_r0.ptr;
  g_rec_lens[g_rec_count] = kf8_r0.pos;
  g_rec_count++;

  // ── KF8 text records (records 5 … 5+T-1) ─────────────────────────────
  for (let i = 0; i < T; i++) {
    const off  = (i as usize) * CHUNK;
    const remaining = g_html_len - off;
    const len  = remaining < CHUNK ? remaining : CHUNK;
    g_rec_ptrs[g_rec_count] = g_html_ptr + off;
    g_rec_lens[g_rec_count] = len;
    g_rec_count++;
  }

  // ── Image records ─────────────────────────────────────────────────────
  for (let i = 0; i < I; i++) {
    g_rec_ptrs[g_rec_count] = g_img_ptrs[i];
    g_rec_lens[g_rec_count] = g_img_lens[i];
    g_rec_count++;
  }

  // ── FDST record ───────────────────────────────────────────────────────
  const fdst = buildFDST();
  g_rec_ptrs[g_rec_count] = fdst.ptr;
  g_rec_lens[g_rec_count] = fdst.pos;
  g_rec_count++;

  // ── KF8 FLIS (relative T+I+2) ─────────────────────────────────────────
  const kf8_flis = buildFLIS();
  g_rec_ptrs[g_rec_count] = kf8_flis.ptr;
  g_rec_lens[g_rec_count] = kf8_flis.pos;
  g_rec_count++;

  // ── KF8 FCIS (relative T+I+3) ─────────────────────────────────────────
  const kf8_fcis = buildFCIS(g_html_len as u32);
  g_rec_ptrs[g_rec_count] = kf8_fcis.ptr;
  g_rec_lens[g_rec_count] = kf8_fcis.pos;
  g_rec_count++;

  // ── EOF marker ────────────────────────────────────────────────────────
  const eof_rec = new Writer(4);
  eof_rec.u8(0xe9); eof_rec.u8(0x8e); eof_rec.u8(0x0d); eof_rec.u8(0x0a);
  g_rec_ptrs[g_rec_count] = eof_rec.ptr;
  g_rec_lens[g_rec_count] = eof_rec.pos;
  g_rec_count++;

  // ── Assemble PalmDB ───────────────────────────────────────────────────
  buildPalmDB();
}