/**
 * Höhenprofil: Geometrie und Funkphysik.
 *
 * Die Formeln sind der Grund, warum das Profil überhaupt etwas aussagt -
 * deshalb werden hier Zahlen geprüft, die sich von Hand nachrechnen lassen,
 * nicht bloß, dass „irgendetwas herauskommt".
 */

import { describe, expect, it, vi } from 'vitest';
import {
  FRESNEL_CLEARANCE,
  buildProfile,
  earthBulge,
  fetchElevations,
  fresnelRadius,
  haversine,
  interpolate,
  samplePath,
  verdictOf,
} from './elevation';

const KOELN = { lat: 50.9375, lon: 6.9603 };
const DUESSELDORF = { lat: 51.2277, lon: 6.7735 };

describe('haversine', () => {
  it('misst eine bekannte Strecke', () => {
    // Köln - Düsseldorf sind knapp 35 km Luftlinie.
    const d = haversine(KOELN, DUESSELDORF);
    expect(d / 1000).toBeGreaterThan(33);
    expect(d / 1000).toBeLessThan(36);
  });

  it('ist null fuer denselben Punkt und richtungsunabhaengig', () => {
    expect(haversine(KOELN, KOELN)).toBe(0);
    expect(haversine(KOELN, DUESSELDORF)).toBeCloseTo(haversine(DUESSELDORF, KOELN), 6);
  });
});

describe('samplePath', () => {
  it('beginnt und endet exakt auf den Knoten', () => {
    const pts = samplePath(KOELN, DUESSELDORF, 40);
    expect(pts).toHaveLength(40);
    expect(pts[0].lat).toBeCloseTo(KOELN.lat, 6);
    expect(pts[0].lon).toBeCloseTo(KOELN.lon, 6);
    expect(pts[39].lat).toBeCloseTo(DUESSELDORF.lat, 6);
    expect(pts[39].lon).toBeCloseTo(DUESSELDORF.lon, 6);
  });

  it('bleibt bei den 100 Punkten, die eine Anfrage erlaubt', () => {
    expect(samplePath(KOELN, DUESSELDORF, 500)).toHaveLength(100);
  });

  it('liegt in der Mitte auch wirklich in der Mitte', () => {
    const mid = interpolate(KOELN, DUESSELDORF, 0.5);
    expect(haversine(KOELN, mid)).toBeCloseTo(haversine(mid, DUESSELDORF), 3);
  });
});

describe('Fresnelzone', () => {
  it('hat in der Mitte einer 10-km-Strecke bei 869,618 MHz rund 29,4 m Radius', () => {
    // lambda = c/f = 0,34474 m; r = sqrt(lambda * d1*d2/(d1+d2)) = sqrt(0,34474 * 2500)
    expect(fresnelRadius(5000, 5000, 869.618)).toBeCloseTo(29.36, 1);
  });

  it('ist an den Endpunkten null', () => {
    expect(fresnelRadius(0, 10000, 869.618)).toBe(0);
    expect(fresnelRadius(10000, 0, 869.618)).toBe(0);
  });

  it('waechst mit der Wellenlaenge', () => {
    expect(fresnelRadius(5000, 5000, 434)).toBeGreaterThan(fresnelRadius(5000, 5000, 869.618));
  });
});

describe('Erdkruemmung', () => {
  it('woelbt sich in der Mitte von 10 km um rund 1,47 m auf', () => {
    // d1*d2 / (2*k*R) mit k = 4/3 und R = 6371 km
    expect(earthBulge(5000, 5000)).toBeCloseTo(1.471, 2);
  });

  it('ist an den Endpunkten null und waechst quadratisch', () => {
    expect(earthBulge(0, 10000)).toBe(0);
    expect(earthBulge(10000, 10000)).toBeCloseTo(4 * earthBulge(5000, 5000), 5);
  });
});

describe('buildProfile', () => {
  /** Flaches Gelaende auf 100 m, `n` Stuetzstellen. */
  const flat = (n: number): number[] => new Array(n).fill(100);

  it('legt die Sichtlinie zwischen die beiden Antennen', () => {
    const p = buildProfile({
      elevations: flat(11),
      distance: 10000,
      txHeight: 10,
      rxHeight: 30,
      freqMHz: 869.618,
    });
    expect(p.txAltitude).toBe(110);
    expect(p.rxAltitude).toBe(130);
    expect(p.points[0].los).toBe(110);
    expect(p.points[10].los).toBe(130);
    expect(p.points[5].los).toBe(120); // linear dazwischen
  });

  it('zieht die Erdkruemmung vom Freiraum ab', () => {
    const p = buildProfile({
      elevations: flat(11),
      distance: 10000,
      txHeight: 10,
      rxHeight: 10,
      freqMHz: 869.618,
    });
    const mid = p.points[5];
    // 10 m Antenne, davon 1,47 m von der Erdwoelbung aufgezehrt.
    expect(mid.clearance).toBeCloseTo(10 - 1.471, 2);
    expect(mid.effective).toBeCloseTo(101.471, 2);
    expect(p.blocked).toBe(false);
  });

  it('meldet eine verdeckte Strecke, wenn ein Berg im Weg steht', () => {
    const elevations = flat(11);
    elevations[5] = 400;
    const p = buildProfile({
      elevations,
      distance: 10000,
      txHeight: 10,
      rxHeight: 10,
      freqMHz: 869.618,
    });
    expect(p.blocked).toBe(true);
    expect(verdictOf(p)).toBe('verdeckt');
    expect(p.worst?.distance).toBe(5000);
  });

  it('unterscheidet freie von angekratzter Fresnelzone', () => {
    // Bei 10 km liegt der Fresnelradius in der Mitte bei 29,4 m; 60 Prozent
    // davon sind 17,6 m. Mit 40 m Antennenhoehe (minus 1,5 m Erdwoelbung) ist
    // reichlich Luft, mit 12 m nicht mehr genug.
    const frei = buildProfile({
      elevations: flat(11),
      distance: 10000,
      txHeight: 40,
      rxHeight: 40,
      freqMHz: 869.618,
    });
    expect(verdictOf(frei)).toBe('frei');
    expect(frei.worstRatio).toBeGreaterThan(FRESNEL_CLEARANCE);

    const knapp = buildProfile({
      elevations: flat(11),
      distance: 10000,
      txHeight: 12,
      rxHeight: 12,
      freqMHz: 869.618,
    });
    expect(verdictOf(knapp)).toBe('angekratzt');
    expect(knapp.blocked).toBe(false);
  });

  it('laesst die Endpunkte nicht die Bewertung gewinnen', () => {
    // Dort ist der Fresnelradius null - ohne Sonderbehandlung waere das
    // Verhaeltnis dort immer unendlich gut bzw. nicht definiert.
    const p = buildProfile({
      elevations: flat(11),
      distance: 10000,
      txHeight: 10,
      rxHeight: 10,
      freqMHz: 869.618,
    });
    expect(p.worst?.distance).not.toBe(0);
    expect(p.worst?.distance).not.toBe(10000);
  });
});

describe('fetchElevations', () => {
  it('teilt in Bloecke von 100 Koordinaten', async () => {
    const urls: string[] = [];
    const fake = vi.fn(async (url: string) => {
      urls.push(url);
      const count = url.split('latitude=')[1].split('&')[0].split(',').length;
      return {
        ok: true,
        json: async () => ({ elevation: new Array(count).fill(123) }),
      } as Response;
    });

    const points = new Array(150).fill(0).map((_, i) => ({ lat: 50 + i / 1000, lon: 7 }));
    const out = await fetchElevations(points, fake as unknown as typeof fetch);

    expect(out).toHaveLength(150);
    expect(urls).toHaveLength(2);
  });

  it('meldet eine unbrauchbare Antwort als Fehler, statt sie zu verwenden', async () => {
    const fake = async (): Promise<Response> =>
      ({ ok: true, json: async () => ({ elevation: [1, 2] }) }) as Response;
    await expect(
      fetchElevations([{ lat: 50, lon: 7 }], fake as unknown as typeof fetch),
    ).rejects.toThrow(/unerwartete Antwort/);
  });

  it('meldet HTTP-Fehler durch', async () => {
    const fake = async (): Promise<Response> => ({ ok: false, status: 503 }) as Response;
    await expect(
      fetchElevations([{ lat: 50, lon: 7 }], fake as unknown as typeof fetch),
    ).rejects.toThrow(/503/);
  });
});
