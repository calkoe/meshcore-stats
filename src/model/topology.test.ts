/**
 * Topologie-Modell: Aufloesung der Pfad-Hashes und die daraus folgende
 * Eindeutigkeit von Funkstrecken.
 *
 * Das ist der heikelste Teil der Anwendung. Ein Pfad-Hash ist nur ein Prefix
 * des Public Key und seine Laenge schwankt - wer ihn naiv vergleicht, zerlegt
 * einen Knoten in mehrere oder wirft mehrere zu einem zusammen.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PAYLOAD_TYPE, ROUTE_TYPE } from '../protocol/constants';
import type { SelfInfoFrame } from '../protocol/frames';
import { parseRawPacket } from '../protocol/packet';
import { TopologyModel, linkKey } from './topology';
import { PROVENANCE, type ViewFilter } from './types';

const FILTER: ViewFilter = { windowMs: null, payloadTypes: null, includeDeclared: true };

/** Zwei bekannte Knoten mit gleichem Anfangsbyte - genau der schwierige Fall. */
const KEY_AA_BB = 'aabb' + '1'.repeat(60);
const KEY_AA_CC = 'aacc' + '2'.repeat(60);
/** Ein Knoten, dessen Anfangsbyte sonst niemand traegt. */
const KEY_CC = 'cc11' + '3'.repeat(60);
const SELF_KEY = '4a' + '9'.repeat(62);

function selfInfo(): SelfInfoFrame {
  return {
    code: 5,
    name: 'self_info',
    advType: 1,
    txPower: 22,
    maxTxPower: 30,
    publicKey: SELF_KEY,
    lat: 51,
    lon: 7,
    multiAcks: 0,
    advertLocPolicy: 1,
    telemetryMode: 0,
    manualAddContacts: 0,
    freqMHz: 869.618,
    bwKHz: 62.5,
    sf: 8,
    cr: 5,
    nodeName: 'Calvin',
  };
}

function header(route: number, payload: number): number {
  return (route & 0x03) | ((payload & 0x0f) << 2);
}

/**
 * Baut ein Flood-Paket mit dem angegebenen Pfad und speist es ein.
 * `hashBytes` legt fest, wie lang die Hashes im Paket sind (1, 2 oder 3).
 */
function feedFlood(model: TopologyModel, hops: string[], hashBytes: number, rssi = -80): void {
  const pathBytes: number[] = [];
  for (const h of hops) {
    const b = h.padEnd(hashBytes * 2, '0').slice(0, hashBytes * 2);
    for (let i = 0; i < hashBytes; i++) pathBytes.push(Number.parseInt(b.slice(i * 2, i * 2 + 2), 16));
  }
  const raw = Uint8Array.from([
    header(ROUTE_TYPE.FLOOD, PAYLOAD_TYPE.TXT_MSG),
    (hops.length & 63) | ((hashBytes - 1) << 6),
    ...pathBytes,
    0x11, // dest_hash
    0x99, // src_hash -> Urheber, zu dem wir nichts wissen
    0x00,
    0x00,
  ]);
  const packet = parseRawPacket(raw);
  if (!packet) throw new Error('Testpaket nicht lesbar');
  model.addRxPacket({ snr: 5, rssi, packet });
}

describe('Aufloesung der Pfad-Hashes', () => {
  let model: TopologyModel;

  beforeEach(() => {
    model = new TopologyModel();
    model.setSelf(selfInfo());
    model.upsertIdentity(KEY_AA_BB, { name: 'AA-BB', type: 2 });
    model.upsertIdentity(KEY_AA_CC, { name: 'AA-CC', type: 2 });
    model.upsertIdentity(KEY_CC, { name: 'CC', type: 2 });
  });

  it('ordnet einen ausreichend langen Hash genau einem Knoten zu', () => {
    feedFlood(model, ['aabb'], 2);
    const view = model.computeView(FILTER);
    const node = view.nodeForHash('aabb');
    expect(node?.key).toBe(KEY_AA_BB);
    expect(node?.certainty).toBe('unique');
  });

  it('ordnet einen mehrdeutigen Hash KEINEM Knoten zu', () => {
    feedFlood(model, ['aa'], 1);
    const view = model.computeView(FILTER);
    const node = view.nodeForHash('aa');
    // 'aa' passt auf AA-BB und AA-CC - geraten wird nicht.
    expect(node?.key).toBe('#aa');
    expect(node?.certainty).toBe('ambiguous');
    expect(node?.candidates).toEqual(expect.arrayContaining(['AA-BB', 'AA-CC']));
  });

  it('fasst denselben Knoten unter verschiedenen Hash-Laengen zusammen', () => {
    feedFlood(model, ['cc'], 1);
    feedFlood(model, ['cc11'], 2);
    feedFlood(model, ['cc1133'], 3);
    const view = model.computeView(FILTER);
    // Alle drei Schreibweisen zeigen auf denselben Knoten ...
    expect(view.keyForHash('cc')).toBe(KEY_CC);
    expect(view.keyForHash('cc11')).toBe(KEY_CC);
    expect(view.keyForHash('cc1133')).toBe(KEY_CC);
    // ... und es gibt genau eine Funkstrecke zu uns, nicht drei.
    const toSelf = [...view.links.values()].filter(
      (l) => l.a === SELF_KEY || l.b === SELF_KEY,
    );
    expect(toSelf).toHaveLength(1);
    expect(toSelf[0].total).toBe(3);
  });

  it('haelt die eigene Identitaet exakt, obwohl ihr Anfangsbyte kurz ist', () => {
    feedFlood(model, ['cc11'], 2);
    const view = model.computeView(FILTER);
    const self = view.nodeForKey(SELF_KEY);
    expect(self?.isSelf).toBe(true);
    expect(self?.certainty).toBe('exact');
    // Die letzte Meile zu uns muss im Pfad auftauchen.
    const route = [...view.routes.values()][0];
    expect(route.chain[route.chain.length - 1]).toBe(SELF_KEY);
  });
});

describe('Eindeutigkeit einer Funkstrecke', () => {
  let model: TopologyModel;

  beforeEach(() => {
    model = new TopologyModel();
    model.setSelf(selfInfo());
    model.upsertIdentity(KEY_CC, { name: 'CC', type: 2 });
  });

  it('gilt als nicht eindeutig, solange nur 1 Byte vorlag', () => {
    feedFlood(model, ['cc'], 1);
    const view = model.computeView(FILTER);
    const link = view.links.get(linkKey(KEY_CC, SELF_KEY));
    expect(link).toBeDefined();
    expect(link!.ambiguous).toBe(true);
    expect(link!.certainCount).toBe(0);
    expect(link!.weakCount).toBe(1);
    expect(view.nodeForKey(KEY_CC)?.seenWeak).toBe(true);
  });

  it('gilt als eindeutig, sobald eine Beobachtung beide Enden festlegt', () => {
    feedFlood(model, ['cc'], 1);
    feedFlood(model, ['cc11'], 2);
    const view = model.computeView(FILTER);
    const link = view.links.get(linkKey(KEY_CC, SELF_KEY))!;
    expect(link.ambiguous).toBe(false);
    expect(link.certainCount).toBe(1);
    expect(link.weakCount).toBe(1);
    // Die schwache Beobachtung bleibt trotzdem vermerkt.
    expect(view.nodeForKey(KEY_CC)?.seenWeak).toBe(true);
    expect(view.nodeForKey(KEY_CC)?.hashBytes).toEqual([1, 2]);
  });

  it('zaehlt eindeutige Strecken in der Gesamtschau', () => {
    feedFlood(model, ['cc'], 1); // nur schwach belegt
    feedFlood(model, ['cc11'], 2); // jetzt belegt
    const view = model.computeView(FILTER);
    expect(view.totals.links).toBeGreaterThanOrEqual(1);
    expect(view.totals.certainLinks).toBeLessThan(view.totals.links);
  });
});

describe('Herkunft der Kanten', () => {
  let model: TopologyModel;

  beforeEach(() => {
    model = new TopologyModel();
    model.setSelf(selfInfo());
    model.upsertIdentity(KEY_CC, { name: 'CC', type: 2 });
  });

  it('misst die Feldstaerke nur auf dem letzten Hop zu uns', () => {
    feedFlood(model, ['aabb', 'cc11'], 2, -95);
    const view = model.computeView(FILTER);

    const measured = view.links.get(linkKey(KEY_CC, SELF_KEY))!;
    expect(measured.provenance.has(PROVENANCE.MEASURED)).toBe(true);
    expect(measured.rssi.n).toBe(1);
    expect(measured.rssi.last).toBe(-95);

    // Die Strecke davor ist beobachtet, aber nicht gemessen.
    const upstream = [...view.links.values()].find(
      (l) => l.key !== measured.key && l.provenance.has(PROVENANCE.OBSERVED),
    );
    expect(upstream).toBeDefined();
    expect(upstream!.rssi.n).toBe(0);
  });

  it('nimmt den out_path eines Kontakts als deklarierte Route auf', () => {
    model.addContactPath({
      code: 3,
      name: 'contact',
      isNew: false,
      publicKey: KEY_CC,
      type: 2,
      flags: 0,
      outPathLen: 1,
      outPath: ['aabb'],
      advName: 'CC',
      lastAdvert: 0,
      lat: 0,
      lon: 0,
      lastMod: 0,
    });
    const view = model.computeView(FILTER);
    const links = [...view.links.values()];
    expect(links.length).toBe(2);
    // Deklarierte Routen erzeugen keine "Hitze".
    expect(links.every((l) => l.total === 0)).toBe(true);
    expect(links.every((l) => l.provenance.has(PROVENANCE.DECLARED))).toBe(true);
  });

  it('blendet deklarierte Routen aus, wenn der Filter das verlangt', () => {
    model.addContactPath({
      code: 3,
      name: 'contact',
      isNew: false,
      publicKey: KEY_CC,
      type: 2,
      flags: 0,
      outPathLen: 1,
      outPath: ['aabb'],
      advName: 'CC',
      lastAdvert: 0,
      lat: 0,
      lon: 0,
      lastMod: 0,
    });
    const view = model.computeView({ ...FILTER, includeDeclared: false });
    expect(view.links.size).toBe(0);
  });
});

describe('Kennzahlen', () => {
  it('weist keine Rate aus, solange der Zeitraum zu kurz ist', () => {
    const model = new TopologyModel();
    model.setSelf(selfInfo());
    feedFlood(model, ['cc11'], 2);
    const view = model.computeView(FILTER);
    // Ein Sekundenbruchteil wuerde zu Fantasiewerten hochgerechnet.
    expect(view.totals.packetsPerMin).toBeNull();
  });

  it('zaehlt Knoten ohne Position getrennt', () => {
    const model = new TopologyModel();
    model.setSelf(selfInfo());
    model.upsertIdentity(KEY_CC, { name: 'CC', type: 2 }); // ohne lat/lon
    const view = model.computeView(FILTER);
    expect(view.totals.positioned).toBe(1); // nur das eigene Geraet
    expect(view.totals.nodes - view.totals.positioned).toBe(1);
  });
});
