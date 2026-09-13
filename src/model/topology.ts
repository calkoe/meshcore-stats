/**
 * Topologie-Modell.
 *
 * Einzige Wahrheitsquelle ist ein Ereignis-Log (jedes empfangene Funkpaket bzw.
 * jede deklarierte Route). Knoten, Funkstrecken und Routen werden daraus
 * abgeleitet - dadurch sind Zeitfilter immer konsistent und Export/Import ist
 * trivial.
 *
 * Wichtige Protokoll-Eigenschaften, die das Modell abbildet:
 *
 *  - Der Path-Hash eines Knotens ist das Prefix seines Public Key (Identity.h),
 *    und seine LAENGE schwankt (1, 2 oder 3 Byte, je nach path_hash_mode des
 *    sendenden Netzes - fuer denselben Knoten auch gemischt).
 *  - Bei FLOOD-Paketen enthaelt das Pfad-Feld die bereits durchlaufenen Repeater
 *    in Reihenfolge. Der LETZTE Eintrag ist damit der Sender, den wir direkt
 *    gehoert haben -> nur fuer diesen Link kennen wir echtes RSSI/SNR.
 *  - Bei DIRECT-Paketen wird der eigene Hash vor dem Weiterleiten entfernt
 *    (Mesh.cpp: removeSelfFromPath). Das Pfad-Feld enthaelt also die REST-Route,
 *    nicht den zurueckgelegten Weg. Solche Pfade sind deklarierte Routen -
 *    echte Topologie-Information, aber ohne messbare Feldstaerke.
 */

import { ADV_TYPE, ADV_TYPE_NAMES, PAYLOAD_TYPE } from '../protocol/constants';
import type { ContactFrame, SelfInfoFrame, DeviceInfoFrame, TraceDataFrame } from '../protocol/frames';
import type { RawPacket } from '../protocol/packet';
import {
  PROVENANCE,
  UNIQUE_HASH_BYTES,
  isCertain,
  type Certainty,
  type ChatMessage,
  type Identity,
  type NodeStats,
  type Stats,
  type TopoEvent,
  type TopoView,
  type ViewFilter,
  type ViewLink,
  type ViewNode,
  type ViewRoute,
} from './types';

const MAX_EVENTS = 50000;
const MAX_MESSAGES = 2000;

/** Speicherformat. Bleibt auf 1, solange die Ereignisse dasselbe Format haben. */
export const STORAGE_VERSION = 1;

export interface StoredModel {
  version: number;
  savedAt: number;
  selfKey: string | null;
  selfHash: string | null;
  selfInfo: SelfInfoFrame | null;
  deviceInfo: DeviceInfoFrame | null;
  identities: Identity[];
  events: TopoEvent[];
  messages: ChatMessage[];
}

function newStats(): Stats {
  return { n: 0, sum: 0, min: Infinity, max: -Infinity, last: null };
}

function pushStat(s: Stats, v: number | null | undefined): void {
  if (v == null || !Number.isFinite(v)) return;
  s.n++;
  s.sum += v;
  if (v < s.min) s.min = v;
  if (v > s.max) s.max = v;
  s.last = v;
}

export function statAvg(s: Stats | null | undefined): number | null {
  return s && s.n > 0 ? s.sum / s.n : null;
}

export function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function dedupeAdjacent(chain: string[]): string[] {
  const out: string[] = [];
  for (const h of chain) {
    if (out.length === 0 || out[out.length - 1] !== h) out.push(h);
  }
  return out;
}

export function isValidCoord(lat: number | null, lon: number | null): boolean {
  return (
    lat != null &&
    lon != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) > 0.00001 &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

/** Rangfolge, um aus zwei Sicherheiten die schwaechere zu waehlen. */
const CERTAINTY_RANK: Record<Certainty, number> = {
  exact: 4,
  unique: 3,
  weak: 2,
  ambiguous: 1,
  unknown: 0,
};

function worse(a: Certainty, b: Certainty): Certainty {
  return CERTAINTY_RANK[a] <= CERTAINTY_RANK[b] ? a : b;
}

function better(a: Certainty, b: Certainty): Certainty {
  return CERTAINTY_RANK[a] >= CERTAINTY_RANK[b] ? a : b;
}

interface Resolved {
  key: string;
  id: Identity | null;
  certainty: Certainty;
  hash: string;
  candidates: Identity[];
}

type Listener = () => void;

export class TopologyModel {
  /** Identitaeten, Schluessel = voller Public Key (hex). */
  identities = new Map<string, Identity>();
  /** Ereignis-Log (Ringpuffer). */
  events: TopoEvent[] = [];
  selfHash: string | null = null;
  selfKey: string | null = null;
  deviceInfo: DeviceInfoFrame | null = null;
  selfInfo: SelfInfoFrame | null = null;
  messages: ChatMessage[] = [];

  private dirty = true;
  private cache: TopoView | null = null;
  private cacheKey = '';
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /* ---------------- Identitaeten ---------------- */

  /**
   * Traegt eine Identitaet ein bzw. aktualisiert sie.
   * Felder werden nur ueberschrieben, wenn die neue Quelle etwas beisteuert -
   * so ueberschreibt ein Advert ohne Position keine bereits bekannte Position.
   */
  upsertIdentity(
    pubkey: string,
    fields: Partial<Pick<Identity, 'name' | 'type' | 'lat' | 'lon' | 'lastAdvert' | 'outPath' | 'isSelf'>> = {},
  ): Identity | null {
    if (!pubkey) return null;
    const key = pubkey.toLowerCase();
    let id = this.identities.get(key);
    if (!id) {
      id = {
        pubkey: key,
        hash: key.slice(0, 2),
        name: '',
        type: ADV_TYPE.NONE,
        lat: null,
        lon: null,
        lastAdvert: 0,
        outPath: null,
        isSelf: false,
        firstSeen: Date.now(),
      };
      this.identities.set(key, id);
    }
    if (fields.name) id.name = fields.name;
    if (fields.type != null && fields.type !== ADV_TYPE.NONE) id.type = fields.type;
    if (isValidCoord(fields.lat ?? null, fields.lon ?? null)) {
      id.lat = fields.lat as number;
      id.lon = fields.lon as number;
    }
    if (fields.lastAdvert) id.lastAdvert = Math.max(id.lastAdvert || 0, fields.lastAdvert);
    if (fields.outPath) id.outPath = fields.outPath;
    if (fields.isSelf) id.isSelf = true;
    this.dirty = true;
    return id;
  }

  setSelf(selfInfo: SelfInfoFrame): void {
    this.selfInfo = selfInfo;
    this.selfKey = selfInfo.publicKey.toLowerCase();
    this.selfHash = this.selfKey.slice(0, 2);
    this.upsertIdentity(selfInfo.publicKey, {
      name: selfInfo.nodeName || 'Dieses Gerät',
      type: selfInfo.advType,
      lat: selfInfo.lat,
      lon: selfInfo.lon,
      isSelf: true,
    });
    this.migrateSelfInChains();
    this.dirty = true;
    this.emit();
  }

  /**
   * Aeltere Aufzeichnungen enthalten an der Stelle des eigenen Knotens nur den
   * 1-Byte-Hash. Der ist gegen die Kontaktliste mehrdeutig - hier wird er an
   * genau den Positionen, an denen das Modell ihn gesetzt hat, durch den vollen
   * Public Key ersetzt.
   */
  private migrateSelfInChains(): void {
    if (!this.selfHash || !this.selfKey) return;
    for (const ev of this.events) {
      const c = ev.chain;
      if (!c || c.length === 0) continue;
      if (ev.kind === 'rx') {
        if (c[c.length - 1] === this.selfHash) c[c.length - 1] = this.selfKey;
      } else if (c[0] === this.selfHash) {
        c[0] = this.selfKey;
      }
    }
  }

  /** Sucht eine Identitaet anhand eines Public-Key-Prefix (z.B. 6 Byte aus einer Nachricht). */
  findByPrefix(prefixHex: string): Identity | null {
    const pfx = prefixHex.toLowerCase();
    for (const id of this.identities.values()) {
      if (id.pubkey.startsWith(pfx)) return id;
    }
    return null;
  }

  /**
   * Loest einen Path-Hash zu bekannten Identitaeten auf. Da der Hash nur ein
   * Prefix des Public Key ist, kann er mehrdeutig sein - deshalb werden alle
   * Treffer geliefert statt stillschweigend einer geraten.
   */
  resolveHash(hash: string): Identity[] {
    const matches: Identity[] = [];
    for (const id of this.identities.values()) {
      if (id.pubkey.startsWith(hash)) matches.push(id);
    }
    return matches;
  }

  /* ---------------- Ereignisse ---------------- */

  private addEvent(ev: TopoEvent): void {
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.dirty = true;
  }

  /** Verarbeitet ein PUSH_CODE_LOG_RX_DATA-Ereignis (jedes empfangene Funkpaket). */
  addRxPacket(rx: { snr: number; rssi: number; packet: RawPacket }): void {
    const pkt = rx.packet;
    const t = Date.now();

    // Adverts liefern Identitaet und Position frei Haus, auch fuer Knoten,
    // die nicht in der Kontaktliste des Geraets stehen.
    if (pkt.advert) {
      this.upsertIdentity(pkt.advert.publicKey, {
        name: pkt.advert.advName,
        type: pkt.advert.type,
        lat: pkt.advert.lat,
        lon: pkt.advert.lon,
        lastAdvert: pkt.advert.timestamp,
      });
    }

    const chain = this.buildChain(pkt);
    if (!chain || chain.length < 2) {
      // Kein verwertbarer Weg (z.B. verschluesseltes ACK ohne Pfad),
      // trotzdem als Verkehrsaufkommen zaehlen.
      this.addEvent({
        t,
        kind: 'rx',
        chain: [],
        measuredInto: null,
        payloadType: pkt.payloadType,
        routeType: pkt.routeType,
        rssi: rx.rssi,
        snr: rx.snr,
        bytes: pkt.rawLength,
      });
      this.emit();
      return;
    }

    // Nur bei Flood kennen wir den tatsaechlichen letzten Sender und damit den
    // Link, dessen Feldstaerke wir gemessen haben.
    const measuredInto = pkt.isFlood ? chain[chain.length - 2] : null;

    this.addEvent({
      t,
      kind: 'rx',
      chain,
      provenance: pkt.isFlood ? PROVENANCE.OBSERVED : PROVENANCE.DECLARED,
      measuredInto,
      payloadType: pkt.payloadType,
      routeType: pkt.routeType,
      rssi: rx.rssi,
      snr: rx.snr,
      bytes: pkt.rawLength,
    });
    this.emit();
  }

  /**
   * Baut die Hop-Kette eines Pakets.
   * Flood : [Urheber?] + durchlaufene Repeater + [wir]
   * Direct: das Pfad-Feld selbst (verbleibende Route)
   */
  private buildChain(pkt: RawPacket): string[] {
    if (pkt.isFlood) {
      const chain: string[] = [];
      if (pkt.originHash) chain.push(pkt.originHash);
      for (const h of pkt.path) chain.push(h);
      if (this.selfKey) chain.push(this.selfKey);
      return dedupeAdjacent(chain);
    }
    // Direct: TRACE fuehrt seine Hop-Liste im Payload, nicht im Pfad-Feld.
    if (pkt.trace && pkt.trace.hops.length) return dedupeAdjacent(pkt.trace.hops.slice());
    return dedupeAdjacent(pkt.path.slice());
  }

  /** Deklarierte Route aus dem out_path eines Kontakts (wir -> ... -> Kontakt). */
  addContactPath(contact: ContactFrame): void {
    if (!contact.outPath || contact.outPath.length === 0) return;
    if (!this.selfKey) return;
    const chain = dedupeAdjacent([this.selfKey, ...contact.outPath, contact.publicKey]);
    if (chain.length < 2) return;
    this.addEvent({
      t: Date.now(),
      kind: 'path',
      chain,
      provenance: PROVENANCE.DECLARED,
      measuredInto: null,
      payloadType: null,
      routeType: null,
      rssi: null,
      snr: null,
      bytes: 0,
      weight: 0, // deklarierte Routen erzeugen keine "Hitze"
    });
    this.emit();
  }

  /** Trace-Ergebnis: Hop-Liste mit SNR pro Hop. */
  addTrace(trace: TraceDataFrame): void {
    if (!trace.hops || trace.hops.length === 0) return;
    const chain = dedupeAdjacent(this.selfKey ? [this.selfKey, ...trace.hops] : trace.hops.slice());
    this.addEvent({
      t: Date.now(),
      kind: 'trace',
      chain,
      provenance: PROVENANCE.TRACE,
      measuredInto: null,
      hopSnrs: trace.snrs,
      payloadType: PAYLOAD_TYPE.TRACE,
      routeType: null,
      rssi: null,
      snr: trace.finalSnr,
      bytes: 0,
      weight: 0,
    });
    this.emit();
  }

  /**
   * Ergebnis einer Pfad-Discovery ("Ping"): Hin- und Rueckweg zu einem Kontakt.
   * Beide Richtungen sind deklarierte Routen - das Netz haelt sie fuer gueltig,
   * gemessene Feldstaerken liefern sie nicht.
   */
  addDiscoveredPaths(targetHash: string, outPath: string[], inPath: string[]): void {
    if (!this.selfKey) return;
    const self = this.selfKey;
    const add = (hops: string[] | null, reverse: boolean): void => {
      if (!hops) return;
      const chain = reverse
        ? dedupeAdjacent([targetHash, ...hops, self])
        : dedupeAdjacent([self, ...hops, targetHash]);
      if (chain.length < 2) return;
      this.addEvent({
        t: Date.now(),
        kind: 'path',
        chain,
        provenance: PROVENANCE.DECLARED,
        measuredInto: null,
        payloadType: null,
        routeType: null,
        rssi: null,
        snr: null,
        bytes: 0,
        weight: 0,
      });
    };
    add(outPath, false);
    add(inPath, true);
    this.emit();
  }

  /** Nimmt eine Nachricht in den Verlauf auf (empfangen oder gesendet). */
  addMessage(msg: Omit<ChatMessage, 'id'>): void {
    this.messages.push({ id: `${Date.now()}-${this.messages.length}`, ...msg });
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    }
    this.emit();
  }

  markLastOutgoingDelivered(): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.dir === 'out' && !m.isChannel && m.state === 'sent') {
        m.state = 'delivered';
        this.emit();
        return;
      }
    }
  }

  /* ---------------- Ableitung ---------------- */

  /** Aggregiert das Ereignis-Log zu Knoten, Funkstrecken und Routen. */
  computeView(filter: ViewFilter): TopoView {
    const { windowMs, payloadTypes, includeDeclared } = filter;

    const cacheKey = JSON.stringify([
      windowMs,
      payloadTypes ? [...payloadTypes].sort() : null,
      includeDeclared,
      this.events.length,
      this.identities.size,
    ]);
    if (!this.dirty && this.cacheKey === cacheKey && this.cache) return this.cache;

    const now = Date.now();
    const cutoff = windowMs ? now - windowMs : 0;

    /*
     * Jeder Hash wird auf einen kanonischen Knotenschluessel abgebildet: den
     * vollen Public Key, wenn genau eine bekannte Identitaet mit dem Prefix
     * beginnt. Passen mehrere (zu kurzer Hash) oder keine, bleibt der Hash fuer
     * sich stehen - geraten wird nicht.
     *
     * Zusaetzlich wird festgehalten, WIE sicher die Zuordnung war. Ein Treffer
     * ueber ein einzelnes Byte ist nur "weak": unter den bekannten Knoten passt
     * genau einer, ein unbekannter Knoten mit demselben Anfangsbyte waere aber
     * nicht davon zu unterscheiden.
     */
    const byFirstByte = new Map<string, Identity[]>();
    for (const id of this.identities.values()) {
      const b = id.pubkey.slice(0, 2);
      const bucket = byFirstByte.get(b);
      if (bucket) bucket.push(id);
      else byFirstByte.set(b, [id]);
    }

    const canonCache = new Map<string, Resolved>();
    const canon = (hash: string): Resolved => {
      const cached = canonCache.get(hash);
      if (cached) return cached;
      const bucket = byFirstByte.get(hash.slice(0, 2)) ?? [];
      const hits = bucket.filter((id) => id.pubkey.startsWith(hash));
      let r: Resolved;
      if (hits.length === 1) {
        const full = hash.length === 64;
        r = {
          key: hits[0].pubkey,
          id: hits[0],
          certainty: full ? 'exact' : hash.length / 2 >= UNIQUE_HASH_BYTES ? 'unique' : 'weak',
          hash,
          candidates: hits,
        };
      } else {
        r = {
          key: `#${hash}`,
          id: null,
          certainty: hits.length > 1 ? 'ambiguous' : 'unknown',
          hash,
          candidates: hits,
        };
      }
      canonCache.set(hash, r);
      return r;
    };

    const selfCanon = this.selfKey; // eigene Identitaet ist exakt bekannt

    const links = new Map<string, ViewLink>();
    const routes = new Map<string, ViewRoute>();
    const nodeStats = new Map<string, NodeStats>();
    /** Beste je erreichte Sicherheit und beobachtete Hash-Laengen je Knoten. */
    const nodeCertainty = new Map<string, { best: Certainty; weak: boolean; lens: Set<number> }>();

    const nodeStat = (key: string): NodeStats => {
      let s = nodeStats.get(key);
      if (!s) {
        s = {
          key,
          rx: 0,
          asOrigin: 0,
          asHop: 0,
          asTransmitter: 0,
          rssi: newStats(),
          snr: newStats(),
          lastSeen: 0,
        };
        nodeStats.set(key, s);
      }
      return s;
    };

    const noteCertainty = (r: Resolved): void => {
      let c = nodeCertainty.get(r.key);
      if (!c) {
        c = { best: r.certainty, weak: false, lens: new Set() };
        nodeCertainty.set(r.key, c);
      }
      c.best = better(c.best, r.certainty);
      if (r.certainty === 'weak') c.weak = true;
      if (r.hash.length < 64) c.lens.add(r.hash.length / 2);
    };

    let packetCount = 0;
    let byteCount = 0;
    const payloadHistogram = new Map<number, number>();
    let oldest = Infinity;

    for (const ev of this.events) {
      if (ev.t < cutoff) continue;
      if (!includeDeclared && ev.provenance === PROVENANCE.DECLARED) continue;
      if (payloadTypes && ev.payloadType != null && !payloadTypes.has(ev.payloadType)) continue;

      if (ev.kind === 'rx') {
        packetCount++;
        byteCount += ev.bytes || 0;
        if (ev.t < oldest) oldest = ev.t;
        payloadHistogram.set(ev.payloadType ?? -1, (payloadHistogram.get(ev.payloadType ?? -1) || 0) + 1);
      }

      const weight = ev.weight != null ? ev.weight : 1;
      if (!ev.chain || ev.chain.length < 2) continue;

      // Ab hier wird ausschliesslich mit kanonischen Knotenschluesseln gearbeitet.
      const resolvedRaw = ev.chain.map(canon);
      for (const r of resolvedRaw) noteCertainty(r);

      // Doppelte Nachbarn zusammenfassen, die erst durch die Aufloesung
      // entstehen (z.B. "fd" und "fddc80" sind derselbe Knoten).
      const resolved: Resolved[] = [];
      for (const r of resolvedRaw) {
        const prev = resolved[resolved.length - 1];
        if (prev && prev.key === r.key) {
          // Laengerer Hash gewinnt: er ist die genauere Beobachtung.
          if (CERTAINTY_RANK[r.certainty] > CERTAINTY_RANK[prev.certainty]) {
            resolved[resolved.length - 1] = r;
          }
          continue;
        }
        resolved.push(r);
      }
      if (resolved.length < 2) continue;
      const chain = resolved.map((r) => r.key);
      const measuredInto = ev.measuredInto != null ? canon(ev.measuredInto).key : null;

      // Knoten-Rollen
      if (ev.kind === 'rx') {
        const s0 = nodeStat(chain[0]);
        s0.asOrigin += weight;
        s0.lastSeen = Math.max(s0.lastSeen, ev.t);
        for (let i = 1; i < chain.length - 1; i++) {
          const s = nodeStat(chain[i]);
          s.asHop += weight;
          s.lastSeen = Math.max(s.lastSeen, ev.t);
        }
      }

      // Kanten
      let chainCertain = true;
      for (let i = 0; i < resolved.length - 1; i++) {
        const ra = resolved[i];
        const rb = resolved[i + 1];
        const a = ra.key;
        const b = rb.key;
        if (a === b) continue;
        const edgeCertainty = worse(ra.certainty, rb.certainty);
        const certain = isCertain(edgeCertainty);
        if (!certain) chainCertain = false;

        const isMeasured = measuredInto != null && a === measuredInto && b === selfCanon;
        const key = linkKey(a, b);
        let link = links.get(key);
        if (!link) {
          const [lo, hi] = key.split('|');
          link = {
            key,
            a: lo,
            b: hi,
            countAB: 0,
            countBA: 0,
            total: 0,
            firstSeen: ev.t,
            lastSeen: ev.t,
            provenance: new Set(),
            rssi: newStats(),
            snr: newStats(),
            byPayload: new Map(),
            measuredCount: 0,
            certainCount: 0,
            weakCount: 0,
            ambiguous: true,
          };
          links.set(key, link);
        }
        if (a === link.a) link.countAB += weight;
        else link.countBA += weight;
        link.total += weight;
        link.firstSeen = Math.min(link.firstSeen, ev.t);
        link.lastSeen = Math.max(link.lastSeen, ev.t);
        link.provenance.add(isMeasured ? PROVENANCE.MEASURED : ev.provenance || PROVENANCE.OBSERVED);
        // Die Sicherheit zaehlt je Beobachtung, nicht je Paket: auch eine
        // deklarierte Route (weight 0) belegt, dass es die Strecke gibt.
        if (certain) {
          link.certainCount++;
          link.ambiguous = false;
        } else {
          link.weakCount++;
        }
        if (ev.payloadType != null) {
          link.byPayload.set(ev.payloadType, (link.byPayload.get(ev.payloadType) || 0) + weight);
        }
        if (isMeasured) {
          link.measuredCount++;
          pushStat(link.rssi, ev.rssi);
          pushStat(link.snr, ev.snr);
          const st = nodeStat(a);
          st.asTransmitter++;
          pushStat(st.rssi, ev.rssi);
          pushStat(st.snr, ev.snr);
        }
        // SNR pro Hop aus einem Trace uebernehmen
        if (ev.kind === 'trace' && ev.hopSnrs && ev.hopSnrs[i] != null) {
          pushStat(link.snr, ev.hopSnrs[i]);
        }
      }

      // Routen
      const rKey = chain.join('>');
      let route = routes.get(rKey);
      if (!route) {
        route = {
          key: rKey,
          chain: chain.slice(),
          count: 0,
          firstSeen: ev.t,
          lastSeen: ev.t,
          provenance: new Set(),
          rssi: newStats(),
          snr: newStats(),
          byPayload: new Map(),
          hops: chain.length - 1,
          certainCount: 0,
          ambiguous: true,
        };
        routes.set(rKey, route);
      }
      route.count += weight;
      route.firstSeen = Math.min(route.firstSeen, ev.t);
      route.lastSeen = Math.max(route.lastSeen, ev.t);
      route.provenance.add(ev.provenance || PROVENANCE.OBSERVED);
      if (chainCertain) {
        route.certainCount++;
        route.ambiguous = false;
      }
      if (ev.payloadType != null) {
        route.byPayload.set(ev.payloadType, (route.byPayload.get(ev.payloadType) || 0) + weight);
      }
      if (ev.measuredInto != null) {
        pushStat(route.rssi, ev.rssi);
        pushStat(route.snr, ev.snr);
      }
    }

    // Knoten zusammenstellen: bekannte Identitaeten ...
    const nodes = new Map<string, ViewNode>();
    for (const id of this.identities.values()) {
      const c = nodeCertainty.get(id.pubkey);
      nodes.set(id.pubkey, {
        key: id.pubkey,
        pubkey: id.pubkey,
        hash: id.hash,
        name: id.name || `(${id.hash})`,
        type: id.type,
        typeName: ADV_TYPE_NAMES[id.type] || 'Unbekannt',
        lat: id.lat,
        lon: id.lon,
        hasPos: isValidCoord(id.lat, id.lon),
        lastAdvert: id.lastAdvert,
        isSelf: id.isSelf,
        known: true,
        certainty: id.isSelf ? 'exact' : (c?.best ?? 'unique'),
        seenWeak: c?.weak ?? false,
        hashBytes: c ? [...c.lens].sort((x, y) => x - y) : [],
        candidates: null,
        stats: nodeStats.get(id.pubkey) || null,
      });
    }

    // ... und Platzhalter fuer Hashes, die keiner EINDEUTIGEN Identitaet
    // zugeordnet werden konnten (unbekannt oder zu kurz und damit mehrdeutig).
    for (const [key, st] of nodeStats) {
      if (nodes.has(key)) continue;
      const hash = key.startsWith('#') ? key.slice(1) : key;
      const r = canonCache.get(hash);
      const ambiguous = r?.certainty === 'ambiguous';
      nodes.set(key, {
        key,
        pubkey: null,
        hash,
        name: `#${hash}`,
        type: ADV_TYPE.NONE,
        typeName: ambiguous ? 'Mehrdeutig' : 'Unbekannt',
        lat: null,
        lon: null,
        hasPos: false,
        lastAdvert: 0,
        isSelf: false,
        known: false,
        certainty: r?.certainty ?? 'unknown',
        seenWeak: false,
        hashBytes: [hash.length / 2],
        candidates: ambiguous ? r!.candidates.map((x) => x.name || `(${x.hash})`) : null,
        stats: st,
      });
    }

    const spanMs = packetCount > 0 && oldest !== Infinity ? Math.max(now - oldest, 1000) : 0;
    const allLinks = [...links.values()];

    const view: TopoView = {
      nodes,
      links,
      routes,
      nodeStats,
      totals: {
        packets: packetCount,
        bytes: byteCount,
        links: links.size,
        certainLinks: allLinks.filter((l) => !l.ambiguous).length,
        routes: routes.size,
        nodes: nodes.size,
        knownNodes: [...nodes.values()].filter((n) => n.known).length,
        positioned: [...nodes.values()].filter((n) => n.hasPos).length,
        // Erst ab einem halbwegs belastbaren Beobachtungszeitraum ausweisen -
        // sonst extrapoliert ein Sekundenbruchteil zu Fantasiewerten.
        packetsPerMin: spanMs >= 30000 ? (packetCount / spanMs) * 60000 : null,
        payloadHistogram,
        maxLinkCount: Math.max(1, ...allLinks.map((l) => l.total)),
      },
      nodeForKey: (key) => nodes.get(key) || null,
      nodeForHash: (hash) => nodes.get(canon(hash).key) || null,
      keyForHash: (hash) => canon(hash).key,
    };

    this.cache = view;
    this.cacheKey = cacheKey;
    this.dirty = false;
    return view;
  }

  /* ---------------- Persistenz ---------------- */

  toJSON(): StoredModel {
    return {
      version: STORAGE_VERSION,
      savedAt: Date.now(),
      selfKey: this.selfKey,
      selfHash: this.selfHash,
      selfInfo: this.selfInfo,
      deviceInfo: this.deviceInfo,
      identities: [...this.identities.values()],
      events: this.events,
      messages: this.messages,
    };
  }

  loadJSON(data: StoredModel): void {
    if (!data || data.version !== STORAGE_VERSION) throw new Error('Unbekanntes Dateiformat');
    this.identities = new Map((data.identities || []).map((id) => [id.pubkey, id]));
    this.events = data.events || [];
    this.messages = data.messages || [];
    this.selfKey = data.selfKey || null;
    this.selfHash = data.selfHash || null;
    this.selfInfo = data.selfInfo || null;
    this.deviceInfo = data.deviceInfo || null;
    this.dirty = true;
    this.emit();
  }

  clear(): void {
    this.events = [];
    this.messages = [];
    this.identities.clear();
    if (this.selfInfo) this.setSelf(this.selfInfo);
    this.dirty = true;
    this.emit();
  }

  /** Verwirft nur Verkehr und Nachrichten; die Identitaeten bleiben stehen. */
  clearTraffic(): void {
    this.events = [];
    this.messages = [];
    this.dirty = true;
    this.emit();
  }
}
