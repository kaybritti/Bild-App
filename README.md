# AI Image Studio

Elegante, responsive Web-App, die zwei Bilder – **Bild1** (Person) und **Bild2** (Kleidungsstück) – an einen n8n-Workflow sendet und das zurückgegebene, generierte Bild anzeigt. Die Bildgenerierung findet ausschließlich in n8n statt.

**Technik:** React 19 · TypeScript · Vite · Tailwind CSS v4 · Lucide Icons · Fetch API

## Voraussetzungen

- Node.js 20 oder neuer (getestet mit Node 24)
- Ein n8n-Workflow mit Webhook (siehe unten)

## Installation

```bash
npm install
```

## Konfiguration

Die Webhook-Adresse steht in der Datei `.env`:

```dotenv
VITE_N8N_WEBHOOK_URL=https://britta-ai.app.n8n.cloud/webhook/7c23bad7-e1fc-46b6-8ef3-0b15592524a9
```

Als Vorlage dient `.env.example`. Nach jeder Änderung an `.env` muss der Dev-Server neu gestartet werden.

> Variablen mit dem Präfix `VITE_` sind im Browser sichtbar. Dort keine Passwörter oder API-Schlüssel eintragen.

## Starten

```bash
npm run dev        # Entwicklungsserver unter http://localhost:5173
npm run build      # TypeScript-Prüfung + Produktions-Build nach dist/
npm run preview    # Produktions-Build lokal ansehen
npm run typecheck  # nur TypeScript prüfen
```

## n8n-Webhook testen

Die Test-URL (`/webhook-test/…`) ist nur erreichbar, solange in n8n ein Testlauf aktiv ist, und nimmt dann **genau eine** Anfrage an.

1. Workflow in n8n öffnen.
2. **„Listen for test event“** bzw. **„Execute workflow“** klicken.
3. In der App Bild1 und Bild2 hochladen und **Generate Image** klicken.
4. Für einen weiteren Test Schritt 2 wiederholen.

Ist kein Testlauf aktiv, antwortet n8n mit HTTP 404 – die App zeigt dann einen entsprechenden Hinweis.

Der Webhook ist bewusst nur für POST freigegeben. Die URL im Browser aufzurufen (GET) ergibt immer einen Fehler und ist kein sinnvoller Test.

### Dev-Proxy (CORS)

Im Entwicklungsmodus (`npm run dev`) schickt die App die Bilder an `/n8n-webhook` auf dem eigenen Dev-Server. Vite leitet die Anfrage serverseitig an `VITE_N8N_WEBHOOK_URL` weiter (siehe `vite.config.ts`). Dadurch gibt es lokal keine CORS-Probleme, und Fehler von n8n (z. B. 404 bei inaktivem Test-Webhook) werden korrekt angezeigt.

Der Produktions-Build (`npm run build`) ruft den Webhook dagegen direkt aus dem Browser auf. Dafür muss der Webhook CORS für die Domain der App erlauben, oder das Hosting braucht einen eigenen Proxy.

### Anforderungen an den n8n-Workflow

| Punkt | Vorgabe |
|---|---|
| Webhook-Methode | `POST` |
| Eingang | `multipart/form-data` mit den Binärfeldern `Bild1` und `Bild2` |
| Antwort | **Respond to Webhook** → *Respond With: Binary File* |
| Content-Type der Antwort | `image/jpeg` oder `image/webp` |
| Antwortmodus des Webhooks | *Using 'Respond to Webhook' Node* (synchron) |
| CORS | Webhook-Option *Allowed Origins (CORS)* muss die Adresse der App erlauben (z. B. `*` oder `http://localhost:5173`) |

Antwortet der Workflow mit JSON, HTML, einem anderen Bildformat (z. B. PNG) oder einer leeren Datei, zeigt die App eine verständliche Fehlermeldung.

### Produktion

Für den Dauerbetrieb den Workflow aktivieren und die Produktions-URL (`/webhook/…` statt `/webhook-test/…`) in `.env` eintragen. Vor einer öffentlichen Nutzung zusätzlich Zugriffsschutz, Rate-Limits, Größenlimits und Datenschutz (Speicherung/Löschung der Bilder im Workflow) prüfen.

## Validierung

- Erlaubt sind JPEG und WebP (geprüft über MIME-Typ **und** Datei-Signatur).
- Leere Dateien und Dateien über 8 MB werden abgelehnt (n8n begrenzt Requests standardmäßig auf ca. 16 MB; anpassbar in `src/config.ts`).
- Zeitlimit pro Generierung: 3 Minuten (`REQUEST_TIMEOUT_MS` in `src/config.ts`).

## Projektstruktur

```
src/
  App.tsx                      Seitenaufbau und Ablaufsteuerung
  config.ts                    Webhook-URL, Formate, Limits
  types.ts                     gemeinsame TypeScript-Typen
  services/n8nService.ts       HTTP-Kommunikation mit n8n
  hooks/useImageFile.ts        Dateiauswahl, Validierung, Vorschau
  hooks/useGeneration.ts       Lade-/Ergebnis-/Fehlerzustand, Schutz vor Doppelanfragen
  utils/validateImage.ts       Prüfung der Bilddateien
  utils/format.ts              Formatierung (Dateigröße, Uhrzeit, Dateiname)
  components/                  Header, Footer, ImageUploadCard, GenerateButton,
                               ResultPanel, PrivacyNotice, ErrorMessage
```
