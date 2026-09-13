/** Inhalte der Karten-Tooltips. */

import type { JSX, ReactNode } from 'react';
import { PAYLOAD_NAMES } from '../protocol/constants';
import { statAvg } from '../model/topology';
import { PROVENANCE, type TopoView, type ViewLink, type ViewNode } from '../model/types';
import { CERTAINTY_TEXT, Signal, certaintyNote, fmtNum, relTime, typeClass } from './format';

function Row({ k, v }: { k: ReactNode; v: ReactNode }): JSX.Element {
  return (
    <>
      <span className="tt__k">{k}</span>
      <span className="tt__v">{v}</span>
    </>
  );
}

export function LinkTooltip({
  view,
  link,
  routeCount,
}: {
  view: TopoView;
  link: ViewLink;
  routeCount: number;
}): JSX.Element {
  const na = view.nodeForKey(link.a);
  const nb = view.nodeForKey(link.b);
  const nameA = na ? na.name : `#${link.a}`;
  const nameB = nb ? nb.name : `#${link.b}`;
  const measured = link.provenance.has(PROVENANCE.MEASURED);
  const rssiAvg = statAvg(link.rssi);
  const snrAvg = statAvg(link.snr);

  const payloads = [...link.byPayload.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, n]) => `${PAYLOAD_NAMES[type] || `0x${type.toString(16)}`} ${n}`)
    .join(' · ');

  let note: string;
  if (measured) note = 'Letzter Hop zu diesem Gerät – Feldstärke direkt gemessen.';
  else if (link.provenance.has(PROVENANCE.OBSERVED)) {
    note =
      'Aus Flood-Pfaden beobachtet: Pakete sind diesen Weg gelaufen. Feldstärke nur am Empfänger messbar.';
  } else if (link.provenance.has(PROVENANCE.TRACE)) note = 'Aus einem Trace-Ergebnis, mit SNR je Hop.';
  else note = 'Deklarierte Route (Direct-Pfad bzw. out_path): das Netz hält diesen Weg für gültig.';

  return (
    <>
      <div className="tt__title">
        {nameA} ↔ {nameB}
      </div>
      <div className="tt__sub">
        Funkstrecke · {routeCount} Route{routeCount === 1 ? '' : 'n'} nutzen sie
      </div>
      <div className="tt__grid">
        <Row k="Pakete gesamt" v={fmtNum(link.total)} />
        {link.countAB > 0 && link.countBA > 0 ? (
          <>
            <Row k={`${nameA} → ${nameB}`} v={fmtNum(link.countAB)} />
            <Row k={`${nameB} → ${nameA}`} v={fmtNum(link.countBA)} />
          </>
        ) : null}
        {measured && link.rssi.n > 0 ? (
          <>
            <Row k="RSSI Ø" v={<Signal rssi={rssiAvg} />} />
            <Row
              k="RSSI Bereich"
              v={`${link.rssi.min.toFixed(0)} … ${link.rssi.max.toFixed(0)} dBm`}
            />
            <Row k="zuletzt" v={`${(link.rssi.last ?? 0).toFixed(0)} dBm`} />
          </>
        ) : null}
        {link.snr.n > 0 ? <Row k="SNR Ø" v={`${(snrAvg ?? 0).toFixed(1)} dB`} /> : null}
        <Row
          k="Zuordnung"
          v={link.ambiguous ? 'nicht eindeutig' : `eindeutig (${link.certainCount}×)`}
        />
        <Row k="zuletzt gehört" v={relTime(link.lastSeen)} />
      </div>
      {payloads ? (
        <>
          <div className="tt__rule" />
          <div className="tt__path">{payloads}</div>
        </>
      ) : null}
      <div className="tt__note">{note}</div>
      {link.ambiguous ? (
        <div className="tt__warn">
          Mindestens ein Ende dieser Strecke wurde nur über ein einzelnes Byte des Public Key
          identifiziert. Es gibt keine Beobachtung, die beide Enden zweifelsfrei festlegt – die
          Strecke ist deshalb punktiert gezeichnet.
        </div>
      ) : null}
    </>
  );
}

export function NodeTooltip({ node }: { node: ViewNode }): JSX.Element {
  const s = node.stats;
  const posNote =
    node.hasPos && node.lat != null && node.lon != null
      ? `${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}`
      : 'keine Position gemeldet – nicht auf der Karte';
  const note = certaintyNote(node);

  return (
    <>
      <div className="tt__title">
        <span className={`dot dot--${typeClass(node.type)}`} />
        {node.name}
      </div>
      <div className="tt__sub">{posNote}</div>
      <div className="tt__grid">
        <Row k="Typ" v={node.isSelf ? 'Dieses Gerät' : node.typeName} />
        <Row k="Path-Hash" v={`#${node.hash}`} />
        {node.pubkey ? <Row k="Public Key" v={`${node.pubkey.slice(0, 12)}…`} /> : null}
        <Row k="Zuordnung" v={CERTAINTY_TEXT[node.certainty]} />
        {node.hashBytes.length > 0 ? (
          <Row
            k="Hash-Länge im Funk"
            v={node.hashBytes.map((b) => `${b} B`).join(' / ')}
          />
        ) : null}
        {s ? (
          <>
            {s.asOrigin ? <Row k="als Absender" v={fmtNum(s.asOrigin)} /> : null}
            {s.asHop ? <Row k="als Zwischenhop" v={fmtNum(s.asHop)} /> : null}
            {s.asTransmitter ? <Row k="direkt gehört" v={fmtNum(s.asTransmitter)} /> : null}
            {s.rssi.n > 0 ? (
              <>
                <Row k="RSSI Ø" v={<Signal rssi={statAvg(s.rssi)} />} />
                <Row
                  k="RSSI Bereich"
                  v={`${s.rssi.min.toFixed(0)} … ${s.rssi.max.toFixed(0)} dBm`}
                />
              </>
            ) : null}
            {s.snr.n > 0 ? <Row k="SNR Ø" v={`${(statAvg(s.snr) ?? 0).toFixed(1)} dB`} /> : null}
            {s.lastSeen ? <Row k="zuletzt gehört" v={relTime(s.lastSeen)} /> : null}
          </>
        ) : null}
        {node.lastAdvert ? (
          <Row
            k={
              <span title="Zeitstempel, den der Knoten selbst in sein Advert schreibt – bei falsch gestellter Uhr entsprechend unzuverlässig">
                Advert-Stempel*
              </span>
            }
            v={relTime(node.lastAdvert * 1000)}
          />
        ) : null}
      </div>
      {node.isSelf ? null : <div className="tt__note">Klicken für Ping, Trace und Terminal.</div>}
      {note ? <div className="tt__warn">{note}</div> : null}
    </>
  );
}
