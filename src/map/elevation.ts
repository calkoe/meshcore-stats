/**
 * Höhenprofil einer Funkstrecke.
 *
 * Das Funkprotokoll kennt keine Höhen - ein Advert enthält nur lat/lon. Das
 * Gelände zwischen zwei Knoten kommt deshalb aus einem Höhenmodell im Netz
 * (Open-Meteo, Copernicus DEM, ~90 m Raster). Die Antennenhöhe über Grund weiß
 * niemand außer dem Betreiber; sie wird im Fenster eingegeben und ist als
 * Annahme gekennzeichnet.
 *
 * Gerechnet wird wie in der Funkplanung üblich:
 *
 *  - **Erdkrümmung** als Aufwölbung des Geländes statt als Krümmung der
 *    Sichtlinie. Mit dem effektiven Erdradius k = 4/3 ist die normale
 *    atmosphärische Brechung berücksichtigt.
 *  - **Erste Fresnelzone**: r = sqrt(λ·d₁·d₂ / (d₁+d₂)). Als frei gilt eine
 *    Strecke, wenn 60 % dieses Radius unverbaut sind - das ist die übliche
 *    Faustregel, unterhalb derer die Dämpfung spürbar wird.
 *
 * Was das Modell NICHT enthält: Gebäude, Wald, Masten. Ein Profil kann also
 * freie Sicht melden, wo in Wirklichkeit eine Baumreihe steht.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Mittlerer Erdradius in Metern. */
const EARTH_RADIUS = 6371000;
/** Effektiver Erdradius-Faktor (Standardatmosphäre). */
export const K_FACTOR = 4 / 3;
/** Lichtgeschwindigkeit in m/s. */
const C = 299792458;
/** Anteil der ersten Fresnelzone, der frei sein sollte. */
export const FRESNEL_CLEARANCE = 0.6;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Entfernung zweier Punkte auf der Kugel, in Metern. */
export function haversine(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Punkt auf dem Großkreis zwischen a und b, `f` von 0 bis 1.
 * Bei kurzen Strecken wäre lineare Interpolation praktisch gleich, aber die
 * Großkreisform kostet nichts und bleibt auch über 100 km richtig.
 */
export function interpolate(a: GeoPoint, b: GeoPoint, f: number): GeoPoint {
  const p1 = rad(a.lat);
  const l1 = rad(a.lon);
  const p2 = rad(b.lat);
  const l2 = rad(b.lon);
  const d = haversine(a, b) / EARTH_RADIUS;
  if (d < 1e-12) return { lat: a.lat, lon: a.lon };

  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
}

/** Gleichmäßig verteilte Stützstellen einschließlich beider Endpunkte. */
export function samplePath(a: GeoPoint, b: GeoPoint, count: number): GeoPoint[] {
  const n = Math.max(2, Math.min(100, Math.round(count)));
  const out: GeoPoint[] = [];
  for (let i = 0; i < n; i++) out.push(interpolate(a, b, i / (n - 1)));
  return out;
}

/** Radius der ersten Fresnelzone an einer Stelle der Strecke, in Metern. */
export function fresnelRadius(d1: number, d2: number, freqMHz: number): number {
  if (d1 <= 0 || d2 <= 0 || freqMHz <= 0) return 0;
  const lambda = C / (freqMHz * 1e6);
  return Math.sqrt((lambda * d1 * d2) / (d1 + d2));
}

/** Scheinbare Aufwölbung der Erde zwischen zwei Punkten, in Metern. */
export function earthBulge(d1: number, d2: number, k: number = K_FACTOR): number {
  return (d1 * d2) / (2 * k * EARTH_RADIUS);
}

export interface ProfilePoint {
  /** Entfernung vom ersten Knoten, in Metern. */
  distance: number;
  /** Geländehöhe laut Höhenmodell, in Metern über NN. */
  ground: number;
  /** Gelände plus Erdkrümmung - das, was der Funkwelle im Weg steht. */
  effective: number;
  /** Höhe der Sichtlinie an dieser Stelle. */
  los: number;
  /** Radius der ersten Fresnelzone hier. */
  fresnel: number;
  /** Abstand der Sichtlinie über dem wirksamen Gelände (negativ = verdeckt). */
  clearance: number;
}

export interface Profile {
  points: ProfilePoint[];
  /** Gesamtstrecke in Metern. */
  distance: number;
  /** Höhe der Antenne an beiden Enden, über NN. */
  txAltitude: number;
  rxAltitude: number;
  /** Ungünstigste Stelle, gemessen am Anteil der freien Fresnelzone. */
  worst: ProfilePoint | null;
  /** Anteil der ersten Fresnelzone, der an der ungünstigsten Stelle frei ist. */
  worstRatio: number;
  /** true, wenn das Gelände die Sichtlinie selbst durchstößt. */
  blocked: boolean;
  freqMHz: number;
}

/**
 * Setzt Geländehöhen, Antennenhöhen und Frequenz zu einem Profil zusammen.
 *
 * `elevations` sind die Geländehöhen der Stützstellen aus `samplePath()`, in
 * derselben Reihenfolge.
 */
export function buildProfile(opts: {
  elevations: number[];
  distance: number;
  txHeight: number;
  rxHeight: number;
  freqMHz: number;
  k?: number;
}): Profile {
  const { elevations, distance, txHeight, rxHeight, freqMHz } = opts;
  const k = opts.k ?? K_FACTOR;
  const n = elevations.length;

  const txAltitude = elevations[0] + txHeight;
  const rxAltitude = elevations[n - 1] + rxHeight;

  const points: ProfilePoint[] = [];
  let worst: ProfilePoint | null = null;
  let worstRatio = Number.POSITIVE_INFINITY;
  let blocked = false;

  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1);
    const d1 = distance * f;
    const d2 = distance - d1;
    const ground = elevations[i];
    const effective = ground + earthBulge(d1, d2, k);
    const los = txAltitude + (rxAltitude - txAltitude) * f;
    const fresnel = fresnelRadius(d1, d2, freqMHz);
    const clearance = los - effective;

    const point: ProfilePoint = { distance: d1, ground, effective, los, fresnel, clearance };
    points.push(point);

    if (clearance < 0) blocked = true;
    // Die Endpunkte selbst haben keine Fresnelzone (Radius 0) - sie würden die
    // Bewertung sonst immer gewinnen.
    if (fresnel > 0) {
      const ratio = clearance / fresnel;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worst = point;
      }
    }
  }

  return {
    points,
    distance,
    txAltitude,
    rxAltitude,
    worst,
    worstRatio: Number.isFinite(worstRatio) ? worstRatio : 1,
    blocked,
    freqMHz,
  };
}

export type ProfileVerdict = 'frei' | 'angekratzt' | 'verdeckt';

/** Bewertung in einem Wort - der Zahlenwert steht in der Oberfläche daneben. */
export function verdictOf(profile: Profile): ProfileVerdict {
  if (profile.blocked) return 'verdeckt';
  return profile.worstRatio >= FRESNEL_CLEARANCE ? 'frei' : 'angekratzt';
}

/* ------------------------------------------------------------------ */
/* Höhenmodell aus dem Netz                                             */
/* ------------------------------------------------------------------ */

/**
 * Open-Meteo liefert Geländehöhen ohne Schlüssel und mit CORS-Freigabe
 * (Copernicus DEM GLO-90). Je Anfrage sind 100 Koordinaten erlaubt.
 *
 * Das ist der EINZIGE Netzzugriff der Anwendung neben den Kartenkacheln, und
 * er passiert nur auf ausdrückliche Anforderung - nicht beim Laden.
 */
export const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
export const ELEVATION_SOURCE = 'Open-Meteo · Copernicus DEM GLO-90 (~90 m)';

export async function fetchElevations(
  points: GeoPoint[],
  fetchImpl: typeof fetch = fetch,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const url =
      `${ELEVATION_API}?latitude=${batch.map((p) => p.lat.toFixed(6)).join(',')}` +
      `&longitude=${batch.map((p) => p.lon.toFixed(6)).join(',')}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Höhenabfrage fehlgeschlagen (HTTP ${res.status})`);
    const data = (await res.json()) as { elevation?: number[] };
    if (!Array.isArray(data.elevation) || data.elevation.length !== batch.length) {
      throw new Error('Höhenmodell lieferte eine unerwartete Antwort.');
    }
    out.push(...data.elevation);
  }
  return out;
}
