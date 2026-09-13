/**
 * Analyse einer Funkstrecke: alles, was sich über sie sagen lässt.
 *
 * Öffnet sich beim Klick auf eine Linie der Karte. Oben die Zahlen aus der
 * Aufzeichnung - wie viel lief darüber, wie stark kam es an, in welche
 * Richtung - dazu Ping und Trace als aktive Messungen. Darunter der
 * Geländeschnitt mit Sichtlinie und erster Fresnelzone; damit lässt sich die
 * Frage beantworten, die eine Karte allein nicht beantworten kann: geht dieser
 * Link überhaupt, oder steht ein Hügel im Weg?
 *
 * Was hier ausdrücklich KEINE Messung ist und deshalb auch so dasteht: die
 * Geländehöhen stammen aus einem 90-m-Raster, Gebäude und Wald sind darin nicht
 * enthalten, und die Antennenhöhe über Grund gibt der Nutzer selbst an - das
 * Funkprotokoll kennt sie nicht. Ebenso wenig überträgt es die Sendeleistung
 * der Gegenstelle; messbar ist nur, wie stark ein Paket bei UNS ankam.
 */

import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { PAYLOAD_NAMES } from '../../protocol/constants';
import { statAvg } from '../../model/topology';
import { PROVENANCE, type TopoView, type ViewLink, type ViewNode } from '../../model/types';
import {
  ELEVATION_SOURCE,
  FRESNEL_CLEARANCE,
  K_FACTOR,
  buildProfile,
  fetchElevations,
  haversine,
  samplePath,
  verdictOf,
  type Profile,
} from '../../map/elevation';
import { useMesh } from '../../state/store';
import { Signal, fmtNum, relTime } from '../format';
import { Modal } from './Modal';

/** Einmal abgefragte Geländeschnitte bleiben für die Sitzung liegen. */
const cache = new Map<string, number[]>();

const WIDTH = 1100;
const HEIGHT = 420;
const PAD = { top: 16, right: 16, bottom: 30, left: 56 };

/**
 * Vorgabe für die Antennenhöhe über Grund.
 *
 * Das Funkprotokoll überträgt keine Höhe - 2 m ist die Annahme „Gerät auf
 * Kopfhöhe" und bleibt eine Annahme. Bei einem Repeater auf einem Turm liegt
 * sie deutlich daneben; die Felder stehen deshalb direkt über dem Diagramm.
 */
const DEFAULT_ANTENNA_M = 2;

export function AnalysisDialog({
  a,
  b,
  link,
  view,
  onClose,
}: {
  a: ViewNode;
  b: ViewNode;
  link: ViewLink;
  view: TopoView;
  onClose(): void;
}): JSX.Element {
  const controller = useMesh();
  const freqMHz = controller.model.selfInfo?.freqMHz ?? 869.525;

  const [txHeight, setTxHeight] = useState(DEFAULT_ANTENNA_M);
  const [rxHeight, setRxHeight] = useState(DEFAULT_ANTENNA_M);
  const [elevations, setElevations] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const hasBothPositions =
    a.hasPos && b.hasPos && a.lat != null && a.lon != null && b.lat != null && b.lon != null;
  const pa = { lat: (a.lat ?? 0) as number, lon: (a.lon ?? 0) as number };
  const pb = { lat: (b.lat ?? 0) as number, lon: (b.lon ?? 0) as number };
  const distance = useMemo(
    () => (hasBothPositions ? haversine(pa, pb) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasBothPositions, pa.lat, pa.lon, pb.lat, pb.lon],
  );

  // Rund 250 m Abstand, gedeckelt auf die 100 Punkte, die eine Anfrage erlaubt.
  const sampleCount = Math.max(30, Math.min(100, Math.round(distance / 250)));
  const key = `${a.key}|${b.key}|${sampleCount}`;

  useEffect(() => {
    if (!hasBothPositions || distance < 1) return;
    let cancelled = false;
    const cached = cache.get(key);
    if (cached) {
      setElevations(cached);
      return;
    }
    setElevations(null);
    setError(null);
    fetchElevations(samplePath(pa, pb, sampleCount))
      .then((values) => {
        cache.set(key, values);
        if (!cancelled) setElevations(values);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hasBothPositions]);

  const profile = useMemo(
    () =>
      elevations ? buildProfile({ elevations, distance, txHeight, rxHeight, freqMHz }) : null,
    [elevations, distance, txHeight, rxHeight, freqMHz],
  );

  const pingable = [a, b].filter((n): n is ViewNode => !!n.pubkey && !n.isSelf);

  return (
    <Modal title="Funkstrecke" onClose={onClose} size="xl">
      <div className="prof">
        <div className="prof__head">
          <span className="prof__pair">
            {a.name} ↔ {b.name}
          </span>
          <span className="prof__meta">
            {hasBothPositions ? `${(distance / 1000).toFixed(2)} km · ` : ''}
            {freqMHz.toFixed(3)} MHz
          </span>
        </div>

        <div className="prof__cols">
          <Stats link={link} nameA={a.name} nameB={b.name} />

          <div className="prof__actions">
            <h3>Messen</h3>
            <p>
              <strong>Ping</strong> ermittelt Hin- und Rückpfad über eine geflutete
              Pfad-Discovery. <strong>Trace</strong> läuft genau diese Strecke als Rundweg ab und
              liefert das SNR je Hop.
            </p>
            <div className="prof__buttons">
              <button
                className="btn btn--sm"
                title="Trace entlang genau dieser Strecke"
                onClick={() => setAction(controller.traceChain([link.a, link.b], view))}
              >
                Trace
              </button>
              {pingable.map((n) => (
                <button
                  key={n.key}
                  className="btn btn--sm"
                  title={`Pfad-Discovery an ${n.name}`}
                  onClick={() => setAction(controller.pingNode(n))}
                >
                  Ping {shorten(n.name)}
                </button>
              ))}
            </div>
            {action ? <div className="prof__action-note">{action}</div> : null}
          </div>
        </div>

        <h3 className="prof__section">Höhenprofil</h3>

        {!hasBothPositions ? (
          <p className="prof__loading">
            Mindestens ein Ende hat keine gemeldete Position – ohne beide Koordinaten gibt es
            keinen Geländeschnitt. Positionen werden nicht geschätzt.
          </p>
        ) : (
          <>
            <div className="prof__inputs">
              <label>
                Antenne {shorten(a.name)} (m über Grund)
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={txHeight}
                  onChange={(e) => setTxHeight(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
              <label>
                Antenne {shorten(b.name)} (m über Grund)
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={rxHeight}
                  onChange={(e) => setRxHeight(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            </div>

            {error ? (
              <p className="prof__error">
                Höhenmodell nicht erreichbar: {error}
                <br />
                Ohne Netzzugang zu api.open-meteo.com lässt sich kein Profil zeichnen.
              </p>
            ) : !profile ? (
              <p className="prof__loading">Geländehöhen werden abgerufen …</p>
            ) : (
              <>
                <Verdict profile={profile} />
                <Chart profile={profile} />
                <ul className="prof__legend">
                  <li>
                    <span className="prof__key prof__key--terrain" />
                    Gelände (mit Erdkrümmung, k = {K_FACTOR.toFixed(2)})
                  </li>
                  <li>
                    <span className="prof__key prof__key--los" />
                    Sichtlinie
                  </li>
                  <li>
                    <span className="prof__key prof__key--fresnel" />
                    {Math.round(FRESNEL_CLEARANCE * 100)} % der ersten Fresnelzone
                  </li>
                  <li>
                    <span className="prof__key prof__key--fresnel-full" />
                    volle erste Fresnelzone
                  </li>
                </ul>
              </>
            )}
          </>
        )}

        <p className="prof__note">
          Geländehöhen: {ELEVATION_SOURCE}. Gebäude, Wald und Masten sind darin{' '}
          <strong>nicht</strong> enthalten – ein „frei" hier ist kein Versprechen. Die
          Antennenhöhen sind deine Angabe, nicht gemessen: das Funkprotokoll überträgt nur Länge
          und Breite. Für das Profil werden die Koordinaten beider Knoten an api.open-meteo.com
          gesendet; das passiert nur beim Öffnen dieses Fensters.
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function Row({ k, v }: { k: ReactNode; v: ReactNode }): JSX.Element {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

/** Alles, was die Aufzeichnung über diese Strecke hergibt. */
function Stats({
  link,
  nameA,
  nameB,
}: {
  link: ViewLink;
  nameA: string;
  nameB: string;
}): JSX.Element {
  const measured = link.provenance.has(PROVENANCE.MEASURED);
  const rssiAvg = statAvg(link.rssi);
  const snrAvg = statAvg(link.snr);
  const payloads = [...link.byPayload.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .map(([type, n]) => `${PAYLOAD_NAMES[type] || `0x${type.toString(16)}`} ${fmtNum(n)}`);

  return (
    <div className="prof__stats">
      <h3>Verkehr und Empfang</h3>
      <dl>
        <Row k="Pakete gesamt" v={fmtNum(link.total)} />
        {link.countAB > 0 && link.countBA > 0 ? (
          <>
            <Row k={`${shorten(nameA)} → ${shorten(nameB)}`} v={fmtNum(link.countAB)} />
            <Row k={`${shorten(nameB)} → ${shorten(nameA)}`} v={fmtNum(link.countBA)} />
          </>
        ) : null}
        <Row k="selbst gehört" v={measured ? `${fmtNum(link.measuredCount)}×` : 'nie'} />
        {measured && link.rssi.n > 0 ? (
          <>
            <Row k="RSSI Ø" v={<Signal rssi={rssiAvg} />} />
            <Row
              k="RSSI Bereich"
              v={`${link.rssi.min.toFixed(0)} … ${link.rssi.max.toFixed(0)} dBm`}
            />
            <Row k="RSSI zuletzt" v={`${(link.rssi.last ?? 0).toFixed(0)} dBm`} />
          </>
        ) : null}
        {link.snr.n > 0 ? (
          <>
            <Row k="SNR Ø" v={`${(snrAvg ?? 0).toFixed(1)} dB`} />
            <Row
              k="SNR Bereich"
              v={`${link.snr.min.toFixed(1)} … ${link.snr.max.toFixed(1)} dB`}
            />
          </>
        ) : null}
        <Row k="Zuordnung" v={link.ambiguous ? 'nicht eindeutig' : 'eindeutig'} />
        <Row k="zuerst gehört" v={relTime(link.firstSeen)} />
        <Row k="zuletzt gehört" v={relTime(link.lastSeen)} />
      </dl>
      {payloads.length ? <div className="prof__payloads">{payloads.join(' · ')}</div> : null}
      <p className="prof__hint">
        {measured
          ? 'RSSI und SNR gelten für den letzten Hop zu diesem Gerät. Die Sendeleistung der Gegenstelle überträgt MeshCore nicht.'
          : 'Diese Strecke hat dieses Gerät nie selbst gehört – Feldstärken gibt es dafür nicht.'}
      </p>
      {link.ambiguous ? (
        <p className="prof__warn">
          Mindestens ein Ende wurde nur über ein einzelnes Byte des Public Key erkannt –
          möglicherweise verbindet diese Strecke gar nicht diese beiden Knoten.
        </p>
      ) : null}
    </div>
  );
}

/** Ergebnis in einem Satz. Die Farbe steht nie allein - die Zahl daneben trägt sie. */
function Verdict({ profile }: { profile: Profile }): JSX.Element {
  const v = verdictOf(profile);
  const pct = Math.round(profile.worstRatio * 100);
  const worst = profile.worst;

  const text =
    v === 'verdeckt'
      ? `Das Gelände steht ${Math.abs(Math.round(worst?.clearance ?? 0))} m in der Sichtlinie.`
      : v === 'angekratzt'
        ? `Sichtlinie frei, aber die Fresnelzone ist angeschnitten: nur ${pct} % frei (nötig sind ${Math.round(FRESNEL_CLEARANCE * 100)} %).`
        : `Sichtlinie frei, ${pct} % der ersten Fresnelzone sind unverbaut.`;

  const where =
    worst && worst.distance > 0
      ? ` Engste Stelle bei ${(worst.distance / 1000).toFixed(1)} km.`
      : '';

  return (
    <div className={`prof__verdict prof__verdict--${v}`}>
      <span className="prof__dot" />
      <span>
        {text}
        {where}
      </span>
    </div>
  );
}

function Chart({ profile }: { profile: Profile }): JSX.Element {
  const pts = profile.points;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  // Wertebereich: Gelände, Sichtlinie und die volle Fresnelzone müssen hinein.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.effective, p.los - p.fresnel);
    hi = Math.max(hi, p.effective, p.los + p.fresnel);
  }
  const span = Math.max(20, hi - lo);
  lo -= span * 0.08;
  hi += span * 0.08;

  const x = (d: number): number => PAD.left + (d / profile.distance) * plotW;
  const y = (h: number): number => PAD.top + plotH - ((h - lo) / (hi - lo)) * plotH;

  const path = (sel: (p: (typeof pts)[number]) => number): string =>
    pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.distance).toFixed(1)},${y(sel(p)).toFixed(1)}`)
      .join(' ');

  const terrainArea =
    `${path((p) => p.effective)} L${x(profile.distance).toFixed(1)},${(PAD.top + plotH).toFixed(1)}` +
    ` L${PAD.left.toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;

  const ticks = axisTicks(lo, hi, 4);
  const worst = profile.worst;
  const v = verdictOf(profile);

  return (
    <svg
      className="prof__chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Geländeschnitt zwischen beiden Knoten"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} className="prof__grid" />
          <text x={PAD.left - 8} y={y(t) + 3.5} className="prof__tick" textAnchor="end">
            {Math.round(t)}
          </text>
        </g>
      ))}
      <text x={PAD.left - 8} y={PAD.top - 4} className="prof__axis" textAnchor="end">
        m ü. NN
      </text>

      {/* Volle erste Fresnelzone, dann die 60-Prozent-Grenze darin. */}
      <path d={path((p) => p.los - p.fresnel)} className="prof__fresnel-full" />
      <path d={path((p) => p.los + p.fresnel)} className="prof__fresnel-full" />
      <path d={path((p) => p.los - p.fresnel * FRESNEL_CLEARANCE)} className="prof__fresnel" />

      <path d={terrainArea} className="prof__terrain-fill" />
      <path d={path((p) => p.effective)} className="prof__terrain" />
      <path d={path((p) => p.los)} className="prof__los" />

      {worst ? (
        <g>
          <line
            x1={x(worst.distance)}
            x2={x(worst.distance)}
            y1={y(worst.effective)}
            y2={y(worst.los)}
            className={`prof__worst prof__worst--${v}`}
          />
          <circle
            cx={x(worst.distance)}
            cy={y(worst.effective)}
            r={3}
            className={`prof__worst-dot prof__worst-dot--${v}`}
          />
        </g>
      ) : null}

      <line
        x1={PAD.left}
        x2={WIDTH - PAD.right}
        y1={PAD.top + plotH}
        y2={PAD.top + plotH}
        className="prof__axis-line"
      />
      <text x={PAD.left} y={HEIGHT - 8} className="prof__tick" textAnchor="start">
        0 km
      </text>
      <text x={WIDTH - PAD.right} y={HEIGHT - 8} className="prof__tick" textAnchor="end">
        {(profile.distance / 1000).toFixed(1)} km
      </text>
    </svg>
  );
}

/** Runde Achsenmarken im gegebenen Bereich. */
function axisTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
  return out;
}

function shorten(name: string): string {
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}
