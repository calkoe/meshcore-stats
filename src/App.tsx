/**
 * Zusammenbau der Oberflaeche.
 *
 * Hier liegen die wenigen Dinge, die mehrere Spalten gleichzeitig betreffen:
 * das Hervorheben zwischen Liste und Karte, das Aktionsfenster eines Knotens
 * und die Dialoge.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react';
import { MapPanel } from './ui/MapPanel';
import { NodeDialog } from './ui/dialogs/NodeDialog';
import { Sidebar } from './ui/Sidebar';
import { ChatPanel } from './ui/ChatPanel';
import { TopBar } from './ui/TopBar';
import { InteractionProvider, type InteractionApi } from './ui/interaction';
import { IntroDialog } from './ui/dialogs/IntroDialog';
import { SettingsDialog } from './ui/dialogs/SettingsDialog';
import { TerminalDialog } from './ui/dialogs/TerminalDialog';
import type { MapRenderer } from './map/renderer';
import type { TopoView, ViewNode } from './model/types';
import { usePreferences } from './state/preferences';
import { hasStoredRecording, useMesh, useSlice, useTopoView } from './state/store';

export function App(): JSX.Element {
  const controller = useMesh();
  const view = useTopoView();
  const { prefs } = usePreferences();
  useSlice('ui');

  const rendererRef = useRef<MapRenderer | null>(null);
  const viewRef = useRef<TopoView>(view);
  viewRef.current = view;

  /** Schluessel des Knotens, dessen Fenster offen ist. Nicht das Objekt selbst,
   *  damit die Zahlen darin mit der Aufzeichnung mitwachsen. */
  const [nodeKey, setNodeKey] = useState<string | null>(null);
  // Der Startdialog erklaert, was die Anwendung tut. Wer schon eine
  // Aufzeichnung hat, kennt das - dann waere er nur ein Klick im Weg.
  const [showIntro, setShowIntro] = useState(() => !hasStoredRecording());
  const [showSettings, setShowSettings] = useState(false);
  const [terminalFor, setTerminalFor] = useState<string | null | undefined>(undefined);
  /** Empfaenger in der Nachrichtenspalte - bestimmt den gruenen Pfad. */
  const [chatTarget, setChatTarget] = useState('');
  /** Angeklickte Nachricht: nur ihr Pfad bleibt auf der Karte stehen. */
  const [focus, setFocus] = useState<{ chain: string[]; label: string; guess: boolean } | null>(
    null,
  );

  // Ketten kommen als rohe Pfad-Hashes; die Karte rechnet mit kanonischen
  // Knotenschluesseln.
  const focusChain = useMemo(
    () => (focus ? focus.chain.map((h) => view.keyForHash(h)) : null),
    [focus, view],
  );

  const learnedPath = useMemo(() => {
    if (!chatTarget.startsWith('pk:')) return null;
    const raw = controller.learnedPathTo(chatTarget.slice(3));
    return raw ? raw.map((h) => view.keyForHash(h)) : null;
  }, [chatTarget, controller, view]);

  // Farbschema am Dokument, damit auch Leaflet-Elemente es erben.
  useEffect(() => {
    document.body.dataset.theme = prefs.theme;
  }, [prefs.theme]);

  // Relative Zeitangaben frisch halten, auch ohne neue Pakete.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!controller.connected) controller.refreshNow();
    }, 60000);
    return () => clearInterval(timer);
  }, [controller]);

  const highlightChains = useCallback((chains: string[][]) => {
    rendererRef.current?.highlightChains(chains);
  }, []);

  const clearHighlight = useCallback(() => {
    rendererRef.current?.clearHighlight();
  }, []);

  /** Hebt einen Knoten samt seiner Funkstrecken hervor. */
  const highlightNode = useCallback((node: ViewNode) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const chains: string[][] = [];
    for (const link of viewRef.current.links.values()) {
      if (link.a === node.key || link.b === node.key) chains.push([link.a, link.b]);
    }
    renderer.highlightChains(chains); // setzt clearHighlight() selbst ab
    renderer.highlightNodes([node.key]);
  }, []);

  const focusNode = useCallback((node: ViewNode) => {
    rendererRef.current?.panTo(node.key);
    setNodeKey(node.key);
  }, []);

  const openTerminal = useCallback((node: ViewNode) => {
    setTerminalFor(node.pubkey ?? null);
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);

  const interaction: InteractionApi = useMemo(
    () => ({
      rendererRef,
      highlightChains,
      highlightNode,
      clearHighlight,
      focusNode,
      openTerminal,
      openSettings,
    }),
    [highlightChains, highlightNode, clearHighlight, focusNode, openTerminal, openSettings],
  );

  const note = mapNote(controller.connState, view.totals.packets);
  const nodeForDialog = nodeKey ? view.nodeForKey(nodeKey) : null;

  return (
    <InteractionProvider value={interaction}>
      <TopBar onSettings={openSettings} onTerminal={() => setTerminalFor(null)} />
      <main className="layout" style={{ '--sidebar-w': `${prefs.sidebarWidth}px` } as CSSProperties}>
        <Sidebar />
        <MapPanel
          note={note}
          focusChain={focusChain}
          focusLabel={focus?.label ?? null}
          focusGuess={focus?.guess ?? false}
          onClearFocus={() => setFocus(null)}
          learnedPath={learnedPath}
          partnerKey={chatTarget.startsWith('pk:') ? chatTarget.slice(3) : null}
        />
        <ChatPanel
          target={chatTarget}
          onTargetChange={setChatTarget}
          onShowPath={(chain, label, guess) =>
            setFocus((cur) =>
              cur && cur.label === label ? null : { chain, label, guess },
            )
          }
        />
      </main>

      {nodeForDialog ? (
        <NodeDialog node={nodeForDialog} onClose={() => setNodeKey(null)} />
      ) : null}
      {showIntro ? <IntroDialog onClose={() => setShowIntro(false)} /> : null}
      {showSettings ? <SettingsDialog onClose={() => setShowSettings(false)} /> : null}
      {terminalFor !== undefined ? (
        <TerminalDialog initialPubkey={terminalFor} onClose={() => setTerminalFor(undefined)} />
      ) : null}
    </InteractionProvider>
  );
}

function mapNote(state: string, packets: number): string | null {
  if (state === 'on' && packets === 0) {
    return 'Höre mit … jedes empfangene Funkpaket wird ausgewertet. Klick auf einen Knoten: Ping, Trace und Terminal.';
  }
  if (state === 'off' && packets > 0) {
    return 'Nicht verbunden. Die bereits erfassten Daten bleiben sichtbar.';
  }
  return null;
}
