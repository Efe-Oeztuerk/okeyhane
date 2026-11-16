# Okeyhane

Multiplayer-Okey im türkischen Kahvehane. Man spielt in Ego-Perspektive mit Freunden, die Teams sitzen sich gegenüber.
Modi: **Standard-Okey**, **101 Okey** und **Perişan Okey**. Batak, Pişti, Tavla und ein Kartenspiel kommen später dazu.

## Starten (lokal)

```bash
npm install
npm run build      # baut den 3D-Client
npm start          # startet den Server auf http://localhost:3000
```

Danach `http://localhost:3000` im Browser öffnen. Freunde im selben WLAN erreichen das Spiel über `http://<deine-IP>:3000`.

## Online stellen (Render)

1. Auf render.com **New → Blueprint** wählen und dieses Repo auswählen. Die Einstellungen kommen aus `render.yaml`.
2. Nach dem Deploy die Render-URL an deine Freunde schicken. Jeder erstellt dort seinen Charakter, einer erstellt einen Tisch und teilt den 5-stelligen Code.

Hinweis: Im kostenlosen Render-Plan wird die Statistik (`stats.json`) bei jedem Neustart gelöscht. Für eine dauerhafte Statistik kommt später Supabase dazu.

## Was drin ist

| Bereich | Funktionen |
|---|---|
| Kahvehane | Ego-Perspektive, mit WASD laufen, auf einen Stuhl klicken zum Hinsetzen, Kilims, Türkei-Fahne, erfundene Schwarz-Weiß-Porträts, Semaver, Uhr mit echter Zeit, Ventilator, Nargile, Rauch, Tageszeit mit Fensterblick, NPC-Gäste beim Tavla, Çaycı bringt Tee |
| Charakter | Hautfarbe, Gesicht, Frisur, Haarfarbe, Augenbrauen, Bart, Schnurrbart, Kleidung und Farbe, Kopfbedeckung, Brille, Zubehör (Tespih, Zigarre, Zahnstocher), Schmuck, Unterschrift. Der Name steht über dem Kopf. |
| Tisch | Privat oder öffentlich, Raumcode, zufälliger Tisch, Bots für freie Plätze, Zuschauer (nur mit Code), Tischbesitzer stellt die Regeln ein und alle sehen sie, Kick, Revanche |
| Regeln | Standard (renksiz/renkli, Startpunkte), 101 (Açmak ≥ 101 / Paare, İşlemek, Strafen, Verdopplung, Anzahl Hände), Perişan (Farb-Multiplikatoren, Okey bir, Çift, Okey yakalanmak), Taş Çalma optional, Schwer-Modus, Zug-Timer |
| Spielen | Istaka mit Drag & Drop, Auto-Sortieren nach Reihen oder Paaren, Doppelklick oder Drag zum Abwerfen bzw. Beenden, auf den Stapel oder Seitenstein in 3D klicken |
| Zettel | Karierter Block in Kugelschreiberschrift, der sich nach jeder Hand animiert selbst schreibt. Die Verlierer unterschreiben am Ende. |
| Kommunikation | Voice-Chat (WebRTC, Push-to-Talk mit V, jeden einzeln stummschalten), Text-Chat, Schnellsprüche als Sprechblase, Emotes (auf den Tisch hauen, Tee, Nargile, Kopfschütteln …), Augen-Signale (Tasten 1/2/3) |
| Fernseher & Musik | YouTube-Links und Livestreams, für den ganzen Tisch synchron (nur der Tischbesitzer steuert). Jeder Spieler wählt „mit dem Tisch“, „aus“ oder „eigene Musik“. Radio-Streams per Link. |
| Einstellungen | Getrennte Lautstärken (Gesamt, Effekte, Voice, Fernseher, Musik, NPCs), Rauch an/aus, Grafikqualität, Tageszeit, Türkisch/Deutsch |
| Statistik | Siege und Niederlagen pro Modus |

## Aufbau

```
packages/engine   Regel-Engine (reine Logik, 28 Tests, Bot)
packages/server   Node-Server: liefert den Client aus + WebSocket-Spielserver
packages/client   Vite + Three.js: Menü, Editor, 3D-Kahvehane, Tisch-UI
```

```bash
npm test                                   # Regel-Tests
npm run simulate -- perisan 42             # 4 Bots spielen ein Spiel
npx tsx packages/server/scripts/e2e.ts     # Multiplayer-Test gegen laufenden Server
```

Das vollständige Konzept steht im Dokument „Okey Kahvehane – Spielkonzept“.
