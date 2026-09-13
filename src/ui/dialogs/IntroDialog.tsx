/** Startdialog. Erklaert, was die Anwendung tut, und weist auf die Grenzen hin. */

import type { JSX } from 'react';
import { MeshCoreBLE } from '../../transport/ble';
import { useMesh } from '../../state/store';

export function IntroDialog({ onClose }: { onClose(): void }): JSX.Element {
  const controller = useMesh();
  const supported = MeshCoreBLE.isSupported();
  const secure = typeof window !== 'undefined' && window.isSecureContext;

  let warn: string | null = null;
  if (!supported) {
    warn =
      'Dieser Browser unterstützt Web Bluetooth nicht. Nötig ist Chrome oder Edge auf dem Desktop.';
  } else if (!secure) {
    warn =
      'Die Seite läuft nicht in einem sicheren Kontext. Web Bluetooth verlangt https:// oder http://localhost.';
  }

  return (
    <div className="modal">
      <div className="modal__box">
        <h2>MeshCore Netz-Topologie</h2>
        <p>
          Verbindet sich per Bluetooth Low Energy mit einem MeshCore-Gerät (Companion-Firmware) und
          zeichnet auf, welche Pakete über welche Hops eintreffen. Ausgewertet wird{' '}
          <strong>jedes empfangene Funkpaket</strong> – Adverts, ACKs, Requests, Gruppen- und
          Textnachrichten –, nicht nur Textnachrichten.
        </p>
        <ul>
          <li>Je mehr Verkehr über eine Funkstrecke läuft, desto dicker und heller die Linie.</li>
          <li>Beim Überfahren einer Linie oder Route erscheint der vollständige Pfad.</li>
          <li>Empfangsstärke in dBm wird dort gezeigt, wo sie tatsächlich gemessen wurde.</li>
          <li>
            Ein Klick auf einen Knoten öffnet Ping, Trace und – bei Repeatern – das Terminal.
          </li>
        </ul>
        {warn ? <p className="modal__warn">{warn}</p> : null}
        <div className="modal__actions">
          <button
            className="btn btn--primary"
            disabled={!!warn}
            onClick={() => {
              onClose();
              void controller.connect();
            }}
          >
            Gerät verbinden
          </button>
          <button className="btn" onClick={onClose}>
            Ohne Gerät ansehen
          </button>
        </div>
      </div>
    </div>
  );
}
