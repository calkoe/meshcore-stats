/** Byte-/Hex-Umwandlungen und String-Lesen. Ohne Abhaengigkeiten, damit die
 *  Protokollschicht in Tests ohne DOM laeuft. */

const utf8 = new TextDecoder('utf-8', { fatal: false });

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new Error(`Hex-Länge ungerade: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`Kein Hex: ${hex}`);
    out[i] = byte;
  }
  return out;
}

/** Liest einen nullterminierten (bzw. laengenbegrenzten) UTF-8 String. */
export function readStr(bytes: Uint8Array, offset: number, maxLen: number): string {
  const end = Math.min(offset + maxLen, bytes.length);
  let stop = end;
  for (let i = offset; i < end; i++) {
    if (bytes[i] === 0) {
      stop = i;
      break;
    }
  }
  return utf8.decode(bytes.subarray(offset, stop));
}

/** Decodiert den Rest als UTF-8 und schneidet Null-Fuellbytes am Ende ab. */
export function readTail(bytes: Uint8Array, offset: number): string {
  return utf8.decode(bytes.subarray(offset)).replace(/\0+$/, '');
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
