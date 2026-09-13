/**
 * Konfiguration des angeschlossenen Geraets.
 *
 * Jede Schaltflaeche schreibt genau ein Kommando und wartet auf die Quittung
 * der Firmware; der Text darunter sagt, was das Geraet geantwortet hat. Nichts
 * wird "optimistisch" angezeigt - was hier steht, hat das Geraet bestaetigt.
 *
 * Nach jeder erfolgreichen Aenderung wird SELF_INFO neu geladen, damit die
 * Anzeige den Stand des Geraets zeigt und nicht den des Formulars.
 */

import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import {
  ADVERT_LOC,
  TELEM_MODE_NAMES,
} from '../../protocol/constants';
import {
  cmdFactoryReset,
  cmdReboot,
  cmdSendSelfAdvert,
  cmdSetAdvertLatLon,
  cmdSetAdvertName,
  cmdSetDevicePin,
  cmdSetDeviceTime,
  cmdSetOtherParams,
  cmdSetPathHashMode,
  cmdSetRadioParams,
  cmdSetTuningParams,
  cmdSetTxPower,
} from '../../protocol/commands';
import { useMesh, useSlice } from '../../state/store';
import { Modal } from './Modal';

/** Bandbreiten, die LoRa-Module tatsaechlich koennen (kHz). */
const BANDWIDTHS = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500];

type Section = 'grund' | 'funk' | 'kanal' | 'mehr' | 'eingriff';

export function SettingsDialog({ onClose }: { onClose(): void }): JSX.Element {
  const controller = useMesh();
  useSlice('config');
  const [section, setSection] = useState<Section>('grund');

  useEffect(() => {
    controller.refreshRuntime();
  }, [controller]);

  const self = controller.model.selfInfo;
  const device = controller.model.deviceInfo;

  return (
    <Modal title="Geräte-Einstellungen" onClose={onClose} wide>
      {!self ? (
        <p className="dlg__empty">
          Das Gerät hat seine Eckdaten noch nicht gemeldet. Bitte kurz warten oder neu verbinden.
        </p>
      ) : (
        <>
          <div className="tabs" role="tablist">
            <Tab id="grund" cur={section} set={setSection}>
              Grundlagen
            </Tab>
            <Tab id="funk" cur={section} set={setSection}>
              Funkparameter
            </Tab>
            <Tab id="kanal" cur={section} set={setSection}>
              Kanäle
            </Tab>
            <Tab id="mehr" cur={section} set={setSection}>
              Fortgeschritten
            </Tab>
            <Tab id="eingriff" cur={section} set={setSection}>
              Eingriffe
            </Tab>
          </div>

          {section === 'grund' ? <Basics /> : null}
          {section === 'funk' ? <Radio /> : null}
          {section === 'kanal' ? <Channels /> : null}
          {section === 'mehr' ? <Advanced /> : null}
          {section === 'eingriff' ? <Interventions /> : null}

          <div className="dlg__foot">
            {device ? (
              <span>
                {device.manufacturer || 'MeshCore'} · {device.firmwareVersion || '?'} · Build{' '}
                {device.buildDate} · Protokoll v{device.firmwareVerCode}
              </span>
            ) : null}
          </div>
        </>
      )}
    </Modal>
  );
}

function Tab({
  id,
  cur,
  set,
  children,
}: {
  id: Section;
  cur: Section;
  set(s: Section): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={cur === id}
      className={`tabs__btn${cur === id ? ' is-active' : ''}`}
      onClick={() => set(id)}
    >
      {children}
    </button>
  );
}

/** Eine Zeile aus Beschriftung, Eingabe und Erklaerung. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="cfg__field">
      <label className="cfg__label">{label}</label>
      <div className="cfg__input">{children}</div>
      {hint ? <div className="cfg__hint">{hint}</div> : null}
    </div>
  );
}

function Status({ text }: { text: string | null }): JSX.Element | null {
  if (!text) return null;
  return <div className="cfg__status">{text}</div>;
}

/* ------------------------------------------------------------------ */
/* Grundlagen                                                          */
/* ------------------------------------------------------------------ */

function Basics(): JSX.Element {
  const controller = useMesh();
  const self = controller.model.selfInfo!;
  const device = controller.model.deviceInfo;
  const rt = controller.runtime;

  const [name, setName] = useState(self.nodeName);
  const [lat, setLat] = useState(String(self.lat));
  const [lon, setLon] = useState(String(self.lon));
  const [status, setStatus] = useState<string | null>(null);

  // Bei neu geladenem SELF_INFO die Felder nachziehen.
  useEffect(() => {
    setName(self.nodeName);
    setLat(String(self.lat));
    setLon(String(self.lon));
  }, [self]);

  const apply = async (frame: Uint8Array, label: string): Promise<void> => {
    const res = await controller.sendAwaitingAck(frame, label);
    setStatus(res.text);
    if (res.ok) controller.reloadSelfInfo();
  };

  const useBrowserPosition = (): void => {
    if (!navigator.geolocation) {
      setStatus('Dieser Browser kennt keine Standortbestimmung.');
      return;
    }
    setStatus('Standort wird abgefragt …');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLon(pos.coords.longitude.toFixed(6));
        setStatus(
          `Standort übernommen (±${Math.round(pos.coords.accuracy)} m). Noch nicht gespeichert – erst „Position setzen“ schreibt sie auf das Gerät.`,
        );
      },
      (err) => setStatus(`Standort nicht verfügbar: ${err.message}`),
    );
  };

  const offset = rt.timeOffsetSec;

  return (
    <div className="cfg">
      <Field label="Knotenname" hint="Erscheint im Advert. Maximal 31 Zeichen.">
        <div className="cfg__row">
          <input
            type="text"
            value={name}
            maxLength={31}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn btn--sm btn--primary"
            disabled={!name.trim() || name === self.nodeName}
            onClick={() => void apply(cmdSetAdvertName(name.trim()), 'Knotenname')}
          >
            Setzen
          </button>
        </div>
      </Field>

      <Field
        label="Eigene Position"
        hint="Nur diese Koordinaten werden für das eigene Gerät gezeichnet. Ohne Position erscheint es nicht auf der Karte."
      >
        <div className="cfg__row">
          <input
            type="number"
            step="0.000001"
            value={lat}
            aria-label="Breitengrad"
            onChange={(e) => setLat(e.target.value)}
          />
          <input
            type="number"
            step="0.000001"
            value={lon}
            aria-label="Längengrad"
            onChange={(e) => setLon(e.target.value)}
          />
          <button className="btn btn--sm" onClick={useBrowserPosition}>
            Vom Browser
          </button>
          <button
            className="btn btn--sm btn--primary"
            onClick={() =>
              void apply(cmdSetAdvertLatLon(Number(lat), Number(lon)), 'Position')
            }
          >
            Position setzen
          </button>
        </div>
      </Field>

      <Field
        label="Uhrzeit"
        hint={
          offset === 0
            ? 'Gerät und Rechner gehen gleich.'
            : `Das Gerät geht ${Math.abs(offset)} s ${offset > 0 ? 'vor' : 'nach'}. Die Firmware nimmt nur Zeiten an, die nicht zurückspringen.`
        }
      >
        <button
          className="btn btn--sm"
          onClick={() =>
            void apply(cmdSetDeviceTime(Math.floor(Date.now() / 1000)), 'Uhrzeit')
          }
        >
          Mit diesem Rechner abgleichen
        </button>
      </Field>

      <Field
        label="Advert senden"
        hint="Macht das Gerät im Netz bekannt. „Geflutet“ erreicht das ganze Netz, „nur Nachbarn“ nur die direkte Hörweite."
      >
        <div className="cfg__row">
          <button
            className="btn btn--sm"
            onClick={() => void apply(cmdSendSelfAdvert(true), 'Advert (geflutet)')}
          >
            Geflutet
          </button>
          <button
            className="btn btn--sm"
            onClick={() => void apply(cmdSendSelfAdvert(false), 'Advert (Nachbarn)')}
          >
            Nur Nachbarn
          </button>
        </div>
      </Field>

      <Status text={status} />

      <div className="cfg__readout">
        <h3>Gerät</h3>
        <dl>
          <Readout k="Public Key" v={`${self.publicKey.slice(0, 16)}…`} />
          <Readout k="Sendeleistung" v={`${self.txPower} dBm (max. ${self.maxTxPower})`} />
          {device ? (
            <>
              <Readout k="BLE-PIN" v={device.blePin === 0 ? 'keiner' : String(device.blePin)} />
              <Readout k="Kontakte / Kanäle" v={`${device.maxContacts} / ${device.maxChannels}`} />
              <Readout k="Path-Hash-Modus" v={`${device.pathHashMode + 1} Byte`} />
              <Readout
                k="Repeater-Betrieb"
                v={device.repeaterEnabled == null ? '—' : device.repeaterEnabled ? 'ein' : 'aus'}
              />
            </>
          ) : null}
          <Readout
            k="Akku"
            v={rt.batteryMilliVolts != null ? `${(rt.batteryMilliVolts / 1000).toFixed(2)} V` : '—'}
          />
          <Readout
            k="Speicher"
            v={
              rt.storageUsedKb != null && rt.storageTotalKb != null
                ? `${rt.storageUsedKb} / ${rt.storageTotalKb} kB`
                : '—'
            }
          />
        </dl>
      </div>
    </div>
  );
}

function Readout({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Funkparameter                                                       */
/* ------------------------------------------------------------------ */

function Radio(): JSX.Element {
  const controller = useMesh();
  const self = controller.model.selfInfo!;

  const [freq, setFreq] = useState(String(self.freqMHz));
  const [bw, setBw] = useState(String(self.bwKHz));
  const [sf, setSf] = useState(self.sf);
  const [cr, setCr] = useState(self.cr);
  const [power, setPower] = useState(self.txPower);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setFreq(String(self.freqMHz));
    setBw(String(self.bwKHz));
    setSf(self.sf);
    setCr(self.cr);
    setPower(self.txPower);
  }, [self]);

  const changed =
    Number(freq) !== self.freqMHz ||
    Number(bw) !== self.bwKHz ||
    sf !== self.sf ||
    cr !== self.cr;

  const applyRadio = async (): Promise<void> => {
    const ok = window.confirm(
      'Funkparameter ändern?\n\n' +
        `bisher:  ${self.freqMHz.toFixed(3)} MHz · BW ${self.bwKHz} kHz · SF${self.sf} · CR4/${self.cr}\n` +
        `neu:     ${Number(freq).toFixed(3)} MHz · BW ${Number(bw)} kHz · SF${sf} · CR4/${cr}\n\n` +
        'Passen die Werte nicht mehr zu deinen Nachbarn, ist das Gerät sofort vom Netz getrennt. ' +
        'Es bleibt aber über Bluetooth erreichbar, die Einstellung lässt sich also zurücknehmen.',
    );
    if (!ok) return;
    const res = await controller.sendAwaitingAck(
      cmdSetRadioParams(Number(freq), Number(bw), sf, cr),
      'Funkparameter',
    );
    setStatus(res.text);
    if (res.ok) controller.reloadSelfInfo();
  };

  const applyPower = async (): Promise<void> => {
    const res = await controller.sendAwaitingAck(cmdSetTxPower(power), 'Sendeleistung');
    setStatus(res.text);
    if (res.ok) controller.reloadSelfInfo();
  };

  return (
    <div className="cfg">
      <Field
        label="Frequenz (MHz)"
        hint="Muss zur Region und zum Netz passen. Die Firmware nimmt 150 bis 2500 MHz an."
      >
        <input type="number" step="0.001" value={freq} onChange={(e) => setFreq(e.target.value)} />
      </Field>

      <Field label="Bandbreite (kHz)" hint="Schmaler = größere Reichweite, aber langsamer.">
        <select value={bw} onChange={(e) => setBw(e.target.value)}>
          {BANDWIDTHS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Spreizfaktor" hint="Höher = empfindlicher und langsamer. Erlaubt sind 5 bis 12.">
        <select value={sf} onChange={(e) => setSf(Number(e.target.value))}>
          {[5, 6, 7, 8, 9, 10, 11, 12].map((v) => (
            <option key={v} value={v}>
              SF{v}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Coderate" hint="4/5 bis 4/8. Mehr Redundanz kostet Luftzeit.">
        <select value={cr} onChange={(e) => setCr(Number(e.target.value))}>
          {[5, 6, 7, 8].map((v) => (
            <option key={v} value={v}>
              4/{v}
            </option>
          ))}
        </select>
      </Field>

      <div className="cfg__row cfg__row--end">
        <button className="btn btn--sm btn--primary" disabled={!changed} onClick={() => void applyRadio()}>
          Funkparameter übernehmen
        </button>
      </div>

      <Field
        label={`Sendeleistung: ${power} dBm`}
        hint={`Erlaubt sind -9 bis ${self.maxTxPower} dBm. Beachte die Vorgaben deiner Region.`}
      >
        <div className="cfg__row">
          <input
            type="range"
            min={-9}
            max={self.maxTxPower}
            step={1}
            value={power}
            onChange={(e) => setPower(Number(e.target.value))}
          />
          <button
            className="btn btn--sm btn--primary"
            disabled={power === self.txPower}
            onClick={() => void applyPower()}
          >
            Setzen
          </button>
        </div>
      </Field>

      <Status text={status} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kanäle                                                              */
/* ------------------------------------------------------------------ */

/**
 * Gruppenkanäle des Geräts.
 *
 * Ein Kanal ist ein Platz mit Namen und 128-Bit-Schlüssel. Das Protokoll kennt
 * kein Löschen – ein Platz gilt als frei, wenn Name und Schlüssel leer sind.
 * Deshalb heißt „Löschen" hier: mit Leerwerten überschreiben.
 *
 * Der Schlüssel wird NICHT aus einem Passwort abgeleitet. MeshCore legt dafür
 * kein Verfahren fest; ein selbst erfundenes würde zu keiner anderen App
 * passen. Einzutragen sind daher 32 Hex-Zeichen – entweder aus einer anderen
 * App kopiert oder hier neu gewürfelt.
 */
function Channels(): JSX.Element {
  const controller = useMesh();
  useSlice('config');
  const max = controller.model.deviceInfo?.maxChannels ?? 8;
  const [edit, setEdit] = useState<{ index: number; name: string; secret: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slots = Array.from({ length: max }, (_, i) => controller.channels.get(i) ?? null);

  const save = async (): Promise<void> => {
    if (!edit) return;
    if (!/^[0-9a-fA-F]{32}$/.test(edit.secret)) {
      setStatus('Der Schlüssel muss aus genau 32 Hex-Zeichen bestehen.');
      return;
    }
    if (!edit.name.trim()) {
      setStatus('Ein Kanal braucht einen Namen – ohne Namen gilt der Platz als leer.');
      return;
    }
    setBusy(true);
    const res = await controller.saveChannel(edit.index, edit.name.trim(), edit.secret.toLowerCase());
    setBusy(false);
    setStatus(res.text);
    if (res.ok) setEdit(null);
  };

  const remove = async (index: number, name: string): Promise<void> => {
    if (!window.confirm(`Kanal „${name}" löschen? Der Platz wird mit Leerwerten überschrieben.`)) {
      return;
    }
    setBusy(true);
    const res = await controller.deleteChannel(index);
    setBusy(false);
    setStatus(res.text);
  };

  return (
    <div className="cfg">
      <div className="chan">
        {slots.map((slot, index) => (
          <div className={`chan__row${slot ? '' : ' chan__row--empty'}`} key={index}>
            <span className="chan__idx">{index}</span>
            <span className="chan__name">{slot ? slot.name : 'frei'}</span>
            <span className="chan__key">{slot ? `${slot.secret.slice(0, 8)}…` : ''}</span>
            <button
              className="btn btn--sm"
              disabled={busy}
              onClick={() =>
                setEdit({ index, name: slot?.name ?? '', secret: slot?.secret ?? randomKey() })
              }
            >
              {slot ? 'Ändern' : 'Anlegen'}
            </button>
            {slot ? (
              <button
                className="btn btn--sm btn--danger"
                disabled={busy}
                onClick={() => void remove(index, slot.name)}
              >
                Löschen
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {edit ? (
        <div className="chan__edit">
          <h3>Kanal {edit.index}</h3>
          <Field label="Name" hint="Erscheint als Absender-Kanal in den Nachrichten.">
            <input
              type="text"
              maxLength={31}
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </Field>
          <Field
            label="Schlüssel (32 Hex-Zeichen)"
            hint="Alle Teilnehmer eines Kanals brauchen denselben Schlüssel. Aus einer anderen App kopieren oder hier neu würfeln – aus einem Passwort lässt er sich nicht ableiten."
          >
            <div className="cfg__row">
              <input
                type="text"
                spellCheck={false}
                value={edit.secret}
                onChange={(e) => setEdit({ ...edit, secret: e.target.value.trim() })}
              />
              <button className="btn btn--sm" onClick={() => setEdit({ ...edit, secret: randomKey() })}>
                Neu würfeln
              </button>
            </div>
          </Field>
          <div className="cfg__row cfg__row--end">
            <button className="btn btn--sm" onClick={() => setEdit(null)}>
              Abbrechen
            </button>
            <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => void save()}>
              Speichern
            </button>
          </div>
        </div>
      ) : null}

      <div className="cfg__row cfg__row--end">
        <button className="btn btn--sm" disabled={busy} onClick={() => void controller.loadChannels()}>
          Neu einlesen
        </button>
      </div>

      <Status text={status} />
    </div>
  );
}

/** 128 Bit aus der Zufallsquelle des Browsers, als Hex. */
function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* Fortgeschritten                                                     */
/* ------------------------------------------------------------------ */

function Advanced(): JSX.Element {
  const controller = useMesh();
  useSlice('config');
  const self = controller.model.selfInfo!;
  const device = controller.model.deviceInfo;
  const rt = controller.runtime;

  const telemetry = useMemo(
    () => ({
      base: self.telemetryMode & 0x03,
      loc: (self.telemetryMode >> 2) & 0x03,
      env: (self.telemetryMode >> 4) & 0x03,
    }),
    [self.telemetryMode],
  );

  const [base, setBase] = useState(telemetry.base);
  const [loc, setLoc] = useState(telemetry.loc);
  const [env, setEnv] = useState(telemetry.env);
  const [manual, setManual] = useState(self.manualAddContacts === 1);
  const [advertLoc, setAdvertLoc] = useState(self.advertLocPolicy);
  const [multiAcks, setMultiAcks] = useState(self.multiAcks);
  const [hashMode, setHashMode] = useState(device?.pathHashMode ?? 0);
  const [rxDelay, setRxDelay] = useState(String(rt.rxDelayBase ?? 0));
  const [airtime, setAirtime] = useState(String(rt.airtimeFactor ?? 0));
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setBase(telemetry.base);
    setLoc(telemetry.loc);
    setEnv(telemetry.env);
    setManual(self.manualAddContacts === 1);
    setAdvertLoc(self.advertLocPolicy);
    setMultiAcks(self.multiAcks);
  }, [self, telemetry]);

  useEffect(() => {
    if (rt.rxDelayBase != null) setRxDelay(String(rt.rxDelayBase));
    if (rt.airtimeFactor != null) setAirtime(String(rt.airtimeFactor));
  }, [rt.rxDelayBase, rt.airtimeFactor]);

  useEffect(() => {
    if (device) setHashMode(device.pathHashMode);
  }, [device]);

  const apply = async (frame: Uint8Array, label: string, reload = true): Promise<void> => {
    const res = await controller.sendAwaitingAck(frame, label);
    setStatus(res.text);
    if (res.ok && reload) controller.reloadSelfInfo();
  };

  return (
    <div className="cfg">
      <Field
        label="Path-Hash-Modus"
        hint={
          <>
            Länge des Hashes, den dieses Gerät in Pfade schreibt. Genau dieser Wert entscheidet, wie
            eindeutig ein Hop im Netz identifizierbar ist: bei 1 Byte können mehrere Knoten
            gleich aussehen, bei 2 oder 3 Byte praktisch nicht mehr. Er gilt nur für die eigenen
            Pakete – was andere Knoten senden, bleibt davon unberührt.
          </>
        }
      >
        <div className="cfg__row">
          <select value={hashMode} onChange={(e) => setHashMode(Number(e.target.value))}>
            <option value={0}>1 Byte</option>
            <option value={1}>2 Byte</option>
            <option value={2}>3 Byte</option>
          </select>
          <button
            className="btn btn--sm btn--primary"
            disabled={hashMode === device?.pathHashMode}
            onClick={() => void apply(cmdSetPathHashMode(hashMode), 'Path-Hash-Modus', false)}
          >
            Setzen
          </button>
        </div>
      </Field>

      <Field
        label="Telemetrie beantworten"
        hint="Wer darf Messwerte abfragen? Antwortet ein Knoten nicht auf einen Ping, steht hier meist „niemand“."
      >
        <div className="cfg__grid3">
          <TelemetrySelect label="Basis" value={base} onChange={setBase} />
          <TelemetrySelect label="Position" value={loc} onChange={setLoc} />
          <TelemetrySelect label="Umwelt" value={env} onChange={setEnv} />
        </div>
      </Field>

      <Field label="Position im Advert" hint="Ohne Freigabe sendet das Gerät seine Koordinaten nicht mit.">
        <select value={advertLoc} onChange={(e) => setAdvertLoc(Number(e.target.value))}>
          <option value={ADVERT_LOC.NONE}>nicht mitsenden</option>
          <option value={ADVERT_LOC.SHARE}>mitsenden</option>
        </select>
      </Field>

      <Field label="Kontakte nur manuell aufnehmen" hint="Verhindert, dass jedes gehörte Advert als Kontakt landet.">
        <label className="check">
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
          manuell
        </label>
      </Field>

      <Field label="Mehrfach-ACKs" hint="Wie viele Bestätigungen eine Nachricht erwartet (0 = Vorgabe der Firmware).">
        <input
          type="number"
          min={0}
          max={3}
          value={multiAcks}
          onChange={(e) => setMultiAcks(Number(e.target.value))}
        />
      </Field>

      <div className="cfg__row cfg__row--end">
        <button
          className="btn btn--sm btn--primary"
          onClick={() =>
            void apply(
              cmdSetOtherParams({
                manualAddContacts: manual,
                telemetryBase: base,
                telemetryLoc: loc,
                telemetryEnv: env,
                advertLocPolicy: advertLoc,
                multiAcks,
              }),
              'Sonstige Parameter',
            )
          }
        >
          Telemetrie, Advert und ACKs übernehmen
        </button>
      </div>

      <Field
        label="Zeitverhalten"
        hint="Grundverzögerung vor dem Senden (Sekunden) und Luftzeit-Faktor. Beide bremsen das Weiterleiten, damit sich Repeater nicht gegenseitig stören."
      >
        <div className="cfg__row">
          <input
            type="number"
            step="0.1"
            value={rxDelay}
            aria-label="Grundverzögerung"
            onChange={(e) => setRxDelay(e.target.value)}
          />
          <input
            type="number"
            step="0.1"
            value={airtime}
            aria-label="Luftzeit-Faktor"
            onChange={(e) => setAirtime(e.target.value)}
          />
          <button
            className="btn btn--sm btn--primary"
            onClick={() =>
              void apply(
                cmdSetTuningParams(Number(rxDelay), Number(airtime)),
                'Zeitverhalten',
                false,
              ).then(() => controller.refreshRuntime())
            }
          >
            Setzen
          </button>
        </div>
      </Field>

      <Status text={status} />
    </div>
  );
}

function TelemetrySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(v: number): void;
}): JSX.Element {
  return (
    <label className="cfg__sub">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {[0, 1, 2].map((v) => (
          <option key={v} value={v}>
            {TELEM_MODE_NAMES[v]}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Eingriffe                                                           */
/* ------------------------------------------------------------------ */

function Interventions(): JSX.Element {
  const controller = useMesh();
  const [pin, setPin] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const setDevicePin = async (): Promise<void> => {
    const value = pin.trim() === '' ? 0 : Number(pin);
    if (value !== 0 && (value < 100000 || value > 999999)) {
      setStatus('Erlaubt ist 0 (kein PIN) oder eine sechsstellige Zahl.');
      return;
    }
    if (
      !window.confirm(
        value === 0
          ? 'BLE-PIN entfernen? Danach kann sich jedes Gerät in Reichweite koppeln.'
          : 'BLE-PIN ändern? Bereits gekoppelte Geräte müssen neu gekoppelt werden.',
      )
    ) {
      return;
    }
    const res = await controller.sendAwaitingAck(cmdSetDevicePin(value), 'BLE-PIN');
    setStatus(res.text);
    setPin('');
  };

  return (
    <div className="cfg">
      <Field
        label="Gerät neu starten"
        hint="Die Bluetooth-Verbindung bricht dabei ab und muss neu aufgebaut werden. Aufgezeichnete Daten bleiben im Browser."
      >
        <button
          className="btn btn--sm"
          onClick={() => {
            if (!window.confirm('Gerät jetzt neu starten?')) return;
            // Ein Neustart beantwortet nichts mehr - deshalb ohne Quittung.
            void controller.ble.send(cmdReboot());
            setStatus('Neustart ausgelöst. Die Verbindung bricht gleich ab.');
          }}
        >
          Neu starten
        </button>
      </Field>

      <Field
        label="BLE-PIN"
        hint="Sechsstellig, oder leer lassen für „kein PIN“. Der Wert geht direkt an das Gerät und wird nirgends im Browser gespeichert."
      >
        <div className="cfg__row">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="z. B. 123456"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <button className="btn btn--sm" onClick={() => void setDevicePin()}>
            PIN setzen
          </button>
        </div>
      </Field>

      <div className="cfg__danger">
        <h3>Werksreset</h3>
        <p>
          Formatiert das Dateisystem des Geräts. <strong>Der private Schlüssel, alle Kontakte und
          alle Einstellungen sind danach unwiderruflich weg</strong> – das Gerät bekommt eine neue
          Identität und ist im Netz ein Fremder. Die Firmware schaltet vorher die Bluetooth-
          Schnittstelle ab; eine Bestätigung kommt in der Regel nicht mehr an.
        </p>
        <div className="cfg__row">
          <input
            type="text"
            placeholder="Zum Bestätigen RESET eingeben"
            value={confirmWord}
            onChange={(e) => setConfirmWord(e.target.value)}
          />
          <button
            className="btn btn--sm btn--danger"
            disabled={confirmWord !== 'RESET'}
            onClick={() => {
              if (!window.confirm('Werksreset wirklich ausführen? Das ist nicht rückgängig zu machen.')) {
                return;
              }
              void controller.ble.send(cmdFactoryReset());
              setStatus('Werksreset ausgelöst.');
              setConfirmWord('');
            }}
          >
            Werksreset ausführen
          </button>
        </div>
      </div>

      <Status text={status} />
    </div>
  );
}
