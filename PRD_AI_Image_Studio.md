# Product Requirements Document (PRD)

## AI Image Studio – Responsive Web-App

**Version:** 1.1  
**Datum:** 18. Oktober 2026  
**Status:** Entwicklungsgrundlage / MVP  
**Plattform:** Browser (Desktop und Mobilgerät)

## 1. Produktvision

AI Image Studio ist eine elegante, minimalistische Web-App, die zwei hochgeladene Bilder an einen n8n-Workflow übermittelt und das daraus generierte Bild darstellt. Ein Anwendungsfall ist die virtuelle Anprobe: Bild1 zeigt eine Person, Bild2 ein Kleidungsstück, das die Person auf dem Ergebnisbild trägt. Die Bildgenerierung selbst findet ausschließlich im externen n8n-Workflow statt.

## 2. Zielgruppe und Umfang

Die erste Version richtet sich an Nutzer, die ohne Registrierung zwei Bilder kombinieren möchten. Der MVP umfasst Bildauswahl, Vorschau, Übermittlung, Ladezustand, Fehlerbehandlung, Ergebnisanzeige und Download. Keine Datenbank, kein Benutzerkonto, keine Zahlungsfunktion und keine lokale KI-Bildgenerierung.

## 3. Designvorgaben

**Verbindliche visuelle Referenz:** der vom Auftraggeber bereitgestellte Screenshot mit drei hochwertigen Fashion-App-Ansichten („Maison Archive“). Nicht die dargestellte Shopping-Funktionalität kopieren, sondern die visuelle Sprache auf einen Bildgenerator übertragen.

- Hochwertige Editorial-/Fashion-Ästhetik, großzügige Bildflächen, reduzierte Bedienelemente.
- Helle Flächen in Off-White (#F7F6F2), Sand (#D9C9B2), dunkle Akzente (#211F1D) und dezentes Grau (#918E88).
- Klare Typografie mit punktuellen Monospace-Akzenten.
- Mobile-first, responsiv für iPhone/Android und Desktop-Browser.
- Gute Kontraste, Tastaturbedienbarkeit und sichtbare Fokuszustände.
- Auf Mobilgeräten Upload-Felder nebeneinander, sofern ausreichend Platz; ansonsten untereinander. Auf Desktop großzügiges Layout mit klar erkennbarer Ergebnisfläche.

## 4. Benutzeroberfläche

### 4.1 Kopfbereich

Dezenter Markenname **AI IMAGE STUDIO**, optional ein schlichtes Icon und ein kurzer Untertitel („CREATE YOUR LOOK“).

### 4.2 Bild1

- Upload-Feld mit der sichtbaren Bezeichnung **Bild1** (z. B. „Person“).
- Dateiauswahl über Browser-Dateidialog.
- Unterstützt JPEG (`image/jpeg`) und WebP (`image/webp`).
- Sofortige Bildvorschau, Austausch und Entfernen der Datei.

### 4.3 Bild2

- Upload-Feld mit der sichtbaren Bezeichnung **Bild2** (z. B. „Kleidungsstück“).
- Gleiche Funktionen und Dateiformate wie Bild1.

### 4.4 Generierungsbutton

- Beschriftung: **GENERATE IMAGE** / „Bild generieren“.
- Nur aktiv, wenn beide gültigen Dateien vorhanden sind und keine Anfrage läuft.
- Während der Anfrage deaktiviert, mit dezenter Ladeanimation und Text „Creating your image…“.

### 4.5 Ergebnisbereich

- Großflächige Vorschau des von n8n zurückgegebenen Bildes.
- Vor Generierung neutraler Platzhalter.
- Nach erfolgreicher Generierung Bild ansehen und über Download-Button speichern.
- Neue Generierung mit denselben oder ausgetauschten Bildern möglich.
- Altes Ergebnis beim Start einer neuen Generierung als veraltet kennzeichnen oder ausblenden.

## 5. Benutzerablauf

1. Nutzer öffnet die Web-App im Browser.
2. Nutzer lädt **Bild1** und **Bild2** hoch.
3. Beide Bilder werden als Vorschau dargestellt.
4. Nutzer klickt auf **GENERATE IMAGE**.
5. App sendet beide Dateien als `multipart/form-data` über HTTP POST an n8n.
6. App zeigt den Verarbeitungszustand und verhindert doppelte Anfragen.
7. n8n verarbeitet die Bilder und gibt eine Bilddatei als HTTP-Antwort zurück.
8. App validiert die Antwort, zeigt das Ergebnis und ermöglicht den Download.

## 6. Technische Architektur

| Komponente | Vorgabe |
|---|---|
| Anwendung | Responsive Browser-Web-App |
| Framework | React + TypeScript |
| Build-Tool | Vite |
| Styling | Tailwind CSS |
| Dateiauswahl | Native HTML File Inputs |
| HTTP-Client | Browser Fetch API |
| Workflow | n8n |
| Datenspeicherung | Keine persistente Speicherung im MVP |
| Lokaler Start | `npm install`, `npm run dev` |

### 6.1 n8n-Endpunkt

**Methode:** `POST`  
**URL (Test):**

```text
https://britta-ai.app.n8n.cloud/webhook-test/7c23bad7-e1fc-46b6-8ef3-0b15592524a9
```

Webhook-URL als Umgebungsvariable in `.env.local` konfigurieren:

```dotenv
VITE_N8N_WEBHOOK_URL=https://britta-ai.app.n8n.cloud/webhook-test/7c23bad7-e1fc-46b6-8ef3-0b15592524a9
```

Eine `.env.example` mit einem Platzhalter beilegen. Vite-Variablen mit Präfix `VITE_` sind im Browser sichtbar und dürfen keine Geheimnisse enthalten. Die Test-URL `/webhook-test/` funktioniert nur während eines aktiven n8n-Testlaufs. Für Produktion den aktiven Produktionswebhook konfigurieren und absichern.

### 6.2 Request-Vertrag

- HTTP-Methode: `POST`
- Body: `FormData` / `multipart/form-data`
- **Exakte Feldnamen:** `Bild1`, `Bild2` (Groß-/Kleinschreibung beachten)
- Pro Feld eine echte Binärdatei als File-Teil; kein JSON, keine Base64-Kodierung.
- MIME-Typen: `image/jpeg`, `image/webp`.
- Den `Content-Type`-Header nicht manuell setzen; der Browser ergänzt den Boundary-Parameter.

```typescript
async function generateImage(bild1: File, bild2: File): Promise<Blob> {
  const url = import.meta.env.VITE_N8N_WEBHOOK_URL;
  if (!url) throw new Error('Webhook-URL ist nicht konfiguriert.');

  const body = new FormData();
  body.append('Bild1', bild1, bild1.name);
  body.append('Bild2', bild2, bild2.name);

  const response = await fetch(url, { method: 'POST', body });
  if (!response.ok) {
    throw new Error(`Bildgenerierung fehlgeschlagen (HTTP ${response.status}).`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!/^image\/(jpeg|webp)(;|$)/i.test(contentType)) {
    throw new Error('n8n hat keine unterstützte Bilddatei zurückgegeben.');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('n8n hat eine leere Bilddatei zurückgegeben.');
  return blob;
}
```

### 6.3 Response-Vertrag

**Annahme für MVP:** n8n antwortet synchron mit einer Bild-Binärdatei und passendem `Content-Type` (`image/jpeg` oder `image/webp`). Der Workflow muss dies beispielsweise über **Respond to Webhook** sicherstellen. JSON-Antworten, asynchrone Job-IDs und URL-Antworten sind nicht Teil des MVP.

Die App erstellt aus dem empfangenen Blob eine lokale Object-URL zur Anzeige und zum Download. Nicht mehr verwendete Object-URLs müssen freigegeben werden (`URL.revokeObjectURL`).

### 6.4 n8n und Browser-Anforderungen

- n8n muss POST-Anfragen mit beiden Multipart-Dateifeldern entgegennehmen.
- n8n muss das generierte Bild als Binärantwort zurückgeben.
- Bei direktem Browserzugriff muss der Webhook die erforderlichen CORS-Header für die Origin der Web-App liefern; das ist vor der Implementierung zu testen.
- Wenn CORS oder Zugangsschutz dies erfordert, ist ein kleiner serverseitiger Proxy vorzusehen. Keine vertraulichen Tokens im React-Frontend hinterlegen.
- Bildverarbeitung kann länger dauern: n8n-/Proxy-/Hosting-Timeouts müssen aufeinander abgestimmt werden. Bei zu langer Laufzeit später asynchrones Jobmodell erwägen.

## 7. Validierung und Fehlerbehandlung

| Situation | Erwartetes Verhalten |
|---|---|
| Kein oder nur ein Bild | Button deaktiviert |
| Beide gültigen Bilder | Button aktiviert |
| Falscher MIME-Typ | Verständlicher Hinweis, Datei nicht übernehmen |
| Leere Datei | Datei ablehnen |
| Datei zu groß | Verständlicher Hinweis; Größenlimit nach n8n-/Hosting-Limits festlegen |
| POST läuft | Ladezustand, keine doppelten Requests |
| Netzwerk-/CORS-Fehler | Fehlermeldung und erneuter Versuch möglich |
| HTTP-Fehler | Statusgerechte Fehlermeldung |
| Antwort ist JSON/HTML/leer | Als ungültige Bildantwort behandeln |
| Erfolgreiche Bildantwort | Ergebnis anzeigen, Download anbieten |

Die gewählten Quelldateien bleiben nach einem Fehler erhalten. Fehlermeldungen sollen keine internen Zugangsdaten oder unnötigen technischen Details offenlegen.

## 8. Datenschutz und Sicherheit

- Hinweis vor dem Upload: Fotos werden zur Verarbeitung an einen externen Dienst übermittelt.
- Übertragung nur über HTTPS.
- Keine dauerhafte Speicherung der Quelldateien in der Web-App vorgesehen.
- Keine API-Schlüssel oder geheimen Zugangsdaten im Frontend.
- Für öffentliche Nutzung: abgesicherter Produktionsendpunkt, Rate-Limits, Größenlimits, Datenschutzerklärung und Lösch-/Aufbewahrungsregeln im n8n-Workflow sowie bei etwaigen KI-Diensten prüfen.
- Keine Annahme treffen, dass Bilder im n8n-Workflow automatisch gelöscht werden: tatsächliche Workflow- und Dienstkonfiguration prüfen.

## 9. MVP-Abnahmekriterien

- [ ] App startet lokal mit `npm run dev`.
- [ ] Layout funktioniert auf Smartphone und Desktop.
- [ ] Design folgt der bereitgestellten Fashion-Screenshot-Referenz.
- [ ] Zwei separate Dateifelder sind sichtbar und korrekt beschriftet.
- [ ] JPEG/WebP-Dateien können ausgewählt, angezeigt und ersetzt werden.
- [ ] Ohne zwei gültige Bilder ist der Generierungsbutton deaktiviert.
- [ ] POST enthält exakt zwei Multipart-Dateifelder namens `Bild1` und `Bild2`.
- [ ] Webhook-URL ist über `VITE_N8N_WEBHOOK_URL` konfigurierbar.
- [ ] Ladeindikator erscheint; Mehrfachklick löst keine zweite Anfrage aus.
- [ ] Erfolgreiche JPEG-/WebP-Binärantwort wird korrekt dargestellt.
- [ ] Ergebnis lässt sich herunterladen.
- [ ] Fehlerfälle führen zu verständlichen Hinweisen, ohne die App abstürzen zu lassen.
- [ ] Eine weitere Generierung ist ohne Neuladen möglich.

## 10. Nicht Bestandteil der ersten Version

- Login und Benutzerverwaltung
- Datenbank, Cloud-Galerie und Bildhistorie
- Zahlungen und Abonnements
- Eigene KI-Bildgenerierung im Browser
- Native iOS-/Android-App
- Mehr als zwei Eingabebilder
- Asynchrone Jobverwaltung mit Polling

## 11. Offene Punkte

1. Maximale Uploadgröße je Datei anhand n8n-/Hosting-Limits festlegen.
2. Tatsächlichen Response-MIME-Typ des n8n-Workflows testen.
3. CORS-Unterstützung der geplanten Hosting-Domain prüfen.
4. Produktionswebhook, Zugriffsschutz und Rate-Limits vor öffentlichem Launch festlegen.
5. Endgültigen App-Namen und Hosting-Anbieter bestimmen.

## 12. Entwicklungsanweisung für Claude Code / Cursor

Implementiere dieses PRD als funktionsfähige, responsive React-/TypeScript-/Vite-Web-App mit Tailwind CSS. Nutze den vom Auftraggeber gelieferten Screenshot als visuelle Designreferenz. Priorisiere die exakte `Bild1`/`Bild2`-Multipart-POST-Anbindung an n8n, die sichere Validierung der Binärantwort und eine elegante Ergebnisanzeige. Verwende klare Komponenten, einen separaten API-Service, verständliche Fehlerzustände und eine `.env.example`. Stelle sicher, dass `npm run dev` funktioniert. Keine Mock-Bildgenerierung als Ersatz für den echten Webhook implementieren; falls der Testwebhook inaktiv ist, eine ehrliche Fehlermeldung anzeigen.
