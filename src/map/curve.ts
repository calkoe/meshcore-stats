/** Geometrie-Hilfen der Karte. */

export interface Point {
  lat: number;
  lon: number;
}

/**
 * Verbindung zwischen zwei Punkten als gerade Strecke.
 *
 * Früher war das ein leicht gewölbter Bogen, damit sich hin- und rücklaufende
 * Kanten unterscheiden lassen. Das Modell führt eine Funkstrecke aber ohnehin
 * nur einmal - beide Richtungen stecken in derselben Kante. Der Bogen trennte
 * damit nichts, verschob die Linie aber gegenüber der tatsächlichen Luftlinie
 * und machte den Zusammenhang zwischen Karte und Höhenprofil unklar.
 *
 * Die Reihenfolge der Endpunkte wird normalisiert, damit dieselbe Strecke
 * unabhängig von der Aufrufrichtung identische Punkte liefert.
 */
export function lineBetween(a: Point, b: Point): [number, number][] {
  const swap = a.lat !== b.lat ? a.lat > b.lat : a.lon > b.lon;
  const pa = swap ? b : a;
  const pb = swap ? a : b;
  return [
    [pa.lat, pa.lon],
    [pb.lat, pb.lon],
  ];
}

/** Wie lineBetween(), aber in Laufrichtung von `from` nach `to`. */
export function orientedLine(from: Point, to: Point): [number, number][] {
  return [
    [from.lat, from.lon],
    [to.lat, to.lon],
  ];
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
