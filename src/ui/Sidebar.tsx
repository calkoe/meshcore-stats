/** Linke Spalte: Kennzahlen, Filter, Knoten, Legende, Daten, Protokoll. */

import { useCallback, useEffect, useRef, type JSX, type ReactNode } from 'react';
import { usePreferences } from '../state/preferences';
import { StatTiles } from './panels/StatTiles';
import { FilterPanel } from './panels/FilterPanel';
import { NodeTable } from './panels/NodeTable';
import { Legend } from './panels/Legend';
import { DataPanel } from './panels/DataPanel';
import { EventLog } from './panels/EventLog';

const MIN_WIDTH = 280;
const MAX_WIDTH = 720;

export function Sidebar(): JSX.Element {
  return (
    <>
      <aside className="sidebar">
        <Panel title="Überblick">
          <StatTiles />
        </Panel>

        <Panel title="Filter">
          <FilterPanel />
        </Panel>

        <Panel title="Knoten" hint="überfahren = hervorheben · klicken = Ping/Trace/Terminal" grow>
          <NodeTable />
        </Panel>

        <Panel title="Legende">
          <Legend />
        </Panel>

        <Panel title="Daten">
          <DataPanel />
        </Panel>

        <Panel title="Ereignisse">
          <EventLog />
        </Panel>
      </aside>
      <SidebarResizer />
    </>
  );
}

/**
 * Ziehbarer Rand zwischen Seitenleiste und Karte.
 *
 * Die Breite liegt in den Einstellungen und ueberlebt damit das Neuladen. Der
 * Griff nimmt den Zeiger fest (`setPointerCapture`), sonst reisst das Ziehen
 * ab, sobald der Zeiger ueber die Karte laeuft.
 */
function SidebarResizer(): JSX.Element {
  const { prefs, set } = usePreferences();
  const dragging = useRef(false);
  const widthRef = useRef(prefs.sidebarWidth);
  widthRef.current = prefs.sidebarWidth;

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(e.clientX)));
      if (next !== widthRef.current) set('sidebarWidth', next);
    },
    [set],
  );

  useEffect(() => {
    const stop = (): void => {
      dragging.current = false;
      document.body.classList.remove('is-resizing');
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [onPointerMove]);

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite der linken Spalte"
      title="Ziehen: Spalte breiter oder schmaler"
      onPointerDown={(e) => {
        dragging.current = true;
        document.body.classList.add('is-resizing');
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onDoubleClick={() => set('sidebarWidth', 400)}
    />
  );
}

function Panel({
  title,
  hint,
  grow,
  children,
}: {
  title: string;
  hint?: string;
  grow?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={`panel${grow ? ' panel--grow' : ''}`}>
      <h2 className="panel__title">
        {title}
        {hint ? <span className="panel__hint">{hint}</span> : null}
      </h2>
      {children}
    </section>
  );
}
