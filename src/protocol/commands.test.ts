/**
 * Kommando-Builder: die Bytes werden gegen die Erwartung der Firmware geprueft.
 *
 * Besonders wichtig sind die Einheiten. Die Firmware liest die Frequenz in kHz
 * und die Bandbreite in Hz - wer das verwechselt, verstellt ein Geraet, das
 * danach nur noch ueber Bluetooth erreichbar ist.
 */

import { describe, expect, it } from 'vitest';
import { CMD, TXT_TYPE } from './constants';
import {
  buildRoundTripPath,
  cmdSendLogin,
  cmdSendSelfAdvert,
  cmdSendTextMsg,
  cmdSendTracePath,
  cmdSetAdvertLatLon,
  cmdSetDevicePin,
  cmdSetOtherParams,
  cmdSetPathHashMode,
  cmdSetRadioParams,
  cmdSetTuningParams,
  cmdSetTxPower,
  cmdFactoryReset,
  cmdReboot,
} from './commands';
import { toHex } from './hex';

describe('Funkparameter', () => {
  it('schreibt Frequenz in kHz und Bandbreite in Hz', () => {
    const f = cmdSetRadioParams(869.618, 62.5, 8, 5);
    const dv = new DataView(f.buffer);
    expect(f[0]).toBe(CMD.SET_RADIO_PARAMS);
    expect(dv.getUint32(1, true)).toBe(869618);
    expect(dv.getUint32(5, true)).toBe(62500);
    expect(f[9]).toBe(8);
    expect(f[10]).toBe(5);
    // Genau 11 Byte: ein zwoelftes Byte waere das "repeat"-Flag, das wir nicht setzen.
    expect(f.length).toBe(11);
  });

  it('schreibt die Sendeleistung vorzeichenbehaftet', () => {
    expect(new DataView(cmdSetTxPower(-9).buffer).getInt8(1)).toBe(-9);
    expect(new DataView(cmdSetTxPower(22).buffer).getInt8(1)).toBe(22);
  });
});

describe('Trace', () => {
  it('baut aus dem Hinweg einen Rundweg', () => {
    expect(buildRoundTripPath([0xa3, 0x5c], 0x77)).toEqual([0xa3, 0x5c, 0x77, 0x5c, 0xa3]);
    // Direkter Nachbar: nur das Ziel bleibt uebrig.
    expect(buildRoundTripPath([], 0x77)).toEqual([0x77]);
  });

  it('setzt path_sz auf 1-Byte-Hashes', () => {
    const f = cmdSendTracePath(0x12345678, 0, buildRoundTripPath([0xa3], 0x5c));
    expect(toHex(f)).toBe('24' + '78563412' + '00000000' + '00' + 'a35ca3');
  });
});

describe('Nachrichten', () => {
  it('nutzt die ersten 6 Byte des Public Key als Empfaengerkennung', () => {
    const key = 'a1b2c3d4e5f6' + '0'.repeat(52);
    const f = cmdSendTextMsg(key, 'hi', 1700000000);
    expect(f[0]).toBe(CMD.SEND_TXT_MSG);
    expect(f[1]).toBe(TXT_TYPE.PLAIN);
    expect(toHex(f.subarray(7, 13))).toBe('a1b2c3d4e5f6');
    expect(new TextDecoder().decode(f.subarray(13))).toBe('hi');
  });

  it('kennzeichnet einen Terminalbefehl als CLI-Daten', () => {
    const f = cmdSendTextMsg('a1'.repeat(32), 'neighbors', 1700000000, TXT_TYPE.CLI_DATA);
    expect(f[1]).toBe(TXT_TYPE.CLI_DATA);
    expect(new TextDecoder().decode(f.subarray(13))).toBe('neighbors');
  });
});

describe('Anmeldung', () => {
  it('haengt das Passwort hinter den vollen Public Key', () => {
    const key = 'ab'.repeat(32);
    const f = cmdSendLogin(key, 'geheim');
    expect(f[0]).toBe(CMD.SEND_LOGIN);
    expect(toHex(f.subarray(1, 33))).toBe(key);
    expect(new TextDecoder().decode(f.subarray(33))).toBe('geheim');
  });
});

describe('Konfiguration', () => {
  it('packt die drei Telemetrie-Modi in ein Byte', () => {
    const f = cmdSetOtherParams({
      manualAddContacts: true,
      telemetryBase: 2,
      telemetryLoc: 1,
      telemetryEnv: 2,
      advertLocPolicy: 1,
      multiAcks: 3,
    });
    expect(f[0]).toBe(CMD.SET_OTHER_PARAMS);
    expect(f[1]).toBe(1);
    // env << 4 | loc << 2 | base  (MyMesh.cpp, SELF_INFO und SET_OTHER_PARAMS)
    expect(f[2]).toBe((2 << 4) | (1 << 2) | 2);
    expect(f[3]).toBe(1);
    expect(f[4]).toBe(3);
  });

  it('schreibt Koordinaten in Millionstel Grad', () => {
    const dv = new DataView(cmdSetAdvertLatLon(50.9123456, -6.5).buffer);
    expect(dv.getInt32(1, true)).toBe(50912346);
    expect(dv.getInt32(5, true)).toBe(-6500000);
  });

  it('setzt den Path-Hash-Modus mit dem Reservebyte davor', () => {
    expect([...cmdSetPathHashMode(1)]).toEqual([CMD.SET_PATH_HASH_MODE, 0, 1]);
  });

  it('schreibt das Zeitverhalten in Tausendsteln', () => {
    const dv = new DataView(cmdSetTuningParams(2.5, 1.25).buffer);
    expect(dv.getUint32(1, true)).toBe(2500);
    expect(dv.getUint32(5, true)).toBe(1250);
  });

  it('schreibt den BLE-PIN als 32-Bit-Zahl', () => {
    expect(new DataView(cmdSetDevicePin(123456).buffer).getUint32(1, true)).toBe(123456);
    expect(new DataView(cmdSetDevicePin(0).buffer).getUint32(1, true)).toBe(0);
  });

  it('unterscheidet geflutetes und lokales Advert', () => {
    expect([...cmdSendSelfAdvert(true)]).toEqual([CMD.SEND_SELF_ADVERT, 1]);
    expect([...cmdSendSelfAdvert(false)]).toEqual([CMD.SEND_SELF_ADVERT, 0]);
  });

  it('haengt die Schluesselwoerter an, die die Firmware per memcmp prueft', () => {
    expect(new TextDecoder().decode(cmdReboot().subarray(1))).toBe('reboot');
    expect(new TextDecoder().decode(cmdFactoryReset().subarray(1))).toBe('reset');
  });
});
