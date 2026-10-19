# CLAUDE.md – deutsche Fassung

> Nur zum Nachlesen. Claude Code liest ausschließlich die englische `CLAUDE.md`. Änderungen bitte dort vornehmen.

Diese Datei gibt Claude Code (claude.ai/code) Hinweise für die Arbeit am Code in diesem Repository.

## Projekt

AI Image Studio ist eine Single-Page-App mit React 19, TypeScript, Vite 8 und Tailwind CSS v4. Nutzer laden zwei Bilder hoch (Bild1 = Person, Bild2 = Kleidungsstück). Die App schickt sie per POST an ihre eigene Serverfunktion `api/generate.ts` (Vercel), die sie an einen n8n-Webhook weiterleitet. n8n gibt ein generiertes Bild zurück, und die App zeigt es an und bietet es zum Download an. Die Bildgenerierung findet ausschließlich in n8n statt. Niemals eine Mock- oder lokale Generierung als Ersatz einbauen.

Die App ist nur nach Anmeldung über Supabase Auth nutzbar (E-Mail + Passwort, der Name wird bei der Registrierung erfasst, die E-Mail-Bestätigung ist Pflicht).

`PRD_AI_Image_Studio.md` ist die verbindliche funktionale Vorgabe, `Kopfbedeckungen.jpg` die visuelle Designreferenz. Die Oberflächentexte sind deutsch, mit Ausnahme der festen englischen Beschriftungen „Generate Image“, „Creating your image…“ und „Create your look“.

## Befehle

```bash
npm install
npm run dev        # Vite-Entwicklungsserver, http://localhost:5173
npm run build      # tsc -b (Typprüfung) + vite build -> dist/
npm run typecheck  # nur tsc -b
npm run preview    # dist/ lokal ausliefern (nur statisch: /api/generate gibt es dort nicht)
```

Es sind weder ein Test-Runner noch ein Linter eingerichtet. Änderungen werden mit `npm run build` geprüft.

## Git

- Remote `origin` ist https://github.com/kaybritti/Bild-App, Standard-Branch `main`.
- `node_modules` und `dist` werden von Git ignoriert. `.env` ist absichtlich im Repository, damit Builds auf Vercel die Webhook-URL und die Supabase-Werte erhalten; die Datei darf nur öffentliche Werte enthalten, niemals Geheimnisse. Geheimnisse gehören in `.env.local` (über `.env.*` ignoriert) und in die Umgebungsvariablen von Vercel.
- Die Commit-Identität ist lokal im Repository gesetzt: `kaybritti <bmbartel@gmx.de>`.
- Pushen über HTTPS läuft über den Git Credential Manager. Ist keine Anmeldung gespeichert, wartet `git push` still auf eine Anmeldung im Browser. Ein nicht-interaktiver Push kann deshalb hängen, bis die Anmeldung im Browser erfolgt ist.

## Konfiguration

- Der Browser sieht weder die n8n-Webhook-URL noch ihre Zugangsdaten. Beides gibt es nur serverseitig (ohne `VITE_`-Präfix):
  - `N8N_WEBHOOK_URL` steht in `.env` (im Repository, öffentlich).
  - Die Zugangsdaten zum Webhook stehen in `.env.local` und bei Vercel. Entweder `N8N_AUTH_HEADER_NAME` + `N8N_AUTH_HEADER_VALUE` (n8n Header Auth) oder `N8N_BASIC_AUTH_USER` + `N8N_BASIC_AUTH_PASSWORD` (Basic Auth).
  - Im n8n-Webhook ist Authentication aktiviert. Ein Aufruf ohne Zugangsdaten erhält `403 "Authorization data is wrong!"`.
- Auf Vercel `N8N_WEBHOOK_URL`, die Auth-Variablen sowie `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` als Projekt-Umgebungsvariablen für die Funktion setzen. Die Funktion greift ersatzweise auch auf die Namen `VITE_SUPABASE_*` zurück. Nicht darauf verlassen, dass die eingecheckte `.env` zur Laufzeit bei der Funktion ankommt.
- Nach Änderungen an `.env` oder `.env.local` den Dev-Server neu starten.
- Die aktuelle URL ist der n8n-**Produktions**-Webhook (`/webhook/…`). Er antwortet nur, solange der Workflow in n8n aktiviert ist. Die **Test**-Variante (`/webhook-test/…`) nimmt nur eine einzige Anfrage an, nachdem „Execute workflow“ bzw. „Listen for test event“ geklickt wurde. In beiden Fällen antwortet ein nicht registrierter Webhook mit HTTP 404.
- **Lokale Entwicklung:** `vite.config.ts` registriert eine Dev-Middleware, die unter `/api/generate` denselben `POST`-Handler aus `api/generate.ts` ausführt. So verhalten sich lokal und Vercel gleich.
  - Die Middleware kopiert die serverseitigen Werte aus `.env` / `.env.local` nach `process.env` (`SERVER_ENV_KEYS`). Neue Servervariablen dort ergänzen.
  - Sie baut aus der Node-Anfrage einen Web-`Request` (ohne Hop-by-Hop-Header) und schreibt die Web-`Response` zurück.

## Supabase (Login)

- Projekt `vboojmnviogfrdjymmgv`, angebunden als MCP-Server `supabase`. `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) stehen in `.env`. Beide sind öffentlich; niemals den Secret- oder Service-Role-Key dort eintragen.
- Datenbank: `public.profiles` (`id` → `auth.users.id` mit Cascade Delete, `name`, `created_at`).
  - RLS ist aktiv. Angemeldete Nutzer dürfen nur ihre eigene Zeile lesen (`select`) und ändern (`update`); `insert`/`delete` gibt es vom Client aus nicht.
  - Zeilen legt die `security definer`-Triggerfunktion `public.handle_new_user()` an (Trigger `on_auth_user_created` auf `auth.users`). Sie übernimmt `raw_user_meta_data->>'name'` und nimmt ersatzweise den Teil der E-Mail-Adresse vor dem @.
  - Schemaänderungen laufen über `apply_migration`; danach `get_advisors` (Security) ausführen.
- Die E-Mail-Bestätigung ist aktiv. `signUp` übergibt `emailRedirectTo: window.location.origin`, deshalb muss jede Adresse der App (localhost:5173, Vercel) im Supabase-Dashboard unter Authentication → URL Configuration eingetragen sein.
- Die Generierung ist serverseitig geschützt. `api/generate.ts` verlangt `Authorization: Bearer <Supabase-Zugriffstoken>` und prüft es mit `GET {SUPABASE_URL}/auth/v1/user`, bevor n8n aufgerufen wird. Der Browser holt das Token über `getAccessToken()` in `authService.ts`.

## Architektur

Der Datenfluss geht in eine Richtung: Hooks halten den Zustand, `App.tsx` verbindet sie mit den darstellenden Komponenten, und nur `src/services/` greift auf das Netzwerk zu.

- **`src/App.tsx`**: rendert `Header`, dann je nach `AuthState` (`loading | signedOut | signedIn`) eine Statuszeile, `AuthScreen` oder `Studio`, dann `Footer`. `Studio` enthält die frühere Seite mit Upload, Generierung und Ergebnis; beim Abmelden wird sie entfernt, was eine laufende Anfrage abbricht und Object-URLs freigibt.
- **`src/services/authService.ts`**: `signUp`, `signIn`, `signOut` und `subscribeToAuth` über den Client in `supabaseClient.ts` (der `null` ist, wenn die Umgebungswerte fehlen).
  - Fehler werfen `AuthServiceError` mit nutzerfreundlichem deutschem Text, abgeleitet aus den Supabase-Fehlercodes. Eine Registrierung mit einer bereits bestätigten Adresse liefert keinen Fehler, sondern einen Nutzer mit leeren `identities`; das wird als „bereits registriert“ behandelt.
  - `signOut` wirft nie, weil supabase-js die lokale Sitzung auch dann entfernt, wenn der Serveraufruf scheitert.
- **`src/hooks/useAuth.ts`**: abonniert `onAuthStateChange` (dessen Ereignis `INITIAL_SESSION` ersetzt einen eigenen `getSession`-Aufruf). Der Anzeigename kommt aus `user_metadata.name`.
- **`api/generate.ts`** (Vercel-Funktion, Web-Signatur `export async function POST(request)`): prüft das Login, leitet den Multipart-Body unverändert (samt `content-type` mit Boundary) mit ergänztem Auth-Header an `N8N_WEBHOOK_URL` weiter und gibt die Bildantwort von n8n unverändert zurück.
  - Die Datei muss eigenständig bleiben (keine relativen Imports), weil Vercel sie separat bündelt. Die Typprüfung läuft über `tsconfig.node.json`.
  - Alle ihre Fehler sind JSON `{ error: "<deutsche Nachricht>" }`. Fehler von n8n werden zu HTTP 502 mit einer zum Status passenden Nachricht.
  - Grenzen: Vercel nimmt höchstens 4,5 MB pro Request-Body an (`MAX_BODY_BYTES`). `maxDuration` ist in `vercel.json` auf 180 s gesetzt, das Zeitlimit zu n8n beträgt 170 s.
- **`src/config.ts`**: zentrale Stelle für `GENERATE_ENDPOINT` (`/api/generate`), Supabase-URL und -Key, die Mindestlänge des Passworts (6), die erlaubten MIME-Typen (`image/jpeg`, `image/webp`), das Größenlimit für Eingabedateien (25 MB), das Upload-Ziel (2 MB / 2048 px pro Bild, damit beide unter die 4,5 MB von Vercel passen) und das Zeitlimit der Anfrage (180 s).
- **`src/services/n8nService.ts`** (`generateImage`): baut ein `FormData` mit den Feldnamen `Bild1` und `Bild2`. Diese Namen sind eine feste Absprache mit dem n8n-Workflow, Groß- und Kleinschreibung zählt.
  - Der POST geht mit dem Supabase-Bearer-Token an `/api/generate`. Den `Content-Type`-Header niemals manuell setzen; der Browser ergänzt die Multipart-Boundary.
  - Die Antwort muss drei Prüfungen bestehen: `response.ok`, ein `Content-Type` von `image/jpeg` oder `image/webp` und eine Magic-Byte-Prüfung des Blobs.
  - Der Fehlertext kommt aus dem JSON-Feld `error` des Servers, bei Plattformfehlern ersatzweise aus `messageForStatus`. Alle Fehler werfen `GenerationError`, dessen Nachricht wörtlich in der Oberfläche angezeigt wird, deshalb diese Texte als nutzerfreundliches Deutsch halten.
  - Das Zeitlimit nutzt einen internen `AbortController`, der auch ein externes Abbruch-Signal weiterleitet.
- **`src/utils/resizeImage.ts`** (`prepareForUpload`): Dateien über 2 MB werden auf einem Canvas neu gezeichnet.
  - Das Bitmap berücksichtigt die EXIF-Drehung, und der Canvas bekommt einen weißen Hintergrund, weil JPEG keine Transparenz kennt.
  - Die Versuche gehen stufenweise von 2048 px / Qualität 0,9 bis 1280 px / 0,75, bis die Datei höchstens 2 MB groß ist; das Ergebnis wird als `.jpg` gespeichert. Kleinere Dateien bleiben unverändert.
- **`src/utils/validateImage.ts`**: `detectImageType` erkennt JPEG/WebP an den Magic Bytes. Die Funktion wird für die Eingabeprüfung und für die Prüfung der Antwort gemeinsam genutzt.
  - Eingabedateien mit leerem oder falschem `file.type` werden als neues `File` mit dem erkannten MIME-Typ verpackt, damit der Multipart-Teil den richtigen Content-Type trägt.
- **`src/hooks/useImageFile.ts`**: eine Instanz pro Upload-Feld.
  - Der Hook prüft die Datei, führt `prepareForUpload` aus und erzeugt dann die Object-URL für die Vorschau aus genau der Datei, die gesendet wird. Die URL wird über das Effect-Cleanup freigegeben, das am `image`-Objekt hängt.
  - Solange das läuft, ist `processing` wahr. `Studio` sperrt in dieser Zeit die Generierung, und die Karte zeigt „Wird vorbereitet“.
  - Ein `selectionId`-Ref verwirft Ergebnisse veralteter asynchroner Auswahlen.
  - Eine ungültige neue Datei lässt das zuvor gewählte Bild stehen.
- **`src/hooks/useGeneration.ts`**: eine Zustandsmaschine, typisiert als Discriminated Union `GenerationState` (`idle | loading | success | error`) in `src/types.ts`.
  - Ein `inFlight`-Ref (kein State) blockiert Doppelklicks sofort und synchron.
  - Die Object-URL des Ergebnisses wird bei jeder Änderung und beim Unmount freigegeben.
  - Der Start einer neuen Generierung setzt `loading` und blendet damit das alte Ergebnis aus, wie es das PRD verlangt.
  - Abgebrochene Anfragen (über Reset oder Unmount) werden still verworfen.
- **`src/components/ResultPanel.tsx`**: stellt alle vier Zustände dar. Ab `lg` nutzt es eine explizite CSS-Grid-Platzierung (Text und Aktionen links, Bildrahmen rechts), während die DOM-Reihenfolge für Screenreader Text → Rahmen → Aktionen bleibt.

## Styling-Konventionen

- Tailwind v4 wird CSS-first in `src/index.css` über `@theme` konfiguriert. Es gibt keine `tailwind.config.js`.
- Die Theme-Tokens statt roher Hex-Werte verwenden:
  - Farben: `paper`, `sand`, `sand-light`, `ink`, `stone`, `stone-dark`, `error`
  - Schriften: `font-serif` (Cormorant Garamond), `font-sans` (Inter), `font-mono` (JetBrains Mono); sie werden in `index.html` von Google Fonts geladen
  - eigener Breakpoint `xs` (360px), unterhalb dessen die beiden Upload-Karten untereinander stehen
  - Animationen: `shimmer`, `progress`, `fade-in`
- Visuelle Sprache: minimalistischer Editorial-Fashion-Look.
  - Keine Schatten, keine farbigen Akzente und keine dekorativen Rahmen.
  - Ausgewählte oder aktive Bildrahmen bekommen eine feine `outline outline-offset-4 outline-ink`, angelehnt an das aktive Vorschaubild im Referenz-Screenshot.
  - Kleine Beschriftungen sind Monospace in Großbuchstaben mit weitem Buchstabenabstand.
  - Für kleinen Text `stone-dark` statt `stone` verwenden (Kontrast).
- Barrierefreiheit: Es gibt eine globale `:focus-visible`-Outline, und eine `prefers-reduced-motion`-Regel schaltet Animationen ab.
  - Das versteckte native `<input type="file">` wird über einen sichtbaren Button ausgelöst.
  - Fehler nutzen `role="alert"`, der Ladezustand nutzt `role="status"`.
- `lucide-react`-Icons verwenden dünne Linien (`strokeWidth` 1–1,5) und `aria-hidden="true"`.

## Erwartete Absprache mit dem n8n-Workflow

- Webhook: nur POST, Antwortmodus auf „Using 'Respond to Webhook' Node“. GET ist absichtlich nicht freigegeben, weil die Bilder im Request-Body übertragen werden. Die URL nicht per GET oder durch Aufruf im Browser prüfen: n8n antwortet dann mit einem „not registered“-Fehler, der wie ein inaktiver Test-Webhook aussieht. Zum Testen einen echten Multipart-POST senden.
- Ein **Respond to Webhook**-Knoten gibt eine *Binary File* mit `Content-Type: image/jpeg` oder `image/webp` zurück. Die Antwort muss außerdem unter dem Vercel-Limit von 4,5 MB bleiben.
- Authentication (Header Auth oder Basic Auth) ist aktiv. Die Zugangsdaten kennt nur `api/generate.ts`.
- CORS spielt keine Rolle mehr, weil n8n von Server zu Server aufgerufen wird.

JSON-Antworten, URL-Antworten oder asynchrone Job-IDs sind im MVP ausdrücklich nicht vorgesehen.
