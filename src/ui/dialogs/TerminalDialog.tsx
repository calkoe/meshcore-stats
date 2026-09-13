/**
 * Terminal als eigenes Fenster, mit Auswahl des Zielknotens.
 *
 * Die Konsole selbst steckt in `TerminalPanel` - dieselbe Komponente sitzt im
 * Knotenfenster, damit es dort nicht nochmal gebaut werden muss.
 */

import { useMemo, useState, type JSX } from 'react';
import { ADV_TYPE } from '../../protocol/constants';
import { useMesh, useSlice } from '../../state/store';
import { TerminalPanel } from '../TerminalPanel';
import { Modal } from './Modal';

export function TerminalDialog({
  initialPubkey,
  onClose,
}: {
  initialPubkey: string | null;
  onClose(): void;
}): JSX.Element {
  const controller = useMesh();
  useSlice('terminal');

  const targets = useMemo(
    () =>
      [...controller.model.identities.values()]
        .filter((i) => !i.isSelf && (i.type === ADV_TYPE.REPEATER || i.type === ADV_TYPE.ROOM))
        .sort((a, b) => (a.name || a.pubkey).localeCompare(b.name || b.pubkey)),
    [controller, controller.model.identities.size],
  );

  const [pubkey, setPubkey] = useState(initialPubkey ?? targets[0]?.pubkey ?? '');
  const target = targets.find((t) => t.pubkey === pubkey) ?? null;

  return (
    <Modal title="Terminal" onClose={onClose} wide>
      <div className="term__pick">
        <select
          aria-label="Knoten"
          value={pubkey}
          onChange={(e) => setPubkey(e.target.value)}
        >
          {targets.length === 0 ? <option value="">— kein Repeater bekannt —</option> : null}
          {targets.map((t) => (
            <option key={t.pubkey} value={t.pubkey}>
              {t.name || t.pubkey.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      {target ? (
        <TerminalPanel pubkey={target.pubkey} name={target.name || target.pubkey.slice(0, 8)} />
      ) : (
        <p className="dlg__empty">
          In der Kontaktliste dieses Geräts steht noch kein Repeater oder Room-Server.
        </p>
      )}
    </Modal>
  );
}
