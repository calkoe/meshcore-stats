/** Kleine Formatierhilfen und wiederkehrende Anzeigebausteine. */

import type { JSX } from 'react';
import { ADV_TYPE } from '../protocol/constants';
import { signalStatus } from '../map/palette';
import type { Certainty, TopoView, ViewNode } from '../model/types';

export function fmtNum(n: number): string {
  return new Intl.NumberFormat('de-DE').format(Math.round(n));
}

export function relTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.round(s / 60)} Min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std`;
  return `vor ${Math.round(s / 86400)} T`;
}

export function typeClass(type: number): string {
  switch (type) {
    case ADV_TYPE.REPEATER:
      return 'repeater';
    case ADV_TYPE.ROOM:
      return 'room';
    case ADV_TYPE.CHAT:
      return 'chat';
    default:
      return 'unknown';
  }
}

/** Signalstaerke: Farbe steht nie allein, der dBm-Wert ist immer daneben. */
export function Signal({ rssi }: { rssi: number | null }): JSX.Element {
  const st = signalStatus(rssi);
  if (!st || rssi == null) return <span>—</span>;
  return (
    <span className={`sig sig--${st.key}`} title={st.label}>
      <span className="sig__dot" />
      {rssi.toFixed(0)} dBm
    </span>
  );
}

export const CERTAINTY_TEXT: Record<Certainty, string> = {
  exact: 'eindeutig (voller Public Key)',
  unique: 'eindeutig',
  weak: 'nur über 1 Byte erkannt',
  ambiguous: 'mehrdeutig',
  unknown: 'unbekannt',
};

/** Erklaert im Klartext, warum eine Zuordnung unsicher ist. */
export function certaintyNote(node: ViewNode): string | null {
  if (node.certainty === 'ambiguous') {
    const list = (node.candidates ?? []).slice(0, 4).join(', ');
    return `Dieses Hash-Prefix passt auf mehrere bekannte Knoten${list ? ` (${list})` : ''} – es wird keinem zugeordnet.`;
  }
  if (node.certainty === 'unknown') {
    return 'Zu diesem Pfad-Hash ist kein Knoten bekannt – nur der Hash selbst liegt vor.';
  }
  if (node.seenWeak) {
    return (
      'Mindestens ein Hop wurde nur über ein einzelnes Byte identifiziert. Unter den bekannten ' +
      'Knoten passt genau dieser, ein unbekannter Knoten mit demselben Anfangsbyte wäre aber nicht ' +
      'davon zu unterscheiden.'
    );
  }
  return null;
}

/**
 * Hop-Kette als Text. Hops, zu denen keine Identitaet bekannt ist, erscheinen
 * gedaempft als roher Pfad-Hash - das ist die tatsaechlich vorliegende
 * Information. Auf der Karte werden solche Hops gar nicht gezeichnet, weil
 * dafuer eine Position noetig waere.
 */
export function PathChain({ view, chain }: { view: TopoView; chain: string[] }): JSX.Element {
  return (
    <>
      {chain.map((key, i) => {
        const n = view.nodeForKey(key);
        const arrow = i > 0 ? <span className="route__arrow">→</span> : null;
        if (!n || !n.known) {
          const title =
            n && n.certainty === 'ambiguous'
              ? `Hash-Prefix passt auf mehrere Knoten (${(n.candidates ?? []).slice(0, 3).join(', ')}) – nicht eindeutig zuzuordnen`
              : 'Unbekannter Knoten – nur der Pfad-Hash ist bekannt, keine Position';
          return (
            <span key={`${key}-${i}`}>
              {arrow}
              <span className="route__hop route__hop--unknown" title={title}>
                {n?.name ?? key}
              </span>
            </span>
          );
        }
        return (
          <span key={`${key}-${i}`}>
            {arrow}
            <span className={n.isSelf ? 'route__hop route__hop--self' : 'route__hop'}>{n.name}</span>
            {n.hasPos ? null : (
              <span
                className="route__nopos"
                title="keine Position gemeldet – nicht auf der Karte"
              >
                {' '}
                ◦
              </span>
            )}
            {n.seenWeak ? (
              <span
                className="route__weak"
                title="nur über ein einzelnes Byte identifiziert – ein unbekannter Knoten mit demselben Anfangsbyte wäre nicht zu unterscheiden"
              >
                {' '}
                ?
              </span>
            ) : null}
          </span>
        );
      })}
    </>
  );
}
