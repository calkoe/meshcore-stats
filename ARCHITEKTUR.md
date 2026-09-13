# Architektur

Was hier steht, sind die Entscheidungen, die man dem Quelltext nicht ansieht –
und die Gründe dafür.

## Schichten

```
Funkgerät ──BLE──▶ transport/ble.ts
                        │ rohe Frames
                        ▼
                   protocol/        Frames zerlegen, Kommandos bauen
                        │ getypte Frames
                        ▼
                   state/mesh.ts    MeshController: Verdrahtung, Sitzung,
                        │           Quittungen, Terminal, Nachrichten
                        ▼
                   model/           Ereignis-Log ──▶ abgeleitete Sicht
                        │
                        ▼
                   ui/ + map/       Darstellung
```

Die Pfeile gehen nur in eine Richtung. `protocol/` kennt weder das Modell noch
React und läuft deshalb in Tests ohne DOM; `model/` kennt kein Leaflet.

## Ein Ereignis-Log als einzige Wahrheit

Das Modell speichert **keine** Knoten und Kanten, sondern nur Ereignisse: jedes
gehörte Funkpaket, jede deklarierte Route, jedes Trace-Ergebnis. Knoten,
Funkstrecken und Routen entstehen erst in `computeView(filter)`.

Das kostet Rechenzeit bei jeder Ansicht – und spart dafür die gesamte Klasse von
Fehlern, bei denen ein Zeitfilter und ein Zähler auseinanderlaufen. Ein
Zeitfenster ist hier keine Sonderbehandlung, sondern eine Schleifenbedingung.
Export und Import sind aus demselben Grund trivial.

Gegen die Kosten hilft ein Zwischenspeicher, dessen Schlüssel aus Filter,
Ereigniszahl und Identitätenzahl besteht.

## Warum die Aufteilung in Scheiben

Bei lebhaftem Funkverkehr treffen mehrere Pakete pro Sekunde ein. Würde jedes
davon einen Neuaufbau des React-Baums auslösen, wäre die Anwendung unbedienbar.

`MeshController` meldet Änderungen deshalb nach Bereichen getrennt (`data`,
`ui`, `chat`, `terminal`, `config`). Nur `data` ist gedrosselt (750 ms); alle
anderen melden sofort, weil dort niemand im Sekundentakt etwas ändert. Die
Oberfläche abonniert über `useSyncExternalStore` genau die Bereiche, die sie
zeigt.

Das kurze Aufleuchten neuer Pfade geht noch einen Schritt weiter und läuft ganz
an React vorbei (`subscribePackets`): zu sehen ist ohnehin nur eine Animation
auf der Karte.

## Warum die Karte imperativ bleibt

Ein Netz dieser Größe hat schnell einige hundert Linien und Marker. Die über
React zu verwalten wäre weder schneller noch klarer – Leaflet führt seine eigene
Szene. `MapRenderer` ist deshalb eine gewöhnliche Klasse; die Brücke ist dünn:
`render(view, options)` hinein, Rückrufe heraus.

Zwei Eigenheiten sind teuer erkauft und sollten nicht wieder verschwinden:

- **Knoten liegen in einer eigenen Leaflet-Ebene** (`nodesPane`, z-index 450)
  über den Linien. Ohne das schiebt das Hervorheben eine Linie über den Marker –
  und der Klick landet auf der Linie statt auf dem Knoten.
- **`lineBetween()` normalisiert die Reihenfolge der Endpunkte.** Sonst liegen
  Grundlinie und Hervorhebung an verschiedenen Stellen, sobald eine Route die
  Strecke in Gegenrichtung durchläuft. Für die Richtungspfeile des gelernten
  Pfades liefert `orientedLine()` dieselbe Strecke in Laufrichtung.

## Quittungen ohne Vorgangsnummern

Die meisten Konfigurationskommandos beantwortet die Firmware nur mit `OK` oder
`ERR` – ohne Bezug zum Kommando. Sie arbeitet Frames aber streng der Reihe nach
ab, und der BLE-Transport serialisiert die Schreibvorgänge. Deshalb genügt eine
Warteschlange: die nächste eintreffende Quittung gehört zum ältesten offenen
Kommando (`sendAwaitingAck`).

Ping und Trace sind der Sonderfall. Beim **Trace** vergeben wir das Tag selbst
und die Firmware reicht es durch. Bei der **Pfad-Discovery** erzeugt die
*Firmware* das Tag – dort wird über den Ziel-Key zugeordnet und das Tag erst aus
`RESP_CODE_SENT` nachgetragen. Wer das verwechselt, wartet ewig auf eine
Antwort, die längst da ist.

## Nichts erfinden

Die Regel, an der sich mehrere Entscheidungen entlanghangeln: **lieber eine
Lücke zeigen als sie plausibel füllen.**

- Positionen werden nie geschätzt. Ein Knoten ohne selbst gemeldete Koordinate
  erscheint nicht, und eine Strecke zu ihm auch nicht.
- Ein Pfad-Hash, der auf mehrere Knoten passt, wird keinem zugeordnet, sondern
  bleibt als `#hash` stehen.
- Ein Hash, der nur über ein einzelnes Byte passt, wird zwar aufgelöst, die
  Strecke aber punktiert gezeichnet – und lässt sich ganz ausblenden.
- Der Pfad einer empfangenen Nachricht steht nicht im Frame. Er wird aus dem
  RX-Protokoll erschlossen und in der Oberfläche als *zugeordnet, nicht
  abgelesen* gekennzeichnet. Passt nichts, bleibt er leer.
- Eine Paketrate wird erst ab 30 Sekunden Beobachtung ausgewiesen. Ein
  Sekundenbruchteil hochgerechnet ergibt eine Zahl, die nichts bedeutet.
- Das Höhenprofil nennt seine Quelle und seine Lücken: 90-m-Raster, keine
  Gebäude, keine Bäume, Antennenhöhe als Eingabe des Nutzers.
- Eine leere Aufzeichnung überschreibt beim automatischen Sichern keine
  gefüllte, solange der Nutzer nicht selbst verworfen hat. Ein zweiter Tab, der
  die Seite frisch geladen hat, hatte sonst gereicht, um die Aufzeichnung des
  ersten wegzuschreiben.

## Single-File-Build

`vite-plugin-singlefile` legt React, Leaflet, das CSS und alle Bilder in eine
`index.html`. Der Workflow prüft danach zweierlei: dass genau eine Datei
entsteht, und dass kein `<script>`/`<link>` auf einen fremden Host zeigt.

Zwei Ausnahmen sind erlaubt und beide unvermeidlich: die Kartenkacheln von
OpenStreetMap – eine Weltkarte lässt sich nicht einbetten – und das Höhenmodell
von Open-Meteo, das nur beim Öffnen eines Höhenprofils abgefragt wird. Der
Workflow prüft explizit, dass keine weiteren Hosts hinzukommen, damit ein
versehentlich wieder eingeführtes CDN auffällt.

## Was getestet wird

`npm test` deckt die Schichten ab, in denen ein Fehler stumm bliebe:

- **`protocol/frames.test.ts`** – Frames werden nach den Layouts aus
  `MyMesh.cpp` von Hand zusammengesetzt, nicht aus dem Parser abgeleitet.
  Sonst bestätigte der Test nur die eigene Implementierung.
- **`protocol/commands.test.ts`** – vor allem die Einheiten. Frequenz in kHz,
  Bandbreite in Hz: wer das verwechselt, verstellt ein Gerät, das danach nur
  noch über Bluetooth erreichbar ist.
- **`model/topology.test.ts`** – Auflösung der Pfad-Hashes und die daraus
  folgende Eindeutigkeit. Der heikelste Teil der Anwendung.
- **`state/mesh.test.ts`** – wann eine Nachricht einem gehörten Paket zugeordnet
  werden darf und wann eben nicht.
- **`map/curve.test.ts`** – Richtungsunabhängigkeit der Linien.
- **`map/elevation.test.ts`** – Fresnelradius, Erdkrümmung und die Bewertung
  „frei / angekratzt / verdeckt". Die Zahlen darin sind von Hand nachgerechnet,
  nicht aus dem Code abgeleitet.

Die Oberfläche selbst hat keine Tests; sie wird im Browser gegen ein echtes
Gerät geprüft.
