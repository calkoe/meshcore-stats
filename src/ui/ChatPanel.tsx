/**
 * Rechte Spalte: empfangene und gesendete Nachrichten.
 *
 * Achtung: Die App holt Nachrichten mit CMD_SYNC_NEXT_MESSAGE aus der
 * Warteschlange des Geraets. Eine parallel laufende Chat-App sieht sie danach
 * nicht mehr.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { TXT_TYPE } from '../protocol/constants';
import { usePreferences } from '../state/preferences';
import { useMesh, useSlice } from '../state/store';

const MAX_SHOWN = 300;

export function ChatPanel({
  target,
  onTargetChange,
  onShowPath,
}: {
  target: string;
  onTargetChange(value: string): void;
  onShowPath(chain: string[], label: string, guess: boolean): void;
}): JSX.Element {
  const controller = useMesh();
  const { isFavorite } = usePreferences();
  useSlice('chat');
  useSlice('ui');
  const logRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{ text: string; cls: string }>({ text: '', cls: '' });

  const msgs = controller.model.messages;
  const connected = controller.connected;

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const contacts = [...controller.model.identities.values()]
    .filter((i) => !i.isSelf && i.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const favorites = contacts.filter((c) => isFavorite(c.pubkey));
  const others = contacts.filter((c) => !isFavorite(c.pubkey));

  const send = async (): Promise<void> => {
    const body = text.trim();
    if (!body || !target) return;
    setText('');
    const result = await controller.sendMessage(target, body);
    setStatus({ text: result, cls: result.includes('gesendet') ? 'is-ok' : '' });
  };

  return (
    <aside className="chat">
      <div className="chat__head">
        <h2>Nachrichten</h2>
        <span className="chat__hint">{connected ? 'verbunden' : 'nicht verbunden'}</span>
      </div>

      <div className="chat__log" ref={logRef}>
        {msgs.length === 0 ? (
          <p className="empty">Noch keine Nachrichten.</p>
        ) : (
          msgs.slice(-MAX_SHOWN).map((m) => {
            const meta: string[] = [];
            if (m.snr != null) meta.push(`SNR ${m.snr.toFixed(1)} dB`);
            if (m.pathLen != null) meta.push(`${m.pathLen} Hop${m.pathLen === 1 ? '' : 's'}`);
            else if (m.dir === 'in') meta.push('Direct');
            if (m.dir === 'out') meta.push(m.state === 'delivered' ? 'zugestellt' : 'gesendet');
            if (m.txtType === TXT_TYPE.CLI_DATA) meta.push('CLI-Antwort');

            const who =
              m.dir === 'out'
                ? `an ${m.isChannel ? `Kanal ${m.channelIdx}` : (m.toName ?? '?')}`
                : m.fromName;

            const hasPath = !!m.chain && m.chain.length >= 2;
            return (
              <div
                className={`msg msg--${m.dir}${hasPath ? ' msg--clickable' : ''}`}
                key={m.id}
                title={
                  hasPath
                    ? 'Klicken: nur den Pfad dieser Nachricht auf der Karte zeigen'
                    : 'Zu dieser Nachricht ist kein Pfad bekannt'
                }
                onClick={() => {
                  if (!m.chain || m.chain.length < 2) return;
                  onShowPath(m.chain, `${who} · ${m.text.slice(0, 24)}`, !!m.chainGuess);
                }}
              >
                <div className="msg__head">
                  <span className="msg__from">{who}</span>
                  {m.isChannel ? <span className="msg__chan">Kanal {m.channelIdx}</span> : null}
                  <span className="msg__meta">
                    {new Date(m.t).toLocaleTimeString('de-DE', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="msg__text">{m.text}</div>
                {meta.length ? (
                  <div className="msg__sub">
                    {meta.map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <form
        className="chat__compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <select
          aria-label="Empfänger"
          value={target}
          onChange={(e) => onTargetChange(e.target.value)}
        >
          <option value="">— Empfänger wählen —</option>
          <option value="ch:0">Kanal 0 (Public)</option>
          {favorites.length ? (
            <optgroup label="★ Favoriten">
              {favorites.map((c) => (
                <option key={c.pubkey} value={`pk:${c.pubkey}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label={favorites.length ? 'Alle Kontakte' : 'Kontakte'}>
            {others.map((c) => (
              <option key={c.pubkey} value={`pk:${c.pubkey}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
        {target.startsWith('pk:') ? (
          <div className="chat__path">
            {controller.learnedPathTo(target.slice(3))
              ? 'Der gelernte Weg dorthin liegt grün mit Pfeilen auf der Karte.'
              : 'Kein Pfad gelernt – die Nachricht geht geflutet los.'}
          </div>
        ) : null}
        <div className="chat__row">
          <input
            type="text"
            placeholder="Nachricht…"
            autoComplete="off"
            maxLength={160}
            aria-label="Nachrichtentext"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={!connected || !target || text.trim().length === 0}
          >
            Senden
          </button>
        </div>
        <div className={`chat__status ${status.cls}`.trim()}>{status.text}</div>
      </form>
    </aside>
  );
}
