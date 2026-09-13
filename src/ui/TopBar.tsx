/** Kopfzeile: Verbindungszustand, Geraet, Einstellungen, Terminal, Thema. */

import type { JSX } from 'react';
import { usePreferences } from '../state/preferences';
import { useMesh, useSlice } from '../state/store';
import { APP_VERSION, PROJECT_URL } from '../version';

export function TopBar({
  onSettings,
  onTerminal,
}: {
  onSettings(): void;
  onTerminal(): void;
}): JSX.Element {
  const controller = useMesh();
  useSlice('ui');
  useSlice('config');
  const { prefs, set } = usePreferences();

  const self = controller.model.selfInfo;
  const device = controller.model.deviceInfo;
  const meta = self
    ? `${self.freqMHz.toFixed(3)} MHz · BW ${self.bwKHz} kHz · SF${self.sf} · CR4/${self.cr}`
    : device
      ? `${device.manufacturer || 'MeshCore'} · ${device.firmwareVersion || '?'}`
      : '';

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__dot" data-state={controller.connState} />
        <h1>MeshCore&nbsp;Netz-Topologie</h1>
        <a
          className="topbar__version"
          href={PROJECT_URL}
          target="_blank"
          rel="noreferrer"
          title="Quelltext auf GitHub"
        >
          v{APP_VERSION}
        </a>
      </div>

      {controller.connState !== 'off' || self ? (
        <div className="topbar__device">
          <span className="topbar__name">{self?.nodeName || controller.deviceName || '—'}</span>
          <span className="topbar__meta">{meta}</span>
        </div>
      ) : null}

      <div className="topbar__actions">
        <button className="btn" onClick={onTerminal} disabled={!controller.connected}>
          Terminal
        </button>
        <button className="btn" onClick={onSettings} disabled={!controller.connected}>
          Einstellungen
        </button>
        {controller.connected ? (
          <button className="btn" onClick={() => void controller.disconnect()}>
            Trennen
          </button>
        ) : (
          <button className="btn btn--primary" onClick={() => void controller.connect()}>
            Mit Gerät verbinden
          </button>
        )}
        <button
          className="btn btn--icon"
          title="Hell / Dunkel umschalten"
          aria-label="Hell / Dunkel umschalten"
          onClick={() => set('theme', prefs.theme === 'dark' ? 'light' : 'dark')}
        >
          ◐
        </button>
      </div>
    </header>
  );
}
