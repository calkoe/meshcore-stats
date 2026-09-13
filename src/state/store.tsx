/**
 * React-Anbindung des MeshController.
 *
 * Die Oberflaeche abonniert einzelne Scheiben statt eines globalen Zustands.
 * Dadurch fuehrt ein eintreffendes Funkpaket nur zum Neuzeichnen von Karte und
 * Listen, nicht auch noch von Chat, Terminal und Einstellungen.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { MeshController, type Slice } from './mesh';
import { usePreferences } from './preferences';
import type { TopoView, ViewFilter } from '../model/types';
import type { StoredModel } from '../model/topology';

const STORAGE_KEY = 'meshcore-topo.v1';
const AUTOSAVE_MS = 15000;

const Ctx = createContext<MeshController | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const controller = useMemo(() => new MeshController(), []);
  const { prefs } = usePreferences();

  // Wiederherstellen: genau einmal, bevor irgendetwas gezeichnet wird.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        controller.loadStored(JSON.parse(raw) as StoredModel);
        controller.addLog(
          `Frühere Aufzeichnung geladen (${controller.model.events.length} Ereignisse).`,
        );
      }
    } catch (err) {
      controller.addLog(`Gespeicherte Daten unlesbar: ${String(err)}`, 'warn');
    }
    return () => controller.dispose();
  }, [controller]);

  // Regelmaessig sichern. Bei Platzmangel werden schrittweise aeltere
  // Ereignisse fallen gelassen, statt gar nichts zu speichern.
  useEffect(() => {
    if (!prefs.persist) return;
    const save = (): void => {
      try {
        const data = controller.model.toJSON();
        for (const limit of [data.events.length, 20000, 8000, 3000, 1000]) {
          try {
            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({ ...data, events: data.events.slice(-limit) }),
            );
            return;
          } catch (err) {
            const e = err as { name?: string; code?: number };
            if (e.name !== 'QuotaExceededError' && e.code !== 22) throw err;
          }
        }
        controller.addLog('Speicher voll - Aufzeichnung wird nicht gesichert.', 'warn');
      } catch (err) {
        controller.addLog(`Speichern fehlgeschlagen: ${String(err)}`, 'warn');
      }
    };
    const timer = setInterval(save, AUTOSAVE_MS);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', save);
    };
  }, [controller, prefs.persist]);

  // Debug-Zugang. Erlaubt es, aus der Browser-Konsole rohe Protokoll-Frames
  // einzuspeisen - etwa aus einem Mitschnitt:
  //   meshcoreTopo.feed(new Uint8Array([0x88, ...]))
  // Achtung: Eingespeiste Frames landen in derselben Aufzeichnung wie echter
  // Funkverkehr. Zum Ausprobieren vorher "im Browser speichern" abschalten.
  useEffect(() => {
    const w = window as unknown as { meshcoreTopo?: unknown };
    w.meshcoreTopo = {
      controller,
      model: controller.model,
      feed: (b: Uint8Array | number[]) =>
        controller.onFrame(b instanceof Uint8Array ? b : new Uint8Array(b)),
      refresh: () => controller.refreshNow(),
    };
    return () => {
      delete w.meshcoreTopo;
    };
  }, [controller]);

  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export function useMesh(): MeshController {
  const c = useContext(Ctx);
  if (!c) throw new Error('StoreProvider fehlt');
  return c;
}

/** Abonniert eine Scheibe und liefert ihre Versionsnummer. */
export function useSlice(slice: Slice): number {
  const controller = useMesh();
  return useSyncExternalStore(
    (fn) => controller.subscribe(slice, fn),
    () => controller.getVersion(slice),
    () => 0,
  );
}

/** Die aktuelle abgeleitete Sicht, passend zu den eingestellten Filtern. */
export function useTopoView(): TopoView {
  const controller = useMesh();
  const { prefs } = usePreferences();
  const version = useSlice('data');
  const filter: ViewFilter = useMemo(
    () => ({
      windowMs: prefs.windowMs || null,
      payloadTypes: prefs.payload === 'all' ? null : new Set([prefs.payload]),
      includeDeclared: prefs.includeDeclared,
    }),
    [prefs.windowMs, prefs.payload, prefs.includeDeclared],
  );
  return useMemo(
    () => controller.model.computeView(filter),
    // `version` gehoert bewusst in die Abhaengigkeiten: es ist das Signal,
    // dass sich das Ereignis-Log geaendert hat.
    [controller, filter, version],
  );
}

export function localStorageKey(): string {
  return STORAGE_KEY;
}

/** Liegt schon eine Aufzeichnung im Browser? */
export function hasStoredRecording(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}
