import { describe, expect, it } from 'vitest';
import { lineBetween, orientedLine, rectsOverlap } from './curve';

describe('lineBetween', () => {
  it('liefert dieselben Punkte, egal in welcher Richtung sie berechnet werden', () => {
    const a = { lat: 51.0, lon: 6.5 };
    const b = { lat: 50.8, lon: 7.1 };
    // Ohne Normalisierung lägen Hervorhebung und Grundlinie an verschiedenen
    // Stellen, sobald eine Route die Strecke in Gegenrichtung durchläuft.
    expect(lineBetween(b, a)).toEqual(lineBetween(a, b));
  });

  it('ist die Luftlinie, nicht mehr ein Bogen', () => {
    const a = { lat: 51.0, lon: 6.5 };
    const b = { lat: 50.8, lon: 7.1 };
    const pts = lineBetween(a, b);
    expect(pts).toHaveLength(2);
    expect(pts).toContainEqual([a.lat, a.lon]);
    expect(pts).toContainEqual([b.lat, b.lon]);
  });
});

describe('orientedLine', () => {
  it('behält die Laufrichtung bei - Grundlage der Richtungspfeile', () => {
    const a = { lat: 50.8, lon: 7.1 };
    const b = { lat: 51.0, lon: 6.5 };
    expect(orientedLine(a, b)[0]).toEqual([a.lat, a.lon]);
    expect(orientedLine(b, a)[0]).toEqual([b.lat, b.lon]);
  });
});

describe('rectsOverlap', () => {
  it('erkennt Überschneidungen von Beschriftungen', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsOverlap(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 11, w: 10, h: 10 })).toBe(false);
  });
});
