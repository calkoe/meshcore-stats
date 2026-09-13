/** Legende. Jede Kodierung der Karte ist hier benannt - auch die Strichbilder. */

import type { JSX } from 'react';
import { SIGNAL_STATUS } from '../../map/palette';
import { usePreferences } from '../../state/preferences';
import { useTopoView } from '../../state/store';
import { fmtNum } from '../format';

/** Die Schwellen der Signalstufen, in derselben Reihenfolge wie SIGNAL_STATUS. */
const SIGNAL_BOUNDS = ['unter −95 dBm', '−95 bis −85', '−85 bis −75', 'über −75 dBm'];

export function Legend(): JSX.Element {
  const { prefs } = usePreferences();
  const view = useTopoView();

  return (
    <>
      <ul className="legend">
        <li>
          <span className="swatch swatch--repeater" />
          Repeater / Gateway
        </li>
        <li>
          <span className="swatch swatch--room" />
          Room-Server
        </li>
        <li>
          <span className="swatch swatch--chat" />
          Client
        </li>
        <li>
          <span className="swatch swatch--unknown" />
          Sensor / unbekannt
        </li>
      </ul>

      {prefs.scale === 'signal' ? (
        <div className="legend__scale">
          <div className="legend__scale-label">Linienfarbe: gemessener Empfang</div>
          <ul className="legend legend--signal">
            {SIGNAL_STATUS.map((step, i) => (
              <li key={step.key}>
                <span className="sig__dot" style={{ background: step.color }} />
                {step.label} ({SIGNAL_BOUNDS[i]})
              </li>
            ))}
            <li>
              <span className="sig__dot sig__dot--none" />
              nie selbst gehört
            </li>
          </ul>
          <p className="legend__note">
            Die Dicke zeigt weiterhin die Zahl der Pakete – Farbe und Dicke sagen hier also
            Verschiedenes.
          </p>
        </div>
      ) : (
        <div className="legend__scale">
          <div className="legend__scale-label">Linienfarbe: Pakete je Strecke</div>
          <div className="legend__ramp" />
          <div className="legend__ends">
            <span>wenig</span>
            <span>{fmtNum(view.totals.maxLinkCount)}</span>
          </div>
        </div>
      )}

      <ul className="legend legend--lines">
        <li>
          <span className="line line--solid" />
          gemessen / beobachtet
        </li>
        <li>
          <span className="line line--dashed" />
          deklarierte Route
        </li>
        <li>
          <span className="line line--dotted" />
          Zuordnung nicht eindeutig
        </li>
        <li>
          <span className="line line--learned" />
          gelernter Weg zum Chatpartner
        </li>
      </ul>

      <p className="legend__note">
        Trifft ein Paket ein, leuchtet sein Weg kurz auf. Ein Klick auf eine Nachricht rechts
        blendet alles bis auf ihren Pfad aus.
      </p>

      <p className="legend__note">
        Ein Hop steht im Paket oft nur als einzelnes Byte des Public Key. Passt es auf genau einen
        bekannten Knoten, ist die Zuordnung plausibel – ein unbekannter Knoten mit demselben
        Anfangsbyte wäre aber nicht zu unterscheiden. Solche Strecken sind punktiert.
      </p>
      <p className="legend__note">
        Knoten ohne selbst gemeldete Position werden nicht gezeichnet – Positionen werden niemals
        geschätzt. Enthält eine Route solche Hops, erscheint nur ihr bekannter Teil.
      </p>
    </>
  );
}
