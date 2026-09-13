/**
 * Bruecke zwischen Seitenleiste und Karte.
 *
 * Das Hervorheben, Zentrieren und Oeffnen der Aktionsfenster passiert von
 * mehreren Stellen aus (Knotentabelle, Routenliste, Karte selbst). Statt die
 * Rueckrufe durch den halben Baum zu reichen, liegen sie hier - die Funktionen
 * sind stabil, ein Neuaufbau wird dadurch nicht ausgeloest.
 */

import { createContext, useContext } from 'react';
import type { MutableRefObject } from 'react';
import type { MapRenderer } from '../map/renderer';
import type { ViewNode } from '../model/types';

export interface InteractionApi {
  rendererRef: MutableRefObject<MapRenderer | null>;
  /** Hebt die Strecken dieser Hop-Ketten hervor (vorhandene Linien, keine neuen). */
  highlightChains(chains: string[][]): void;
  /** Hebt einen Knoten samt seiner Funkstrecken hervor. */
  highlightNode(node: ViewNode): void;
  clearHighlight(): void;
  /** Zentriert auf den Knoten und oeffnet das Aktionsfenster (Ping/Trace/Terminal). */
  focusNode(node: ViewNode): void;
  openTerminal(node: ViewNode): void;
  openSettings(): void;
}

const Ctx = createContext<InteractionApi | null>(null);

export const InteractionProvider = Ctx.Provider;

export function useInteraction(): InteractionApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('InteractionProvider fehlt');
  return api;
}
