/** Filter der Darstellung. Sie veraendern nie die Aufzeichnung, nur die Sicht. */

import type { JSX } from 'react';
import { PAYLOAD_NAMES } from '../../protocol/constants';
import { usePreferences } from '../../state/preferences';
import { useTopoView } from '../../state/store';
import { fmtNum } from '../format';

const WINDOWS: { value: number; label: string }[] = [
  { value: 0, label: 'alles' },
  { value: 60000, label: 'letzte Minute' },
  { value: 300000, label: 'letzte 5 Min' },
  { value: 900000, label: 'letzte 15 Min' },
  { value: 3600000, label: 'letzte Stunde' },
  { value: 21600000, label: 'letzte 6 Std' },
  { value: 86400000, label: 'letzte 24 Std' },
];

export function FilterPanel(): JSX.Element {
  const { prefs, set } = usePreferences();
  const view = useTopoView();
  const hist = view.totals.payloadHistogram;
  const payloadOptions = [...hist.entries()]
    .filter(([k]) => k >= 0)
    .sort((a, b) => b[1] - a[1]);
  const ambiguous = view.totals.links - view.totals.certainLinks;

  return (
    <>
      <div className="field">
        <label htmlFor="selWindow">Zeitfenster</label>
        <select
          id="selWindow"
          value={prefs.windowMs}
          onChange={(e) => set('windowMs', Number(e.target.value))}
        >
          {WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="selPayload">Pakettyp</label>
        <select
          id="selPayload"
          value={prefs.payload === 'all' ? 'all' : String(prefs.payload)}
          onChange={(e) => set('payload', e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">alle Pakete</option>
          {payloadOptions.map(([type, n]) => (
            <option key={type} value={type}>
              {PAYLOAD_NAMES[type] || `Typ 0x${type.toString(16)}`} ({fmtNum(n)})
            </option>
          ))}
        </select>
      </div>

      <div className="checks">
        <Check
          checked={prefs.includeDeclared}
          onChange={(v) => set('includeDeclared', v)}
          label="deklarierte Routen zeigen"
        />
        <Check
          checked={prefs.showLabels}
          onChange={(v) => set('showLabels', v)}
          label="Beschriftungen"
        />
        <Check
          checked={prefs.onlyGateways}
          onChange={(v) => set('onlyGateways', v)}
          label="nur Gateways"
        />
        <Check
          checked={prefs.onlyDirect}
          onChange={(v) => set('onlyDirect', v)}
          label="nur direkte Funknachbarn"
          title="Nur Funkstrecken, auf denen dieses Gerät die Gegenstelle selbst gehört hat – also echte Funknachbarn mit gemessener Feldstärke"
        />
        <Check
          checked={prefs.onlyCertain}
          onChange={(v) => set('onlyCertain', v)}
          label={`nur eindeutige Verbindungen${ambiguous > 0 ? ` (${fmtNum(ambiguous)} aus)` : ''}`}
          title={
            'Ein Hop im Pfad steht oft nur als einzelnes Byte des Public Key im Paket. ' +
            'Passt dieses Byte auf genau einen bekannten Knoten, ist die Zuordnung plausibel, ' +
            'aber nicht beweisbar – ein unbekannter Knoten mit demselben Anfangsbyte wäre nicht ' +
            'zu unterscheiden. Solche Strecken sind punktiert gezeichnet und lassen sich hier ganz ausblenden.'
          }
        />
      </div>
    </>
  );
}

function Check({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  title?: string;
}): JSX.Element {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
