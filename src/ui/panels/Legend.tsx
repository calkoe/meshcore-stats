/** Legende. Jede Kodierung der Karte ist hier benannt - auch die Strichbilder. */

import type { JSX } from 'react';
import { usePreferences } from '../../state/preferences';
import { useTopoView } from '../../state/store';
import { fmtNum } from '../format';

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

      <div className="legend__scale">
        <div className="legend__scale-label">Nachrichten je Strecke</div>
        <div className={`legend__ramp${prefs.scale === 'heat' ? ' is-heat' : ''}`} />
        <div className="legend__ends">
          <span>wenig</span>
          <span>{fmtNum(view.totals.maxLinkCount)}</span>
        </div>
      </div>

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
