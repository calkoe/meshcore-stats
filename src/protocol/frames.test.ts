/**
 * Frame-Parser gegen von Hand gebaute Frames.
 *
 * Die Bytes hier sind nicht aus dem Parser abgeleitet, sondern nach den
 * Layouts aus MyMesh.cpp zusammengesetzt - sonst wuerde der Test nur die eigene
 * Implementierung bestaetigen.
 */

import { describe, expect, it } from 'vitest';
import { PAYLOAD_TYPE, PUSH, RESP, ROUTE_TYPE, TXT_TYPE } from './constants';
import { parseFrame } from './frames';
import { parseRawPacket } from './packet';
import { fromHex } from './hex';

function bytes(...parts: (number | number[] | Uint8Array | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p);
    else if (typeof p === 'string') out.push(...new TextEncoder().encode(p));
    else out.push(...p);
  }
  return Uint8Array.from(out);
}

function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

function i32(n: number): number[] {
  return u32(n >>> 0);
}

function pad(to: number, arr: number[]): number[] {
  return [...arr, ...new Array(Math.max(0, to - arr.length)).fill(0)];
}

/** Header eines Funkpakets: Route-Typ, Payload-Typ, Payload-Version. */
function header(route: number, payload: number, ver = 0): number {
  return (route & 0x03) | ((payload & 0x0f) << 2) | ((ver & 0x03) << 6);
}

/** Laengenbyte eines Pfad-Felds: Anzahl Hashes plus Hash-Groesse. */
function pathLenByte(count: number, hashBytes: number): number {
  return (count & 63) | ((hashBytes - 1) << 6);
}

describe('parseRawPacket', () => {
  it('liest einen Flood-Pfad mit 1-Byte-Hashes', () => {
    const pkt = parseRawPacket(
      bytes(header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.TXT_MSG), pathLenByte(2, 1), 0xa3, 0x5c, [
        0x11, 0x99, 0xde, 0xad,
      ]),
    );
    expect(pkt).not.toBeNull();
    expect(pkt!.isFlood).toBe(true);
    expect(pkt!.path).toEqual(['a3', '5c']);
    // dest_hash steht an Position 0, src_hash an Position 1 des Payloads.
    expect(pkt!.destHash).toBe('11');
    expect(pkt!.originHash).toBe('99');
  });

  it('liest einen Pfad mit 2- und 3-Byte-Hashes', () => {
    const two = parseRawPacket(
      bytes(header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.ACK), pathLenByte(2, 2), [
        0xfd, 0xdc, 0x4a, 0x1b,
      ]),
    );
    expect(two!.path).toEqual(['fddc', '4a1b']);
    expect(two!.hashSize).toBe(2);

    const three = parseRawPacket(
      bytes(header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.ACK), pathLenByte(1, 3), [0xfd, 0xdc, 0x80]),
    );
    expect(three!.path).toEqual(['fddc80']);
  });

  it('verwirft, was die Firmware auch verwerfen wuerde', () => {
    // Unbekannte Payload-Version: das RX-Log enthaelt auch reines Rauschen.
    expect(parseRawPacket(bytes(header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.ACK, 1), 0x00))).toBeNull();
    // Lokal verworfenes Paket eines Repeaters.
    expect(parseRawPacket(bytes(0xff, 0x00))).toBeNull();
    // Reservierter Hash-Groessen-Modus.
    expect(parseRawPacket(bytes(header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.ACK), 0xc1, 0x00))).toBeNull();
    // Pfad laenger als das Paket.
    expect(
      parseRawPacket(bytes(header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.ACK), pathLenByte(9, 1), 0x01)),
    ).toBeNull();
  });

  it('liest Transport-Codes nur bei den Transport-Routentypen', () => {
    const pkt = parseRawPacket(
      bytes(
        header(ROUTE_TYPE.TRANSPORT_FLOOD, PAYLOAD_TYPE.ACK),
        [0x34, 0x12, 0x78, 0x56],
        pathLenByte(1, 1),
        0xaa,
      ),
    );
    expect(pkt!.transportCodes).toEqual([0x1234, 0x5678]);
    expect(pkt!.path).toEqual(['aa']);
  });

  it('liest Position und Namen aus einem Advert', () => {
    const pubkey = new Array(32).fill(0).map((_, i) => i + 1);
    const appData = [
      0x10 | 0x80 | 0x02, // lat/lon + Name + Typ Repeater
      ...i32(51123456),
      ...i32(6987654),
      ...[...new TextEncoder().encode('DE-NW-Test')],
    ];
    const pkt = parseRawPacket(
      bytes(
        header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.ADVERT),
        pathLenByte(0, 1),
        pubkey,
        u32(1700000000),
        new Array(64).fill(0),
        appData,
      ),
    );
    expect(pkt!.advert).not.toBeNull();
    expect(pkt!.advert!.lat).toBeCloseTo(51.123456, 6);
    expect(pkt!.advert!.lon).toBeCloseTo(6.987654, 6);
    expect(pkt!.advert!.advName).toBe('DE-NW-Test');
    expect(pkt!.advert!.type).toBe(2);
  });
});

describe('parseFrame', () => {
  it('liest SELF_INFO inklusive Funkparametern', () => {
    const frame = bytes(
      RESP.SELF_INFO,
      1, // adv_type
      22, // tx_power
      30, // max_tx_power
      new Array(32).fill(0xab),
      i32(51000000),
      i32(7000000),
      0, // multi_acks
      1, // advert_loc_policy
      (2 << 4) | (1 << 2) | 2, // env | loc | base
      0, // manual_add_contacts
      u32(869618), // Frequenz in kHz
      u32(62500), // Bandbreite in Hz
      8, // sf
      5, // cr
      'MeshCore-Calvin',
    );
    const f = parseFrame(frame);
    expect(f?.name).toBe('self_info');
    if (f?.name !== 'self_info') throw new Error('falscher Frame');
    expect(f.freqMHz).toBeCloseTo(869.618, 3);
    expect(f.bwKHz).toBeCloseTo(62.5, 3);
    expect(f.sf).toBe(8);
    expect(f.cr).toBe(5);
    expect(f.nodeName).toBe('MeshCore-Calvin');
    expect(f.telemetryMode & 0x03).toBe(2);
    expect((f.telemetryMode >> 2) & 0x03).toBe(1);
    expect((f.telemetryMode >> 4) & 0x03).toBe(2);
    expect(f.txPower).toBe(22);
  });

  it('liest negative Sendeleistung als Vorzeichenwert', () => {
    const frame = bytes(RESP.SELF_INFO, 1, 0xf7, 30, new Array(54).fill(0));
    const f = parseFrame(frame);
    if (f?.name !== 'self_info') throw new Error('falscher Frame');
    expect(f.txPower).toBe(-9);
  });

  it('liest einen Kontakt samt out_path', () => {
    const frame = bytes(
      RESP.CONTACT,
      new Array(32).fill(0x5c), // pub_key
      2, // type
      0, // flags
      pathLenByte(2, 1), // out_path_len
      pad(64, [0xa3, 0x77]), // out_path
      pad(32, [...new TextEncoder().encode('DE-NW-BM-Buir2')]), // adv_name
      u32(1700000000), // last_advert
      i32(50900000),
      i32(6600000),
      u32(1700000001),
    );
    const f = parseFrame(frame);
    if (f?.name !== 'contact') throw new Error('falscher Frame');
    expect(f.advName).toBe('DE-NW-BM-Buir2');
    expect(f.outPath).toEqual(['a3', '77']);
    expect(f.lat).toBeCloseTo(50.9, 5);
  });

  it('meldet "kein Pfad bekannt" als leeren out_path', () => {
    const frame = bytes(
      RESP.CONTACT,
      new Array(32).fill(0x5c),
      2,
      0,
      0xff, // out_path_len = -1
      pad(64, []),
      pad(32, []),
      u32(0),
      i32(0),
      i32(0),
      u32(0),
    );
    const f = parseFrame(frame);
    if (f?.name !== 'contact') throw new Error('falscher Frame');
    expect(f.outPathLen).toBe(-1);
    expect(f.outPath).toEqual([]);
  });

  it('liest LOG_RX_DATA mit SNR und RSSI', () => {
    const frame = bytes(
      PUSH.LOG_RX_DATA,
      0x1a, // SNR * 4 = 26 -> 6.5 dB
      0x92, // RSSI -110 dBm
      header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.TXT_MSG),
      pathLenByte(1, 1),
      0xa3,
      [0x11, 0x99, 0x00, 0x00],
    );
    const f = parseFrame(frame);
    if (f?.name !== 'log_rx_data') throw new Error('falscher Frame');
    expect(f.snr).toBeCloseTo(6.5, 5);
    expect(f.rssi).toBe(-110);
    expect(f.packet.path).toEqual(['a3']);
  });

  it('liest ein Trace-Ergebnis mit SNR je Hop', () => {
    const frame = bytes(
      PUSH.TRACE_DATA,
      0, // reserved
      2, // path_len
      0, // flags -> path_sz 0, also 1 Byte je Hash
      u32(0x12345678),
      u32(0),
      [0xa3, 0x5c], // Hops
      [0x20, 0xf0], // SNRs: 8.0 und -4.0
      0x10, // finaler SNR 4.0
    );
    const f = parseFrame(frame);
    if (f?.name !== 'trace_data') throw new Error('falscher Frame');
    expect(f.tag).toBe(0x12345678);
    expect(f.hops).toEqual(['a3', '5c']);
    expect(f.snrs).toEqual([8, -4]);
    expect(f.finalSnr).toBe(4);
  });

  it('liest Hin- und Rueckpfad einer Pfad-Discovery', () => {
    const frame = bytes(
      PUSH.PATH_DISCOVERY_RESPONSE,
      0,
      [0x5c, 0x01, 0x02, 0x03, 0x04, 0x05], // pub_key_prefix
      pathLenByte(2, 1),
      [0xa3, 0x77],
      pathLenByte(1, 1),
      [0x4a],
    );
    const f = parseFrame(frame);
    if (f?.name !== 'path_discovery') throw new Error('falscher Frame');
    expect(f.outPath).toEqual(['a3', '77']);
    expect(f.inPath).toEqual(['4a']);
  });

  it('liest eine Direktnachricht in der V3-Form', () => {
    const frame = bytes(
      RESP.CONTACT_MSG_RECV_V3,
      0x18, // SNR 6.0
      0,
      0,
      [0x5c, 0x01, 0x02, 0x03, 0x04, 0x05],
      pathLenByte(2, 1), // ueber zwei Hops geflutet
      TXT_TYPE.CLI_DATA,
      u32(1700000000),
      'OK - 3 neighbors',
    );
    const f = parseFrame(frame);
    if (f?.name !== 'contact_msg') throw new Error('falscher Frame');
    expect(f.snr).toBe(6);
    expect(f.txtType).toBe(TXT_TYPE.CLI_DATA);
    expect(f.pathLen).toBe(2);
    expect(f.viaFlood).toBe(true);
    expect(f.text).toBe('OK - 3 neighbors');
  });

  it('erkennt an path_len 0xFF eine Direct-Route', () => {
    const frame = bytes(
      RESP.CONTACT_MSG_RECV,
      [0x5c, 0x01, 0x02, 0x03, 0x04, 0x05],
      0xff,
      TXT_TYPE.PLAIN,
      u32(1700000000),
      'hallo',
    );
    const f = parseFrame(frame);
    if (f?.name !== 'contact_msg') throw new Error('falscher Frame');
    expect(f.pathLen).toBeNull();
    expect(f.viaFlood).toBe(false);
  });

  it('trennt bei Kanalnachrichten Absender und Text', () => {
    const frame = bytes(
      RESP.CHANNEL_MSG_RECV_V3,
      0x10,
      0,
      0,
      0, // channel_idx
      pathLenByte(1, 1),
      TXT_TYPE.PLAIN,
      u32(1700000000),
      'Calvin: Test',
    );
    const f = parseFrame(frame);
    if (f?.name !== 'channel_msg') throw new Error('falscher Frame');
    expect(f.senderName).toBe('Calvin');
    expect(f.text).toBe('Test');
  });

  it('liest das Ergebnis einer Anmeldung', () => {
    const ok = parseFrame(
      bytes(PUSH.LOGIN_SUCCESS, 0x01, fromHex('5c0102030405'), u32(1700000000), 0x03, 9),
    );
    if (ok?.name !== 'login_success') throw new Error('falscher Frame');
    expect(ok.ok).toBe(true);
    expect(ok.permissions).toBe(1);
    expect(ok.publicKeyPrefix).toBe('5c0102030405');
    expect(ok.firmwareLevel).toBe(9);

    const fail = parseFrame(bytes(PUSH.LOGIN_FAIL, 0, fromHex('5c0102030405')));
    if (fail?.name !== 'login_fail') throw new Error('falscher Frame');
    expect(fail.ok).toBe(false);
  });

  it('liest Akku, Speicher und Zeitverhalten', () => {
    const batt = parseFrame(bytes(RESP.BATT_AND_STORAGE, [0x10, 0x0f], u32(1234), u32(8192)));
    if (batt?.name !== 'batt_and_storage') throw new Error('falscher Frame');
    expect(batt.batteryMilliVolts).toBe(0x0f10);
    expect(batt.storageUsedKb).toBe(1234);
    expect(batt.storageTotalKb).toBe(8192);

    const tuning = parseFrame(bytes(RESP.TUNING_PARAMS, u32(2500), u32(1000)));
    if (tuning?.name !== 'tuning_params') throw new Error('falscher Frame');
    expect(tuning.rxDelayBase).toBeCloseTo(2.5, 5);
    expect(tuning.airtimeFactor).toBeCloseTo(1, 5);
  });

  it('liest die Sendequittung mit Tag und erwarteter Wartezeit', () => {
    const f = parseFrame(bytes(RESP.SENT, 1, u32(0xdeadbeef), u32(7000)));
    if (f?.name !== 'sent') throw new Error('falscher Frame');
    expect(f.isFlood).toBe(true);
    expect(f.tag).toBe(0xdeadbeef);
    expect(f.estTimeoutMs).toBe(7000);
  });

  it('meldet Fehlercodes durch', () => {
    const f = parseFrame(bytes(RESP.ERR, 6));
    expect(f?.name).toBe('err');
    expect((f as { errCode?: number }).errCode).toBe(6);
  });
});
