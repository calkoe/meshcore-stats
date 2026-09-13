/**
 * Web-Bluetooth-Transport zum MeshCore Companion-Radio.
 *
 * Die Firmware nutzt den Nordic UART Service. Pro GATT-Notification kommt genau
 * ein Protokoll-Frame an (kein Laengen-Praefix - der existiert nur auf UART).
 * Die Characteristics sind mit SECMODE_ENC_WITH_MITM geschuetzt, das Betriebs-
 * system fragt deshalb beim ersten Verbinden nach der BLE-PIN (Standard 123456).
 */

import { NUS_CHAR_RX, NUS_CHAR_TX, NUS_SERVICE } from '../protocol/constants';

export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface BleHandlers {
  onFrame(bytes: Uint8Array): void;
  onLog(msg: string, level: LogLevel): void;
  onConnected(name: string): void;
  onDisconnected(intentional: boolean): void;
}

export class MeshCoreBLE {
  private device: BluetoothDevice | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  connected = false;

  constructor(private handlers: BleHandlers) {
    this.onDisconnectedEvent = this.onDisconnectedEvent.bind(this);
    this.onNotify = this.onNotify.bind(this);
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  /** Oeffnet den Geraete-Picker und verbindet. */
  async connect(): Promise<void> {
    if (!MeshCoreBLE.isSupported()) {
      throw new Error('Web Bluetooth wird von diesem Browser nicht unterstützt. Bitte Chrome oder Edge verwenden.');
    }

    this.handlers.onLog('Gerätesuche läuft …', 'info');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [NUS_SERVICE] }, { namePrefix: 'MeshCore' }],
      optionalServices: [NUS_SERVICE],
    });

    this.device.addEventListener('gattserverdisconnected', this.onDisconnectedEvent);
    await this.openGatt();
  }

  private async openGatt(): Promise<void> {
    const device = this.device;
    if (!device?.gatt) throw new Error('Kein Gerät ausgewählt.');
    this.handlers.onLog(`Verbinde mit ${device.name || 'Gerät'} …`, 'info');
    const server = await device.gatt.connect();

    const service = await server.getPrimaryService(NUS_SERVICE);
    this.rxChar = await service.getCharacteristic(NUS_CHAR_RX);
    this.txChar = await service.getCharacteristic(NUS_CHAR_TX);

    this.txChar.addEventListener('characteristicvaluechanged', this.onNotify);
    await this.txChar.startNotifications();

    this.connected = true;
    const name = device.name || 'MeshCore-Gerät';
    this.handlers.onLog(`Verbunden mit ${name}`, 'ok');
    this.handlers.onConnected(name);
  }

  /** Erneut verbinden ohne neuen Geraete-Picker (nur wenn schon einmal gekoppelt). */
  async reconnect(): Promise<void> {
    if (!this.device) throw new Error('Kein Gerät bekannt - bitte neu verbinden.');
    await this.openGatt();
  }

  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) {
      // Handler abhaengen, damit das Event nicht als Verbindungsabbruch gilt.
      this.device.removeEventListener('gattserverdisconnected', this.onDisconnectedEvent);
      this.device.gatt.disconnect();
    }
    this.connected = false;
    this.handlers.onDisconnected(true);
  }

  private onDisconnectedEvent(): void {
    this.connected = false;
    this.rxChar = null;
    this.txChar = null;
    this.handlers.onLog('Verbindung getrennt', 'warn');
    this.handlers.onDisconnected(false);
  }

  private onNotify(event: Event): void {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const dv = target.value;
    if (!dv) return;
    const bytes = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
    if (bytes.length === 0) return;
    this.handlers.onFrame(bytes);
  }

  /**
   * Sendet ein Frame. Schreibvorgaenge werden serialisiert, weil Web Bluetooth
   * parallele GATT-Operationen mit "GATT operation already in progress" abweist.
   */
  send(frame: Uint8Array): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(async () => {
        const rx = this.rxChar;
        if (!rx) throw new Error('Nicht verbunden');
        // Eigene Kopie: die GATT-Schnittstelle verlangt einen Puffer, der
        // garantiert kein SharedArrayBuffer ist.
        const data = new Uint8Array(frame);
        // withoutResponse ist schneller, wird aber nicht von jedem Stack unterstuetzt.
        if (rx.properties.writeWithoutResponse) await rx.writeValueWithoutResponse(data);
        else await rx.writeValue(data);
      })
      .catch((err: unknown) => {
        this.handlers.onLog(`Sendefehler: ${errorText(err)}`, 'error');
      });
    return this.writeQueue;
  }
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
