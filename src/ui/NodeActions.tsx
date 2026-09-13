/**
 * Aktionsfenster eines Knotens: Ping, Trace, Terminal, Pfad zuruecksetzen.
 *
 * Erreichbar ueber einen Klick auf den Knoten in der Karte ODER auf seine Zeile
 * in der Knotentabelle - beides oeffnet dasselbe Fenster.
 */

import { useEffect, useLayoutEffect, useRef, useState, type JSX, type RefObject } from 'react';
import { ADV_TYPE } from '../protocol/constants';
import { cmdResetPath } from '../protocol/commands';
import { usePreferences } from '../state/preferences';
import { useMesh, useTopoView } from '../state/store';
import { useInteraction } from './interaction';
import { typeClass } from './format';
import type { NodeActionState } from './MapPanel';

export function NodeActions({
  state,
  onClose,
  wrapRef,
}: {
  state: NodeActionState;
  onClose(): void;
  wrapRef: RefObject<HTMLDivElement>;
}): JSX.Element {
  const controller = useMesh();
  const view = useTopoView();
  const { isFavorite, toggleFavorite } = usePreferences();
  const { openTerminal } = useInteraction();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const node = state.node;
  const id = node.pubkey ? controller.model.identities.get(node.pubkey) : null;
  const outPath = id?.outPath ?? [];
  const canPing = !!node.pubkey && !node.isSelf;
  const canTrace = !node.isSelf;
  const canTerminal =
    !!node.pubkey && !node.isSelf && (node.type === ADV_TYPE.REPEATER || node.type === ADV_TYPE.ROOM);

  // Innerhalb der Karte halten.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const wrap = wrapRef.current;
    if (!box || !wrap) return;
    const b = box.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    let left = state.x + 14;
    let top = state.y + 14;
    if (left + b.width > w.width - 8) left = state.x - b.width - 14;
    if (top + b.height > w.height - 8) top = Math.max(8, state.y - b.height - 14);
    box.style.left = `${Math.max(8, left)}px`;
    box.style.top = `${Math.max(8, top)}px`;
  }, [state, wrapRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resetPath = async (): Promise<void> => {
    if (!node.pubkey) return;
    if (!window.confirm(`Bekannten Pfad zu "${node.name}" verwerfen? Das Gerät sucht ihn danach neu (Flood).`)) {
      return;
    }
    const res = await controller.sendAwaitingAck(cmdResetPath(node.pubkey), 'Pfad zurücksetzen');
    setNote(res.text);
  };

  return (
    <div className="nodeactions" ref={boxRef}>
      <button className="na__close" aria-label="Schließen" onClick={onClose}>
        ×
      </button>
      <div className="na__title">
        <span className={`dot dot--${typeClass(node.type)}`} />
        {node.name}
        {node.pubkey && !node.isSelf ? (
          <button
            className={`star${isFavorite(node.pubkey) ? ' is-on' : ''}`}
            title={
              isFavorite(node.pubkey)
                ? 'Favorit entfernen'
                : 'Als Favorit merken – steht dann oben in der Empfängerliste'
            }
            aria-label="Favorit"
            onClick={() => toggleFavorite(node.pubkey as string)}
          >
            {isFavorite(node.pubkey) ? '★' : '☆'}
          </button>
        ) : null}
      </div>
      <div className="na__sub">
        {node.typeName}
        {outPath.length
          ? ` · bekannter Pfad: ${outPath.length} Hop${outPath.length === 1 ? '' : 's'}`
          : ' · kein Pfad bekannt (Flood)'}
      </div>
      <div className="na__row">
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
        <button
          className="btn btn--sm"
          disabled={!canTerminal}
          title={
            canTerminal
              ? 'Befehlszeile dieses Knotens (Anmeldung nötig)'
              : 'Nur Repeater und Room-Server haben eine Befehlszeile'
          }
          onClick={() => {
            openTerminal(node);
            onClose();
          }}
        >
          Terminal
        </button>
        {node.pubkey && !node.isSelf ? (
          <button className="btn btn--sm" onClick={() => void resetPath()}>
            Pfad zurücksetzen
          </button>
        ) : null}
      </div>
      <div className="na__note">
        {note ?? (
          <>
            <strong>Ping</strong> ermittelt Hin- und Rückpfad (Pfad-Discovery, geflutet).{' '}
            <strong>Trace</strong> läuft den bekannten Pfad als Rundweg ab und liefert das SNR je
            Hop.
          </>
        )}
      </div>
      {node.certainty === 'ambiguous' ? (
        <div className="na__warn">
          Dieses Hash-Prefix passt auf mehrere bekannte Knoten
          {view.nodeForKey(node.key)?.candidates?.length
            ? ` (${(view.nodeForKey(node.key)?.candidates ?? []).slice(0, 3).join(', ')})`
            : ''}
          . Ping und Trace treffen deshalb möglicherweise nicht den gemeinten.
        </div>
      ) : null}
    </div>
  );
}
