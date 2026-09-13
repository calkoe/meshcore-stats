/** Kennzahlen. Was NICHT dargestellt werden kann, steht offen daneben. */

import type { JSX } from 'react';
import { PROVENANCE } from '../../model/types';
import { useTopoView } from '../../state/store';
import { fmtNum } from '../format';

export function StatTiles(): JSX.Element {
  const view = useTopoView();
  const t = view.totals;
  const measured = [...view.links.values()].filter((l) =>
    l.provenance.has(PROVENANCE.MEASURED),
  ).length;
  const observed = [...view.routes.values()].filter(
    (r) => !r.provenance.has(PROVENANCE.DECLARED),
  ).length;

  return (
    <div className="tiles">
      <Tile
        label="Pakete"
        value={fmtNum(t.packets)}
        sub={t.packetsPerMin != null ? `${t.packetsPerMin.toFixed(1)} /min` : 'Rate ab 30 s'}
      />
      <Tile
        label="Knoten"
        value={fmtNum(t.positioned)}
        sub={`auf der Karte · ${fmtNum(t.nodes - t.positioned)} ohne Position`}
      />
      <Tile
        label="Funkstrecken"
        value={fmtNum(t.links)}
        sub={`${fmtNum(measured)} mit dBm · ${fmtNum(t.certainLinks)} eindeutig`}
      />
      <Tile label="Routen" value={fmtNum(t.routes)} sub={`${fmtNum(observed)} beobachtet`} />
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }): JSX.Element {
  return (
    <div className="tile">
      <div className="tile__label">{label}</div>
      <div className="tile__value">{value}</div>
      <div className="tile__sub">{sub}</div>
    </div>
  );
}
