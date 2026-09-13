/**
 * Verdrahtung zwischen Funkgeraet und Modell.
 *
 * Diese Klasse kennt React nicht. Sie haelt den gesamten veraenderlichen
 * Zustand (Verbindung, Ereignisse, Chat, Terminal, Geraeteeinstellungen) und
 * meldet Aenderungen ueber nummerierte Scheiben ("slices") an die Oberflaeche.
 * Der Grund fuer die Trennung: bei lebhaftem Funkverkehr treffen mehrere
 * Pakete pro Sekunde ein. Wuerde jedes davon einen Neuaufbau der Karte
 * ausloesen, waere die Anwendung unbedienbar - die Scheibe `data` wird deshalb
 * gedrosselt, alle anderen melden sofort.
 *
 * Ablauf nach dem Verbinden:
 *   CMD_DEVICE_QUERY -> RESP_CODE_DEVICE_INFO   (Firmware-Version)
 *   CMD_APP_START    -> RESP_CODE_SELF_INFO     (eigener Public Key, Funkparameter)
 *   CMD_GET_CONTACTS -> RESP_CODE_CONTACT*      (bekannte Knoten inkl. out_path)
 * danach passiv: PUSH_CODE_LOG_RX_DATA fuer jedes empfangene Funkpaket.
 */

import {
  APP_TARGET_VER,
  ADV_TYPE_NAMES,
  ERR_NAMES,
  PAYLOAD_TYPE,
  TXT_TYPE,
} from '../protocol/constants';
import {
  buildRoundTripPath,
  cmdAppStart,
  cmdDeviceQuery,
  cmdGetBattAndStorage,
  cmdGetContacts,
  cmdGetDeviceTime,
  cmdGetTuningParams,
  cmdLogout,
  cmdSendChannelTextMsg,
  cmdSendLogin,
  cmdSendPathDiscovery,
  cmdSendTextMsg,
  cmdSendTracePath,
  cmdSyncNextMessage,
} from '../protocol/commands';
import { parseFrame, type AnyMsgFrame, type Frame } from '../protocol/frames';
import { MeshCoreBLE, errorText, type LogLevel } from '../transport/ble';
import { TopologyModel } from '../model/topology';
import type { StoredModel } from '../model/topology';
import type { ViewNode } from '../model/types';

export type Slice = 'data' | 'ui' | 'chat' | 'terminal' | 'config';
export type ConnState = 'off' | 'busy' | 'on' | 'err';

const SLICES: Slice[] = ['data', 'ui', 'chat', 'terminal', 'config'];

/** Hoechstens so oft wird die Karte bei laufendem Funkverkehr neu aufgebaut. */
const DATA_THROTTLE_MS = 750;
/** So lange wird auf die Antwort eines Kommandos gewartet. */
const ACK_TIMEOUT_MS = 8000;
/** So lange bleibt ein Ping oder Trace offen, bevor er als verloren gilt. */
const REQUEST_TIMEOUT_MS = 120000;
/** So lange gilt ein gehoertes Textpaket als moegliche Quelle einer Nachricht. */
const TEXT_MATCH_WINDOW_MS = 90000;
/** So viele gehoerte Textpakete werden fuer die Zuordnung vorgehalten. */
const TEXT_BUFFER = 60;

export interface LogLine {
  id: number;
  t: number;
  msg: string;
  level: LogLevel;
}

export interface TerminalLine {
  id: number;
  t: number;
  dir: 'in' | 'out' | 'note';
  text: string;
}

export interface TerminalSession {
  pubkey: string;
  name: string;
  status: 'neu' | 'anmeldung' | 'bereit' | 'abgelehnt';
  /** Rechte, die der Gegenknoten nach dem Login gemeldet hat. */
  permissions: number | null;
  lines: TerminalLine[];
  history: string[];
}

export interface AckResult {
  ok: boolean;
  errCode?: number;
  timeout?: boolean;
  text: string;
}

interface PendingAck {
  label: string;
  resolve(result: AckResult): void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingRequest {
  key: string;
  kind: 'ping' | 'trace';
  targetKey: string | null;
  targetName: string;
  sentAt: number;
  tag: number | null;
  timer: ReturnType<typeof setTimeout>;
}

/** Ein gehoertes Textpaket - Rohstoff fuer die Zuordnung von Nachricht zu Pfad. */
interface HeardText {
  t: number;
  payloadType: number;
  /** Erstes Byte des Absender-Public-Key, soweit im Klartext vorhanden. */
  srcHash: string | null;
  hops: number;
  chain: string[];
}

export type PacketListener = (chain: string[]) => void;

export interface DeviceRuntime {
  batteryMilliVolts: number | null;
  storageUsedKb: number | null;
  storageTotalKb: number | null;
  rxDelayBase: number | null;
  airtimeFactor: number | null;
  /** Geraetezeit minus Browserzeit, in Sekunden. */
  timeOffsetSec: number;
}

let nextId = 1;

export class MeshController {
  readonly model = new TopologyModel();
  readonly ble: MeshCoreBLE;

  connState: ConnState = 'off';
  deviceName = '';
  log: LogLine[] = [];
  terminals = new Map<string, TerminalSession>();
  runtime: DeviceRuntime = {
    batteryMilliVolts: null,
    storageUsedKb: null,
    storageTotalKb: null,
    rxDelayBase: null,
    airtimeFactor: null,
    timeOffsetSec: 0,
  };

  private versions: Record<Slice, number> = { data: 0, ui: 0, chat: 0, terminal: 0, config: 0 };
  private listeners: Record<Slice, Set<() => void>> = {
    data: new Set(),
    ui: new Set(),
    chat: new Set(),
    terminal: new Set(),
    config: new Set(),
  };

  private dataTimer: ReturnType<typeof setTimeout> | null = null;
  private dataPending = false;
  private contactsLoading = false;
  private ackQueue: PendingAck[] = [];
  private requests = new Map<string, PendingRequest>();
  private heardText: HeardText[] = [];
  private packetListeners = new Set<PacketListener>();

  constructor() {
    this.ble = new MeshCoreBLE({
      onFrame: (bytes) => this.onFrame(bytes),
      onLog: (msg, level) => this.addLog(msg, level),
      onConnected: (name) => this.onConnected(name),
      onDisconnected: (intentional) => this.onDisconnected(intentional),
    });
    // Jede Modelaenderung faerbt die Datenscheibe schmutzig; das Drosseln
    // uebernimmt bumpData().
    this.model.subscribe(() => this.bump('data'));
  }

  /* ---------------- Abonnements ---------------- */

  subscribe(slice: Slice, fn: () => void): () => void {
    this.listeners[slice].add(fn);
    return () => {
      this.listeners[slice].delete(fn);
    };
  }

  getVersion(slice: Slice): number {
    return this.versions[slice];
  }

  /**
   * Meldet jedes eingetroffene Funkpaket mit seiner Hop-Kette (rohe Hashes).
   *
   * Bewusst KEINE Scheibe: die Karte laesst den Pfad kurz aufleuchten, und das
   * soll ohne Neuaufbau des React-Baums passieren - bei lebhaftem Verkehr sind
   * das mehrere Ereignisse pro Sekunde.
   */
  subscribePackets(fn: PacketListener): () => void {
    this.packetListeners.add(fn);
    return () => {
      this.packetListeners.delete(fn);
    };
  }

  private bump(slice: Slice): void {
    if (slice === 'data') {
      this.bumpDataThrottled();
      return;
    }
    this.versions[slice]++;
    for (const fn of this.listeners[slice]) fn();
  }

  private bumpDataThrottled(): void {
    if (this.dataTimer) {
      this.dataPending = true;
      return;
    }
    this.flushData();
    this.dataTimer = setTimeout(() => {
      this.dataTimer = null;
      if (this.dataPending) {
        this.dataPending = false;
        this.bumpDataThrottled();
      }
    }, DATA_THROTTLE_MS);
  }

  /** Erzwingt sofort einen Neuaufbau (z.B. nach einer Nutzeraktion). */
  refreshNow(): void {
    if (this.dataTimer) {
      clearTimeout(this.dataTimer);
      this.dataTimer = null;
    }
    this.dataPending = false;
    this.flushData();
  }

  private flushData(): void {
    this.versions.data++;
    for (const fn of this.listeners.data) fn();
  }

  dispose(): void {
    if (this.dataTimer) clearTimeout(this.dataTimer);
    for (const s of SLICES) this.listeners[s].clear();
  }

  /* ---------------- Protokollzeile ---------------- */

  addLog(msg: string, level: LogLevel = 'info'): void {
    this.log = [...this.log.slice(-199), { id: nextId++, t: Date.now(), msg, level }];
    this.bump('ui');
  }

  /* ---------------- Verbindung ---------------- */

  async connect(): Promise<void> {
    try {
      this.connState = 'busy';
      this.bump('ui');
      await this.ble.connect();
    } catch (err) {
      this.connState = 'off';
      this.bump('ui');
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        this.addLog('Keine Auswahl getroffen.', 'warn');
      } else {
        this.addLog(`Verbindung fehlgeschlagen: ${errorText(err)}`, 'error');
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.ble.disconnect();
  }

  private onConnected(name: string): void {
    this.connState = 'busy';
    this.deviceName = name;
    this.bump('ui');
    void this.ble.send(cmdDeviceQuery(APP_TARGET_VER));
    void this.ble.send(cmdAppStart('meshcore-topo', APP_TARGET_VER));
    // Die Kontaktliste wird erst nach SELF_INFO angefordert (siehe onFrame).
  }

  private onDisconnected(intentional: boolean): void {
    this.connState = 'off';
    this.ackQueue.forEach((a) => {
      clearTimeout(a.timer);
      a.resolve({ ok: false, timeout: true, text: 'Verbindung getrennt' });
    });
    this.ackQueue = [];
    this.bump('ui');
    if (!intentional) {
      this.addLog('Verbindung unterbrochen - erneut verbinden, um weiter aufzuzeichnen.', 'warn');
    }
  }

  get connected(): boolean {
    return this.ble.connected;
  }

  /* ---------------- Kommandos mit Quittung ---------------- */

  /**
   * Sendet ein Kommando und wartet auf die Quittung des Geraets.
   *
   * Das Protokoll kennt fuer diese Kommandos keine Vorgangsnummern - die
   * Firmware arbeitet Frames aber streng der Reihe nach ab, und der BLE-
   * Transport serialisiert die Schreibvorgaenge. Deshalb genuegt eine
   * Warteschlange: die naechste eintreffende Quittung gehoert zum aeltesten
   * offenen Kommando.
   */
  sendAwaitingAck(frame: Uint8Array, label: string): Promise<AckResult> {
    if (!this.connected) {
      return Promise.resolve({ ok: false, text: 'Nicht verbunden' });
    }
    return new Promise<AckResult>((resolve) => {
      const entry: PendingAck = {
        label,
        resolve,
        timer: setTimeout(() => {
          const idx = this.ackQueue.indexOf(entry);
          if (idx >= 0) this.ackQueue.splice(idx, 1);
          resolve({ ok: false, timeout: true, text: `${label}: keine Antwort vom Gerät` });
        }, ACK_TIMEOUT_MS),
      };
      this.ackQueue.push(entry);
      void this.ble.send(frame);
    });
  }

  private settleAck(result: Omit<AckResult, 'text'> & { text?: string }): PendingAck | null {
    const entry = this.ackQueue.shift();
    if (!entry) return null;
    clearTimeout(entry.timer);
    const text =
      result.text ??
      (result.ok
        ? `${entry.label}: übernommen`
        : `${entry.label}: abgelehnt (${ERR_NAMES[result.errCode ?? 0] || `Code ${result.errCode}`})`);
    entry.resolve({ ...result, text });
    return entry;
  }

  /** Fordert Laufzeitwerte an, die nicht im Handshake stehen. */
  refreshRuntime(): void {
    if (!this.connected) return;
    void this.ble.send(cmdGetTuningParams());
    void this.ble.send(cmdGetBattAndStorage());
    void this.ble.send(cmdGetDeviceTime());
  }

  /** Laedt SELF_INFO neu - noetig, nachdem Einstellungen geschrieben wurden. */
  reloadSelfInfo(): void {
    if (!this.connected) return;
    void this.ble.send(cmdAppStart('meshcore-topo', APP_TARGET_VER));
  }

  /* ---------------- Frame-Verarbeitung ---------------- */

  /** Eintritt fuer Frames - auch aus der Konsole zum Nachspielen von Mitschnitten. */
  onFrame(bytes: Uint8Array): void {
    let frame: Frame | null;
    try {
      frame = parseFrame(bytes);
    } catch (err) {
      this.addLog(`Frame nicht lesbar (${bytes.length} B): ${errorText(err)}`, 'warn');
      return;
    }
    if (!frame) return;

    switch (frame.name) {
      case 'device_info': {
        this.model.deviceInfo = frame;
        this.addLog(
          `Gerät: ${frame.manufacturer} ${frame.firmwareVersion} (Build ${frame.buildDate})`,
          'ok',
        );
        this.bump('config');
        this.bump('ui');
        break;
      }

      case 'self_info': {
        this.model.setSelf(frame);
        const radio = `${frame.freqMHz.toFixed(3)} MHz · BW ${frame.bwKHz} kHz · SF${frame.sf} · CR4/${frame.cr}`;
        this.addLog(
          `Eigener Knoten "${frame.nodeName}" (${frame.publicKey.slice(0, 8)}…), ${radio}`,
          'ok',
        );
        this.connState = 'on';
        this.contactsLoading = true;
        void this.ble.send(cmdGetContacts());
        this.refreshRuntime();
        this.syncMessages();
        this.bump('config');
        this.bump('ui');
        this.refreshNow();
        break;
      }

      case 'contacts_start':
        this.addLog(`Kontaktliste wird geladen (${frame.count ?? 0} Einträge) …`);
        break;

      case 'contact':
        this.model.upsertIdentity(frame.publicKey, {
          name: frame.advName,
          type: frame.type,
          lat: frame.lat,
          lon: frame.lon,
          lastAdvert: frame.lastAdvert,
          outPath: frame.outPath,
        });
        this.model.addContactPath(frame);
        break;

      case 'end_of_contacts': {
        this.contactsLoading = false;
        this.addLog('Kontakte geladen.', 'ok');
        this.refreshNow();
        break;
      }

      case 'log_rx_data': {
        this.model.addRxPacket(frame);
        const pkt = frame.packet;
        // Kette so, wie das Modell sie auch bildet: Urheber, Hops, wir.
        const chain: string[] = [];
        if (pkt.isFlood) {
          if (pkt.originHash) chain.push(pkt.originHash);
          chain.push(...pkt.path);
          if (this.model.selfKey) chain.push(this.model.selfKey);
        } else {
          chain.push(...pkt.path);
        }
        if (chain.length >= 2) {
          for (const fn of this.packetListeners) fn(chain);
        }
        // Textpakete vorhalten: die Nachricht selbst nennt spaeter nur die
        // Hop-ZAHL, nicht den Weg.
        if (pkt.payloadType === PAYLOAD_TYPE.TXT_MSG || pkt.payloadType === PAYLOAD_TYPE.GRP_TXT) {
          this.heardText.push({
            t: Date.now(),
            payloadType: pkt.payloadType,
            srcHash: pkt.originHash,
            hops: pkt.path.length,
            chain,
          });
          if (this.heardText.length > TEXT_BUFFER) this.heardText.shift();
        }
        break;
      }

      case 'new_advert':
        this.model.upsertIdentity(frame.publicKey, {
          name: frame.advName,
          type: frame.type,
          lat: frame.lat,
          lon: frame.lon,
          lastAdvert: frame.lastAdvert,
          outPath: frame.outPath,
        });
        this.addLog(
          `Neuer Knoten: ${frame.advName || frame.publicKey.slice(0, 8)} (${ADV_TYPE_NAMES[frame.type] || '?'})`,
        );
        break;

      case 'path_updated':
        // Der Pfad zu diesem Kontakt hat sich geaendert - Kontaktliste nachziehen.
        if (!this.contactsLoading) {
          this.contactsLoading = true;
          void this.ble.send(cmdGetContacts());
        }
        break;

      case 'path_discovery': {
        const id = this.model.findByPrefix(frame.publicKeyPrefix);
        this.model.addDiscoveredPaths(
          id ? id.pubkey : frame.publicKeyPrefix,
          frame.outPath,
          frame.inPath,
        );
        this.resolveRequest('ping', id ? `ping:${id.pubkey}` : null, (p, ms) => {
          this.addLog(
            `Ping-Antwort von ${p.targetName} nach ${(ms / 1000).toFixed(1)} s · ` +
              `Hinweg ${frame.outPath.length} Hops, Rückweg ${frame.inPath.length} Hops`,
            'ok',
          );
        });
        this.refreshNow();
        break;
      }

      case 'trace_data':
        this.model.addTrace(frame);
        this.resolveRequest('trace', `trace:${frame.tag}`, (p, ms) => {
          const snrs = frame.snrs.map((x) => x.toFixed(1)).join(' / ');
          this.addLog(
            `Trace zu ${p.targetName} zurück nach ${(ms / 1000).toFixed(1)} s · ` +
              `${frame.hops.length} Hops · SNR ${snrs} dB`,
            'ok',
          );
        });
        this.refreshNow();
        break;

      case 'sent': {
        // Beim Ping stammt das Tag von der FIRMWARE - hier nachtragen.
        let p = frame.tag != null ? this.requests.get(`trace:${frame.tag}`) : undefined;
        if (!p) {
          for (const e of this.requests.values()) {
            if (e.tag == null) {
              p = e;
              break;
            }
          }
        }
        if (p) {
          p.tag = frame.tag;
          const secs = frame.estTimeoutMs != null ? Math.round(frame.estTimeoutMs / 1000) : null;
          this.addLog(
            `${p.kind === 'ping' ? 'Ping' : 'Trace'} an ${p.targetName} abgeschickt ` +
              `(${frame.isFlood ? 'geflutet' : 'gerichtet'}` +
              (secs != null ? `, Antwort erwartet binnen ~${secs} s)` : ')'),
          );
        }
        this.settleAck({ ok: true, text: 'abgeschickt' });
        break;
      }

      case 'msg_waiting':
        // Das Geraet meldet Post. Wir holen sie ab, sonst laeuft die
        // Offline-Warteschlange voll.
        this.syncMessages();
        break;

      case 'contact_msg':
      case 'channel_msg':
        this.handleIncomingMessage(frame);
        this.syncMessages(); // naechste Nachricht holen
        break;

      case 'no_more_messages':
        break;

      case 'curr_time':
        this.runtime = {
          ...this.runtime,
          timeOffsetSec: (frame.epochSec ?? 0) - Math.floor(Date.now() / 1000),
        };
        this.bump('config');
        break;

      case 'batt_and_storage':
        this.runtime = {
          ...this.runtime,
          batteryMilliVolts: frame.batteryMilliVolts,
          storageUsedKb: frame.storageUsedKb,
          storageTotalKb: frame.storageTotalKb,
        };
        this.bump('config');
        break;

      case 'tuning_params':
        this.runtime = {
          ...this.runtime,
          rxDelayBase: frame.rxDelayBase,
          airtimeFactor: frame.airtimeFactor,
        };
        this.bump('config');
        break;

      case 'login_success':
      case 'login_fail':
        this.handleLoginResult(frame.ok, frame.publicKeyPrefix, frame.permissions);
        break;

      case 'send_confirmed':
        this.model.markLastOutgoingDelivered();
        this.bump('chat');
        break;

      case 'ok':
        this.settleAck({ ok: true });
        break;

      case 'err': {
        const code = frame.errCode ?? 0;
        const entry = this.settleAck({ ok: false, errCode: code });
        if (!entry) {
          this.addLog(
            `Gerät meldet Fehler (${ERR_NAMES[code] || `Code ${code}`})`,
            'warn',
          );
        }
        if (this.contactsLoading) this.contactsLoading = false;
        break;
      }

      case 'disabled':
        if (!this.settleAck({ ok: false, text: 'Funktion vom Gerät deaktiviert' })) {
          this.addLog('Funktion vom Gerät deaktiviert.', 'warn');
        }
        break;

      default:
        break;
    }
  }

  /* ---------------- Ping und Trace ---------------- */

  private randomTag(): number {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }

  /**
   * "Ping": CMD_SEND_PATH_DISCOVERY_REQ. Die Firmware schickt dafuer eine
   * Telemetrie-Anfrage bewusst als Flood los; die Antwort enthaelt Hin- UND
   * Rueckpfad, die sich unterscheiden koennen. Braucht kein Login.
   */
  pingNode(node: ViewNode): string {
    if (!this.connected) return 'Nicht verbunden.';
    if (!node.pubkey) return 'Für diesen Knoten ist kein vollständiger Public Key bekannt.';

    this.registerRequest(`ping:${node.pubkey}`, {
      kind: 'ping',
      targetKey: node.pubkey,
      targetName: node.name,
    });
    void this.sendAwaitingAck(cmdSendPathDiscovery(node.pubkey), 'Ping');
    this.addLog(`Ping an ${node.name} …`);
    return 'Ping läuft … die Antwort kann je nach Hop-Zahl einige Sekunden dauern.';
  }

  /**
   * Trace entlang eines bekannten Pfades. Gesendet wird ein RUNDWEG, damit das
   * Ergebnis wieder bei uns ankommt (siehe cmdSendTracePath).
   */
  traceTo(node: ViewNode | null, hopHashes: string[], targetHash: string): string {
    if (!this.connected) return 'Nicht verbunden.';

    const firstByte = (h: string): number => Number.parseInt(h.slice(0, 2), 16);
    const path = buildRoundTripPath(hopHashes.map(firstByte), firstByte(targetHash));
    if (path.length === 0 || path.length > 60) return 'Pfad ist für einen Trace nicht geeignet.';

    const tag = this.randomTag();
    const name = node?.name ?? `#${targetHash}`;
    this.registerRequest(`trace:${tag}`, {
      kind: 'trace',
      targetKey: node?.pubkey ?? null,
      targetName: name,
    });
    void this.sendAwaitingAck(cmdSendTracePath(tag, 0, path), 'Trace');
    this.addLog(
      `Trace zu ${name} über ${hopHashes.length} Hops (Rundweg ${path.length} Einträge) …`,
    );
    return 'Trace läuft … das Ergebnis erscheint als SNR je Hop.';
  }

  /** Trace entlang einer beobachteten Route (Kette kanonischer Knotenschluessel). */
  traceChain(chain: string[], view: { nodeForKey(k: string): ViewNode | null }): string {
    if (!this.connected) return 'Nicht verbunden.';
    const hops = chain.filter((k) => k !== this.model.selfKey);
    if (hops.length === 0) return 'Route enthält keine fremden Hops.';
    const targetKey = hops[hops.length - 1];
    return this.traceTo(
      view.nodeForKey(targetKey),
      hops.slice(0, -1).map(keyToHash),
      keyToHash(targetKey),
    );
  }

  /**
   * Merkt sich eine offene Anfrage.
   *
   * Nur beim TRACE vergeben wir das Tag selbst (es steht im Kommando und die
   * Firmware reicht es unveraendert durch). Bei der Pfad-Discovery erzeugt die
   * FIRMWARE das Tag - dort wird ueber den Ziel-Key zugeordnet und das Tag erst
   * aus RESP_CODE_SENT nachgetragen.
   */
  private registerRequest(
    key: string,
    info: { kind: 'ping' | 'trace'; targetKey: string | null; targetName: string },
  ): void {
    const entry: PendingRequest = {
      ...info,
      key,
      sentAt: Date.now(),
      tag: null,
      timer: setTimeout(() => {
        if (this.requests.delete(key)) {
          this.addLog(
            `Keine Antwort von ${info.targetName} (${info.kind === 'ping' ? 'Ping' : 'Trace'}).`,
            'warn',
          );
        }
      }, REQUEST_TIMEOUT_MS),
    };
    this.requests.set(key, entry);
  }

  private resolveRequest(
    kind: 'ping' | 'trace',
    matchKey: string | null,
    onFound: (p: PendingRequest, ms: number) => void,
  ): void {
    let entry: PendingRequest | undefined;
    if (matchKey != null) entry = this.requests.get(matchKey);
    if (!entry) {
      // Fallback: aelteste offene Anfrage dieser Art (z.B. Ziel nicht in den Kontakten).
      for (const p of this.requests.values()) {
        if (p.kind === kind) {
          entry = p;
          break;
        }
      }
    }
    if (!entry) return;
    clearTimeout(entry.timer);
    this.requests.delete(entry.key);
    onFound(entry, Date.now() - entry.sentAt);
  }

  /* ---------------- Nachrichten ---------------- */

  syncMessages(): void {
    if (!this.connected) return;
    void this.ble.send(cmdSyncNextMessage());
  }

  private handleIncomingMessage(frame: AnyMsgFrame): void {
    // CLI-Antworten eines Repeaters gehoeren in das Terminal, nicht in den Chat.
    if (!frame.isChannel && frame.txtType === TXT_TYPE.CLI_DATA) {
      const session = this.sessionForPrefix(frame.publicKeyPrefix);
      if (session) {
        this.pushTerminalLine(session, 'in', frame.text);
        return;
      }
    }

    let fromName: string;
    let fromKey: string | null = null;
    if (frame.isChannel) {
      fromName = frame.senderName || 'Unbekannt';
    } else {
      const id = this.model.findByPrefix(frame.publicKeyPrefix);
      fromName = id?.name || `#${frame.publicKeyPrefix.slice(0, 4)}`;
      fromKey = id?.pubkey ?? null;
    }

    const heard = this.matchHeardText(frame);
    this.model.addMessage({
      dir: 'in',
      t: Date.now(),
      senderTimestamp: frame.senderTimestamp,
      fromName,
      fromKey,
      isChannel: frame.isChannel,
      channelIdx: frame.isChannel ? frame.channelIdx : null,
      text: frame.text,
      snr: frame.snr,
      pathLen: frame.pathLen,
      viaFlood: frame.viaFlood,
      txtType: frame.txtType,
      chain: heard?.chain ?? null,
      chainGuess: !!heard,
    });
    this.bump('chat');
    this.addLog(
      `Nachricht von ${fromName}: ${frame.text.slice(0, 40)}${frame.text.length > 40 ? '…' : ''}`,
    );
  }

  /**
   * Sucht das gehoerte Textpaket, aus dem diese Nachricht stammen duerfte.
   *
   * Sichere Merkmale gibt es nur zwei: das erste Byte des Absender-Public-Key
   * (steht bei Direktnachrichten im Klartext des Pakets) und die Hop-Zahl.
   * Beides muss passen, und das Paket darf nicht zu lange her sein. Bleiben
   * mehrere uebrig, gewinnt das juengste. Passt keines, bleibt der Pfad leer -
   * eine erfundene Kette waere schlimmer als gar keine.
   */
  private matchHeardText(frame: AnyMsgFrame): HeardText | null {
    const now = Date.now();
    const wantType = frame.isChannel ? PAYLOAD_TYPE.GRP_TXT : PAYLOAD_TYPE.TXT_MSG;
    const srcHash = frame.isChannel ? null : frame.publicKeyPrefix.slice(0, 2);

    let best: HeardText | null = null;
    for (const h of this.heardText) {
      if (now - h.t > TEXT_MATCH_WINDOW_MS) continue;
      if (h.payloadType !== wantType) continue;
      if (srcHash && h.srcHash && h.srcHash !== srcHash) continue;
      // pathLen === null heisst: kam ueber eine Direct-Route, dann kennen wir
      // die Hop-Zahl des Flood-Pfades nicht und vergleichen sie auch nicht.
      if (frame.pathLen != null && h.hops !== frame.pathLen) continue;
      if (!best || h.t > best.t) best = h;
    }
    if (best) this.heardText = this.heardText.filter((h) => h !== best);
    return best;
  }

  deviceNowSec(): number {
    return Math.floor(Date.now() / 1000) + this.runtime.timeOffsetSec;
  }

  /** Sendet eine Chat-Nachricht. `target` ist `ch:<idx>` oder `pk:<pubkey>`. */
  async sendMessage(target: string, text: string): Promise<string> {
    if (!this.connected) return 'Nicht verbunden.';
    const ts = this.deviceNowSec();

    if (target.startsWith('ch:')) {
      const idx = Number(target.slice(3));
      this.model.addMessage({
        dir: 'out',
        t: Date.now(),
        senderTimestamp: ts,
        fromName: this.model.selfInfo?.nodeName || 'Ich',
        isChannel: true,
        channelIdx: idx,
        text,
        state: 'sent',
      });
      this.bump('chat');
      const res = await this.sendAwaitingAck(cmdSendChannelTextMsg(idx, text, ts), 'Kanalnachricht');
      return res.ok ? `An Kanal ${idx} gesendet.` : res.text;
    }

    const pubkey = target.slice(3);
    const id = this.model.identities.get(pubkey);
    this.model.addMessage({
      dir: 'out',
      t: Date.now(),
      senderTimestamp: ts,
      fromName: this.model.selfInfo?.nodeName || 'Ich',
      toName: id?.name || pubkey.slice(0, 8),
      toKey: pubkey,
      isChannel: false,
      text,
      state: 'sent',
      // Beim Senden ist der Weg bekannt: der gelernte Pfad zum Empfaenger.
      chain: this.learnedPathTo(pubkey),
      chainGuess: false,
    });
    this.bump('chat');
    const res = await this.sendAwaitingAck(cmdSendTextMsg(pubkey, text, ts), 'Nachricht');
    return res.ok
      ? `An ${id?.name || 'Kontakt'} gesendet – warte auf Bestätigung.`
      : res.text;
  }

  /**
   * Der Weg, den das Geraet zu diesem Kontakt gelernt hat (out_path).
   * `null`, wenn keiner bekannt ist - dann geht die Nachricht als Flood los und
   * ihr Weg steht vorher nicht fest.
   */
  learnedPathTo(pubkey: string): string[] | null {
    const id = this.model.identities.get(pubkey);
    if (!id || !this.model.selfKey) return null;
    if (!id.outPath || id.outPath.length === 0) return null;
    return [this.model.selfKey, ...id.outPath, id.pubkey];
  }

  /* ---------------- Terminal (CLI zu einem fremden Knoten) ---------------- */

  private sessionForPrefix(prefix: string): TerminalSession | null {
    for (const s of this.terminals.values()) {
      if (s.pubkey.startsWith(prefix)) return s;
    }
    return null;
  }

  session(pubkey: string): TerminalSession | null {
    return this.terminals.get(pubkey) ?? null;
  }

  openTerminal(pubkey: string, name: string): TerminalSession {
    let s = this.terminals.get(pubkey);
    if (!s) {
      s = { pubkey, name, status: 'neu', permissions: null, lines: [], history: [] };
      this.terminals.set(pubkey, s);
      this.bump('terminal');
    }
    return s;
  }

  private pushTerminalLine(session: TerminalSession, dir: TerminalLine['dir'], text: string): void {
    session.lines = [...session.lines.slice(-499), { id: nextId++, t: Date.now(), dir, text }];
    this.bump('terminal');
  }

  /**
   * Anmeldung an einem Repeater oder Room-Server.
   *
   * Das Passwort geht ausschliesslich als Kommando an das eigene Funkgeraet,
   * das es verschluesselt an den Zielknoten weiterreicht. Es wird nirgends
   * gespeichert - weder im Browser noch im Modell.
   */
  async terminalLogin(pubkey: string, password: string): Promise<void> {
    const s = this.terminals.get(pubkey);
    if (!s) return;
    if (!this.connected) {
      this.pushTerminalLine(s, 'note', 'Nicht verbunden.');
      return;
    }
    s.status = 'anmeldung';
    this.pushTerminalLine(s, 'note', `Anmeldung an ${s.name} …`);
    const res = await this.sendAwaitingAck(cmdSendLogin(pubkey, password), 'Anmeldung');
    if (!res.ok) {
      s.status = 'abgelehnt';
      this.pushTerminalLine(s, 'note', res.text);
    }
  }

  private handleLoginResult(ok: boolean, prefix: string, permissions: number): void {
    const s = this.sessionForPrefix(prefix);
    if (!s) return;
    if (ok) {
      s.status = 'bereit';
      s.permissions = permissions;
      this.pushTerminalLine(
        s,
        'note',
        permissions ? `Angemeldet (Rechte 0x${permissions.toString(16)}).` : 'Angemeldet.',
      );
    } else {
      s.status = 'abgelehnt';
      s.permissions = null;
      this.pushTerminalLine(s, 'note', 'Anmeldung abgelehnt - Passwort falsch?');
    }
    this.bump('terminal');
  }

  /**
   * Schickt einen Befehl an den Knoten. Technisch ist das eine Textnachricht
   * vom Typ TXT_TYPE_CLI_DATA; die Antwort kommt als normale Nachricht
   * desselben Typs zurueck und landet ueber handleIncomingMessage() hier.
   */
  async terminalSend(pubkey: string, command: string): Promise<void> {
    const s = this.terminals.get(pubkey);
    if (!s) return;
    if (!this.connected) {
      this.pushTerminalLine(s, 'note', 'Nicht verbunden.');
      return;
    }
    s.history = [...s.history.filter((h) => h !== command), command].slice(-50);
    this.pushTerminalLine(s, 'out', command);
    const res = await this.sendAwaitingAck(
      cmdSendTextMsg(pubkey, command, this.deviceNowSec(), TXT_TYPE.CLI_DATA),
      'Befehl',
    );
    if (!res.ok) this.pushTerminalLine(s, 'note', res.text);
  }

  async terminalLogout(pubkey: string): Promise<void> {
    const s = this.terminals.get(pubkey);
    if (!s) return;
    await this.sendAwaitingAck(cmdLogout(pubkey), 'Abmeldung');
    s.status = 'neu';
    s.permissions = null;
    this.pushTerminalLine(s, 'note', 'Abgemeldet.');
  }

  closeTerminal(pubkey: string): void {
    this.terminals.delete(pubkey);
    this.bump('terminal');
  }

  /* ---------------- Daten ---------------- */

  loadStored(data: StoredModel): void {
    this.model.loadJSON(data);
    this.bump('chat');
    this.refreshNow();
  }

  clearData(): void {
    this.model.clear();
    this.heardText = [];
    this.bump('chat');
    this.refreshNow();
  }

  /**
   * Verwirft nur den aufgezeichneten Verkehr: Pakete, Routen und Nachrichten.
   * Die Kontakte bleiben - sie sind die Namen und Positionen, ohne die die
   * Karte leer waere, und sie kommen ohnehin vom Geraet.
   */
  clearTraffic(): void {
    this.model.clearTraffic();
    this.heardText = [];
    this.bump('chat');
    this.refreshNow();
  }
}

/** Kanonischer Knotenschluessel -> Path-Hash (hex, ohne fuehrendes '#'). */
export function keyToHash(key: string): string {
  return key.startsWith('#') ? key.slice(1) : key.slice(0, 2);
}
