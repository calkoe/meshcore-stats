/**
 * MeshCore Companion-Radio Protokoll - Konstanten.
 *
 * Alle Werte sind gegen die Firmware-Quellen verifiziert:
 *   examples/companion_radio/MyMesh.cpp   (Frame-Codes, Frame-Layouts)
 *   examples/companion_radio/NodePrefs.h  (Telemetrie- und Advert-Richtlinien)
 *   src/Dispatcher.cpp                     (Roh-Paket-Wireformat, logRxRaw)
 *   src/Packet.h                           (Header-Bits, Payload-Typen)
 *   src/Mesh.cpp                           (Advert-Payload, Trace-Sonderfall)
 *   src/helpers/AdvertDataHelpers.*        (app_data der Adverts)
 *   src/Identity.h                         (Path-Hash == Prefix des Public Key)
 *
 * Ueber BLE ist eine Notification exakt ein Frame - es gibt keinen Laengen-
 * Praefix (der existiert nur auf der seriellen Schnittstelle).
 */

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_CHAR_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // App -> Geraet (write)
export const NUS_CHAR_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Geraet -> App (notify)

/** Groesstes Frame, das die Firmware sendet (MyMesh.h: MAX_FRAME_SIZE). */
export const MAX_FRAME_SIZE = 176;

export const PUB_KEY_SIZE = 32;
export const MAX_PATH_SIZE = 64;
export const SIGNATURE_SIZE = 64;

/** Protokollstand, den diese App beherrscht (CMD_APP_START / CMD_DEVICE_QUERY). */
export const APP_TARGET_VER = 12;

export const CMD = {
  APP_START: 1,
  SEND_TXT_MSG: 2,
  SEND_CHANNEL_TXT_MSG: 3,
  GET_CONTACTS: 4,
  GET_DEVICE_TIME: 5,
  SET_DEVICE_TIME: 6,
  SEND_SELF_ADVERT: 7,
  SET_ADVERT_NAME: 8,
  SYNC_NEXT_MESSAGE: 10,
  SET_RADIO_PARAMS: 11,
  SET_RADIO_TX_POWER: 12,
  RESET_PATH: 13,
  SET_ADVERT_LATLON: 14,
  REBOOT: 19,
  GET_BATT_AND_STORAGE: 20,
  SET_TUNING_PARAMS: 21,
  DEVICE_QUERY: 22,
  SEND_LOGIN: 26,
  HAS_CONNECTION: 28,
  LOGOUT: 29,
  GET_CHANNEL: 31,
  SET_CHANNEL: 32,
  SEND_TRACE_PATH: 36,
  SET_DEVICE_PIN: 37,
  SET_OTHER_PARAMS: 38,
  GET_ADVERT_PATH: 42,
  GET_TUNING_PARAMS: 43,
  FACTORY_RESET: 51,
  SEND_PATH_DISCOVERY_REQ: 52,
  SET_PATH_HASH_MODE: 61,
} as const;

export const RESP = {
  OK: 0,
  ERR: 1,
  CONTACTS_START: 2,
  CONTACT: 3,
  END_OF_CONTACTS: 4,
  SELF_INFO: 5,
  SENT: 6,
  CONTACT_MSG_RECV: 7,
  CHANNEL_MSG_RECV: 8,
  CURR_TIME: 9,
  NO_MORE_MESSAGES: 10,
  BATT_AND_STORAGE: 12,
  DEVICE_INFO: 13,
  DISABLED: 15,
  CONTACT_MSG_RECV_V3: 16,
  CHANNEL_MSG_RECV_V3: 17,
  CHANNEL_INFO: 18,
  ADVERT_PATH: 22,
  TUNING_PARAMS: 23,
} as const;

export const PUSH = {
  ADVERT: 0x80,
  PATH_UPDATED: 0x81,
  SEND_CONFIRMED: 0x82,
  MSG_WAITING: 0x83,
  RAW_DATA: 0x84,
  LOGIN_SUCCESS: 0x85,
  LOGIN_FAIL: 0x86,
  STATUS_RESPONSE: 0x87,
  LOG_RX_DATA: 0x88,
  TRACE_DATA: 0x89,
  NEW_ADVERT: 0x8a,
  TELEMETRY_RESPONSE: 0x8b,
  BINARY_RESPONSE: 0x8c,
  PATH_DISCOVERY_RESPONSE: 0x8d,
  CONTROL_DATA: 0x8e,
  CONTACT_DELETED: 0x8f,
  CONTACTS_FULL: 0x90,
} as const;

/** MyMesh.cpp: ERR_CODE_* - erscheint als zweites Byte in RESP_CODE_ERR. */
export const ERR_NAMES: Record<number, string> = {
  1: 'Kommando nicht unterstützt',
  2: 'nicht gefunden',
  3: 'Tabelle voll',
  4: 'falscher Zustand',
  5: 'Dateisystemfehler',
  6: 'unzulässiger Wert',
};

// Packet.h: header & 0x03
export const ROUTE_TYPE = {
  TRANSPORT_FLOOD: 0x00,
  FLOOD: 0x01,
  DIRECT: 0x02,
  TRANSPORT_DIRECT: 0x03,
} as const;

export const ROUTE_NAMES: Record<number, string> = {
  0x00: 'Transport-Flood',
  0x01: 'Flood',
  0x02: 'Direct',
  0x03: 'Transport-Direct',
};

// Packet.h: (header >> 2) & 0x0F
export const PAYLOAD_TYPE = {
  REQ: 0x00,
  RESPONSE: 0x01,
  TXT_MSG: 0x02,
  ACK: 0x03,
  ADVERT: 0x04,
  GRP_TXT: 0x05,
  GRP_DATA: 0x06,
  ANON_REQ: 0x07,
  PATH: 0x08,
  TRACE: 0x09,
  MULTIPART: 0x0a,
  CONTROL: 0x0b,
  RAW_CUSTOM: 0x0f,
} as const;

export const PAYLOAD_NAMES: Record<number, string> = {
  0x00: 'Request',
  0x01: 'Response',
  0x02: 'Textnachricht',
  0x03: 'ACK',
  0x04: 'Advert',
  0x05: 'Gruppentext',
  0x06: 'Gruppendaten',
  0x07: 'Anon-Request',
  0x08: 'Path-Return',
  0x09: 'Trace',
  0x0a: 'Multipart',
  0x0b: 'Control',
  0x0f: 'Raw/Custom',
};

// AdvertDataHelpers.h
export const ADV_TYPE = { NONE: 0, CHAT: 1, REPEATER: 2, ROOM: 3, SENSOR: 4 } as const;
export const ADV_TYPE_NAMES: Record<number, string> = {
  0: 'Unbekannt',
  1: 'Client',
  2: 'Repeater',
  3: 'Room-Server',
  4: 'Sensor',
};

export const ADV_LATLON_MASK = 0x10;
export const ADV_FEAT1_MASK = 0x20;
export const ADV_FEAT2_MASK = 0x40;
export const ADV_NAME_MASK = 0x80;

// TxtDataHelpers.h
export const TXT_TYPE = { PLAIN: 0, CLI_DATA: 1, SIGNED_PLAIN: 2 } as const;

// NodePrefs.h
export const TELEM_MODE = { DENY: 0, ALLOW_FLAGS: 1, ALLOW_ALL: 2 } as const;
export const TELEM_MODE_NAMES: Record<number, string> = {
  0: 'niemand',
  1: 'nur freigegebene Kontakte',
  2: 'alle',
};
export const ADVERT_LOC = { NONE: 0, SHARE: 1 } as const;

/** out_path_len-Wert der Firmware fuer "kein Pfad bekannt" (Flood). */
export const OUT_PATH_UNKNOWN = -1;
