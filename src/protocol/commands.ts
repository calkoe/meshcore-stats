/**
 * Kommando-Builder (App -> Geraet).
 *
 * Jede Funktion liefert genau ein Frame. Die Byte-Layouts stehen im Kommentar
 * mit der Fundstelle in MyMesh.cpp; Einheiten sind dort teils ueberraschend
 * (Frequenz in kHz, Bandbreite in Hz) und deshalb hier explizit benannt.
 */

import { CMD, PUB_KEY_SIZE, TXT_TYPE } from './constants';
import { encodeUtf8, fromHex } from './hex';

function frame(code: number, size: number): { out: Uint8Array; dv: DataView } {
  const out = new Uint8Array(size);
  out[0] = code;
  return { out, dv: new DataView(out.buffer) };
}

/** Schreibt einen Public Key (64 Hex-Zeichen) ab `offset`. */
function putPubKey(out: Uint8Array, offset: number, publicKeyHex: string): void {
  const key = fromHex(publicKeyHex);
  if (key.length !== PUB_KEY_SIZE) throw new Error(`Public Key muss ${PUB_KEY_SIZE} Byte haben`);
  out.set(key, offset);
}

/* ---------------- Sitzung ---------------- */

/** CMD_DEVICE_QUERY: [22, app_target_ver] */
export function cmdDeviceQuery(appVer: number): Uint8Array {
  return new Uint8Array([CMD.DEVICE_QUERY, appVer]);
}

/** CMD_APP_START: [1, ver, 6x reserved, app_name...] */
export function cmdAppStart(appName: string, appVer: number): Uint8Array {
  const nameBytes = encodeUtf8(appName);
  const { out } = frame(CMD.APP_START, 8 + nameBytes.length);
  out[1] = appVer;
  out.set(nameBytes, 8);
  return out;
}

/** CMD_GET_CONTACTS: [4] oder [4, since_u32] */
export function cmdGetContacts(since: number | null = null): Uint8Array {
  if (since == null) return new Uint8Array([CMD.GET_CONTACTS]);
  const { out, dv } = frame(CMD.GET_CONTACTS, 5);
  dv.setUint32(1, since, true);
  return out;
}

/** CMD_GET_DEVICE_TIME: [5] */
export function cmdGetDeviceTime(): Uint8Array {
  return new Uint8Array([CMD.GET_DEVICE_TIME]);
}

/** CMD_SYNC_NEXT_MESSAGE: [10] - holt die naechste Nachricht aus der Warteschlange. */
export function cmdSyncNextMessage(): Uint8Array {
  return new Uint8Array([CMD.SYNC_NEXT_MESSAGE]);
}

/** CMD_GET_BATT_AND_STORAGE: [20] */
export function cmdGetBattAndStorage(): Uint8Array {
  return new Uint8Array([CMD.GET_BATT_AND_STORAGE]);
}

/** CMD_GET_TUNING_PARAMS: [43] */
export function cmdGetTuningParams(): Uint8Array {
  return new Uint8Array([CMD.GET_TUNING_PARAMS]);
}

/* ---------------- Messen: Ping und Trace ---------------- */

/**
 * CMD_SEND_TRACE_PATH: [36][tag u32][auth u32][flags][path bytes...]
 *
 * flags Bit0-1 = path_sz, die Hash-Groesse ist 1 << path_sz (also 1, 2 oder 4 -
 * anders als im Paket-Header, wo sie mode+1 ist). Wir nutzen 1-Byte-Hashes.
 *
 * Wichtig: der Pfad muss ein RUNDWEG sein. Ein Knoten haengt sein SNR an, wenn
 * sein Hash an der Position der bisher gesammelten SNR-Anzahl steht; gemeldet
 * wird das Ergebnis von dem Knoten, der das Paket hoert, nachdem alle Hashes
 * abgearbeitet sind. Damit das Ergebnis bei UNS ankommt, muss der Pfad wieder
 * zu uns zurueckfuehren (siehe buildRoundTripPath()).
 */
export function cmdSendTracePath(tag: number, authCode: number, pathHashes: number[]): Uint8Array {
  const { out, dv } = frame(CMD.SEND_TRACE_PATH, 10 + pathHashes.length);
  dv.setUint32(1, tag >>> 0, true);
  dv.setUint32(5, authCode >>> 0, true);
  out[9] = 0; // path_sz = 0 -> 1 Byte je Hash
  out.set(Uint8Array.from(pathHashes), 10);
  return out;
}

/**
 * Baut aus dem Hinweg einen Rundweg fuer den Trace:
 *   [...hops, ziel, ...hops rueckwaerts]
 * Bei einem direkten Nachbarn bleibt nur [ziel] uebrig.
 */
export function buildRoundTripPath(hopBytes: number[], targetByte: number): number[] {
  return [...hopBytes, targetByte, ...[...hopBytes].reverse()];
}

/** CMD_SEND_PATH_DISCOVERY_REQ: [52][0][pub_key 32] - der "Ping". */
export function cmdSendPathDiscovery(publicKeyHex: string): Uint8Array {
  const { out } = frame(CMD.SEND_PATH_DISCOVERY_REQ, 2 + PUB_KEY_SIZE);
  out[1] = 0;
  putPubKey(out, 2, publicKeyHex);
  return out;
}

/* ---------------- Nachrichten ---------------- */

/**
 * CMD_SEND_TXT_MSG: [2][txt_type][attempt][timestamp u32][pub_key_prefix 6][text]
 * Der Zeitstempel ist die Geraetezeit in Sekunden.
 *
 * `txtType` ist TXT_TYPE_PLAIN fuer Chat und TXT_TYPE_CLI_DATA fuer einen
 * Befehl an einen Repeater/Room-Server (das Terminal). Bei CLI_DATA ersetzt die
 * Firmware den Zeitstempel durch ihre eigene RTC-Zeit, um den Replay-Schutz
 * nicht auszuloesen, und erwartet KEIN ACK.
 */
export function cmdSendTextMsg(
  publicKeyHex: string,
  text: string,
  timestampSec: number,
  txtType: number = TXT_TYPE.PLAIN,
  attempt = 0,
): Uint8Array {
  const body = encodeUtf8(text);
  const { out, dv } = frame(CMD.SEND_TXT_MSG, 13 + body.length);
  out[1] = txtType;
  out[2] = attempt;
  dv.setUint32(3, timestampSec >>> 0, true);
  out.set(fromHex(publicKeyHex.slice(0, 12)), 7); // 6-Byte-Prefix des Public Key
  out.set(body, 13);
  return out;
}

/** CMD_SEND_CHANNEL_TXT_MSG: [3][txt_type][channel_idx][timestamp u32][text] */
export function cmdSendChannelTextMsg(
  channelIdx: number,
  text: string,
  timestampSec: number,
): Uint8Array {
  const body = encodeUtf8(text);
  const { out, dv } = frame(CMD.SEND_CHANNEL_TXT_MSG, 7 + body.length);
  out[1] = TXT_TYPE.PLAIN;
  out[2] = channelIdx;
  dv.setUint32(3, timestampSec >>> 0, true);
  out.set(body, 7);
  return out;
}

/* ---------------- Terminal: Anmeldung an einem fremden Knoten ---------------- */

/**
 * CMD_SEND_LOGIN: [26][pub_key 32][passwort...]
 * Antwort: RESP_CODE_SENT, spaeter PUSH_CODE_LOGIN_SUCCESS bzw. _FAIL.
 */
export function cmdSendLogin(publicKeyHex: string, password: string): Uint8Array {
  const pw = encodeUtf8(password);
  const { out } = frame(CMD.SEND_LOGIN, 1 + PUB_KEY_SIZE + pw.length);
  putPubKey(out, 1, publicKeyHex);
  out.set(pw, 1 + PUB_KEY_SIZE);
  return out;
}

/** CMD_LOGOUT: [29][pub_key 32] - beendet die Sitzung zu diesem Knoten. */
export function cmdLogout(publicKeyHex: string): Uint8Array {
  const { out } = frame(CMD.LOGOUT, 1 + PUB_KEY_SIZE);
  putPubKey(out, 1, publicKeyHex);
  return out;
}

/** CMD_HAS_CONNECTION: [28][pub_key 32] - OK, wenn die Sitzung noch steht. */
export function cmdHasConnection(publicKeyHex: string): Uint8Array {
  const { out } = frame(CMD.HAS_CONNECTION, 1 + PUB_KEY_SIZE);
  putPubKey(out, 1, publicKeyHex);
  return out;
}

/* ---------------- Konfiguration des eigenen Geraets ---------------- */

/** CMD_SET_ADVERT_NAME: [8][name...] - max. 31 Zeichen, die Firmware kuerzt. */
export function cmdSetAdvertName(name: string): Uint8Array {
  const body = encodeUtf8(name).subarray(0, 31);
  const { out } = frame(CMD.SET_ADVERT_NAME, 1 + body.length);
  out.set(body, 1);
  return out;
}

/**
 * CMD_SET_ADVERT_LATLON: [14][lat i32][lon i32]
 * Beide Werte in Millionstel Grad. Die Firmware lehnt Werte ausserhalb
 * +/-90 bzw. +/-180 Grad mit ERR_CODE_ILLEGAL_ARG ab.
 */
export function cmdSetAdvertLatLon(lat: number, lon: number): Uint8Array {
  const { out, dv } = frame(CMD.SET_ADVERT_LATLON, 9);
  dv.setInt32(1, Math.round(lat * 1e6), true);
  dv.setInt32(5, Math.round(lon * 1e6), true);
  return out;
}

/**
 * CMD_SET_DEVICE_TIME: [6][sekunden u32]
 * Die Firmware nimmt nur Zeiten an, die NICHT vor ihrer aktuellen liegen.
 */
export function cmdSetDeviceTime(epochSec: number): Uint8Array {
  const { out, dv } = frame(CMD.SET_DEVICE_TIME, 5);
  dv.setUint32(1, epochSec >>> 0, true);
  return out;
}

/** CMD_SEND_SELF_ADVERT: [7][1 = geflutet, 0 = nur direkte Nachbarn] */
export function cmdSendSelfAdvert(flood: boolean): Uint8Array {
  return new Uint8Array([CMD.SEND_SELF_ADVERT, flood ? 1 : 0]);
}

/**
 * CMD_SET_RADIO_PARAMS: [11][freq u32][bw u32][sf][cr][repeat?]
 *
 * Einheiten wie in der Firmware: Frequenz in kHz (869.618 MHz -> 869618),
 * Bandbreite in Hz (62.5 kHz -> 62500). Gueltig sind freq 150000..2500000,
 * bw 7000..500000, sf 5..12, cr 5..8 - alles andere quittiert das Geraet mit
 * ERR_CODE_ILLEGAL_ARG.
 */
export function cmdSetRadioParams(
  freqMHz: number,
  bwKHz: number,
  sf: number,
  cr: number,
): Uint8Array {
  const { out, dv } = frame(CMD.SET_RADIO_PARAMS, 11);
  dv.setUint32(1, Math.round(freqMHz * 1000), true);
  dv.setUint32(5, Math.round(bwKHz * 1000), true);
  out[9] = sf;
  out[10] = cr;
  return out;
}

/** CMD_SET_RADIO_TX_POWER: [12][dBm int8] - erlaubt ist -9 bis max_tx_power. */
export function cmdSetTxPower(dbm: number): Uint8Array {
  const { out, dv } = frame(CMD.SET_RADIO_TX_POWER, 2);
  dv.setInt8(1, dbm);
  return out;
}

/**
 * CMD_SET_OTHER_PARAMS:
 *   [38][manual_add_contacts][telemetrie][advert_loc_policy][multi_acks]
 * Das Telemetrie-Byte packt drei Modi zu je 2 Bit: Basis, Position, Umwelt.
 */
export function cmdSetOtherParams(params: {
  manualAddContacts: boolean;
  telemetryBase: number;
  telemetryLoc: number;
  telemetryEnv: number;
  advertLocPolicy: number;
  multiAcks: number;
}): Uint8Array {
  const { out } = frame(CMD.SET_OTHER_PARAMS, 5);
  out[1] = params.manualAddContacts ? 1 : 0;
  out[2] =
    (params.telemetryBase & 0x03) |
    ((params.telemetryLoc & 0x03) << 2) |
    ((params.telemetryEnv & 0x03) << 4);
  out[3] = params.advertLocPolicy;
  out[4] = params.multiAcks;
  return out;
}

/**
 * CMD_SET_PATH_HASH_MODE: [61][0][mode]
 * mode 0/1/2 = 1/2/3 Byte je Hash im Pfad-Feld. Genau dieser Wert entscheidet,
 * wie eindeutig ein Hop im Netz identifizierbar ist.
 */
export function cmdSetPathHashMode(mode: number): Uint8Array {
  return new Uint8Array([CMD.SET_PATH_HASH_MODE, 0, mode]);
}

/** CMD_SET_TUNING_PARAMS: [21][rx_delay_base *1000 u32][airtime_factor *1000 u32] */
export function cmdSetTuningParams(rxDelayBase: number, airtimeFactor: number): Uint8Array {
  const { out, dv } = frame(CMD.SET_TUNING_PARAMS, 9);
  dv.setUint32(1, Math.round(rxDelayBase * 1000), true);
  dv.setUint32(5, Math.round(airtimeFactor * 1000), true);
  return out;
}

/** CMD_RESET_PATH: [13][pub_key 32] - setzt den Pfad zu einem Kontakt auf Flood. */
export function cmdResetPath(publicKeyHex: string): Uint8Array {
  const { out } = frame(CMD.RESET_PATH, 1 + PUB_KEY_SIZE);
  putPubKey(out, 1, publicKeyHex);
  return out;
}

/**
 * CMD_SET_DEVICE_PIN: [37][pin u32]
 * Erlaubt ist 0 (kein PIN) oder eine sechsstellige Zahl. Der Wert wandert in
 * die Geraeteeinstellungen, nicht in den Browser.
 */
export function cmdSetDevicePin(pin: number): Uint8Array {
  const { out, dv } = frame(CMD.SET_DEVICE_PIN, 5);
  dv.setUint32(1, pin >>> 0, true);
  return out;
}

/** CMD_REBOOT: [19]"reboot" - die Firmware prueft das Wort mit memcmp. */
export function cmdReboot(): Uint8Array {
  const word = encodeUtf8('reboot');
  const { out } = frame(CMD.REBOOT, 1 + word.length);
  out.set(word, 1);
  return out;
}

/**
 * CMD_FACTORY_RESET: [51]"reset"
 * Formatiert das Dateisystem des Geraets: Schluessel, Kontakte und
 * Einstellungen sind danach weg. Die Firmware schaltet vorher die serielle
 * bzw. BLE-Schnittstelle ab - eine Bestaetigung kommt in der Regel nicht mehr an.
 */
export function cmdFactoryReset(): Uint8Array {
  const word = encodeUtf8('reset');
  const { out } = frame(CMD.FACTORY_RESET, 1 + word.length);
  out.set(word, 1);
  return out;
}
