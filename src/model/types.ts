/** Datentypen des Topologie-Modells. */

/** Herkunft einer Kante - bestimmt Aussagekraft und Darstellung. */
export const PROVENANCE = {
  /** Letzter Hop zu uns: RSSI/SNR real gemessen. */
  MEASURED: 'measured',
  /** Paket ist diesen Weg nachweislich gelaufen (Flood-Pfad). */
  OBSERVED: 'observed',
  /** Route, die das Netz fuer gueltig haelt (Direct-Pfad, out_path). */
  DECLARED: 'declared',
  /** Aus einem Trace-Ergebnis, mit SNR pro Hop. */
  TRACE: 'trace',
} as const;

export type Provenance = (typeof PROVENANCE)[keyof typeof PROVENANCE];

/**
 * Wie sicher ein Pfad-Hash einem Knoten zugeordnet werden konnte.
 *
 * Ein Path-Hash ist nur ein PREFIX des Public Key (Identity.h) und seine Laenge
 * schwankt je nach `path_hash_mode` des sendenden Netzes zwischen 1 und 3 Byte.
 * Ein einzelnes Byte kann deshalb prinzipiell mehrere Knoten meinen.
 */
export type Certainty =
  /** Voller Public Key - unverwechselbar (nur das eigene Geraet). */
  | 'exact'
  /** Hash lang genug und passt auf genau eine bekannte Identitaet. */
  | 'unique'
  /** Passt auf genau eine bekannte Identitaet, aber nur ueber 1 Byte:
   *  ein unbekannter Knoten mit demselben Anfangsbyte waere nicht zu unterscheiden. */
  | 'weak'
  /** Passt auf mehrere bekannte Identitaeten - nicht aufloesbar. */
  | 'ambiguous'
  /** Passt auf keine bekannte Identitaet. */
  | 'unknown';

/**
 * Ab wie vielen Byte ein Hash als eindeutig gilt.
 *
 * Bei 2 Byte (16 Bit) liegt die Wahrscheinlichkeit, dass ein bestimmter
 * weiterer Knoten dasselbe Prefix traegt, bei 1/65536; selbst in einem Netz mit
 * einigen tausend Knoten bleibt das die Ausnahme. Bei 1 Byte dagegen teilen
 * sich in einem Netz dieser Groesse regelmaessig mehrere Knoten dasselbe Byte -
 * deshalb liegt die Grenze genau hier.
 */
export const UNIQUE_HASH_BYTES = 2;

/** Gilt die Zuordnung als belastbar? */
export function isCertain(c: Certainty): boolean {
  return c === 'exact' || c === 'unique';
}

export interface Identity {
  pubkey: string;
  hash: string;
  name: string;
  type: number;
  lat: number | null;
  lon: number | null;
  lastAdvert: number;
  outPath: string[] | null;
  isSelf: boolean;
  firstSeen: number;
}

export interface Stats {
  n: number;
  sum: number;
  min: number;
  max: number;
  last: number | null;
}

export type EventKind = 'rx' | 'path' | 'trace';

/**
 * Ein Ereignis des Logs. Die Kette enthaelt ROHE Pfad-Hashes in der Form, in
 * der sie auf dem Funk lagen (plus den eigenen vollen Public Key an unserer
 * Stelle) - die Aufloesung auf Knoten passiert erst beim Ableiten der Sicht.
 */
export interface TopoEvent {
  t: number;
  kind: EventKind;
  chain: string[];
  provenance?: Provenance;
  /** Hash des Senders, den wir direkt gehoert haben (nur bei Flood). */
  measuredInto: string | null;
  payloadType: number | null;
  routeType: number | null;
  rssi: number | null;
  snr: number | null;
  bytes: number;
  weight?: number;
  hopSnrs?: number[];
}

export interface NodeStats {
  key: string;
  rx: number;
  asOrigin: number;
  asHop: number;
  asTransmitter: number;
  rssi: Stats;
  snr: Stats;
  lastSeen: number;
}

export interface ViewNode {
  key: string;
  pubkey: string | null;
  hash: string;
  name: string;
  type: number;
  typeName: string;
  lat: number | null;
  lon: number | null;
  hasPos: boolean;
  lastAdvert: number;
  isSelf: boolean;
  known: boolean;
  /** Beste Sicherheit, mit der dieser Knoten je identifiziert wurde. */
  certainty: Certainty;
  /** Wurde er auch schon einmal nur ueber ein einzelnes Byte erkannt? */
  seenWeak: boolean;
  /** Hash-Laengen (in Byte), unter denen er im Funkverkehr auftauchte. */
  hashBytes: number[];
  /** Bei Mehrdeutigkeit: Namen der bekannten Knoten, die auch passen. */
  candidates: string[] | null;
  stats: NodeStats | null;
}

export interface ViewLink {
  key: string;
  a: string;
  b: string;
  countAB: number;
  countBA: number;
  total: number;
  firstSeen: number;
  lastSeen: number;
  provenance: Set<Provenance>;
  rssi: Stats;
  snr: Stats;
  byPayload: Map<number, number>;
  measuredCount: number;
  /** Beobachtungen, bei denen BEIDE Endpunkte zweifelsfrei bestimmt waren. */
  certainCount: number;
  /** Beobachtungen, bei denen mindestens ein Endpunkt unsicher war. */
  weakCount: number;
  /** true, wenn es keine einzige zweifelsfreie Beobachtung gibt. */
  ambiguous: boolean;
}

export interface ViewRoute {
  key: string;
  chain: string[];
  count: number;
  firstSeen: number;
  lastSeen: number;
  provenance: Set<Provenance>;
  rssi: Stats;
  snr: Stats;
  byPayload: Map<number, number>;
  hops: number;
  certainCount: number;
  ambiguous: boolean;
}

export interface ViewTotals {
  packets: number;
  bytes: number;
  links: number;
  certainLinks: number;
  routes: number;
  nodes: number;
  knownNodes: number;
  positioned: number;
  packetsPerMin: number | null;
  payloadHistogram: Map<number, number>;
  maxLinkCount: number;
}

export interface TopoView {
  nodes: Map<string, ViewNode>;
  links: Map<string, ViewLink>;
  routes: Map<string, ViewRoute>;
  nodeStats: Map<string, NodeStats>;
  totals: ViewTotals;
  nodeForKey(key: string): ViewNode | null;
  nodeForHash(hash: string): ViewNode | null;
  keyForHash(hash: string): string;
}

export interface ViewFilter {
  windowMs: number | null;
  payloadTypes: Set<number> | null;
  includeDeclared: boolean;
}

export interface ChatMessage {
  id: string;
  dir: 'in' | 'out';
  t: number;
  senderTimestamp: number;
  fromName: string;
  fromKey?: string | null;
  toName?: string;
  toKey?: string;
  isChannel: boolean;
  channelIdx?: number | null;
  text: string;
  snr?: number | null;
  pathLen?: number | null;
  viaFlood?: boolean;
  txtType?: number;
  state?: 'sent' | 'delivered';
  /**
   * Hop-Kette dieser Nachricht als rohe Pfad-Hashes.
   *
   * Beim EMPFANG steht der Pfad nicht in der Nachricht selbst - das Frame
   * nennt nur die Anzahl der Hops. Die Kette stammt deshalb aus dem
   * RX-Protokoll: dem zuletzt gehoerten Textpaket, dessen Absenderbyte und
   * Hop-Zahl zu dieser Nachricht passen. Das ist eine Zuordnung, keine
   * Ablesung - deshalb `chainGuess`.
   *
   * Beim SENDEN ist es der bekannte Pfad zum Empfaenger (out_path), also eine
   * deklarierte Route.
   */
  chain?: string[] | null;
  chainGuess?: boolean;
}
