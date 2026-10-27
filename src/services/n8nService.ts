import { GENERATE_ENDPOINT, REQUEST_TIMEOUT_MS, type SupportedMimeType } from '../config';
import { detectImageType } from '../utils/validateImage';
import { getAccessToken } from './authService';

/** Fehler mit einer Nachricht, die direkt in der Oberfläche angezeigt werden kann. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

export interface GeneratedImage {
  blob: Blob;
  mimeType: SupportedMimeType;
}

/** Ersatztexte, falls die Serverfunktion selbst nicht antwortet (z. B. Plattform-Fehler von Vercel). */
function messageForStatus(status: number): string {
  if (status === 401) return 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.';
  if (status === 402) return 'Für die Bildgenerierung brauchst du ein aktives Abo.';
  if (status === 404) return 'Die Serverfunktion wurde nicht gefunden (HTTP 404).';
  if (status === 413) return 'Die Bilder sind zusammen zu groß (HTTP 413). Bitte kleinere Dateien verwenden.';
  if (status === 429) return 'Zu viele Anfragen (HTTP 429). Bitte einen Moment warten und erneut versuchen.';
  if (status === 504) return 'Die Generierung hat zu lange gedauert (HTTP 504). Bitte erneut versuchen.';
  if (status >= 500) return `Auf dem Server ist ein Fehler aufgetreten (HTTP ${status}). Bitte später erneut versuchen.`;
  return `Die Bildgenerierung ist fehlgeschlagen (HTTP ${status}).`;
}

/** Die Serverfunktion liefert Fehler als JSON { error } mit fertiger Nachricht. */
async function readErrorMessage(response: Response): Promise<string> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      const data: unknown = await response.json();
      if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) {
        return data.error;
      }
    } catch {
      // Ungültiges JSON – auf den Standardtext zurückfallen.
    }
  }
  return messageForStatus(response.status);
}

/** Macht aus dem Retry-After-Header (Sekunden) einen Hinweis wie „in etwa 3 Minuten“. */
function waitHint(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const wait =
    seconds < 90
      ? `${Math.ceil(seconds)} Sekunden`
      : seconds < 90 * 60
        ? `${Math.ceil(seconds / 60)} Minuten`
        : seconds < 36 * 3600
          ? `${Math.ceil(seconds / 3600)} Stunden`
          : `${Math.ceil(seconds / 86400)} Tagen`;
  return ` Nächster Versuch in etwa ${wait} möglich.`;
}

function parseImageContentType(header: string | null): SupportedMimeType | null {
  const match = /^image\/(jpeg|jpg|webp)\s*(;|$)/i.exec(header?.trim() ?? '');
  if (!match) return null;
  return match[1].toLowerCase() === 'webp' ? 'image/webp' : 'image/jpeg';
}

/**
 * Sendet Bild1 und Bild2 als multipart/form-data an die eigene Serverfunktion,
 * die sie an den n8n-Webhook weiterleitet, und liefert das generierte Bild als Blob zurück.
 */
export async function generateImage(bild1: File, bild2: File, signal?: AbortSignal): Promise<GeneratedImage> {
  signal?.throwIfAborted();
  const token = await getAccessToken();
  signal?.throwIfAborted();
  if (!token) {
    throw new GenerationError('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
  }

  const body = new FormData();
  body.append('Bild1', bild1, bild1.name);
  body.append('Bild2', bild2, bild2.name);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) controller.abort();

  const failureFor = (fallback: string) => {
    if (timedOut) {
      return new GenerationError(
        `Die Generierung hat zu lange gedauert (über ${Math.round(REQUEST_TIMEOUT_MS / 60_000)} Minuten). Bitte erneut versuchen.`,
      );
    }
    if (signal?.aborted) return new GenerationError('Die Anfrage wurde abgebrochen.');
    return new GenerationError(fallback);
  };

  try {
    let response: Response;
    try {
      // Content-Type wird bewusst nicht gesetzt – der Browser ergänzt die Multipart-Boundary.
      response = await fetch(GENERATE_ENDPOINT, {
        method: 'POST',
        body,
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch {
      throw failureFor('Der Server ist nicht erreichbar. Bitte die Internetverbindung prüfen und erneut versuchen.');
    }

    if (!response.ok) {
      const message = await readErrorMessage(response);
      const hint = response.status === 429 ? waitHint(response.headers.get('retry-after')) : '';
      throw new GenerationError(message + hint);
    }

    const contentType = response.headers.get('content-type');
    const mimeType = parseImageContentType(contentType);
    if (!mimeType) {
      const received = contentType?.split(';')[0].trim() || 'unbekannt';
      throw new GenerationError(
        `Der Server hat keine unterstützte Bilddatei geliefert (erhalten: ${received}). Erwartet wird ein JPEG- oder WebP-Bild.`,
      );
    }

    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      throw failureFor('Die Bildantwort konnte nicht vollständig empfangen werden. Bitte erneut versuchen.');
    }

    if (blob.size === 0) {
      throw new GenerationError('Der Server hat eine leere Bilddatei geliefert.');
    }
    if ((await detectImageType(blob)) !== mimeType) {
      throw new GenerationError('Die Bildantwort ist keine gültige JPEG- oder WebP-Datei.');
    }

    return { blob: blob.type === mimeType ? blob : new Blob([blob], { type: mimeType }), mimeType };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
