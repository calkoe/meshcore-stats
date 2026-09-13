/**
 * Anzeige-Einstellungen. Sie beschreiben nur, WIE die aufgezeichneten Daten
 * dargestellt werden - nie das Geraet selbst (das steht in der
 * Konfigurationsseite) und nie die Daten (die liegen im Modell).
 *
 * Alles hier wird im localStorage gehalten, damit ein Neuladen nicht jedes Mal
 * dieselbe Klickarbeit erfordert.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type Scale = 'blue' | 'heat';

export interface Preferences {
  theme: Theme;
  /** Zeitfenster in Millisekunden; 0 bedeutet "alles". */
  windowMs: number;
  /** Pakettyp-Filter; 'all' oder ein Payload-Typ. */
  payload: 'all' | number;
  includeDeclared: boolean;
  showLabels: boolean;
  onlyGateways: boolean;
  onlyDirect: boolean;
  /** Nur Funkstrecken, deren beide Enden zweifelsfrei bestimmt sind. */
  onlyCertain: boolean;
  scale: Scale;
  /** 0 = alle Strecken, 100 = nur die verkehrsreichste. */
  hotOnly: number;
  persist: boolean;
  /**
   * Bevorzugte Kontakte (Public Keys). Rein oertlich im Browser - die
   * Companion-Firmware kennt keine Favoriten, `ContactInfo.flags` ist fuer die
   * Telemetrie-Freigabe vergeben.
   */
  favorites: string[];
  /** Breite der linken Spalte in Pixeln, ziehbar. */
  sidebarWidth: number;
}

const DEFAULTS: Preferences = {
  theme: 'dark',
  windowMs: 3600000,
  payload: 'all',
  includeDeclared: true,
  showLabels: true,
  onlyGateways: false,
  onlyDirect: false,
  onlyCertain: false,
  scale: 'blue',
  hotOnly: 0,
  persist: true,
  favorites: [],
  sidebarWidth: 400,
};

const STORAGE_KEY = 'meshcore-topo.prefs';

function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

interface PreferencesApi {
  prefs: Preferences;
  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void;
  toggleFavorite(pubkey: string): void;
  isFavorite(pubkey: string | null | undefined): boolean;
}

const Ctx = createContext<PreferencesApi | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }): JSX.Element {
  const [prefs, setPrefs] = useState<Preferences>(load);

  const set = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Privater Modus oder voller Speicher - die Einstellung gilt dann nur
        // fuer diese Sitzung. Kein Grund, die Anwendung anzuhalten.
      }
      return next;
    });
  }, []);

  const toggleFavorite = useCallback(
    (pubkey: string) => {
      setPrefs((prev) => {
        const favorites = prev.favorites.includes(pubkey)
          ? prev.favorites.filter((k) => k !== pubkey)
          : [...prev.favorites, pubkey];
        const next = { ...prev, favorites };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // siehe oben
        }
        return next;
      });
    },
    [],
  );

  const api = useMemo(
    () => ({
      prefs,
      set,
      toggleFavorite,
      isFavorite: (pubkey: string | null | undefined) =>
        !!pubkey && prefs.favorites.includes(pubkey),
    }),
    [prefs, set, toggleFavorite],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePreferences(): PreferencesApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('PreferencesProvider fehlt');
  return api;
}
