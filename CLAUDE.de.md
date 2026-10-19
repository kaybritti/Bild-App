# CLAUDE.md – deutsche Fassung

> Nur zum Nachlesen. Claude Code liest ausschließlich die englische `CLAUDE.md`. Änderungen bitte dort vornehmen.

Diese Datei gibt Claude Code (claude.ai/code) Hinweise für die Arbeit am Code in diesem Repository.

## Projekt

AI Image Studio ist eine Single-Page-App mit React 19, TypeScript, Vite 8 und Tailwind CSS v4. Nutzer laden zwei Bilder hoch (Bild1 = Person, Bild2 = Kleidungsstück). Die App schickt sie per POST an einen n8n-Webhook, n8n gibt ein generiertes Bild zurück, und die App zeigt es an und bietet es zum Download an. Die Bildgenerierung findet ausschließlich in n8n statt. Niemals eine Mock- oder lokale Generierung als Ersatz einbauen.

Die App ist nur nach Anmeldung über Supabase Auth nutzbar (E-Mail + Passwort, der Name wird bei der Registrierung erfasst, die E-Mail-Bestätigung ist Pflicht).

`PRD_AI_Image_Studio.md` ist die verbindliche funktionale Vorgabe, `Kopfbedeckungen.jpg` die visuelle Designreferenz. Die Oberflächentexte sind deutsch, mit Ausnahme der festen englischen Beschriftungen „Generate Image“, „Creating your image…“ und „Create your look“.

## Befehle

```bash
npm install
npm run dev        # Vite-Entwicklungsserver, http://localhost:5173
npm run build      # tsc -b (Typprüfung) + vite build -> dist/
npm run typecheck  # nur tsc -b
npm run preview    # dist/ lokal ausliefern
```

Es sind weder ein Test-Runner noch ein Linter eingerichtet. Änderungen werden mit `npm run build` geprüft.

## Git

- Remote `origin` ist https://github.com/kaybritti/Bild-App, Standard-Branch `main`.
- `node_modules` und `dist` werden von Git ignoriert. `.env` ist bewusst committet, damit gehostete Builds (Vercel) die Webhook-URL und die Supabase-Werte bekommen; sie darf nur öffentliche Werte enthalten, niemals Geheimnisse.
- Die Commit-Identität ist nur für dieses Repo gesetzt: `kaybritti <bmbartel@gmx.de>`.
- Push über HTTPS läuft über den Git Credential Manager. Ist keine Anmeldung gespeichert, wartet `git push` stumm auf eine Anmeldung im Browser. Ein nicht-interaktiver Push scheint dann zu hängen, bis der Nutzer sich anmeldet.

## Konfiguration

- `VITE_N8N_WEBHOOK_URL` steht in `.env` (committet). `.env.example` ist die Vorlage. Eine in Vercel gesetzte Umgebungsvariable hat Vorrang.
- Der Wert wird beim Build eingebettet und ist im Browser sichtbar, deshalb niemals Geheimnisse dort eintragen.
- Nach Änderungen an `.env` den Dev-Server neu starten.
- Die aktuelle URL ist der n8n-**Produktions**-Webhook (`/webhook/…`). Er antwortet nur, solange der Workflow in n8n aktiviert ist. Die **Test**-Variante (`/webhook-test/…`) nimmt nur eine einzige Anfrage an, nachdem „Execute workflow“ bzw. „Listen for test event“ geklickt wurde. In beiden Fällen antwortet ein nicht registrierter Webhook mit HTTP 404 als JSON und ohne CORS-Header. Die Oberfläche zeigt den Testmodus-Hinweis nur, wenn die URL `/webhook-test/` enthält.
- **Dev-Proxy:** Unter `npm run dev` ersetzt `src/config.ts` die `WEBHOOK_URL` durch den Pfad `/n8n-webhook` auf demselben Server, und `vite.config.ts` leitet diesen Pfad serverseitig an `VITE_N8N_WEBHOOK_URL` weiter.
  - Der Proxy umgeht CORS lokal, und die App sieht die echten Statuscodes von n8n. Ohne ihn erschien der 404 ohne CORS-Header im Browser nur als allgemeiner Netzwerkfehler (fetch-`TypeError`).
  - Der Produktions-Build ruft den Webhook direkt auf. Dafür muss CORS in n8n oder beim Hosting eingerichtet sein.
  - Die Pfad-Konstante `/n8n-webhook` steht doppelt in beiden Dateien und muss übereinstimmen. Das Proxy-Zeitlimit von 180 s entspricht `REQUEST_TIMEOUT_MS`.

## Supabase (Login)

- Projekt `vboojmnviogfrdjymmgv`, angebunden als MCP-Server `supabase`. `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) stehen in `.env`. Beide sind öffentlich; den Secret- bzw. Service-Role-Key niemals dort eintragen.
- Datenbank: `public.profiles` (`id` → `auth.users.id` mit Cascade-Delete, `name`, `created_at`).
  - RLS ist aktiv. Angemeldete Nutzer dürfen nur ihre eigene Zeile lesen (`select`) und ändern (`update`); `insert`/`delete` vom Client gibt es nicht.
  - Die Zeilen legt die `security definer`-Triggerfunktion `public.handle_new_user()` an (Trigger `on_auth_user_created` auf `auth.users`). Sie übernimmt `raw_user_meta_data->>'name'` und nutzt sonst den Teil der E-Mail vor dem `@`.
  - Schemaänderungen laufen über `apply_migration`; danach `get_advisors` (security) ausführen.
- Die E-Mail-Bestätigung ist aktiv. `signUp` übergibt `emailRedirectTo: window.location.origin`, deshalb muss jede Adresse der App (localhost:5173, Vercel) im Supabase-Dashboard unter Authentication → URL Configuration eingetragen sein.
- Der n8n-Webhook selbst ist durch den Login nicht geschützt; die Sperre wirkt nur in der Oberfläche.

## Architektur

Der Datenfluss geht in eine Richtung: Hooks halten den Zustand, `App.tsx` verbindet sie mit den darstellenden Komponenten, und nur `src/services/` greift auf das Netzwerk zu.

- **`src/App.tsx`**: rendert `Header`, dann je nach `AuthState` (`loading | signedOut | signedIn`) eine Statuszeile, `AuthScreen` oder `Studio`, dann `Footer`. `Studio` enthält die bisherige Seite mit Upload, Generierung und Ergebnis; beim Abmelden wird es entfernt, was eine laufende Anfrage abbricht und Object-URLs freigibt.
- **`src/services/authService.ts`**: `signUp`, `signIn`, `signOut` und `subscribeToAuth` über den Client aus `supabaseClient.ts` (der `null` ist, wenn die Env-Werte fehlen).
  - Fehler werfen `AuthServiceError` mit nutzerfreundlichem deutschem Text, abgeleitet aus den Supabase-Fehlercodes. Eine Registrierung mit einer bereits bestätigten Adresse liefert keinen Fehler, sondern einen Nutzer mit leerem `identities`; das wird als „bereits registriert“ behandelt.
  - `signOut` wirft nie, weil supabase-js die lokale Session auch dann entfernt, wenn der Serveraufruf fehlschlägt.
- **`src/hooks/useAuth.ts`**: abonniert `onAuthStateChange` (dessen `INITIAL_SESSION`-Event ersetzt ein separates `getSession`). Der Anzeigename kommt aus `user_metadata.name`.

- **`src/config.ts`**: zentrale Stelle für die Webhook-URL, Supabase-URL und -Key, die Mindestlänge des Passworts (6), die erlaubten MIME-Typen (`image/jpeg`, `image/webp`), das Größenlimit pro Datei (8 MB, weil n8n eine Anfrage bei ca. 16 MB begrenzt und beide Dateien in einer Anfrage reisen) und das Zeitlimit der Anfrage (180 s).
- **`src/services/n8nService.ts`** (`generateImage`): baut ein `FormData` mit den Feldnamen `Bild1` und `Bild2`. Diese Namen sind eine feste Absprache mit dem n8n-Workflow, Groß- und Kleinschreibung zählt.
  - Den `Content-Type`-Header niemals manuell setzen; der Browser ergänzt die Multipart-Boundary.
  - Die Antwort muss drei Prüfungen bestehen: `response.ok`, ein `Content-Type` von `image/jpeg` oder `image/webp` und eine Magic-Byte-Prüfung des Blobs.
  - Alle Fehler werfen `GenerationError`. Dessen Nachricht wird wörtlich in der Oberfläche angezeigt, deshalb diese Texte als nutzerfreundliches Deutsch halten.
  - Das Zeitlimit nutzt einen internen `AbortController`, der auch ein externes Abbruch-Signal weiterleitet.
- **`src/utils/validateImage.ts`**: `detectImageType` erkennt JPEG/WebP an den Magic Bytes. Die Funktion wird für die Eingabeprüfung und für die Prüfung der Antwort gemeinsam genutzt.
  - Eingabedateien mit leerem oder falschem `file.type` werden als neues `File` mit dem erkannten MIME-Typ verpackt, damit der Multipart-Teil den richtigen Content-Type trägt.
- **`src/hooks/useImageFile.ts`**: eine Instanz pro Upload-Feld.
  - Der Hook prüft die Datei und erzeugt dann eine Object-URL für die Vorschau. Die URL wird über das Effect-Cleanup freigegeben, das am `image`-Objekt hängt.
  - Ein `selectionId`-Ref verwirft Ergebnisse veralteter asynchroner Prüfungen.
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
- Ein **Respond to Webhook**-Knoten gibt eine *Binary File* mit `Content-Type: image/jpeg` oder `image/webp` zurück.
- „Allowed Origins (CORS)“ muss die Adresse der App enthalten.

JSON-Antworten, URL-Antworten oder asynchrone Job-IDs sind im MVP ausdrücklich nicht vorgesehen.
