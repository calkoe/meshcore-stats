/** Geometrie-Hilfen der Karte. */

export interface Point {
  lat: number;
  lon: number;
}

/**
 * Leicht gekruemmte Verbindung zwischen zwei Punkten (quadratische Bezier).
 * Die Kruemmung liegt im geografischen Raum, bleibt also ueber alle Zoomstufen
 * optisch gleich und trennt hin- und ruecklaufende Kanten sichtbar voneinander.
 *
 * Die Reihenfolge der Endpunkte wird vorher normalisiert. Ohne das zeigt die
 * Woelbung je nach Aufrufrichtung zur anderen Seite - dieselbe Strecke laege
 * dann an zwei Orten, und beim Hervorheben erschiene eine zweite Linie daneben.
 */
export function curveBetween(a: Point, b: Point, bend = 0.14, steps = 18): [number, number][] {
  const swap = a.lat !== b.lat ? a.lat > b.lat : a.lon > b.lon;
  const pa = swap ? b : a;
  const pb = swap ? a : b;
  const latScale = Math.cos((((pa.lat + pb.lat) / 2) * Math.PI) / 180) || 1;
  const dx = (pb.lon - pa.lon) * latScale;
  const dy = pb.lat - pa.lat;
  const mx = (pa.lon + pb.lon) / 2;
  const my = (pa.lat + pb.lat) / 2;
  // Kontrollpunkt senkrecht zur Verbindung
  const cx = mx + (-dy * bend) / latScale;
  const cy = my + dx * bend;

  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const lon = u * u * pa.lon + 2 * u * t * cx + t * t * pb.lon;
    const lat = u * u * pa.lat + 2 * u * t * cy + t * t * pb.lat;
    pts.push([lat, lon]);
  }
  return pts;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
