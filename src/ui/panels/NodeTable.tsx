/** Knotentabelle: ueberfahren hebt hervor, klicken oeffnet das Aktionsfenster. */

import type { JSX } from 'react';
import { statAvg } from '../../model/topology';
import type { ViewNode } from '../../model/types';
import { usePreferences } from '../../state/preferences';
import { useTopoView } from '../../state/store';
import { useInteraction } from '../interaction';
import { Signal, fmtNum, typeClass } from '../format';

export function NodeTable(): JSX.Element {
  const view = useTopoView();
  const { prefs, isFavorite, toggleFavorite } = usePreferences();
  const { highlightNode, clearHighlight, focusNode } = useInteraction();

  // Nur Knoten mit bekannter Identitaet - reine Pfad-Hashes ohne Advert werden
  // nicht als Knoten ausgegeben.
  let nodes = [...view.nodes.values()].filter((n) => n.known);
  if (prefs.onlyDirect) {
    nodes = nodes.filter((n) => n.isSelf || (n.stats && n.stats.asTransmitter > 0));
  }
  /*
   * Sortiert nach gemessener Empfangsstaerke, das staerkste Signal zuerst.
   * Knoten ohne Messung haben keine Feldstaerke - sie wandern ans Ende und
   * werden dort nach Verkehrsaufkommen geordnet, statt eine Null vorzutaeuschen.
   */
  nodes = nodes.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const ra = rssiOf(a);
    const rb = rssiOf(b);
    if (ra != null && rb != null) return rb - ra;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return traffic(b) - traffic(a) || a.name.localeCompare(b.name);
  });

  return (
    <div className="table-wrap">
      <table className="ntable">
        <thead>
          <tr>
            <th className="ntable__star" title="Favorit">
              ★
            </th>
            <th>Name</th>
            <th>Typ</th>
            <th className="num">Pakete</th>
            <th className="num" title="Sortiert nach gemessener Empfangsstärke">
              dBm ↓
            </th>
          </tr>
        </thead>
        <tbody>
          {nodes.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                Noch keine Knoten.
              </td>
            </tr>
          ) : (
            nodes.map((node) => {
              const rssi = rssiOf(node);
              const fav = isFavorite(node.pubkey);
              return (
                <tr
                  key={node.key}
                  title="Klicken: auf der Karte zentrieren, Ping, Trace und Terminal"
                  onMouseEnter={() => highlightNode(node)}
                  onMouseLeave={() => clearHighlight()}
                  onClick={() => focusNode(node)}
                >
                  <td className="ntable__star">
                    {node.pubkey && !node.isSelf ? (
                      <button
                        className={`star${fav ? ' is-on' : ''}`}
                        aria-label={fav ? 'Favorit entfernen' : 'Als Favorit merken'}
                        title={
                          fav
                            ? 'Favorit entfernen'
                            : 'Als Favorit merken – steht dann oben in der Empfängerliste'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(node.pubkey as string);
                        }}
                      >
                        {fav ? '★' : '☆'}
                      </button>
                    ) : null}
                  </td>
                  <td>
                    <div className="ntable__name">
                      <span
                        className={`dot dot--${typeClass(node.type)}${node.isSelf ? ' dot--self' : ''}`}
                      />
                      <span title={node.name}>{node.name}</span>
                    </div>
                  </td>
                  <td>
                    {node.isSelf ? 'Dieses Gerät' : node.typeName}
                    {node.hasPos ? null : (
                      <span
                        className="route__nopos"
                        title="keine Position gemeldet – nicht auf der Karte"
                      >
                        {' '}
                        ◦
                      </span>
                    )}
                    {node.seenWeak ? (
                      <span
                        className="route__weak"
                        title="tauchte im Funkverkehr nur über ein einzelnes Byte auf – Zuordnung plausibel, aber nicht beweisbar"
                      >
                        {' '}
                        ?
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{traffic(node) ? fmtNum(traffic(node)) : '—'}</td>
                  <td className="num">{rssi != null ? <Signal rssi={rssi} /> : '—'}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function traffic(n: ViewNode): number {
  return n.stats ? n.stats.asHop + n.stats.asOrigin + n.stats.asTransmitter : 0;
}

/** Mittlere gemessene Empfangsstaerke, oder null wenn nie selbst gehoert. */
function rssiOf(n: ViewNode): number | null {
  return n.stats ? statAvg(n.stats.rssi) : null;
}
