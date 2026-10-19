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

## So läuft eine Anfrage

```
Browser ──(Bild1, Bild2 + Login-Token)──▶ /api/generate ──(Bilder + n8n-Zugangsdaten)──▶ n8n-Webhook
```

Der Browser spricht nie direkt mit n8n. Die Serverfunktion `api/generate.ts` prüft das Supabase-Login, ergänzt die Zugangsdaten für den Webhook und gibt das generierte Bild zurück. Webhook-URL und Passwort stehen deshalb nicht im Browser-Code.

## Konfiguration

**`.env`** (im Git-Repository, nur öffentliche Werte):

```dotenv
N8N_WEBHOOK_URL=https://britta-ai.app.n8n.cloud/webhook/7c23bad7-e1fc-46b6-8ef3-0b15592524a9
VITE_SUPABASE_URL=https://vboojmnviogfrdjymmgv.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

**`.env.local`** (nicht im Git-Repository, geheime Werte): je nach *Authentication* im n8n-Webhook-Knoten **eine** der beiden Varianten ausfüllen.

```dotenv
# Variante A – Header Auth (Name und Wert aus dem n8n-Credential „Header Auth“)
N8N_AUTH_HEADER_NAME=
N8N_AUTH_HEADER_VALUE=

# Variante B – Basic Auth (Benutzer und Passwort aus dem n8n-Credential „Basic Auth“)
N8N_BASIC_AUTH_USER=
N8N_BASIC_AUTH_PASSWORD=
```

Als Vorlage dient `.env.example`. Nach jeder Änderung an `.env` oder `.env.local` muss der Dev-Server neu gestartet werden.

> Variablen mit dem Präfix `VITE_` sind im Browser sichtbar. Dort keine Passwörter oder API-Schlüssel eintragen.

### Vercel

Unter *Project → Settings → Environment Variables* eintragen, danach neu deployen:

| Variable | Wert |
|---|---|
| `N8N_WEBHOOK_URL` | Webhook-URL (wie in `.env`) |
| `N8N_AUTH_HEADER_NAME` + `N8N_AUTH_HEADER_VALUE` **oder** `N8N_BASIC_AUTH_USER` + `N8N_BASIC_AUTH_PASSWORD` | Zugangsdaten aus n8n |
| `SUPABASE_URL` | wie `VITE_SUPABASE_URL` |
| `SUPABASE_PUBLISHABLE_KEY` | wie `VITE_SUPABASE_PUBLISHABLE_KEY` |

Die Funktion `api/generate.ts` darf bis zu 180 Sekunden laufen (`vercel.json`). Vercel nimmt pro Anfrage höchstens 4,5 MB an. Deshalb verkleinert die App Fotos über 2 MB vor dem Senden automatisch.

## Starten

```bash
npm run dev        # Entwicklungsserver unter http://localhost:5173
npm run build      # TypeScript-Prüfung + Produktions-Build nach dist/
npm run preview    # Produktions-Build lokal ansehen (ohne /api/generate)
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

### Lokal und auf Vercel gleich

Im Entwicklungsmodus (`npm run dev`) führt der Vite-Dev-Server dieselbe Serverfunktion `api/generate.ts` aus wie Vercel (siehe `vite.config.ts`). Die Zugangsdaten kommen lokal aus `.env.local`. CORS spielt keine Rolle, weil n8n immer vom Server aus aufgerufen wird.

### Anforderungen an den n8n-Workflow

| Punkt | Vorgabe |
|---|---|
| Webhook-Methode | `POST` |
| Eingang | `multipart/form-data` mit den Binärfeldern `Bild1` und `Bild2` |
| Antwort | **Respond to Webhook** → *Respond With: Binary File* |
| Content-Type der Antwort | `image/jpeg` oder `image/webp` |
| Antwortmodus des Webhooks | *Using 'Respond to Webhook' Node* (synchron) |
| Authentication | Header Auth oder Basic Auth – dieselben Werte in `.env.local` und bei Vercel eintragen |
| Antwortgröße | unter 4,5 MB (Vercel-Limit) |

Antwortet der Workflow mit JSON, HTML, einem anderen Bildformat (z. B. PNG) oder einer leeren Datei, zeigt die App eine verständliche Fehlermeldung.

### Produktion

Für den Dauerbetrieb den Workflow aktivieren und die Produktions-URL (`/webhook/…` statt `/webhook-test/…`) als `N8N_WEBHOOK_URL` eintragen. Der Webhook ist per Authentication geschützt, und Bilder generieren können nur angemeldete Nutzer. Vor einer öffentlichen Nutzung zusätzlich Rate-Limits und Datenschutz prüfen (Speicherung und Löschung der Bilder im Workflow).

## Validierung

- Erlaubt sind JPEG und WebP (geprüft über MIME-Typ **und** Datei-Signatur).
- Leere Dateien und Dateien über 25 MB werden abgelehnt.
- Fotos über 2 MB werden im Browser automatisch verkleinert (lange Seite max. 2048 px, JPEG), damit beide Bilder zusammen unter das Vercel-Limit von 4,5 MB passen. Anpassbar in `src/config.ts`.
- Zeitlimit pro Generierung: 3 Minuten (`REQUEST_TIMEOUT_MS` in `src/config.ts`).

## Projektstruktur

```
api/
  generate.ts                  Serverfunktion: Login prüfen, Bilder an n8n weiterleiten
src/
  App.tsx                      Seitenaufbau (Login oder Studio)
  config.ts                    Endpunkt, Supabase, Formate, Limits
  types.ts                     gemeinsame TypeScript-Typen
  services/n8nService.ts       Aufruf der Serverfunktion /api/generate
  services/authService.ts      Registrierung, Anmeldung, Zugriffstoken
  hooks/useImageFile.ts        Dateiauswahl, Validierung, Verkleinerung, Vorschau
  hooks/useGeneration.ts       Lade-/Ergebnis-/Fehlerzustand, Schutz vor Doppelanfragen
  utils/validateImage.ts       Prüfung der Bilddateien
  utils/resizeImage.ts         Verkleinern großer Fotos vor dem Senden
  utils/format.ts              Formatierung (Dateigröße, Uhrzeit, Dateiname)
  components/                  Studio, AuthScreen, Header, Footer, ImageUploadCard,
                               GenerateButton, ResultPanel, PrivacyNotice, ErrorMessage
vercel.json                    Laufzeitlimit der Serverfunktion
```
