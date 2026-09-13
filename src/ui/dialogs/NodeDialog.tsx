/**
 * Knotenfenster: alles zu einem Knoten und alles, was man mit ihm tun kann.
 *
 * Öffnet sich beim Klick auf einen Knoten der Karte oder auf seine Zeile in der
 * Knotentabelle. Links die Angaben aus der Aufzeichnung, rechts die Aktionen,
 * darunter - bei Repeatern und Room-Servern - die Befehlszeile des Knotens.
 *
 * Bewusst ein Fenster und kein kleines Popup: Ping, Trace und Terminal führen
 * zu Antworten, die Platz brauchen, und das Herumschieben eines Popups am
 * Kartenrand war beim Arbeiten mehr im Weg als hilfreich. Der Tooltip beim
 * bloßen Überfahren bleibt davon unberührt.
 */

import { useState, type JSX, type ReactNode } from 'react';
import { ADV_TYPE } from '../../protocol/constants';
import { cmdResetPath } from '../../protocol/commands';
import { statAvg } from '../../model/topology';
import type { ViewNode } from '../../model/types';
import { usePreferences } from '../../state/preferences';
import { useMesh } from '../../state/store';
import { TerminalPanel } from '../TerminalPanel';
import { CERTAINTY_TEXT, Signal, certaintyNote, fmtNum, relTime, typeClass } from '../format';
import { Modal } from './Modal';

export function NodeDialog({ node, onClose }: { node: ViewNode; onClose(): void }): JSX.Element {
  const controller = useMesh();
  const { isFavorite, toggleFavorite } = usePreferences();
  const [note, setNote] = useState<string | null>(null);

  const id = node.pubkey ? controller.model.identities.get(node.pubkey) : null;
  const outPath = id?.outPath ?? [];
  const canPing = !!node.pubkey && !node.isSelf;
  const canTrace = !node.isSelf;
  const hasTerminal =
    !!node.pubkey && !node.isSelf && (node.type === ADV_TYPE.REPEATER || node.type === ADV_TYPE.ROOM);
  const s = node.stats;
  const warn = certaintyNote(node);

  const resetPath = async (): Promise<void> => {
    if (!node.pubkey) return;
    if (
      !window.confirm(
        `Bekannten Pfad zu „${node.name}" verwerfen? Das Gerät sucht ihn danach neu (Flood).`,
      )
    ) {
      return;
    }
    const res = await controller.sendAwaitingAck(cmdResetPath(node.pubkey), 'Pfad zurücksetzen');
    setNote(res.text);
  };

  return (
    <Modal title={node.isSelf ? 'Dieses Gerät' : 'Knoten'} onClose={onClose} size="xl">
      <div className="prof">
        <div className="prof__head">
          <span className="prof__pair">
            <span className={`dot dot--${typeClass(node.type)}`} /> {node.name}
            {node.pubkey && !node.isSelf ? (
              <button
                className={`star${isFavorite(node.pubkey) ? ' is-on' : ''}`}
                title={
                  isFavorite(node.pubkey)
                    ? 'Favorit entfernen'
                    : 'Als Favorit merken – steht dann oben in Liste und Empfängerauswahl'
                }
                aria-label="Favorit"
                onClick={() => toggleFavorite(node.pubkey as string)}
              >
                {isFavorite(node.pubkey) ? '★' : '☆'}
              </button>
            ) : null}
          </span>
          <span className="prof__meta">
            {node.isSelf ? 'Dieses Gerät' : node.typeName}
            {outPath.length
              ? ` · bekannter Pfad: ${outPath.length} Hop${outPath.length === 1 ? '' : 's'}`
              : node.isSelf
                ? ''
                : ' · kein Pfad bekannt (Flood)'}
          </span>
        </div>

        <div className="prof__cols">
          <div className="prof__stats">
            <h3>Angaben</h3>
            <dl>
              <Row k="Path-Hash" v={`#${node.hash}`} />
              {node.pubkey ? <Row k="Public Key" v={`${node.pubkey.slice(0, 16)}…`} /> : null}
              <Row
                k="Position"
                v={
                  node.hasPos && node.lat != null && node.lon != null
                    ? `${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}`
                    : 'nicht gemeldet'
                }
              />
              <Row k="Zuordnung" v={CERTAINTY_TEXT[node.certainty]} />
              {node.hashBytes.length ? (
                <Row k="Hash-Länge im Funk" v={node.hashBytes.map((x) => `${x} B`).join(' / ')} />
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
            </dl>
            {warn ? <p className="prof__warn">{warn}</p> : null}
          </div>

          <div className="prof__actions">
            <h3>Messen</h3>
            <p>
              <strong>Ping</strong> ermittelt Hin- und Rückpfad (Pfad-Discovery, geflutet).{' '}
              <strong>Trace</strong> läuft den bekannten Pfad als Rundweg ab und liefert das SNR je
              Hop.
            </p>
            <div className="prof__buttons">
              <button
                className="btn btn--sm btn--primary"
                disabled={!canPing}
                onClick={() => setNote(controller.pingNode(node))}
              >
                Ping
              </button>
              <button
                className="btn btn--sm"
                disabled={!canTrace}
                onClick={() => setNote(controller.traceTo(node, outPath, node.hash))}
              >
                Trace
              </button>
              {node.pubkey && !node.isSelf ? (
                <button
                  className="btn btn--sm"
                  title="Verwirft den gelernten Weg; die nächste Nachricht wird geflutet"
                  onClick={() => void resetPath()}
                >
                  Pfad vergessen
                </button>
              ) : null}
            </div>
            {note ? <div className="prof__action-note">{note}</div> : null}
          </div>
        </div>

        {hasTerminal ? (
          <>
            <h3 className="prof__section">Terminal</h3>
            <TerminalPanel pubkey={node.pubkey as string} name={node.name} compact />
          </>
        ) : node.isSelf ? (
          <p className="prof__note">
            Für das eigene Gerät gibt es keine Befehlszeile über Bluetooth – die
            Companion-Firmware stellt sie nur seriell bereit. Was sich hier einstellen lässt,
            steht unter <strong>Einstellungen</strong>.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function Row({ k, v }: { k: ReactNode; v: ReactNode }): JSX.Element {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
