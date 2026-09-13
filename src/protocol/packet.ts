/**
 * Roh-Funkpaket (Wireformat) - das, was PUSH_CODE_LOG_RX_DATA mitliefert.
 *
 * Layout wie in Dispatcher::tryParsePacket():
 *   [0]   header:  Bit0-1 Route-Typ, Bit2-5 Payload-Typ, Bit6-7 Payload-Version
 *   [1-4] transport codes (2x u16 LE) - nur bei Route-Typ 0x00 / 0x03
 *   [n]   path_len-Byte: untere 6 Bit = Hash-Anzahl, obere 2 Bit = Hash-Groesse-1
 *   [..]  Pfad-Hashes
 *   [..]  Payload (Rest)
 */

import {
  ADV_FEAT1_MASK,
  ADV_FEAT2_MASK,
  ADV_LATLON_MASK,
  ADV_NAME_MASK,
  MAX_PATH_SIZE,
  PAYLOAD_TYPE,
  PUB_KEY_SIZE,
  ROUTE_TYPE,
  SIGNATURE_SIZE,
} from './constants';
import { readTail, toHex } from './hex';

export interface AdvertPayload {
  publicKey: string;
  /** Zeitstempel, den der Knoten SELBST in sein Advert schreibt. */
  timestamp: number;
  type: number;
  flags: number;
  lat: number | null;
  lon: number | null;
  advName: string;
}

export interface TracePayload {
  tag: number;
  authCode: number;
  flags: number;
  hops: string[];
  snrs: number[];
}

export interface RawPacket {
  header: number;
  routeType: number;
  payloadType: number;
  payloadVer: number;
  transportCodes: [number, number] | null;
  hashSize: number;
  /** Bei Flood: bereits durchlaufene Repeater. Bei Direct: verbleibende Route. */
  path: string[];
  /** Roh - bei TRACE stehen hier SNR-Werte, keine Hashes. */
  pathBytes: Uint8Array;
  payload: Uint8Array;
  rawLength: number;
  isFlood: boolean;
  isDirect: boolean;
  trace: TracePayload | null;
  originHash: string | null;
  destHash: string | null;
  advert: AdvertPayload | null;
}

export function parseRawPacket(raw: Uint8Array): RawPacket | null {
  if (!raw || raw.length < 2) return null;
  let i = 0;
  const header = raw[i++];
  const routeType = header & 0x03;
  const payloadType = (header >> 2) & 0x0f;
  const payloadVer = (header >> 6) & 0x03;

  // Ein Repeater markiert lokal verworfene Pakete mit header = 0xFF.
  if (header === 0xff) return null;

  // Wichtig: logRxRaw() protokolliert JEDES Funksignal, das der Demodulator
  // ausgibt - also auch Rauschen und korrupte Pakete, noch bevor die Firmware
  // sie prueft. Wir verwerfen dieselben Pakete wie tryParsePacket(), sonst
  // wandern Phantom-Knoten und Phantom-Hops in die Topologie.
  if (payloadVer > 0) return null;

  const hasTransportCodes =
    routeType === ROUTE_TYPE.TRANSPORT_FLOOD || routeType === ROUTE_TYPE.TRANSPORT_DIRECT;
  let transportCodes: [number, number] | null = null;
  if (hasTransportCodes) {
    if (i + 4 > raw.length) return null;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    transportCodes = [dv.getUint16(i, true), dv.getUint16(i + 2, true)];
    i += 4;
  }

  if (i >= raw.length) return null;
  const pathLenByte = raw[i++];
  const pathMode = pathLenByte >> 6;
  if (pathMode === 3) return null; // reserviert
  const hashCount = pathLenByte & 63;
  const hashSize = pathMode + 1;
  const pathByteLen = hashCount * hashSize;
  if (pathByteLen > MAX_PATH_SIZE || i + pathByteLen > raw.length) return null;

  const pathBytes = raw.subarray(i, i + pathByteLen);
  i += pathByteLen;
  const payload = raw.subarray(i);

  const path: string[] = [];
  for (let n = 0; n < hashCount; n++) {
    path.push(toHex(pathBytes.subarray(n * hashSize, (n + 1) * hashSize)));
  }

  const isFlood = routeType === ROUTE_TYPE.FLOOD || routeType === ROUTE_TYPE.TRANSPORT_FLOOD;

  const pkt: RawPacket = {
    header,
    routeType,
    payloadType,
    payloadVer,
    transportCodes,
    hashSize,
    path,
    pathBytes,
    payload,
    rawLength: raw.length,
    isFlood,
    isDirect: !isFlood,
    trace: null,
    originHash: null,
    destHash: null,
    advert: null,
  };

  // Sonderfall TRACE (nur direct): das Pfad-Feld enthaelt gesammelte SNR-Werte,
  // die eigentliche Hash-Liste steht im Payload hinter tag/auth/flags.
  if (pkt.isDirect && payloadType === PAYLOAD_TYPE.TRACE) {
    pkt.trace = parseTracePayload(pkt);
  }

  pkt.originHash = deriveOriginHash(pkt);
  pkt.destHash = deriveDestHash(pkt);
  if (payloadType === PAYLOAD_TYPE.ADVERT) pkt.advert = parseAdvertPayload(payload);

  return pkt;
}

function parseTracePayload(pkt: RawPacket): TracePayload | null {
  const p = pkt.payload;
  if (p.length < 9) return null;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const flags = p[8];
  const pathSz = flags & 0x03;
  const hashSize = 1 << pathSz;
  const hops: string[] = [];
  for (let i = 9; i + hashSize <= p.length; i += hashSize) {
    hops.push(toHex(p.subarray(i, i + hashSize)));
  }
  // Das Pfad-Feld des Pakets enthaelt hier die bisher gesammelten SNRs.
  const snrs: number[] = [];
  const pv = new DataView(pkt.pathBytes.buffer, pkt.pathBytes.byteOffset, pkt.pathBytes.byteLength);
  for (let i = 0; i < pkt.pathBytes.length; i++) snrs.push(pv.getInt8(i) / 4);
  return { tag: dv.getUint32(0, true), authCode: dv.getUint32(4, true), flags, hops, snrs };
}

/**
 * Hash des Urhebers, soweit aus dem Payload ableitbar.
 * Layout-Kommentare siehe Packet.h (PAYLOAD_VER_1: 1-Byte-Hashes, 2-Byte-MAC).
 */
function deriveOriginHash(pkt: RawPacket): string | null {
  const p = pkt.payload;
  switch (pkt.payloadType) {
    case PAYLOAD_TYPE.REQ:
    case PAYLOAD_TYPE.RESPONSE:
    case PAYLOAD_TYPE.TXT_MSG:
    case PAYLOAD_TYPE.PATH:
      // dest_hash, src_hash, MAC...
      return p.length >= 2 ? toHex(p.subarray(1, 2)) : null;
    case PAYLOAD_TYPE.ADVERT:
      // Der Public Key des Werbenden steht am Anfang; der Path-Hash ist sein Prefix.
      return p.length >= 1 ? toHex(p.subarray(0, 1)) : null;
    default:
      // ACK, Gruppennachrichten, ANON_REQ, CONTROL, RAW: kein Absender-Hash im Klartext.
      return null;
  }
}

function deriveDestHash(pkt: RawPacket): string | null {
  const p = pkt.payload;
  switch (pkt.payloadType) {
    case PAYLOAD_TYPE.REQ:
    case PAYLOAD_TYPE.RESPONSE:
    case PAYLOAD_TYPE.TXT_MSG:
    case PAYLOAD_TYPE.PATH:
    case PAYLOAD_TYPE.ANON_REQ:
      return p.length >= 1 ? toHex(p.subarray(0, 1)) : null;
    default:
      return null;
  }
}

/**
 * Advert-Payload: pub_key(32) + timestamp(4) + signature(64) + app_data.
 * app_data siehe AdvertDataParser: flags-Byte, optional lat/lon, feat1/2, Name.
 *
 * Hinweis: Die Ed25519-Signatur wird hier NICHT geprueft (die Firmware tut das
 * bereits fuer alles, was sie selbst als Kontakt uebernimmt). Adverts aus dem
 * RX-Log sind daher als "ungeprueft" zu behandeln.
 */
export function parseAdvertPayload(payload: Uint8Array): AdvertPayload | null {
  const minLen = PUB_KEY_SIZE + 4 + SIGNATURE_SIZE;
  if (payload.length < minLen + 1) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const publicKey = toHex(payload.subarray(0, PUB_KEY_SIZE));
  const timestamp = dv.getUint32(PUB_KEY_SIZE, true);
  const appData = payload.subarray(minLen);

  const flags = appData[0];
  let i = 1;
  let lat: number | null = null;
  let lon: number | null = null;
  if (flags & ADV_LATLON_MASK) {
    if (i + 8 > appData.length) {
      return { publicKey, timestamp, type: flags & 0x0f, flags, lat, lon, advName: '' };
    }
    const adv = new DataView(appData.buffer, appData.byteOffset, appData.byteLength);
    lat = adv.getInt32(i, true) / 1e6;
    i += 4;
    lon = adv.getInt32(i, true) / 1e6;
    i += 4;
  }
  if (flags & ADV_FEAT1_MASK) i += 2;
  if (flags & ADV_FEAT2_MASK) i += 2;

  let advName = '';
  if (flags & ADV_NAME_MASK && i < appData.length) advName = readTail(appData, i);

  return { publicKey, timestamp, type: flags & 0x0f, flags, lat, lon, advName };
}

/**
 * Dekodiert ein Pfad-Feld eines FRAMES (nicht des Funkpakets). Das Laengenbyte
 * kodiert wie im Paket-Header: untere 6 Bit = Anzahl Hashes, obere 2 Bit =
 * (Hash-Groesse - 1). -1 (0xFF) bedeutet "kein Pfad bekannt" (Flood).
 */
export function decodePathField(bytes: Uint8Array, offset: number, lenByte: number): string[] {
  if (lenByte < 0) return [];
  const count = lenByte & 63;
  const size = (lenByte >> 6) + 1;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = offset + i * size;
    if (start + size > bytes.length || start + size > offset + MAX_PATH_SIZE) break;
    out.push(toHex(bytes.subarray(start, start + size)));
  }
  return out;
}

/** Anzahl Bytes, die ein Pfad-Feld mit diesem Laengenbyte belegt. */
export function pathFieldByteLength(lenByte: number): number {
  return lenByte > 0 ? (lenByte & 63) * ((lenByte >> 6) + 1) : 0;
}
