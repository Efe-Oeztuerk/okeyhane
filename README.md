# Okeyhane

Multiplayer-Okey im türkischen Kahvehane: Ego-Perspektive, mit Freunden, Teams gegenüber.
Modi: Standard-Okey, 101 Okey, Perişan Okey. Später kommen Batak, Pişti, Tavla und ein Kartenspiel dazu.

## Stand: Meilenstein 1 – Regel-Engine

`packages/engine` enthält die reine Spiellogik, ohne Grafik. Der Spielserver nutzt sie später direkt.

| Datei | Inhalt |
|---|---|
| `tiles.ts` | 106 Steine, Gösterge → Okey, Sahte Okey |
| `evaluate.ts` | Optimale Aufteilung in Reihen/Gruppen, lose Steine, 7 Paare, Kombinationsprüfung (inkl. 12-13-1) |
| `scoring.ts` | Wertung Standard (renksiz/renkli), 101, Perişan (Multiplikator, Okey bir, Çift, Okey yakalanmak) |
| `game.ts` | Spielablauf: ziehen, abwerfen, beenden, Gösterge zeigen, Okey bir, Açmak/İşlemek, Taş Çalma, Punktezettel |
| `rules.ts` | Alle Hausregeln, die der Tischbesitzer einstellen kann |
| `bot.ts` | Einfacher Bot, der einen freien Platz füllen kann |

```bash
npm install
npm test                                   # 28 Tests
npm run simulate -- perisan 42             # 4 Bots spielen ein ganzes Spiel
npm run simulate -- okey101 7
npm run simulate -- standard 3
```

## Nächste Meilensteine

1. ~~Regel-Engine~~
2. Multiplayer-Server (Colyseus): Tisch erstellen, Raumcode, 4 Plätze, Bots auffüllen
3. Erster spielbarer Client: 3D-Tisch in Ego-Perspektive, Istaka mit Drag & Drop, Punktezettel
4. Kahvehane, Charakter-Editor, Voice, Fernseher, Musik

Das vollständige Konzept steht im Dokument „Okey Kahvehane – Spielkonzept“.
