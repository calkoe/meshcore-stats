<div align="center">

# MeshCore Netz-Topologie

### Sehen, wie das Funknetz wirklich aussieht

**Eine einzige HTML-Datei. Kein Backend. Die Aufzeichnung verlässt deinen Rechner nie.**

<br>

<a href="https://calkoe.github.io/meshcore-stats/"><img src="https://img.shields.io/badge/%E2%96%B6%20Jetzt%20im%20Browser%20starten-3987e5?style=for-the-badge&logoColor=white" alt="Im Browser starten" height="42"></a>

<sub>Öffnet die fertige Anwendung direkt – keine Installation, keine Anmeldung.<br>
Zum Mitnehmen: <a href="https://github.com/calkoe/meshcore-stats/releases/latest">die <code>index.html</code> aus dem letzten Release</a>.<br>
Bluetooth funktioniert nur über <code>https</code> oder <code>localhost</code> – <a href="#grenzen">nicht per Doppelklick</a>.</sub>

<br><br>

[![Build](https://img.shields.io/badge/build-single--file-3987e5)](.github/workflows/build.yml)
[![Tests](https://img.shields.io/badge/tests-57%20passing-1c7c59)](src)
[![Lizenz](https://img.shields.io/badge/lizenz-MIT-696e79)](#lizenz)
[![Quelltext](https://img.shields.io/badge/quelltext-github.com%2Fcalkoe%2Fmeshcore--stats-24292f)](https://github.com/calkoe/meshcore-stats)

</div>

---

## Was die Anwendung leistet

Sie verbindet sich per **Bluetooth Low Energy** mit einem MeshCore-Gerät mit
Companion-Firmware und rekonstruiert daraus die Topologie des Funknetzes:
welche Knoten es gibt, über welche Hops Pakete eintreffen, welche Strecken die
„heißen" sind und wie stark der Empfang jeweils war.

Dazu kommen drei Dinge, die über das Zusehen hinausgehen: die **Konfiguration**
des eigenen Geräts, ein **Terminal** zu fremden Repeatern und **Chat** mit
sichtbarem Weg der Nachricht.

## Starten

Web Bluetooth verlangt einen sicheren Kontext – `file://` reicht nicht.

```bash
npm install
npm run dev        # http://localhost:5173/
npm run build      # erzeugt dist/index.html (eine Datei)
npm test           # Protokoll- und Modelltests
```

Beim ersten Verbinden fragt das Betriebssystem nach der BLE-PIN des Geräts
(Standard bei MeshCore: `123456`).

## Was ausgewertet wird

Die Companion-Firmware schickt für **jedes empfangene Funkpaket** ein
`PUSH_CODE_LOG_RX_DATA`-Frame mit SNR, RSSI und dem rohen Paket – noch bevor sie
es selbst auswertet. Damit sieht die App den gesamten Funkverkehr in Hörweite,
nicht nur Textnachrichten: Adverts, ACKs, Requests, Gruppen- und
Direktnachrichten, Traces, Control-Pakete.

Aus dem Paket-Header werden Route-Typ, Payload-Typ und der Pfad ausgelesen.
Entscheidend ist der Unterschied zwischen den beiden Routing-Arten:

| | Pfad-Feld enthält | Aussage |
|---|---|---|
| **Flood** | die bereits durchlaufenen Repeater, in Reihenfolge | Das Paket ist diesen Weg **nachweislich gelaufen**. Der letzte Eintrag ist der Sender, den wir direkt gehört haben – nur für diese eine Strecke gilt das gemessene RSSI/SNR. |
| **Direct** | die **Rest**-Route (der eigene Hash wird vor dem Weiterleiten entfernt) | Eine Route, die das Netz für gültig hält – echte Topologie, aber ohne messbare Feldstärke. |

## Eindeutigkeit: das eigentliche Problem

Ein Hop steht im Paket **nicht** als vollständige Kennung, sondern als
*Prefix des Public Key* – und dessen Länge schwankt je nach `path_hash_mode` des
sendenden Netzes zwischen 1 und 3 Byte, für denselben Knoten auch gemischt.
`fd`, `fddc` und `fddc80` können also dasselbe Gerät meinen.

Die App löst jeden Hash über die Kontaktliste auf und hält fest, **wie sicher**
die Zuordnung war:

| Fall | Bedeutung | Darstellung |
|---|---|---|
| voller Public Key | nur das eigene Gerät – unverwechselbar | normal |
| ≥ 2 Byte, genau ein Treffer | eindeutig | durchgezogen |
| 1 Byte, genau ein Treffer | plausibel, aber nicht beweisbar: ein **unbekannter** Knoten mit demselben Anfangsbyte wäre nicht zu unterscheiden | **punktiert** |
| mehrere Treffer | mehrdeutig – wird keinem Knoten zugeordnet, bleibt als `#hash` stehen | erscheint nicht auf der Karte |
| kein Treffer | unbekannt – nur der Hash liegt vor | erscheint nicht auf der Karte |

Eine Funkstrecke gilt als eindeutig, sobald es **mindestens eine** Beobachtung
gibt, bei der beide Enden zweifelsfrei bestimmt waren. Der Filter **„nur
eindeutige Verbindungen"** blendet alle übrigen ganz aus; die Kennzahlenleiste
weist offen aus, wie viele das sind.

Die Grenze bei 2 Byte ist begründet: bei 16 Bit liegt die Wahrscheinlichkeit,
dass ein bestimmter weiterer Knoten dasselbe Prefix trägt, bei 1/65536 – bei
1 Byte teilen sich in einem Netz dieser Größe regelmäßig mehrere Knoten dasselbe
Byte. Der eigene `path_hash_mode` lässt sich in den Einstellungen ändern.

## Darstellung

- **Liniendicke und -farbe** kodieren die Zahl der Pakete über eine Funkstrecke
  (logarithmisch). Die Skala ist unten rechts zwischen **Blau** und **Hitze**
  umschaltbar; beide sind streng monoton in der Helligkeit, die Größe bleibt
  also auch ohne Farbsehen ablesbar.
- **Strichbild** trägt die Vorbehalte: durchgezogen = gemessen oder beobachtet,
  lang gestrichelt = deklarierte Route, fein punktiert = Zuordnung nicht
  eindeutig, **grün mit Pfeilen** = gelernter Weg zum aktuellen Chatpartner.
- **Knotenfarbe** = Typ (Repeater/Gateway, Room-Server, Client, sonstige).
  Identität hängt nie allein an der Farbe – Beschriftung, Legende und Tabelle
  sagen dasselbe noch einmal.
- **Trifft ein Paket ein, leuchtet sein Weg kurz auf.**
- **Schwellen-Slider** unten rechts blendet von *allen* Strecken bis auf die
  wenigen verkehrsreichsten aus (rangbasiert, damit das Ergebnis unabhängig vom
  gewählten Zeitfenster vorhersagbar bleibt).
- **Die linke Spalte ist ziehbar** – Doppelklick auf den Rand setzt sie zurück.

### Positionen werden nie geschätzt

Gezeichnet werden ausschließlich Koordinaten, die ein Knoten selbst per Advert
gemeldet hat. Knoten ohne gemeldete Position erscheinen nicht auf der Karte, und
Strecken zu ihnen ebenfalls nicht – enthält eine Route solche Hops, ist nur ihr
bekannter Teil sichtbar. Wie viele Knoten das betrifft, steht offen in der
Kennzahlenleiste. Eine geschätzte Position sähe auf einer Karte genauso echt aus
wie eine gemessene und würde mehr verwirren als helfen.

## Ping und Trace

**So startest du sie:** einen Knoten auf der Karte anklicken – oder eine Zeile in
der Knotentabelle links. Beides öffnet dasselbe Aktionsfenster.

- **Ping** – `CMD_SEND_PATH_DISCOVERY_REQ`. Die Firmware setzt dafür eine
  Telemetrie-Anfrage bewusst als Flood ab; die Antwort liefert **Hin- und
  Rückpfad**, die sich unterscheiden können. Kein Login nötig. Antwortet der
  Gegenknoten nicht (viele Repeater haben Telemetrie deaktiviert), läuft die
  Anfrage nach zwei Minuten in einen Timeout.
- **Trace** – `CMD_SEND_TRACE_PATH`, liefert das **SNR je Hop**. Gesendet wird
  ein *Rundweg* (`hops → Ziel → hops rückwärts`): Ein Knoten hängt sein SNR an,
  wenn sein Hash an der Position der bisher gesammelten SNR-Zahl steht, und das
  Ergebnis meldet der Knoten, der das Paket hört, nachdem alle Hashes
  abgearbeitet sind – der Pfad muss also zu uns zurückführen.
- **Pfad zurücksetzen** – verwirft den gelernten Weg zu diesem Kontakt
  (`CMD_RESET_PATH`); das Gerät sucht ihn danach neu.

## Nachrichten

Die rechte Spalte zeigt empfangene und gesendete Nachrichten mit SNR und
Hop-Zahl. Favoriten stehen in der Empfängerliste ganz oben – gesetzt wird der
Stern in der Knotentabelle oder im Aktionsfenster.

- **Klick auf eine Nachricht** blendet auf der Karte alles bis auf ihren Pfad
  aus. Wichtig: Der Weg steht **nicht in der Nachricht** – das Frame nennt nur
  die Hop-Zahl. Gezeigt wird das zuletzt gehörte Textpaket, dessen Absenderbyte
  und Hop-Zahl passen; die Leiste kennzeichnet das als *zugeordnet, nicht
  abgelesen*. Passt nichts, bleibt der Pfad leer.
- **Ist ein Kontakt als Empfänger gewählt**, liegt der gelernte Weg dorthin grün
  mit Richtungspfeilen auf der Karte. Hat das Gerät keinen gelernt, steht das
  dort – die Nachricht geht dann geflutet los.

> **Achtung:** Die App holt Nachrichten mit `CMD_SYNC_NEXT_MESSAGE` aus der
> Warteschlange des Geräts. Eine parallel laufende Chat-App sieht sie danach
> nicht mehr.

## Einstellungen

Oben rechts, in vier Abschnitten. Jede Schaltfläche schreibt genau ein Kommando
und wartet auf die Quittung der Firmware – angezeigt wird, was das Gerät
geantwortet hat, nicht was das Formular hofft.

| Abschnitt | Inhalt |
|---|---|
| **Grundlagen** | Knotenname, eigene Position (auch aus dem Browser), Uhr abgleichen, Advert senden (geflutet / nur Nachbarn), Geräteinfo, Akku, Speicher |
| **Funkparameter** | Frequenz, Bandbreite, Spreizfaktor, Coderate, Sendeleistung – mit Rückfrage, die alte und neue Werte gegenüberstellt |
| **Fortgeschritten** | Path-Hash-Modus, Telemetrie-Freigaben, Position im Advert, Mehrfach-ACKs, Zeitverhalten (`rx_delay_base`, `airtime_factor`) |
| **Eingriffe** | Neustart, BLE-PIN, Werksreset (nur nach Eintippen von `RESET`) |

Einheiten sind in der Firmware uneinheitlich – Frequenz in kHz, Bandbreite in
Hz. Die Builder in `src/protocol/commands.ts` rechnen das um und sind durch
Tests abgedeckt.

## Terminal

Ein Klick auf **Terminal** (oben rechts oder im Aktionsfenster eines Repeaters)
öffnet die Admin-Konsole eines **fremden** Knotens: `CMD_SEND_LOGIN` mit dessen
Passwort, danach Befehle als Textnachrichten vom Typ `TXT_TYPE_CLI_DATA`. Die
Antworten laufen als Nachrichten desselben Typs zurück und landen im Terminal
statt im Chat. Pfeiltasten blättern durch die Befehlshistorie.

Das Passwort geht als Kommando an das eigene Funkgerät und wird nirgends
gespeichert.

> Für das **eigene** Gerät gibt es das nicht: die Companion-Firmware stellt ihre
> Befehlszeile nur über die serielle Schnittstelle bereit, nicht über Bluetooth
> (`_cli_rescue` in `MyMesh.cpp`). Was sich am eigenen Gerät einstellen lässt,
> steht deshalb in den Einstellungen.

Einen Hilfe-Befehl kennt die Repeater-Firmware nicht; auf Unbekanntes antwortet
sie mit „Unknown command". Aus der Ferne angenommen werden unter anderem `ver`,
`board`, `clock`, `neighbors`, `advert`, `region` sowie `get`/`set`.

## Daten

Die Aufzeichnung liegt im `localStorage` und lässt sich als JSON exportieren und
wieder importieren.

- **Nur Verkehr verwerfen** – löscht Pakete, Routen und Nachrichten, **behält
  die Kontakte** mit Namen und Positionen.
- **Alles verwerfen** – löscht zusätzlich die Kontakte.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `src/protocol/` | Companion-Protokoll: Konstanten, Frame-Parser, Kommando-Builder |
| `src/model/` | Topologie-Modell; leitet Knoten, Strecken und Routen aus einem Ereignis-Log ab |
| `src/transport/` | Web-Bluetooth-Transport (Nordic UART Service) |
| `src/state/` | Verdrahtung Gerät ↔ Modell, Anzeige-Einstellungen, React-Anbindung |
| `src/map/` | Leaflet-Karte, Farbskalen, Kurven, Beschriftungsverteilung |
| `src/ui/` | Oberfläche |

Sämtliche Byte-Layouts sind gegen die Firmware-Quellen verifiziert
(`examples/companion_radio/MyMesh.cpp`, `NodePrefs.h`, `src/Dispatcher.cpp`,
`src/Packet.h`, `src/Mesh.cpp`, `src/helpers/AdvertDataHelpers.*`,
`src/helpers/CommonCLI.cpp`, `src/Identity.h`) und im Quelltext mit Fundstelle
kommentiert. Mehr zur Struktur in [ARCHITEKTUR.md](ARCHITEKTUR.md).

Ein Debug-Zugang liegt auf `window.meshcoreTopo` (`feed()`, `model`,
`controller`). **Achtung:** eingespeiste Frames landen in derselben Aufzeichnung
wie echter Funkverkehr – vorher „im Browser speichern" abschalten.

## Grenzen

- **Web Bluetooth** gibt es nur in Chrome und Edge auf dem Desktop, und nur im
  sicheren Kontext (`https://` oder `http://localhost`). Ein Doppelklick auf die
  heruntergeladene Datei genügt dafür nicht.
- **Kartenkacheln** kommen zur Laufzeit von OpenStreetMap – eine Weltkarte lässt
  sich nicht in eine HTML-Datei legen. Ohne Netz bleibt der Kartengrund leer,
  die Topologie wird trotzdem gezeichnet. Der Build-Workflow prüft, dass
  `tile.openstreetmap.org` der einzige fremde Host bleibt.
- **Adverts aus dem RX-Log werden nicht signaturgeprüft** (die Firmware prüft
  nur, was sie selbst als Kontakt übernimmt).
- **Pakete, die die Firmware selbst verwerfen würde** (unbekannte
  Payload-Version, ungültige Pfadlänge), werden verworfen – sonst wandert
  Rauschen als Phantom-Knoten in die Topologie.
- **Der Pfad einer empfangenen Nachricht ist erschlossen, nicht abgelesen** –
  siehe oben.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
