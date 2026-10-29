/**
 * The plugin's ZIP, written and read here so the same files always make the
 * same bytes: entries stored (not compressed), in the order given, each
 * dated 1 January 1980, the earliest date a ZIP holds. Reading takes only
 * such a ZIP, as the previous release's package is one.
 */
import { crc32 } from 'node:zlib';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_SIZE = 22;
const VERSION_NEEDED = 20;
/** General purpose flag bit 11: names are UTF-8. */
const UTF8_NAMES = 0x0800;
const STORED = 0;
/** 1 January 1980 in MS-DOS date format: day 1, month 1, year 0 from 1980. */
const DOS_DATE = (1 << 5) | 1;

/** The ZIP of the files given, by their path inside it. */
export function writeZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = new TextEncoder().encode(path);
    const checksum = crc32(data);
    const local = new Uint8Array(LOCAL_HEADER_SIZE + name.length + data.length);
    const at = new DataView(local.buffer);
    at.setUint32(0, LOCAL_HEADER, true);
    at.setUint16(4, VERSION_NEEDED, true);
    at.setUint16(6, UTF8_NAMES, true);
    at.setUint16(8, STORED, true);
    at.setUint16(12, DOS_DATE, true);
    at.setUint32(14, checksum, true);
    at.setUint32(18, data.length, true);
    at.setUint32(22, data.length, true);
    at.setUint16(26, name.length, true);
    local.set(name, LOCAL_HEADER_SIZE);
    local.set(data, LOCAL_HEADER_SIZE + name.length);
    const central = new Uint8Array(CENTRAL_HEADER_SIZE + name.length);
    const entry = new DataView(central.buffer);
    entry.setUint32(0, CENTRAL_HEADER, true);
    entry.setUint16(4, VERSION_NEEDED, true);
    entry.setUint16(6, VERSION_NEEDED, true);
    entry.setUint16(8, UTF8_NAMES, true);
    entry.setUint16(10, STORED, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, checksum, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.set(name, CENTRAL_HEADER_SIZE);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, central) => sum + central.length, 0);
  const end = new Uint8Array(END_SIZE);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  tail.setUint16(8, files.size, true);
  tail.setUint16(10, files.size, true);
  tail.setUint32(12, centralSize, true);
  tail.setUint32(16, offset, true);
  const zip = new Uint8Array(offset + centralSize + END_SIZE);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    zip.set(part, at);
    at += part.length;
  }
  return zip;
}

/** The files of a ZIP this module wrote, by their path inside it; throws on any other. */
export function readZip(zip: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endAt = zip.length - END_SIZE;
  if (endAt < 0 || view.getUint32(endAt, true) !== END_OF_CENTRAL_DIRECTORY) {
    throw new Error('Not a ZIP with no comment');
  }
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER || view.getUint16(at + 10, true) !== STORED) {
      throw new Error('Not a ZIP of stored entries');
    }
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLength));
    const dataAt = localAt + LOCAL_HEADER_SIZE + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    files.set(name, zip.slice(dataAt, dataAt + size));
    at += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }
  return files;
}
