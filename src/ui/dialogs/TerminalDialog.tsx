/**
 * Terminal zu einem fremden Knoten (Repeater oder Room-Server).
 *
 * Technisch ist das die Admin-Konsole von MeshCore: `CMD_SEND_LOGIN` mit dem
 * Passwort des Zielknotens, danach Textnachrichten vom Typ TXT_TYPE_CLI_DATA.
 * Beides laeuft verschluesselt ueber das Mesh - der Befehl kann also mehrere
 * Hops brauchen, und die Antwort dauert entsprechend.
 *
 * Fuer das EIGENE Gerät gibt es das nicht: die Companion-Firmware stellt ihre
 * Befehlszeile nur über die serielle Schnittstelle bereit, nicht über
 * Bluetooth. Was sich am eigenen Gerät einstellen lässt, steht deshalb in den
 * Einstellungen.
 *
 * Das Passwort wird nicht gespeichert - es geht einmal als Kommando an das
 * eigene Funkgerät und verlässt diesen Dialog nicht.
 */

import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { ADV_TYPE } from '../../protocol/constants';
import { useMesh, useSlice } from '../../state/store';
import { relTime } from '../format';
import { Modal } from './Modal';

/** Befehle, die die Repeater-Firmware auch aus der Ferne annimmt. */
const EXAMPLES = ['ver', 'board', 'clock', 'neighbors', 'advert', 'region'];

export function TerminalDialog({
  initialPubkey,
  onClose,
}: {
  initialPubkey: string | null;
  onClose(): void;
}): JSX.Element {
  const controller = useMesh();
  useSlice('terminal');
  useSlice('ui');

  const targets = useMemo(
    () =>
      [...controller.model.identities.values()]
        .filter((i) => !i.isSelf && (i.type === ADV_TYPE.REPEATER || i.type === ADV_TYPE.ROOM))
        .sort((a, b) => (a.name || a.pubkey).localeCompare(b.name || b.pubkey)),
    [controller, controller.model.identities.size],
  );

  const [pubkey, setPubkey] = useState(initialPubkey ?? targets[0]?.pubkey ?? '');
  const [password, setPassword] = useState('');
  const [command, setCommand] = useState('');
  const [historyPos, setHistoryPos] = useState(-1);
  const outRef = useRef<HTMLDivElement | null>(null);

  const target = targets.find((t) => t.pubkey === pubkey) ?? null;
  const session = pubkey ? controller.session(pubkey) : null;

  // Sitzung anlegen, sobald ein Ziel gewaehlt ist.
  useEffect(() => {
    if (pubkey && target) controller.openTerminal(pubkey, target.name || pubkey.slice(0, 8));
  }, [controller, pubkey, target]);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.lines.length]);

  const ready = session?.status === 'bereit';

  const submit = async (): Promise<void> => {
    const cmd = command.trim();
    if (!cmd || !pubkey) return;
    setCommand('');
    setHistoryPos(-1);
    await controller.terminalSend(pubkey, cmd);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const hist = session?.history ?? [];
    if (e.key === 'ArrowUp' && hist.length) {
      e.preventDefault();
      const pos = historyPos < 0 ? hist.length - 1 : Math.max(0, historyPos - 1);
      setHistoryPos(pos);
      setCommand(hist[pos]);
    } else if (e.key === 'ArrowDown' && hist.length) {
      e.preventDefault();
      if (historyPos < 0) return;
      const pos = historyPos + 1;
      if (pos >= hist.length) {
        setHistoryPos(-1);
        setCommand('');
      } else {
        setHistoryPos(pos);
        setCommand(hist[pos]);
      }
    }
  };

  return (
    <Modal title="Terminal" onClose={onClose} wide>
      <div className="term">
        <div className="term__head">
          <select
            aria-label="Knoten"
            value={pubkey}
            onChange={(e) => {
              setPubkey(e.target.value);
              setPassword('');
            }}
          >
            {targets.length === 0 ? <option value="">— kein Repeater bekannt —</option> : null}
            {targets.map((t) => (
              <option key={t.pubkey} value={t.pubkey}>
                {t.name || t.pubkey.slice(0, 8)}
              </option>
            ))}
          </select>

          <span className={`term__state term__state--${session?.status ?? 'neu'}`}>
            {session?.status ?? 'neu'}
          </span>

          {ready ? (
            <button className="btn btn--sm" onClick={() => void controller.terminalLogout(pubkey)}>
              Abmelden
            </button>
          ) : null}
        </div>

        {!ready ? (
          <form
            className="term__login"
            onSubmit={(e) => {
              e.preventDefault();
              void controller.terminalLogin(pubkey, password);
              setPassword('');
            }}
          >
            <input
              type="password"
              placeholder="Passwort des Knotens"
              autoComplete="off"
              aria-label="Passwort des Knotens"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn--sm btn--primary"
              disabled={!pubkey || !controller.connected || session?.status === 'anmeldung'}
            >
              Anmelden
            </button>
            <span className="term__hint">
              Das Passwort geht nur an das Funkgerät und wird nirgends gespeichert.
            </span>
          </form>
        ) : null}

        <div className="term__out" ref={outRef}>
          {!session || session.lines.length === 0 ? (
            <p className="empty">
              Noch nichts gesendet. Nach der Anmeldung antwortet der Knoten auf Befehle wie{' '}
              <code>ver</code> oder <code>neighbors</code>.
            </p>
          ) : (
            session.lines.map((l) => (
              <div key={l.id} className={`term__line term__line--${l.dir}`}>
                <span className="term__time">{relTime(l.t)}</span>
                <span className="term__text">
                  {l.dir === 'out' ? '> ' : ''}
                  {l.text}
                </span>
              </div>
            ))
          )}
        </div>

        <form
          className="term__in"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            type="text"
            placeholder={ready ? 'Befehl …' : 'erst anmelden'}
            autoComplete="off"
            aria-label="Befehl"
            disabled={!ready}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="btn btn--sm btn--primary" disabled={!ready || !command.trim()}>
            Senden
          </button>
        </form>

        <div className="term__examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="term__chip"
              disabled={!ready}
              onClick={() => setCommand(ex)}
            >
              {ex}
            </button>
          ))}
          <span className="term__hint">
            Dazu <code>get &lt;Schlüssel&gt;</code> und <code>set &lt;Schlüssel&gt; &lt;Wert&gt;</code>.
            Kennt der Knoten einen Befehl nicht, antwortet er „Unknown command“. Einen
            Hilfe-Befehl gibt es nicht.
          </span>
        </div>
      </div>
    </Modal>
  );
}
