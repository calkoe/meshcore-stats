/**
 * Die Karte samt allem, was darauf schwebt: Tooltip, Hinweiszeile, Farbskala
 * und Schwellenregler.
 *
 * Die Fenster zu Knoten und Funkstrecken liegen NICHT hier - ein Klick öffnet
 * einen Dialog, kein am Kartenrand herumrutschendes Popup. Was beim bloßen
 * Überfahren erscheint, bleibt der leichte Tooltip.
 */

import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import type L from 'leaflet';
import { MapRenderer, type RenderStats } from '../map/renderer';
import type { TopoView, ViewLink } from '../model/types';
import { useInteraction } from './interaction';
import { useMesh, useTopoView } from '../state/store';
import { usePreferences } from '../state/preferences';
import { LinkTooltip, NodeTooltip } from './Tooltips';
import { AnalysisDialog } from './dialogs/AnalysisDialog';

interface Floating {
  x: number;
  y: number;
  content: ReactNode;
}

export function MapPanel({
  note,
  focusChain,
  focusLabel,
  focusGuess,
  onClearFocus,
  learnedPath,
  partnerKey,
}: {
  note: string | null;
  focusChain: string[] | null;
  focusLabel: string | null;
  focusGuess: boolean;
  onClearFocus(): void;
  learnedPath: string[] | null;
  partnerKey: string | null;
}): JSX.Element {
  const controller = useMesh();
  const view = useTopoView();
  const { prefs, set } = usePreferences();
  const { rendererRef, highlightChains, highlightNode, clearHighlight, focusNode } =
    useInteraction();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<TopoView>(view);
  viewRef.current = view;

  const [tooltip, setTooltip] = useState<Floating | null>(null);
  /** Schluessel der Strecke, deren Analyse offen ist - nicht das Objekt selbst,
   *  damit die Zahlen im Fenster mit der Aufzeichnung mitwachsen. */
  const [analysisKey, setAnalysisKey] = useState<string | null>(null);
  const [stats, setStats] = useState<RenderStats>({
    totalLinks: 0,
    shownLinks: 0,
    ambiguousLinks: 0,
    visibleMaxLink: 1,
  });

  const focusNodeRef = useRef(focusNode);
  focusNodeRef.current = focusNode;

  /** Alle Routen hervorheben, die ueber diese Strecke laufen. */
  const chainsUsingLink = useCallback((link: ViewLink): string[][] => {
    const v = viewRef.current;
    const chains = [...v.routes.values()]
      .filter((r) => chainUsesLink(r.chain, link.a, link.b))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((r) => r.chain);
    return chains.length ? chains : [[link.a, link.b]];
  }, []);

  // Karte genau einmal aufbauen. Die Rueckrufe greifen ueber Refs auf den
  // aktuellen Stand zu, damit der Aufbau nicht von den Daten abhaengt.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = new MapRenderer(container, {
      onNodeHover: (node, latlng) => {
        highlightNode(node);
        setTooltip({
          ...toContainerXY(renderer.map, latlng),
          content: <NodeTooltip node={node} />,
        });
      },
      onNodeOut: () => {
        clearHighlight();
        setTooltip(null);
      },
      onNodeClick: (node) => {
        setTooltip(null);
        focusNodeRef.current(node);
      },
      onLinkHover: (link, latlng) => {
        const chains = chainsUsingLink(link);
        highlightChains(chains);
        setTooltip({
          ...toContainerXY(renderer.map, latlng),
          content: <LinkTooltip view={viewRef.current} link={link} routeCount={chains.length} />,
        });
      },
      onLinkOut: () => {
        clearHighlight();
        setTooltip(null);
      },
      onLinkClick: (link) => {
        setTooltip(null);
        setAnalysisKey(link.key);
      },
      onStats: setStats,
      onMapClick: () => setTooltip(null),
    });
    rendererRef.current = renderer;
    return () => {
      rendererRef.current = null;
      renderer.destroy();
    };
  }, [chainsUsingLink, clearHighlight, controller, highlightChains, highlightNode, rendererRef]);

  // Daten und Darstellungsoptionen an die Karte reichen.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setThemeClass(prefs.theme);
    renderer.render(view, {
      theme: prefs.theme,
      scale: prefs.scale,
      showLabels: prefs.showLabels,
      onlyGateways: prefs.onlyGateways,
      onlyDirect: prefs.onlyDirect,
      onlyCertain: prefs.onlyCertain,
      hotOnly: prefs.hotOnly,
      focusChain,
      learnedPath,
      partnerKey,
    });
  }, [
    rendererRef,
    view,
    prefs.theme,
    prefs.scale,
    prefs.showLabels,
    prefs.onlyGateways,
    prefs.onlyDirect,
    prefs.onlyCertain,
    prefs.hotOnly,
    focusChain,
    learnedPath,
    partnerKey,
  ]);

  // Neu eintreffende Pakete kurz aufleuchten lassen. Bewusst ohne React-
  // Zustand: bei lebhaftem Funkverkehr waeren das mehrere Neuaufbauten je
  // Sekunde, und zu sehen ist ohnehin nur eine Animation auf der Karte.
  useEffect(() => {
    return controller.subscribePackets((raw) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.flashChain(raw.map((h) => viewRef.current.keyForHash(h)));
    });
  }, [controller, rendererRef]);

  // Die Breite der linken Spalte ist ziehbar - Leaflet muss das erfahren.
  useEffect(() => {
    rendererRef.current?.invalidateSize();
  }, [rendererRef, prefs.sidebarWidth]);

  // Tooltip innerhalb der Karte halten.
  useEffect(() => {
    const el = tooltipRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap || !tooltip) return;
    const box = el.getBoundingClientRect();
    const bounds = wrap.getBoundingClientRect();
    let left = tooltip.x + 16;
    let top = tooltip.y + 16;
    if (left + box.width > bounds.width - 8) left = tooltip.x - box.width - 16;
    if (top + box.height > bounds.height - 8) top = Math.max(8, tooltip.y - box.height - 16);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }, [tooltip]);

  const thresholdLabel =
    stats.shownLinks === stats.totalLinks ? `alle ${stats.totalLinks}` : `Top ${stats.shownLinks}`;
  const analysis = analysisKey ? view.links.get(analysisKey) : null;
  const na = analysis ? view.nodeForKey(analysis.a) : null;
  const nb = analysis ? view.nodeForKey(analysis.b) : null;

  return (
    <div className="mapwrap" ref={wrapRef}>
      <div id="map" ref={containerRef} />

      {tooltip ? (
        <div className="tooltip" ref={tooltipRef}>
          {tooltip.content}
        </div>
      ) : null}

      {analysis && na && nb ? (
        <AnalysisDialog
          a={na}
          b={nb}
          link={analysis}
          view={view}
          onClose={() => setAnalysisKey(null)}
        />
      ) : null}

      {focusLabel ? (
        <div className="focusbar">
          <span className="focusbar__what">Pfad: {focusLabel}</span>
          {focusGuess ? (
            <span
              className="focusbar__guess"
              title="Der Pfad steht nicht in der Nachricht selbst – das Frame nennt nur die Hop-Zahl. Gezeigt wird das zuletzt gehörte Textpaket, dessen Absenderbyte und Hop-Zahl passen."
            >
              zugeordnet, nicht abgelesen
            </span>
          ) : null}
          <button
            className="btn btn--sm"
            onClick={() => {
              if (focusChain) controller.traceChain(focusChain, viewRef.current);
            }}
          >
            Trace
          </button>
          <button className="btn btn--sm" onClick={onClearFocus}>
            Auswahl aufheben
          </button>
        </div>
      ) : null}

      {note ? <div className="mapnote">{note}</div> : null}

      <div className="mapctl">
        <div className="scaletoggle" role="group" aria-label="Bedeutung der Linienfarbe">
          <span className="scaletoggle__label">Linienfarbe</span>
          {(
            [
              ['packets', 'Pakete', 'Farbe nach der Zahl der Pakete über diese Strecke'],
              ['signal', 'Signal', 'Farbe nach gemessener Empfangsstärke in dBm'],
            ] as const
          ).map(([value, label, title]) => (
            <button
              key={value}
              type="button"
              className={`scaletoggle__btn${prefs.scale === value ? ' is-active' : ''}`}
              aria-pressed={prefs.scale === value}
              title={title}
              onClick={() => set('scale', value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="threshold">
          <label className="threshold__label" htmlFor="linkThreshold">
            Strecken
          </label>
          <input
            id="linkThreshold"
            type="range"
            min={0}
            max={100}
            step={1}
            value={prefs.hotOnly}
            aria-label="Nur die verkehrsreichsten Funkstrecken anzeigen"
            onChange={(e) => set('hotOnly', Number(e.target.value))}
          />
          <span className="threshold__value">{thresholdLabel}</span>
        </div>
      </div>
    </div>
  );
}

function toContainerXY(map: L.Map, latlng: L.LatLng): { x: number; y: number } {
  const p = map.latLngToContainerPoint(latlng);
  return { x: p.x, y: p.y };
}

function chainUsesLink(chain: string[], a: string, b: string): boolean {
  for (let i = 0; i < chain.length - 1; i++) {
    const x = chain[i];
    const y = chain[i + 1];
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
}
