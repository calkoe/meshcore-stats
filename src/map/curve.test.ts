import { describe, expect, it } from 'vitest';
import { curveBetween, rectsOverlap } from './curve';

describe('curveBetween', () => {
  it('liefert dieselbe Kurve, egal in welcher Richtung sie berechnet wird', () => {
    const a = { lat: 51.0, lon: 6.5 };
    const b = { lat: 50.8, lon: 7.1 };
    const forward = curveBetween(a, b);
    const backward = curveBetween(b, a);
    // Ohne diese Normalisierung woelbt sich die Rueckrichtung zur anderen Seite -
    // beim Hervorheben erschien dann eine zweite Linie neben der echten.
    expect(backward).toEqual(forward);
  });

  it('beginnt und endet exakt auf den Endpunkten', () => {
    const a = { lat: 51.0, lon: 6.5 };
    const b = { lat: 50.8, lon: 7.1 };
    const pts = curveBetween(a, b);
    const ends = [pts[0], pts[pts.length - 1]];
    expect(ends).toContainEqual([a.lat, a.lon]);
    expect(ends).toContainEqual([b.lat, b.lon]);
  });

  it('weicht in der Mitte von der Geraden ab', () => {
    const pts = curveBetween({ lat: 51, lon: 6 }, { lat: 51, lon: 7 });
    const mid = pts[Math.floor(pts.length / 2)];
    expect(Math.abs(mid[0] - 51)).toBeGreaterThan(0.01);
  });
});

describe('rectsOverlap', () => {
  it('erkennt Ueberschneidungen von Beschriftungen', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsOverlap(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 11, w: 10, h: 10 })).toBe(false);
  });
});
