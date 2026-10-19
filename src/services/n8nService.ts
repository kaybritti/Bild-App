import { IS_TEST_WEBHOOK, REQUEST_TIMEOUT_MS, WEBHOOK_URL, type SupportedMimeType } from '../config';
import { detectImageType } from '../utils/validateImage';

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

const WEBHOOK_HINT = IS_TEST_WEBHOOK
  ? 'Beim Test-Webhook muss in n8n zuerst „Listen for test event“ bzw. „Execute workflow“ geklickt werden.'
  : 'Bitte prüfen, ob der Workflow in n8n aktiviert ist.';

function messageForStatus(status: number): string {
  if (status === 404) {
    return `Der n8n-Webhook ist nicht registriert oder nicht aktiv (HTTP 404). ${WEBHOOK_HINT}`;
  }
  if (status === 401 || status === 403) {
    return `Der Zugriff auf den Webhook wurde verweigert (HTTP ${status}).`;
  }
  if (status === 413) {
    return 'Die Bilder sind zu groß für den Webhook (HTTP 413). Bitte kleinere Dateien verwenden.';
  }
  if (status === 429) {
    return 'Zu viele Anfragen (HTTP 429). Bitte einen Moment warten und erneut versuchen.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return `Der Dienst ist gerade nicht verfügbar oder hat zu lange gebraucht (HTTP ${status}). Bitte später erneut versuchen.`;
  }
  if (status >= 500) {
    return `Im n8n-Workflow ist ein Fehler aufgetreten (HTTP ${status}). Bitte später erneut versuchen.`;
  }
  if (status >= 400) {
    return `Der Workflow konnte die Bilder nicht verarbeiten (HTTP ${status}).`;
  }
  return `Die Bildgenerierung ist fehlgeschlagen (HTTP ${status}).`;
}

function parseImageContentType(header: string | null): SupportedMimeType | null {
  const match = /^image\/(jpeg|jpg|webp)\s*(;|$)/i.exec(header?.trim() ?? '');
  if (!match) return null;
  return match[1].toLowerCase() === 'webp' ? 'image/webp' : 'image/jpeg';
}

/**
 * Sendet Bild1 und Bild2 als multipart/form-data an den n8n-Webhook
 * und liefert das generierte Bild als Blob zurück.
 */
export async function generateImage(bild1: File, bild2: File, signal?: AbortSignal): Promise<GeneratedImage> {
  if (!WEBHOOK_URL) {
    throw new GenerationError(
      'Die Webhook-URL ist nicht konfiguriert. Bitte VITE_N8N_WEBHOOK_URL in der .env-Datei setzen und die App neu starten.',
    );
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
      response = await fetch(WEBHOOK_URL, { method: 'POST', body, signal: controller.signal });
    } catch {
      throw failureFor(
        `Der n8n-Webhook ist nicht erreichbar. Bitte die Internetverbindung prüfen. ${WEBHOOK_HINT} ` +
          'Eine weitere mögliche Ursache ist eine fehlende CORS-Freigabe im Webhook.',
      );
    }

    if (!response.ok) {
      throw new GenerationError(messageForStatus(response.status));
    }

    const contentType = response.headers.get('content-type');
    const mimeType = parseImageContentType(contentType);
    if (!mimeType) {
      const received = contentType?.split(';')[0].trim() || 'unbekannt';
      throw new GenerationError(
        `n8n hat keine unterstützte Bilddatei zurückgegeben (erhalten: ${received}). Erwartet wird ein JPEG- oder WebP-Bild.`,
      );
    }

    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      throw failureFor('Die Bildantwort konnte nicht vollständig empfangen werden. Bitte erneut versuchen.');
    }

    if (blob.size === 0) {
      throw new GenerationError('n8n hat eine leere Bilddatei zurückgegeben.');
    }
    if ((await detectImageType(blob)) === null) {
      throw new GenerationError('Die Antwort von n8n ist keine gültige JPEG- oder WebP-Datei.');
    }

    return { blob: blob.type === mimeType ? blob : new Blob([blob], { type: mimeType }), mimeType };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
