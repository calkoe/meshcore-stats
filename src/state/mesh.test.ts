/**
 * Zuordnung von Nachricht zu Pfad.
 *
 * Der Weg einer empfangenen Nachricht steht NICHT in der Nachricht - das Frame
 * nennt nur die Hop-Zahl. Die Kette stammt aus dem RX-Protokoll. Diese Tests
 * halten fest, wann zugeordnet werden darf und wann eben nicht.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PAYLOAD_TYPE, RESP, ROUTE_TYPE, TXT_TYPE } from '../protocol/constants';
import { MeshController } from './mesh';

const SELF_KEY = '4a' + '9'.repeat(62);
const SENDER = 'a3' + '7'.repeat(62);

function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

function header(route: number, payload: number): number {
  return (route & 0x03) | ((payload & 0x0f) << 2);
}

function hex(h: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < h.length; i += 2) out.push(Number.parseInt(h.slice(i, i + 2), 16));
  return out;
}

/** RESP_CODE_SELF_INFO mit dem angegebenen Public Key. */
function selfInfoFrame(): Uint8Array {
  return Uint8Array.from([
    RESP.SELF_INFO, 1, 22, 30,
    ...hex(SELF_KEY),
    ...u32(51000000), ...u32(7000000),
    0, 1, 0, 0,
    ...u32(869618), ...u32(62500), 8, 5,
    ...[...new TextEncoder().encode('Calvin')],
  ]);
}

/** PUSH_CODE_LOG_RX_DATA: ein gehoertes Textpaket ueber `hops` Zwischenstationen. */
function textPacket(hops: string[], srcByte: number, payloadType = PAYLOAD_TYPE.TXT_MSG): Uint8Array {
  return Uint8Array.from([
    0x88, 20, 0xb0,
    header(ROUTE_TYPE.FLOOD, payloadType),
    hops.length & 63,
    ...hops.map((h) => Number.parseInt(h, 16)),
    0x11, srcByte, 0x00, 0x00,
  ]);
}

/** RESP_CODE_CONTACT_MSG_RECV_V3 vom angegebenen Absender. */
function messageFrame(prefix: string, hops: number, text: string): Uint8Array {
  return Uint8Array.from([
    RESP.CONTACT_MSG_RECV_V3, 20, 0, 0,
    ...hex(prefix),
    hops,
    TXT_TYPE.PLAIN,
    ...u32(1700000000),
    ...[...new TextEncoder().encode(text)],
  ]);
}

describe('Pfad einer empfangenen Nachricht', () => {
  let c: MeshController;

  beforeEach(() => {
    c = new MeshController();
    c.onFrame(selfInfoFrame());
    c.model.upsertIdentity(SENDER, { name: 'Repeater A3', type: 2 });
  });

  it('uebernimmt den Weg aus dem passenden gehoerten Textpaket', () => {
    c.onFrame(textPacket(['5c', 'a3'], 0xa3));
    c.onFrame(messageFrame(SENDER.slice(0, 12), 2, 'hallo'));

    const msg = c.model.messages.at(-1);
    expect(msg?.text).toBe('hallo');
    expect(msg?.chain).toEqual(['a3', '5c', 'a3', SELF_KEY]);
    // Die Zuordnung ist erschlossen, nicht abgelesen - das muss sichtbar bleiben.
    expect(msg?.chainGuess).toBe(true);
  });

  it('ordnet nichts zu, wenn die Hop-Zahl nicht passt', () => {
    c.onFrame(textPacket(['5c', 'a3'], 0xa3)); // zwei Hops
    c.onFrame(messageFrame(SENDER.slice(0, 12), 4, 'hallo')); // Nachricht meldet vier

    const msg = c.model.messages.at(-1);
    expect(msg?.chain).toBeNull();
    expect(msg?.chainGuess).toBe(false);
  });

  it('ordnet nichts zu, wenn das Absenderbyte nicht passt', () => {
    c.onFrame(textPacket(['a3'], 0x5c)); // Urheber 5c
    c.onFrame(messageFrame(SENDER.slice(0, 12), 1, 'hallo')); // Absender beginnt mit a3

    expect(c.model.messages.at(-1)?.chain).toBeNull();
  });

  it('verbraucht ein Paket nur einmal', () => {
    c.onFrame(textPacket(['a3'], 0xa3));
    c.onFrame(messageFrame(SENDER.slice(0, 12), 1, 'erste'));
    c.onFrame(messageFrame(SENDER.slice(0, 12), 1, 'zweite'));

    expect(c.model.messages.at(-2)?.chain).not.toBeNull();
    expect(c.model.messages.at(-1)?.chain).toBeNull();
  });

  it('nimmt fuer Kanalnachrichten nur Gruppentext-Pakete', () => {
    c.onFrame(textPacket(['a3'], 0xa3, PAYLOAD_TYPE.TXT_MSG));
    c.onFrame(
      Uint8Array.from([
        RESP.CHANNEL_MSG_RECV_V3, 20, 0, 0,
        0, // channel_idx
        1, // path_len
        TXT_TYPE.PLAIN,
        ...u32(1700000000),
        ...[...new TextEncoder().encode('Calvin: hi')],
      ]),
    );
    // Das gehoerte Paket war eine Direktnachricht - es gehoert nicht dazu.
    expect(c.model.messages.at(-1)?.chain).toBeNull();
  });
});

describe('Verkehr verwerfen', () => {
  it('behaelt die Kontakte', () => {
    const c = new MeshController();
    c.onFrame(selfInfoFrame());
    c.model.upsertIdentity(SENDER, { name: 'Repeater A3', type: 2 });
    c.onFrame(textPacket(['a3'], 0xa3));
    expect(c.model.events.length).toBeGreaterThan(0);

    c.clearTraffic();
    expect(c.model.events).toHaveLength(0);
    expect(c.model.messages).toHaveLength(0);
    expect(c.model.identities.has(SENDER)).toBe(true);
    expect(c.model.selfKey).toBe(SELF_KEY);
  });
});

describe('Gelernter Pfad zum Chatpartner', () => {
  it('setzt sich aus uns, dem out_path und dem Ziel zusammen', () => {
    const c = new MeshController();
    c.onFrame(selfInfoFrame());
    c.model.upsertIdentity(SENDER, { name: 'Repeater A3', type: 2, outPath: ['5c', '77'] });
    expect(c.learnedPathTo(SENDER)).toEqual([SELF_KEY, '5c', '77', SENDER]);
  });

  it('meldet keinen Pfad, wenn das Geraet keinen gelernt hat', () => {
    const c = new MeshController();
    c.onFrame(selfInfoFrame());
    c.model.upsertIdentity(SENDER, { name: 'Repeater A3', type: 2 });
    expect(c.learnedPathTo(SENDER)).toBeNull();
  });
});
