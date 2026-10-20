# AI Image Studio

React-/TypeScript-App für virtuelle Anproben. Angemeldete Nutzer senden zwei Bilder
(Person und Kleidungsstück) an einen authentifizierten n8n-Workflow. Es gibt keine
lokale KI-Generierung und keinen Mock-Fallback.

## Entwicklung

Voraussetzung: Node.js 24 oder neuer.

```sh
npm ci
npm run dev
npm run build
npm test
```

`npm run dev` stellt auch `/api/generate` bereit. `npm run preview` liefert nur
statische Dateien; die API benötigt den Dev-Server oder Vercel.

## Konfiguration

`.env` enthält ausschließlich öffentliche Werte:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (niemals Secret- oder Service-Role-Key)
- `N8N_WEBHOOK_URL` (nur serverseitig verwendet, HTTPS erforderlich)
- `VITE_TURNSTILE_SITE_KEY` (optional, Cloudflare-Turnstile-Site-Key; leer = kein CAPTCHA)

Geheimnisse gehören ausschließlich in `.env.local` und in die serverseitigen
Vercel-Umgebungsvariablen:

- `SUPABASE_SECRET_KEY`: Supabase Secret API Key (`sb_secret_...`) oder ein Legacy
  Service-Role-JWT. **Kein `VITE_`-Präfix**, niemals committen oder im Browser verwenden.
- `N8N_AUTH_HEADER_NAME` und `N8N_AUTH_HEADER_VALUE`, alternativ
  `N8N_BASIC_AUTH_USER` und `N8N_BASIC_AUTH_PASSWORD`.
- Für Vercel zusätzlich `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY` setzen.
  Die API akzeptiert alternativ die jeweiligen `VITE_SUPABASE_*`-Variablen.

Vorlage: `.env.example`. Nach Änderungen den Dev-Server neu starten bzw. neu deployen.
Die API verwendet Secret Keys nur im `apikey`-Header; Legacy-JWTs zusätzlich als Bearer.
Siehe [Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Nutzungsschutz aktivieren

1. Die vollständige Migration
   `supabase/migrations/202610200001_generation_limits.sql` im SQL-Editor des
   richtigen Supabase-Projekts ausführen oder über den bestehenden Migrationsprozess
   anwenden. Die Migration ist für einmalige Ausführung vorgesehen. Im Projekt
   `vboojmnviogfrdjymmgv` ist sie seit 20.10.2026 als Version `20261020000001` eingespielt.
2. Einen serverseitigen `SUPABASE_SECRET_KEY` lokal und bei Vercel hinterlegen.
3. Bei Supabase E-Mail-Bestätigung und die erlaubten Redirect-URLs konfigurieren.
4. Bei n8n die Webhook-Authentifizierung aktiv lassen und die Produktions-URL verwenden.
5. Nach erfolgreicher Einrichtung deployen und mit einem bestätigten Testkonto prüfen.

**Ohne Secret Key oder erreichbare Quota-Funktionen startet die API keine Generierung
(HTTP 503). Es gibt keinen ungeschützten Ersatzbetrieb.**

Die Datenbank begrenzt atomar über alle Serverinstanzen:

| Grenze | Standard |
|---|---:|
| Versuche pro Nutzer und UTC-Tag | 10 |
| Versuche insgesamt pro UTC-Tag | 100 |
| Abstand pro Nutzer | 60 Sekunden |
| Laufende Anfragen pro Nutzer | 1 |
| Laufende Anfragen insgesamt | 5 |

Die Reservierung erfolgt vor dem Dekodieren der Bilder. Auch ungültige Uploads und
fehlgeschlagene Versuche zählen, damit diese Pfade nicht unbegrenzt belastet werden.
HTTP 429 enthält `Retry-After`; die App zeigt daraus die Wartezeit an. Sobald n8n
antwortet – auch mit einem Fehlerstatus –, wird die Reservierung freigegeben (der
Abstand von 60 Sekunden gilt weiter). Bei einem Netzwerkfehler, Timeout oder Abbruch,
bevor n8n antwortet, bleibt sie vorsichtshalber bis zu 10 Minuten aktiv: Ein abgebrochener
HTTP-Aufruf beweist nicht, dass der externe KI-Auftrag gestoppt wurde. Der n8n-Workflow
sollte entsprechend ein eigenes Laufzeitlimit haben. Die API startet keine automatischen
Wiederholungen. Die Tagesgrenze begrenzt Versuche, keinen exakten Eurobetrag.

Limits lassen sich ausschließlich administrativ ändern:

```sql
update private.generation_limits
set user_daily = 10, global_daily = 100, global_concurrent = 5, cooldown_seconds = 60
where id = true;

-- Neue Generierungen sofort sperren (laufende externe Jobs bleiben bestehen):
update private.generation_limits set enabled = false where id = true;
-- Wieder freigeben:
-- update private.generation_limits set enabled = true where id = true;
```

Die privaten Tabellen haben RLS und keine Freigabe für `anon`/`authenticated`.
Die RPCs dürfen nur mit `service_role` ausgeführt werden; `search_path` ist festgesetzt.
Siehe [Supabase-Datenbankfunktionen](https://supabase.com/docs/guides/database/functions).
Gespeichert werden ausschließlich Nutzer-ID, Anfrage-ID und Zeiten; alte Einträge werden
bei weiteren Reservierungen bereinigt (aktueller und vorheriger UTC-Tag). Ohne weitere
Anfragen bleiben sie bis zur nächsten Bereinigung bestehen. Bilder werden dort nicht gespeichert.

## Konten schützen (Supabase- und Vercel-Dashboard)

Diese Einstellungen liegen außerhalb des Codes und müssen im Dashboard gesetzt werden:

1. **Passwortlänge:** Authentication → Providers → Email → *Minimum password length*
   auf **8** setzen (passend zu `MIN_PASSWORD_LENGTH` in `src/config.ts`). Die App
   prüft die Länge nur im Formular; verbindlich ist die Supabase-Einstellung.
2. **Geleakte Passwörter:** Authentication → Attack Protection → *Prevent use of leaked
   passwords* aktivieren (HaveIBeenPwned; je nach Supabase-Plan verfügbar).
3. **Eigener SMTP-Server:** Authentication → Emails → SMTP Settings. Ohne eigenen SMTP
   verschickt Supabase nur sehr wenige Mails und nur an Mitglieder des Projektteams;
   Bestätigungs- und Passwort-Mails erreichen echte Nutzer dann nicht.
4. **Redirect-URLs:** Authentication → URL Configuration muss jede App-Adresse enthalten
   (lokal und Vercel). Bestätigungs- und Passwort-Links führen auf `window.location.origin`.
5. **CAPTCHA gegen Bot-Registrierungen** (Cloudflare Turnstile), in dieser Reihenfolge:
   1. Im Cloudflare-Dashboard ein Turnstile-Widget für die App-Domains anlegen.
   2. Den **Site Key** als `VITE_TURNSTILE_SITE_KEY` in `.env` eintragen und deployen.
      Die App zeigt das Widget dann bei Anmeldung, Registrierung und Passwort-Mails.
   3. Erst danach in Supabase unter Authentication → Attack Protection *Enable Captcha
      protection* (Turnstile) aktivieren und den **Secret Key** dort hinterlegen.
      Umgekehrt schlägt jede Anmeldung fehl, solange die App noch kein Token mitsendet.
   Die CSP in `vercel.json` erlaubt dafür `https://challenges.cloudflare.com`.
6. **Optional, Vercel Firewall:** eine Rate-Limit-Regel für `/api/generate`, damit Anfragen
   ohne Login keine Funktionsaufrufe verbrauchen.

Ohne CAPTCHA kann ein Angreifer mit wenigen bestätigten Konten das gemeinsame Tageslimit
(100) ausschöpfen und die App für alle bis Mitternacht (UTC) sperren.

## Bildverarbeitung und API

- Genau zwei Multipart-Dateien: `Bild1` und `Bild2`, ohne zusätzliche oder doppelte Felder.
- Jeweils JPEG oder WebP, maximal 2 MiB; gesamte Anfrage maximal 4.500.000 Bytes.
- Browser akzeptiert Originale bis 25 MiB und kodiert sie immer als JPEG neu:
  maximal 2048 Pixel Kantenlänge, ohne ursprüngliche Dateinamen/EXIF/GPS.
- Der Server prüft unabhängig davon MIME-Typ, Signatur, Dekodierbarkeit, Animation
  und maximale Pixelzahl (16 Millionen). Er kodiert jedes Bild nochmals neu, entfernt
  Metadaten und leitet nur normierte Dateien an n8n weiter.
- n8n muss synchron ein JPEG oder WebP mit passendem `Content-Type` liefern.
  Die API begrenzt auch die Antwortgröße, dekodiert sie und liefert ein bereinigtes
  JPEG (Qualität 92, bei Bedarf 85 bzw. 75, um unter 4,5 MB zu bleiben) mit maximal
  4096 Pixel Kantenlänge und `Cache-Control: no-store` zurück.
- Dekodierung ist zeitlich begrenzt. Der n8n-Aufruf hat 140 Sekunden Zeitlimit;
  Vercel maximal 180 Sekunden. Transfers werden auch ohne `Content-Length` begrenzt.
- Redirects bei authentifizierten Serveraufrufen werden abgewiesen.
- Detaillierte Upstream-Fehler und Konfigurationsgeheimnisse werden nicht an Nutzer ausgegeben.

Für öffentliche Deployments gelten die Header aus `vercel.json`: CSP, Schutz gegen
Einbettung und MIME-Sniffing, restriktive Berechtigungen und Referrer-Policy sowie HSTS.
Die Schriften werden lokal ausgeliefert. Bei einem anderen Supabase-Projekt muss dessen
exakte HTTPS-Domain in der CSP (`connect-src`) angepasst werden. Der Vite-Dev-Server
hat wegen HMR keine Produktions-CSP und darf nicht öffentlich betrieben werden.

## Prüfungen und Betriebsgrenzen

`npm test` prüft manipulierte Uploads, Auth-/Quota-Ausfälle, Grenzen, Metadatenentfernung,
Abbrüche und defekte Antworten mit gemockten Netzaufrufen. Die echte SQL-Migration wird
zusätzlich in lokalem PGlite auf Berechtigungen und Nutzungslimits geprüft.
Es werden keine echten Bildgenerierungen oder kostenpflichtigen Dienste aufgerufen.
`npm run build` prüft TypeScript und erzeugt den Produktions-Build.

Datenbanklimits ersetzen keine Plattform-Firewall gegen große Mengen unautorisierter
HTTP-Anfragen. Auth-Rate-Limits, Registrierungsschutz, RLS bestehender Tabellen,
Monitoring und gegebenenfalls WAF müssen im tatsächlichen Hosting geprüft werden.
Speicherung, Weitergabe und Löschung von Bildern bei n8n und dem KI-Anbieter sind
außerhalb dieses Repositories und müssen separat eingerichtet werden.
