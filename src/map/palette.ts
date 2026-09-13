/**
 * Farbwahl der Karte.
 *
 * Die Rollen sind getrennt gehalten, damit keine Farbe zwei Dinge bedeutet:
 *
 *  - Kanten  = SEQUENTIELL (Magnitude "wie viele Nachrichten"): eine Hue (Blau),
 *              monoton in der Helligkeit. Auf dunklem Grund heisst hell = viel.
 *  - Knoten  = KATEGORIAL (Knotentyp): drei gepruefte Slots (Orange/Grün/Violett).
 *              Blau ist bewusst NICHT dabei, es gehoert der sequentiellen
 *              Kantenskala. Die beiden seltenen Typen (Sensor/Unbekannt) tragen
 *              Neutralgrau - Identitaet haengt nie allein an der Farbe
 *              (zusaetzlich Beschriftung, Legende, Tabelle).
 *  - Signal  = STATUS-Palette, immer zusammen mit dem dBm-Zahlenwert.
 *  - Herkunft und Eindeutigkeit einer Kante = LINIENSTIL, ein von der Farbe
 *              unabhaengiger Kanal.
 */

import { ADV_TYPE } from '../protocol/constants';

/** Sequentiell "Blau" (Vorgabe): eine Hue, monoton in der Helligkeit. */
export const SEQ_DARK = [
  '#1c5cab',
  '#256abf',
  '#2a78d6',
  '#3987e5',
  '#5598e7',
  '#86b6ef',
  '#b7d3f6',
  '#cde2fb',
];
export const SEQ_LIGHT = [
  '#b7d3f6',
  '#86b6ef',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#184f95',
  '#0d366b',
];

/**
 * Sequentiell "Hitze" (umschaltbar): warme Rampe, ebenfalls streng monoton in
 * der Helligkeit - dadurch bleibt die Groesse auch ohne Farbsehen ablesbar,
 * obwohl mehrere Farbtoene durchlaufen werden.
 */
export const HEAT_DARK = [
  '#5b2a2a',
  '#8a3320',
  '#b8481a',
  '#d9631a',
  '#ee8420',
  '#f7a83a',
  '#fbc95f',
  '#fde79a',
];
export const HEAT_LIGHT = [...HEAT_DARK].reverse();

const TYPE_COLORS_DARK: Record<number, string> = {
  [ADV_TYPE.REPEATER]: '#d95926',
  [ADV_TYPE.ROOM]: '#199e70',
  [ADV_TYPE.CHAT]: '#9085e9',
  [ADV_TYPE.SENSOR]: '#898781',
  [ADV_TYPE.NONE]: '#898781',
};
const TYPE_COLORS_LIGHT: Record<number, string> = {
  [ADV_TYPE.REPEATER]: '#eb6834',
  [ADV_TYPE.ROOM]: '#1baf7a',
  [ADV_TYPE.CHAT]: '#4a3aa7',
  [ADV_TYPE.SENSOR]: '#898781',
  [ADV_TYPE.NONE]: '#898781',
};

export function typeColor(type: number, theme: 'dark' | 'light'): string {
  const table = theme === 'dark' ? TYPE_COLORS_DARK : TYPE_COLORS_LIGHT;
  return table[type] ?? table[ADV_TYPE.NONE];
}

export function seqRamp(scale: 'blue' | 'heat', theme: 'dark' | 'light'): string[] {
  if (scale === 'heat') return theme === 'dark' ? HEAT_DARK : HEAT_LIGHT;
  return theme === 'dark' ? SEQ_DARK : SEQ_LIGHT;
}

export interface SignalStep {
  key: 'good' | 'warning' | 'serious' | 'critical';
  color: string;
  label: string;
}

export const SIGNAL_STATUS: SignalStep[] = [
  { key: 'critical', color: '#d03b3b', label: 'sehr schwach' },
  { key: 'serious', color: '#ec835a', label: 'schwach' },
  { key: 'warning', color: '#fab219', label: 'brauchbar' },
  { key: 'good', color: '#0ca30c', label: 'gut' },
];

/** Ordnet ein RSSI (dBm) einer Status-Stufe zu. Wird immer MIT Zahlenwert gezeigt. */
export function signalStatus(rssi: number | null | undefined): SignalStep | null {
  if (rssi == null || !Number.isFinite(rssi)) return null;
  if (rssi < -95) return SIGNAL_STATUS[0];
  if (rssi < -85) return SIGNAL_STATUS[1];
  if (rssi < -75) return SIGNAL_STATUS[2];
  return SIGNAL_STATUS[3];
}

/**
 * Linienstil einer Funkstrecke. Drei klar unterscheidbare Strichbilder, damit
 * jede Einschraenkung ihr eigenes Zeichen hat:
 *
 *   durchgezogen   - gemessen bzw. beobachtet, Endpunkte zweifelsfrei
 *   lang gestrichelt - deklarierte Route (Netz haelt sie fuer gueltig)
 *   fein punktiert - mindestens ein Endpunkt nur ueber ein Byte identifiziert
 *
 * Die Mehrdeutigkeit hat Vorrang: sie stellt in Frage, OB es die Strecke gibt,
 * waehrend "deklariert" nur sagt, dass wir sie nicht selbst gemessen haben.
 */
export function lineDash(opts: { ambiguous: boolean; declaredOnly: boolean }): string | undefined {
  if (opts.ambiguous) return '1 5';
  if (opts.declaredOnly) return '7 6';
  return undefined;
}
