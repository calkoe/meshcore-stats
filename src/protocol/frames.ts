/**
 * Frame-Parser (Geraet -> App).
 *
 * Jede BLE-Notification ist genau ein Frame; das erste Byte ist der Code.
 * Die Byte-Layouts stammen aus MyMesh.cpp und sind dort jeweils vermerkt.
 */

import { PUB_KEY_SIZE, PUSH, RESP, TXT_TYPE } from './constants';
import { readStr, readTail, toHex } from './hex';
import { decodePathField, parseRawPacket, pathFieldByteLength, type RawPacket } from './packet';

export interface SelfInfoFrame {
  code: typeof RESP.SELF_INFO;
  name: 'self_info';
  advType: number;
  txPower: number;
  maxTxPower: number;
  publicKey: string;
  lat: number;
  lon: number;
  multiAcks: number;
  advertLocPolicy: number;
  telemetryMode: number;
  manualAddContacts: number;
  freqMHz: number;
  bwKHz: number;
  sf: number;
  cr: number;
  nodeName: string;
}

export interface DeviceInfoFrame {
  code: typeof RESP.DEVICE_INFO;
  name: 'device_info';
  firmwareVerCode: number;
  maxContacts: number;
  maxChannels: number;
  blePin: number;
  buildDate: string;
  manufacturer: string;
  firmwareVersion: string;
  repeaterEnabled: boolean | null;
  pathHashMode: number;
}

export interface ContactFrame {
  code: number;
  name: 'contact' | 'new_advert';
  isNew: boolean;
  publicKey: string;
  type: number;
  flags: number;
  outPathLen: number;
  outPath: string[];
  advName: string;
  lastAdvert: number;
  lat: number;
  lon: number;
  lastMod: number;
}

export interface LogRxDataFrame {
  code: typeof PUSH.LOG_RX_DATA;
  name: 'log_rx_data';
  snr: number;
  rssi: number;
  packet: RawPacket;
}

export interface TraceDataFrame {
  code: typeof PUSH.TRACE_DATA;
  name: 'trace_data';
  tag: number;
  authCode: number;
  flags: number;
  hops: string[];
  snrs: number[];
  finalSnr: number | null;
}

export interface ContactMsgFrame {
  code: number;
  name: 'contact_msg';
  isChannel: false;
  snr: number | null;
  publicKeyPrefix: string;
  pathLen: number | null;
  viaFlood: boolean;
  txtType: number;
  senderTimestamp: number;
  text: string;
}

export interface ChannelMsgFrame {
  code: number;
  name: 'channel_msg';
  isChannel: true;
  snr: number | null;
  channelIdx: number;
  pathLen: number | null;
  viaFlood: boolean;
  txtType: number;
  senderTimestamp: number;
  senderName: string;
  text: string;
}

export type AnyMsgFrame = ContactMsgFrame | ChannelMsgFrame;

export interface PathDiscoveryFrame {
  code: typeof PUSH.PATH_DISCOVERY_RESPONSE;
  name: 'path_discovery';
  publicKeyPrefix: string;
  outPath: string[];
  inPath: string[];
}

export interface LoginResultFrame {
  code: typeof PUSH.LOGIN_SUCCESS | typeof PUSH.LOGIN_FAIL;
  name: 'login_success' | 'login_fail';
  ok: boolean;
  permissions: number;
  publicKeyPrefix: string;
  serverTimestamp: number | null;
  aclPermissions: number | null;
  firmwareLevel: number | null;
}

export interface BattStorageFrame {
  code: typeof RESP.BATT_AND_STORAGE;
  name: 'batt_and_storage';
  batteryMilliVolts: number;
  storageUsedKb: number;
  storageTotalKb: number;
}

export interface TuningParamsFrame {
  code: typeof RESP.TUNING_PARAMS;
  name: 'tuning_params';
  rxDelayBase: number;
  airtimeFactor: number;
}

export interface ChannelInfoFrame {
  code: typeof RESP.CHANNEL_INFO;
  name: 'channel_info';
  index: number;
  channelName: string;
  /** 128-Bit-Schluessel als Hex. Ein leerer Name bedeutet: Platz unbenutzt. */
  secret: string;
}

export interface SentFrame {
  code: typeof RESP.SENT;
  name: 'sent';
  isFlood: boolean;
  tag: number | null;
  estTimeoutMs: number | null;
}

export interface SimpleFrame {
  code: number;
  name:
    | 'ok'
    | 'err'
    | 'disabled'
    | 'contacts_start'
    | 'end_of_contacts'
    | 'no_more_messages'
    | 'msg_waiting'
    | 'advert'
    | 'path_updated'
    | 'curr_time'
    | 'send_confirmed'
    | 'unhandled';
  errCode?: number;
  count?: number;
  publicKey?: string;
  epochSec?: number;
  ack?: number;
  tripTimeMs?: number;
  length?: number;
}

export type Frame =
  | SelfInfoFrame
  | DeviceInfoFrame
  | ContactFrame
  | LogRxDataFrame
  | TraceDataFrame
  | ContactMsgFrame
  | ChannelMsgFrame
  | PathDiscoveryFrame
  | LoginResultFrame
  | ChannelInfoFrame
  | BattStorageFrame
  | TuningParamsFrame
  | SentFrame
  | SimpleFrame;

/** Zerlegt ein einzelnes BLE-Frame. `null`, wenn es zu kurz oder unbrauchbar ist. */
export function parseFrame(bytes: Uint8Array): Frame | null {
  if (!bytes || bytes.length < 1) return null;
  const code = bytes[0];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  switch (code) {
    case RESP.SELF_INFO:
      return parseSelfInfo(bytes, dv);

    case RESP.DEVICE_INFO:
      return parseDeviceInfo(bytes, dv);

    case RESP.CONTACTS_START:
      return bytes.length >= 5
        ? { code, name: 'contacts_start', count: dv.getUint32(1, true) }
        : { code, name: 'contacts_start', count: 0 };

    case RESP.CONTACT:
    case PUSH.NEW_ADVERT:
      return parseContact(bytes, dv, code === PUSH.NEW_ADVERT);

    case RESP.END_OF_CONTACTS:
      return { code, name: 'end_of_contacts' };

    case RESP.CONTACT_MSG_RECV:
    case RESP.CONTACT_MSG_RECV_V3:
      return parseContactMsg(bytes, dv, code === RESP.CONTACT_MSG_RECV_V3);

    case RESP.CHANNEL_MSG_RECV:
    case RESP.CHANNEL_MSG_RECV_V3:
      return parseChannelMsg(bytes, dv, code === RESP.CHANNEL_MSG_RECV_V3);

    case RESP.NO_MORE_MESSAGES:
      return { code, name: 'no_more_messages' };

    case RESP.CHANNEL_INFO:
      // [18][idx][name 32][secret 16] - siehe CMD_GET_CHANNEL in MyMesh.cpp.
      return bytes.length >= 50
        ? {
            code: RESP.CHANNEL_INFO,
            name: 'channel_info',
            index: bytes[1],
            channelName: readStr(bytes, 2, 32),
            secret: toHex(bytes.subarray(34, 50)),
          }
        : null;

    case RESP.BATT_AND_STORAGE:
      return bytes.length >= 11
        ? {
            code: RESP.BATT_AND_STORAGE,
            name: 'batt_and_storage',
            batteryMilliVolts: dv.getUint16(1, true),
            storageUsedKb: dv.getUint32(3, true),
            storageTotalKb: dv.getUint32(7, true),
          }
        : null;

    case RESP.TUNING_PARAMS:
      return bytes.length >= 9
        ? {
            code: RESP.TUNING_PARAMS,
            name: 'tuning_params',
            // Die Firmware sendet Millisekunden bzw. Tausendstel.
            rxDelayBase: dv.getUint32(1, true) / 1000,
            airtimeFactor: dv.getUint32(5, true) / 1000,
          }
        : null;

    case PUSH.LOG_RX_DATA:
      return parseLogRxData(bytes);

    case PUSH.ADVERT:
      // Bekannter Kontakt hat erneut advertised - nur der Public Key.
      return bytes.length >= 1 + PUB_KEY_SIZE
        ? { code, name: 'advert', publicKey: toHex(bytes.subarray(1, 1 + PUB_KEY_SIZE)) }
        : null;

    case PUSH.PATH_UPDATED:
      return bytes.length >= 1 + PUB_KEY_SIZE
        ? { code, name: 'path_updated', publicKey: toHex(bytes.subarray(1, 1 + PUB_KEY_SIZE)) }
        : null;

    case PUSH.TRACE_DATA:
      return parseTraceData(bytes, dv);

    case PUSH.PATH_DISCOVERY_RESPONSE:
      return parsePathDiscovery(bytes);

    case PUSH.LOGIN_SUCCESS:
    case PUSH.LOGIN_FAIL:
      return parseLoginResult(bytes, dv, code === PUSH.LOGIN_SUCCESS);

    case RESP.SENT:
      // [6][flags][tag u32][est_timeout u32] - flags: 1 = als Flood gesendet
      return bytes.length >= 10
        ? {
            code: RESP.SENT,
            name: 'sent',
            isFlood: bytes[1] === 1,
            tag: dv.getUint32(2, true),
            estTimeoutMs: dv.getUint32(6, true),
          }
        : { code: RESP.SENT, name: 'sent', isFlood: false, tag: null, estTimeoutMs: null };

    case RESP.CURR_TIME:
      return bytes.length >= 5 ? { code, name: 'curr_time', epochSec: dv.getUint32(1, true) } : null;

    case PUSH.MSG_WAITING:
      return { code, name: 'msg_waiting' };

    case PUSH.SEND_CONFIRMED:
      // [0x82][ack u32][trip_time u32]
      return bytes.length >= 9
        ? {
            code,
            name: 'send_confirmed',
            ack: dv.getUint32(1, true),
            tripTimeMs: dv.getUint32(5, true),
          }
        : null;

    case RESP.OK:
      return { code, name: 'ok' };

    case RESP.ERR:
      return { code, name: 'err', errCode: bytes.length > 1 ? bytes[1] : 0 };

    case RESP.DISABLED:
      return { code, name: 'disabled' };

    default:
      return { code, name: 'unhandled', length: bytes.length };
  }
}

/** RESP_CODE_SELF_INFO (5) - Antwort auf CMD_APP_START. */
function parseSelfInfo(bytes: Uint8Array, dv: DataView): SelfInfoFrame | null {
  if (bytes.length < 58) return null;
  return {
    code: RESP.SELF_INFO,
    name: 'self_info',
    advType: bytes[1],
    txPower: dv.getInt8(2),
    maxTxPower: dv.getInt8(3),
    publicKey: toHex(bytes.subarray(4, 4 + PUB_KEY_SIZE)),
    lat: dv.getInt32(36, true) / 1e6,
    lon: dv.getInt32(40, true) / 1e6,
    multiAcks: bytes[44],
    advertLocPolicy: bytes[45],
    telemetryMode: bytes[46],
    manualAddContacts: bytes[47],
    freqMHz: dv.getUint32(48, true) / 1000,
    bwKHz: dv.getUint32(52, true) / 1000,
    sf: bytes[56],
    cr: bytes[57],
    nodeName: readStr(bytes, 58, bytes.length - 58),
  };
}

/** RESP_CODE_DEVICE_INFO (13) - Antwort auf CMD_DEVICE_QUERY. */
function parseDeviceInfo(bytes: Uint8Array, dv: DataView): DeviceInfoFrame | null {
  if (bytes.length < 8) return null;
  return {
    code: RESP.DEVICE_INFO,
    name: 'device_info',
    firmwareVerCode: bytes[1],
    maxContacts: bytes[2] * 2,
    maxChannels: bytes[3],
    blePin: dv.getUint32(4, true),
    buildDate: readStr(bytes, 8, 12),
    manufacturer: bytes.length >= 60 ? readStr(bytes, 20, 40) : '',
    firmwareVersion: bytes.length >= 80 ? readStr(bytes, 60, 20) : '',
    repeaterEnabled: bytes.length >= 81 ? bytes[80] === 1 : null,
    pathHashMode: bytes.length >= 82 ? bytes[81] : 0,
  };
}

/**
 * RESP_CODE_CONTACT (3) / PUSH_CODE_NEW_ADVERT (0x8A).
 * Layout siehe MyMesh::writeContactRespFrame() - insgesamt 148 Bytes.
 */
function parseContact(bytes: Uint8Array, dv: DataView, isNew: boolean): ContactFrame | null {
  if (bytes.length < 148) return null;
  const outPathLenRaw = dv.getInt8(35);
  return {
    code: bytes[0],
    name: isNew ? 'new_advert' : 'contact',
    isNew,
    publicKey: toHex(bytes.subarray(1, 1 + PUB_KEY_SIZE)),
    type: bytes[33],
    flags: bytes[34],
    outPathLen: outPathLenRaw,
    outPath: decodePathField(bytes, 36, outPathLenRaw),
    advName: readStr(bytes, 100, 32),
    lastAdvert: dv.getUint32(132, true),
    lat: dv.getInt32(136, true) / 1e6,
    lon: dv.getInt32(140, true) / 1e6,
    lastMod: dv.getUint32(144, true),
  };
}

/**
 * PUSH_CODE_LOG_RX_DATA (0x88) - wird fuer JEDES empfangene Funkpaket gesendet
 * (Dispatcher::checkRecv ruft logRxRaw() vor dem Parsen auf).
 *
 *   [0] 0x88  [1] int8 SNR*4  [2] int8 RSSI dBm  [3..] rohes Funkpaket
 */
function parseLogRxData(bytes: Uint8Array): LogRxDataFrame | null {
  if (bytes.length < 4) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packet = parseRawPacket(bytes.subarray(3));
  if (!packet) return null;
  return {
    code: PUSH.LOG_RX_DATA,
    name: 'log_rx_data',
    snr: dv.getInt8(1) / 4,
    rssi: dv.getInt8(2),
    packet,
  };
}

/**
 * PUSH_CODE_TRACE_DATA (0x89) - Ergebnis eines Trace, mit SNR pro Hop.
 *
 *   [0] 0x89  [1] reserved  [2] path_len  [3] flags
 *   [4..7] tag u32   [8..11] auth_code u32
 *   [12..] path_hashes[path_len], danach path_snrs, danach finaler SNR
 */
function parseTraceData(bytes: Uint8Array, dv: DataView): TraceDataFrame | null {
  if (bytes.length < 12) return null;
  const pathLen = bytes[2];
  const flags = bytes[3];
  const pathSz = flags & 0x03;
  const hashSize = 1 << pathSz;

  let i = 12;
  const hops: string[] = [];
  for (let n = 0; n < pathLen && i + hashSize <= bytes.length; n++) {
    hops.push(toHex(bytes.subarray(i, i + hashSize)));
    i += hashSize;
  }
  const snrCount = pathLen >> pathSz;
  const snrs: number[] = [];
  for (let n = 0; n < snrCount && i < bytes.length; n++) snrs.push(dv.getInt8(i++) / 4);
  const finalSnr = i < bytes.length ? dv.getInt8(i) / 4 : null;

  return {
    code: PUSH.TRACE_DATA,
    name: 'trace_data',
    tag: dv.getUint32(4, true),
    authCode: dv.getUint32(8, true),
    flags,
    hops,
    snrs,
    finalSnr,
  };
}

/**
 * RESP_CODE_CONTACT_MSG_RECV (7) bzw. _V3 (16), siehe MyMesh::queueMessage().
 *
 *   V3: [16][snr int8 *4][res][res]  danach identisch zu V1:
 *   [pub_key_prefix 6][path_len][txt_type][sender_timestamp u32]
 *   [extra 4 - nur bei txt_type == SIGNED_PLAIN][text ...]
 *
 * path_len == 0xFF bedeutet: kam ueber eine Direct-Route (kein Flood-Pfad).
 */
function parseContactMsg(bytes: Uint8Array, dv: DataView, isV3: boolean): ContactMsgFrame | null {
  let i = 1;
  let snr: number | null = null;
  if (isV3) {
    snr = dv.getInt8(i) / 4;
    i += 3;
  }
  if (bytes.length < i + 12) return null;

  const publicKeyPrefix = toHex(bytes.subarray(i, i + 6));
  i += 6;
  const pathLenRaw = bytes[i++];
  const txtType = bytes[i++];
  const senderTimestamp = dv.getUint32(i, true);
  i += 4;
  if (txtType === TXT_TYPE.SIGNED_PLAIN) i += 4; // Signatur-Prefix des Absenders

  return {
    code: bytes[0],
    name: 'contact_msg',
    isChannel: false,
    snr,
    publicKeyPrefix,
    pathLen: pathLenRaw === 0xff ? null : pathLenRaw & 63,
    viaFlood: pathLenRaw !== 0xff,
    txtType,
    senderTimestamp,
    text: readTail(bytes, i),
  };
}

/**
 * RESP_CODE_CHANNEL_MSG_RECV (8) bzw. _V3 (17).
 *   V3: [17][snr][res][res] dann [channel_idx][path_len][txt_type][timestamp u32][text]
 * Der Text hat bei Kanalnachrichten die Form "Absender: Nachricht".
 */
function parseChannelMsg(bytes: Uint8Array, dv: DataView, isV3: boolean): ChannelMsgFrame | null {
  let i = 1;
  let snr: number | null = null;
  if (isV3) {
    snr = dv.getInt8(i) / 4;
    i += 3;
  }
  if (bytes.length < i + 7) return null;

  const channelIdx = bytes[i++];
  const pathLenRaw = bytes[i++];
  const txtType = bytes[i++];
  const timestamp = dv.getUint32(i, true);
  i += 4;
  const raw = readTail(bytes, i);
  const sep = raw.indexOf(': ');

  return {
    code: bytes[0],
    name: 'channel_msg',
    isChannel: true,
    snr,
    channelIdx,
    pathLen: pathLenRaw === 0xff ? null : pathLenRaw & 63,
    viaFlood: pathLenRaw !== 0xff,
    txtType,
    senderTimestamp: timestamp,
    senderName: sep > 0 ? raw.slice(0, sep) : '',
    text: sep > 0 ? raw.slice(sep + 2) : raw,
  };
}

/**
 * PUSH_CODE_PATH_DISCOVERY_RESPONSE (0x8D), siehe MyMesh::onContactPathRecv().
 *
 *   [0] 0x8D  [1] reserved  [2..7] pub_key_prefix (6)
 *   [8] out_path_len   danach out_path
 *   [..] in_path_len   danach in_path
 *
 * Liefert beide Richtungen - der Rueckweg kann sich vom Hinweg unterscheiden.
 */
function parsePathDiscovery(bytes: Uint8Array): PathDiscoveryFrame | null {
  if (bytes.length < 10) return null;
  let i = 2;
  const publicKeyPrefix = toHex(bytes.subarray(i, i + 6));
  i += 6;

  const outLen = new Int8Array([bytes[i++]])[0];
  const outPath = decodePathField(bytes, i, outLen);
  i += pathFieldByteLength(outLen);

  let inPath: string[] = [];
  if (i < bytes.length) {
    const inLen = new Int8Array([bytes[i++]])[0];
    inPath = decodePathField(bytes, i, inLen);
  }

  return { code: PUSH.PATH_DISCOVERY_RESPONSE, name: 'path_discovery', publicKeyPrefix, outPath, inPath };
}

/**
 * PUSH_CODE_LOGIN_SUCCESS (0x85) / PUSH_CODE_LOGIN_FAIL (0x86),
 * siehe MyMesh::onContactResponse().
 *
 *   [0] code  [1] permissions  [2..7] pub_key_prefix (6)
 *   danach nur bei der neuen Server-Antwort: [tag u32][acl][fw_level]
 */
function parseLoginResult(bytes: Uint8Array, dv: DataView, ok: boolean): LoginResultFrame | null {
  if (bytes.length < 8) return null;
  return {
    code: ok ? PUSH.LOGIN_SUCCESS : PUSH.LOGIN_FAIL,
    name: ok ? 'login_success' : 'login_fail',
    ok,
    permissions: bytes[1],
    publicKeyPrefix: toHex(bytes.subarray(2, 8)),
    serverTimestamp: bytes.length >= 12 ? dv.getUint32(8, true) : null,
    aclPermissions: bytes.length >= 13 ? bytes[12] : null,
    firmwareLevel: bytes.length >= 14 ? bytes[13] : null,
  };
}
