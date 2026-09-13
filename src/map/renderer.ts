/**
 * Kartendarstellung der Mesh-Topologie (Leaflet).
 *
 * Bewusst imperativ: ein Netz dieser Groesse hat schnell einige hundert Linien
 * und Marker. Die ueber React zu verwalten waere weder schneller noch klarer -
 * Leaflet fuehrt seine eigene Szene. Die Bruecke ist duenn: `render()` bekommt
 * die abgeleitete Sicht, alles andere sind Rueckrufe nach oben.
 */

import L from 'leaflet';
import { ADV_TYPE } from '../protocol/constants';
import { PROVENANCE } from '../model/types';
import type { TopoView, ViewLink, ViewNode } from '../model/types';
import { linkKey, statAvg } from '../model/topology';
import { lineBetween, orientedLine, rectsOverlap, type Point, type Rect } from './curve';
import { UNMEASURED_COLOR, lineDash, seqRamp, signalStatus, typeColor } from './palette';

/** Obergrenze gleichzeitig sichtbarer Beschriftungen. */
const MAX_LABELS = 70;

/**
 * Kartenkacheln: OpenStreetMap-Standard, weil dafuer kein API-Schluessel noetig
 * ist. Die dunkle Variante entsteht per CSS-Filter auf der Kachel-Ebene -
 * dadurch bleibt die App ohne Konto und ohne Schluessel lauffaehig.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

export interface RenderOptions {
  theme: 'dark' | 'light';
  /** 'packets' faerbt nach Menge, 'signal' nach gemessener Feldstaerke. */
  scale: 'packets' | 'signal';
  showLabels: boolean;
  onlyGateways: boolean;
  onlyDirect: boolean;
  onlyCertain: boolean;
  hotOnly: number;
  /** Wenn gesetzt, wird NUR diese Kette gezeichnet (Pfad einer Nachricht). */
  focusChain: string[] | null;
  /** Gelernter Weg zum aktuellen Chatpartner - gruen, mit Richtungspfeilen. */
  learnedPath: string[] | null;
  /** Aktueller Chatpartner - wird auf der Karte eigens hervorgehoben. */
  partnerKey: string | null;
}

/** Gruen fuer den gelernten Pfad. Traegt immer eine Beschriftung in der Legende. */
const LEARNED_COLOR = { dark: '#35c46a', light: '#0f8a45' };

export interface RenderStats {
  totalLinks: number;
  shownLinks: number;
  ambiguousLinks: number;
  visibleMaxLink: number;
}

export interface MapCallbacks {
  onNodeHover(node: ViewNode, latlng: L.LatLng): void;
  onNodeOut(): void;
  onNodeClick(node: ViewNode, point: L.Point): void;
  onLinkHover(link: ViewLink, latlng: L.LatLng): void;
  onLinkOut(): void;
  onLinkClick(link: ViewLink, point: L.Point): void;
  onStats(stats: RenderStats): void;
  onMapClick(): void;
}

interface LinkShape {
  line: L.Polyline;
  base: L.PathOptions;
}

interface DrawnNode {
  node: ViewNode;
  pos: Point;
  radius: number;
  traffic: number;
}

const DEFAULT_OPTIONS: RenderOptions = {
  theme: 'dark',
  scale: 'packets',
  showLabels: true,
  onlyGateways: false,
  onlyDirect: false,
  onlyCertain: false,
  hotOnly: 0,
  focusChain: null,
  learnedPath: null,
  partnerKey: null,
};

/** So lange leuchtet eine Strecke auf, wenn ein Paket ueber sie eintrifft. */
const FLASH_MS = 550;

export class MapRenderer {
  readonly map: L.Map;
  private linkLayer: L.LayerGroup;
  private learnedLayer: L.LayerGroup;
  private nodeLayer: L.LayerGroup;
  private labelLayer: L.LayerGroup;
  private arrowLayer: L.LayerGroup;
  private positions = new Map<string, Point>();
  private linkShapes = new Map<string, LinkShape>();
  private nodeMarkers = new Map<string, L.CircleMarker>();
  private nodeBase = new Map<string, L.CircleMarkerOptions>();
  private drawn: DrawnNode[] = [];
  private highlighted: LinkShape[] = [];
  private highlightedKeys = new Set<string>();
  private highlightedNodes: { marker: L.CircleMarker; base: L.CircleMarkerOptions }[] = [];
  private flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Segmente des gelernten Pfades, in Laufrichtung - Grundlage der Pfeile. */
  private learnedSegments: [number, number][][] = [];
  private view: TopoView | null = null;
  private options: RenderOptions = DEFAULT_OPTIONS;
  private hasFitted = false;

  constructor(
    container: HTMLElement,
    private cb: MapCallbacks,
  ) {
    this.map = L.map(container, {
      zoomControl: true,
      preferCanvas: false, // SVG-Renderer: zuverlaessige Treffererkennung auf Linien
      worldCopyJump: true,
      attributionControl: true,
    }).setView([51.1, 10.4], 6);

    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(this.map);

    // Eigene Ebene fuer Knoten OBERHALB der Linien (overlayPane = 400).
    // Ohne das liegt eine hervorgehobene Linie ueber dem Marker - der Klick
    // landet dann auf der Linie statt auf dem Knoten.
    this.map.createPane('nodesPane');
    const pane = this.map.getPane('nodesPane');
    if (pane) pane.style.zIndex = '450';

    this.linkLayer = L.layerGroup().addTo(this.map);
    this.learnedLayer = L.layerGroup().addTo(this.map);
    this.nodeLayer = L.layerGroup().addTo(this.map);
    this.labelLayer = L.layerGroup().addTo(this.map);
    this.arrowLayer = L.layerGroup().addTo(this.map);

    // Beim Zoomen/Verschieben nur Beschriftungen und Pfeile neu verteilen
    // (billig) - beim Hineinzoomen werden dadurch mehr Namen sichtbar.
    this.map.on('moveend zoomend', () => {
      this.renderLabels();
      this.renderPathArrows();
    });
    this.map.on('click', () => this.cb.onMapClick());
  }

  destroy(): void {
    for (const t of this.flashTimers.values()) clearTimeout(t);
    this.flashTimers.clear();
    this.map.remove();
  }

  invalidateSize(): void {
    this.map.invalidateSize();
  }

  private get ringColor(): string {
    return this.options.theme === 'dark' ? '#1a1a19' : '#fcfcfb';
  }

  private get inkColor(): string {
    return this.options.theme === 'dark' ? '#ffffff' : '#0b0b0b';
  }

  /* ---------------- Positionen ---------------- */

  /**
   * Zeichenpositionen. Es werden AUSSCHLIESSLICH Koordinaten verwendet, die ein
   * Knoten selbst per Advert gemeldet hat.
   *
   * Positionen werden bewusst NICHT geschaetzt oder interpoliert: eine
   * erfundene Position sieht auf einer Karte genauso echt aus wie eine gemessene
   * und macht die Darstellung unbrauchbar. Knoten ohne gemeldete Position
   * erscheinen deshalb gar nicht - und Strecken zu ihnen ebenfalls nicht. Wie
   * viele das sind, weist die Kennzahlenleiste offen aus.
   */
  private layoutPositions(view: TopoView): void {
    this.positions.clear();
    for (const n of view.nodes.values()) {
      if (n.hasPos && n.lat != null && n.lon != null) {
        this.positions.set(n.key, { lat: n.lat, lon: n.lon });
      }
    }
  }

  posForKey(key: string): Point | null {
    return this.positions.get(key) ?? null;
  }

  /* ---------------- Rendern ---------------- */

  render(view: TopoView, options: Partial<RenderOptions> = {}): void {
    this.view = view;
    this.options = { ...this.options, ...options };
    this.layoutPositions(view);

    for (const t of this.flashTimers.values()) clearTimeout(t);
    this.flashTimers.clear();
    this.linkLayer.clearLayers();
    this.learnedLayer.clearLayers();
    this.nodeLayer.clearLayers();
    this.labelLayer.clearLayers();
    this.arrowLayer.clearLayers();
    this.linkShapes.clear();
    this.nodeMarkers.clear();
    this.nodeBase.clear();
    this.drawn = [];
    this.highlighted = [];
    this.highlightedKeys.clear();
    this.highlightedNodes = [];

    const stats = this.renderLinks(view);
    this.renderLearnedPath();
    this.renderNodes(view);
    this.cb.onStats(stats);

    if (!this.hasFitted) this.fitToData();
  }

  /** Zeichnet die Karte mit den zuletzt uebergebenen Daten neu. */
  rerender(options: Partial<RenderOptions> = {}): void {
    if (this.view) this.render(this.view, options);
    else this.options = { ...this.options, ...options };
  }

  private renderLinks(view: TopoView): RenderStats {
    const ramp = seqRamp(this.options.theme);
    let links = [...view.links.values()];
    const ambiguousLinks = links.filter((l) => l.ambiguous).length;

    // "nur direkte Funknachbarn": ausschliesslich Strecken, auf denen dieses
    // Geraet die Gegenstelle selbst gehoert hat (PROVENANCE.MEASURED). Nur dort
    // ist die Feldstaerke ueberhaupt gemessen.
    if (this.options.onlyDirect) {
      links = links.filter((l) => l.provenance.has(PROVENANCE.MEASURED));
    }
    // "nur eindeutige Verbindungen": es muss mindestens eine Beobachtung geben,
    // bei der BEIDE Endpunkte zweifelsfrei bestimmt waren.
    if (this.options.onlyCertain) {
      links = links.filter((l) => !l.ambiguous);
    }
    // Pfad einer angeklickten Nachricht: alles andere tritt ab.
    const focus = this.options.focusChain;
    if (focus && focus.length >= 2) {
      const wanted = new Set<string>();
      for (let i = 0; i < focus.length - 1; i++) {
        if (focus[i] !== focus[i + 1]) wanted.add(linkKey(focus[i], focus[i + 1]));
      }
      links = links.filter((l) => wanted.has(l.key));
    }

    const totalLinks = links.length;

    // Schwelle: 0 = alle Strecken, 100 = nur die verkehrsreichste. Dazwischen
    // wird rangbasiert abgeschnitten - das ist vorhersagbarer als eine feste
    // Paketzahl, weil das Aufkommen je nach Zeitfenster stark schwankt.
    const hot = this.options.hotOnly || 0;
    if (hot > 0 && links.length > 1) {
      const keep = Math.max(1, Math.round(links.length * (1 - hot / 100)));
      links = links.sort((a, b) => b.total - a.total).slice(0, keep);
    }

    // Massstab an die sichtbare Auswahl anpassen, sonst waeren alle Linien duenn.
    const max = Math.max(1, ...links.map((l) => l.total));
    // Nach Gewicht sortiert zeichnen: starke Routen liegen oben.
    links.sort((a, b) => a.total - b.total);

    for (const link of links) {
      const pa = this.posForKey(link.a);
      const pb = this.posForKey(link.b);
      if (!pa || !pb) continue;

      const t = max > 1 ? Math.log1p(link.total) / Math.log1p(max) : 1;
      // Die Dicke zeigt immer die Menge. Die FARBE zeigt entweder ebenfalls die
      // Menge (sequentielle Rampe) oder die gemessene Empfangsstaerke - dann in
      // denselben vier Stufen, die auch die Tabellen und Tooltips verwenden.
      // Strecken ohne Messung bekommen Neutralgrau, nie eine Bewertung.
      const color =
        this.options.scale === 'signal'
          ? (signalStatus(statAvg(link.rssi))?.color ??
            UNMEASURED_COLOR[this.options.theme])
          : ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
      const weight = 1 + t * 4;
      const declaredOnly =
        !link.provenance.has(PROVENANCE.MEASURED) &&
        !link.provenance.has(PROVENANCE.OBSERVED) &&
        !link.provenance.has(PROVENANCE.TRACE);
      const dashArray = lineDash({ ambiguous: link.ambiguous, declaredOnly });
      const opacity = link.ambiguous ? 0.5 : declaredOnly ? 0.55 : 0.9;

      const latlngs = lineBetween(pa, pb);
      const base: L.PathOptions = { color, weight, opacity, dashArray, lineCap: 'round' };
      const line = L.polyline(latlngs, { ...base, interactive: false });
      // Unsichtbare, dicke Trefferflaeche: Hit-Target groesser als die Marke.
      const hit = L.polyline(latlngs, {
        color: '#000',
        weight: Math.max(weight + 12, 16),
        opacity: 0,
        interactive: true,
        bubblingMouseEvents: false,
      });

      // Das Hervorheben passiert ueber highlightChains(), das genau diese Linie
      // umstylt - es wird nie zusaetzliche Geometrie gezeichnet.
      hit.on('mouseover', (e) => this.cb.onLinkHover(link, e.latlng));
      hit.on('mouseout', () => this.cb.onLinkOut());
      hit.on('click', (e) => {
        if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        this.cb.onLinkClick(link, this.map.latLngToContainerPoint(e.latlng));
      });

      line.addTo(this.linkLayer);
      hit.addTo(this.linkLayer);
      this.linkShapes.set(link.key, { line, base });
    }

    return {
      totalLinks,
      shownLinks: links.length,
      ambiguousLinks,
      visibleMaxLink: max,
    };
  }

  private renderNodes(view: TopoView): void {
    let nodes = [...view.nodes.values()];
    if (this.options.onlyDirect) {
      const keep = new Set<string>();
      for (const link of view.links.values()) {
        if (!link.provenance.has(PROVENANCE.MEASURED)) continue;
        keep.add(link.a);
        keep.add(link.b);
      }
      nodes = nodes.filter((n) => n.isSelf || keep.has(n.key));
    }
    const maxTraffic = Math.max(1, ...nodes.map(trafficOf));

    for (const node of nodes) {
      const pos = this.positions.get(node.key);
      if (!pos) continue;
      if (
        this.options.onlyGateways &&
        node.type !== ADV_TYPE.REPEATER &&
        node.type !== ADV_TYPE.ROOM &&
        !node.isSelf
      ) {
        continue;
      }

      const traffic = trafficOf(node);
      const t = Math.log1p(traffic) / Math.log1p(maxTraffic);
      const isPartner = !!this.options.partnerKey && node.key === this.options.partnerKey;
      // Kleinere Marken als frueher: in einem dichten Netz verdecken grosse
      // Kreise die Strecken, um die es eigentlich geht. Zwei Knoten sind davon
      // ausgenommen - das eigene Geraet und der aktuelle Chatpartner. Nach
      // genau diesen beiden sucht man beim Lesen der Karte staendig.
      const radius = node.isSelf ? 9 : isPartner ? 8 : 3 + t * 5.5;

      const base: L.CircleMarkerOptions = {
        radius,
        color: node.isSelf
          ? this.inkColor
          : isPartner
            ? LEARNED_COLOR[this.options.theme]
            : this.ringColor, // Ring gegen Ueberlappung
        weight: node.isSelf || isPartner ? 3 : 1.5,
        fillColor: node.isSelf ? this.inkColor : typeColor(node.type, this.options.theme),
        fillOpacity: node.isSelf ? 1 : 0.95,
      };

      // Hof um die beiden wichtigen Knoten. Die Farbe sagt, welcher es ist:
      // Textfarbe = dieses Geraet, Gruen = Gegenstelle des Chats - dieselbe
      // Farbe wie der gelernte Pfad, der dorthin fuehrt.
      if (node.isSelf || isPartner) {
        const halo = node.isSelf ? this.inkColor : LEARNED_COLOR[this.options.theme];
        L.circleMarker([pos.lat, pos.lon], {
          radius: radius + 8,
          color: halo,
          weight: 2,
          opacity: 0.7,
          fill: false,
          pane: 'nodesPane',
          interactive: false,
          dashArray: isPartner ? '3 4' : undefined,
        }).addTo(this.nodeLayer);
      }

      const marker = L.circleMarker([pos.lat, pos.lon], {
        ...base,
        pane: 'nodesPane',
        interactive: false,
      });

      // Groessere, unsichtbare Trefferflaeche: kleine Marker sind sonst kaum zu
      // treffen. Sie traegt die Interaktion, der sichtbare Kreis nicht.
      const hit = L.circleMarker([pos.lat, pos.lon], {
        radius: Math.max(radius + 8, 14),
        stroke: false,
        fillOpacity: 0,
        fill: true,
        pane: 'nodesPane',
        interactive: true,
        bubblingMouseEvents: false,
      });

      hit.on('mouseover', (e) => this.cb.onNodeHover(node, e.latlng));
      hit.on('mouseout', () => this.cb.onNodeOut());
      hit.on('click', (e) => {
        // Wichtig: das NATIVE Event stoppen. L.DomEvent.stopPropagation() mit
        // dem Leaflet-Event setzt nur ein internes Flag, der Klick liefe
        // trotzdem bis zum document - und wuerde das Aktionsfenster sofort
        // wieder schliessen.
        if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        this.cb.onNodeClick(node, this.map.latLngToContainerPoint([pos.lat, pos.lon]));
      });

      marker.addTo(this.nodeLayer);
      hit.addTo(this.nodeLayer);
      this.nodeMarkers.set(node.key, marker);
      this.nodeBase.set(node.key, base);
      this.drawn.push({ node, pos, radius, traffic });
    }

    this.renderLabels();
  }

  /**
   * Direktbeschriftung mit Kollisionsvermeidung im Bildschirmraum.
   *
   * In einem Netz mit ueber 150 Knoten waere "jeden Repeater beschriften" nur
   * Brei. Beschriftet wird deshalb nach Wichtigkeit (eigenes Geraet, dann
   * Verkehrsaufkommen), und nur solange der Platz reicht. Beim Zoomen wird neu
   * verteilt, sodass beim Hineinzoomen mehr Namen erscheinen.
   */
  private renderLabels(): void {
    this.labelLayer.clearLayers();
    if (!this.options.showLabels || this.drawn.length === 0) return;

    const bounds = this.map.getBounds();
    const partnerKey = this.options.partnerKey;
    const rank = (d: DrawnNode): number => (d.node.isSelf ? 2 : d.node.key === partnerKey ? 1 : 0);
    const candidates = this.drawn
      .filter((d) => d.node.name && bounds.contains([d.pos.lat, d.pos.lon]))
      .sort((a, b) => {
        const r = rank(b) - rank(a);
        if (r !== 0) return r;
        return b.traffic - a.traffic || a.node.name.localeCompare(b.node.name);
      });

    const occupied: Rect[] = [];
    let placed = 0;
    for (const d of candidates) {
      // Eigenes Geraet und Chatpartner werden IMMER beschriftet - sie sollen
      // nicht wegen eines zufaellig danebenliegenden Namens verschwinden.
      const pinned = rank(d) > 0;
      if (!pinned && placed >= MAX_LABELS) break;
      const pt = this.map.latLngToContainerPoint([d.pos.lat, d.pos.lon]);
      const rect: Rect = {
        x: pt.x + d.radius + 4,
        y: pt.y - 7,
        w: d.node.name.length * 6.1 + 6,
        h: 14,
      };
      if (!pinned && occupied.some((r) => rectsOverlap(r, rect))) continue;
      occupied.push(rect);
      placed++;

      const span = document.createElement('span');
      span.className = pinned ? 'node-label__text node-label__text--pinned' : 'node-label__text';
      span.textContent = d.node.name;

      L.marker([d.pos.lat, d.pos.lon], {
        interactive: false,
        icon: L.divIcon({
          className: 'node-label',
          html: span.outerHTML,
          iconSize: [0, 0],
          iconAnchor: [-d.radius - 4, 8],
        }),
      }).addTo(this.labelLayer);
    }
  }

  /**
   * Der gelernte Weg zum aktuellen Chatpartner.
   *
   * Gruen und mit Richtungspfeilen, weil er etwas anderes aussagt als der
   * uebrige Bestand: nicht "hier lief Verkehr", sondern "diesen Weg nimmt eine
   * Nachricht an diesen Kontakt". Hops ohne bekannte Position lassen eine
   * Luecke - geschaetzt wird auch hier nichts.
   */
  private renderLearnedPath(): void {
    this.learnedSegments = [];
    const path = this.options.learnedPath;
    if (!path || path.length < 2) {
      this.arrowLayer.clearLayers();
      return;
    }
    const color = LEARNED_COLOR[this.options.theme];

    for (let i = 0; i < path.length - 1; i++) {
      const from = this.posForKey(path[i]);
      const to = this.posForKey(path[i + 1]);
      if (!from || !to || path[i] === path[i + 1]) continue;
      const pts = orientedLine(from, to);
      this.learnedSegments.push(pts);
      L.polyline(pts, {
        color,
        weight: 3.5,
        opacity: 0.95,
        lineCap: 'round',
        interactive: false,
      }).addTo(this.learnedLayer);
    }
    this.renderPathArrows();
  }

  /**
   * Richtungspfeile auf dem gelernten Pfad. Sie liegen im Bildschirmraum, damit
   * sie bei jeder Zoomstufe gleich gross bleiben, und werden beim Zoomen neu
   * ausgerichtet.
   */
  private renderPathArrows(): void {
    this.arrowLayer.clearLayers();
    if (this.learnedSegments.length === 0) return;
    const color = LEARNED_COLOR[this.options.theme];

    for (const pts of this.learnedSegments) {
      const from = pts[0];
      const to = pts[pts.length - 1];
      // Der Pfeil sitzt in der Mitte der Strecke und zeigt in Laufrichtung.
      // Der Winkel wird im Bildschirmraum bestimmt, sonst stimmt er in
      // hoeheren Breiten nicht mit dem Gezeichneten ueberein.
      const a = this.map.latLngToContainerPoint(from);
      const b = this.map.latLngToContainerPoint(to);
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];

      const span = document.createElement('span');
      span.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      span.style.color = color;
      span.textContent = '▶';

      L.marker(mid, {
        interactive: false,
        pane: 'nodesPane',
        icon: L.divIcon({
          className: 'path-arrow',
          html: span.outerHTML,
          iconSize: [0, 0],
          iconAnchor: [5, 6],
        }),
      }).addTo(this.arrowLayer);
    }
  }

  /**
   * Laesst die Strecken einer Kette kurz aufleuchten - so ist zu sehen, wo
   * gerade etwas ankommt, ohne dass die Karte sich sonst veraendert.
   */
  flashChain(chain: string[]): void {
    if (!chain || chain.length < 2) return;
    for (let i = 0; i < chain.length - 1; i++) {
      if (chain[i] === chain[i + 1]) continue;
      const key = linkKey(chain[i], chain[i + 1]);
      const sh = this.linkShapes.get(key);
      if (!sh) continue;

      const running = this.flashTimers.get(key);
      if (running) clearTimeout(running);
      sh.line.setStyle({
        color: this.inkColor,
        weight: (sh.base.weight ?? 2) + 2.5,
        opacity: 1,
        dashArray: sh.base.dashArray,
      });
      this.flashTimers.set(
        key,
        setTimeout(() => {
          this.flashTimers.delete(key);
          // Liegt die Strecke gerade unter dem Zeiger, gilt die Hervorhebung.
          if (this.highlightedKeys.has(key)) return;
          sh.line.setStyle(sh.base);
        }, FLASH_MS),
      );
    }
  }

  /* ---------------- Hervorhebung ---------------- */

  /**
   * Hebt die Strecken einer oder mehrerer Hop-Ketten hervor.
   *
   * Es wird ausschliesslich die BEREITS GEZEICHNETE Linie umgestylt - niemals
   * zusaetzliche Geometrie erzeugt. Hops ohne bekannte Position haben keine
   * Linie; der bekannte Teil des Pfades wird hervorgehoben, der Rest bleibt aus.
   */
  highlightChains(chains: string[][]): void {
    this.clearHighlight();
    if (!chains || chains.length === 0) return;

    const keys = new Set<string>();
    for (const chain of chains) {
      for (let i = 0; i < chain.length - 1; i++) {
        if (chain[i] === chain[i + 1]) continue;
        keys.add(linkKey(chain[i], chain[i + 1]));
      }
    }

    for (const key of keys) {
      const sh = this.linkShapes.get(key);
      if (!sh) continue; // Strecke nicht gezeichnet (Position unbekannt)
      sh.line.setStyle({
        color: this.inkColor,
        weight: (sh.base.weight ?? 2) + 3,
        opacity: 1,
        dashArray: sh.base.dashArray,
      });
      this.highlighted.push(sh);
      this.highlightedKeys.add(key);
    }
  }

  /** Hebt einzelne Knoten hervor (groesserer Radius, kraeftiger Ring). */
  highlightNodes(nodeKeys: string[]): void {
    for (const key of nodeKeys) {
      const marker = this.nodeMarkers.get(key);
      const base = this.nodeBase.get(key);
      if (!marker || !base) continue;
      marker.setStyle({ radius: (base.radius ?? 6) + 4, color: this.inkColor, weight: 3 });
      marker.bringToFront();
      this.highlightedNodes.push({ marker, base });
    }
  }

  clearHighlight(): void {
    for (const sh of this.highlighted) sh.line.setStyle(sh.base);
    this.highlighted = [];
    this.highlightedKeys.clear();
    for (const { marker, base } of this.highlightedNodes) marker.setStyle(base);
    this.highlightedNodes = [];
  }

  /* ---------------- Sonstiges ---------------- */

  /** Beim naechsten Rendern erneut auf die Daten zoomen. */
  requestFit(): void {
    this.hasFitted = false;
  }

  fitToData(): void {
    const pts = [...this.positions.values()].map((p) => [p.lat, p.lon] as [number, number]);
    if (pts.length === 0) return;
    if (pts.length === 1) this.map.setView(pts[0], 13);
    else this.map.fitBounds(L.latLngBounds(pts).pad(0.15));
    this.hasFitted = true;
  }

  panTo(nodeKey: string): void {
    const p = this.positions.get(nodeKey);
    if (p) this.map.panTo([p.lat, p.lon]);
  }

  containerPointOf(nodeKey: string): L.Point | null {
    const p = this.positions.get(nodeKey);
    return p ? this.map.latLngToContainerPoint([p.lat, p.lon]) : null;
  }

  setThemeClass(theme: 'dark' | 'light'): void {
    const pane = this.map.getPane('tilePane');
    if (pane) pane.classList.toggle('tilepane--dark', theme === 'dark');
  }
}

function trafficOf(n: ViewNode): number {
  return n.stats ? n.stats.asHop + n.stats.asOrigin + n.stats.asTransmitter : 0;
}

