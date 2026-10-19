const CONFIGURED_WEBHOOK_URL = import.meta.env.VITE_N8N_WEBHOOK_URL?.trim() ?? '';

/** Pfad des Dev-Proxys aus vite.config.ts (muss dort mit DEV_PROXY_PATH übereinstimmen). */
const DEV_PROXY_PATH = '/n8n-webhook';

/**
 * Im Dev-Server geht die Anfrage über den Vite-Proxy (keine CORS-Sperre),
 * im Produktions-Build direkt an n8n.
 */
export const WEBHOOK_URL =
  import.meta.env.DEV && CONFIGURED_WEBHOOK_URL ? DEV_PROXY_PATH : CONFIGURED_WEBHOOK_URL;

/** n8n-Test-Webhooks sind nur erreichbar, solange im Editor ein Testlauf aktiv ist. */
export const IS_TEST_WEBHOOK = CONFIGURED_WEBHOOK_URL.includes('/webhook-test/');

/** Supabase (Login). Beide Werte sind öffentlich und landen im Browser-Bundle. */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
export const IS_SUPABASE_CONFIGURED = SUPABASE_URL !== '' && SUPABASE_PUBLISHABLE_KEY !== '';

/** Supabase verlangt standardmäßig mindestens 6 Zeichen. */
export const MIN_PASSWORD_LENGTH = 6;

export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/webp'] as const;
export type SupportedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

/** Wert für das accept-Attribut der Datei-Inputs (Endungen helfen Browsern ohne MIME-Erkennung). */
export const FILE_INPUT_ACCEPT = 'image/jpeg,image/webp,.jpg,.jpeg,.webp';

/**
 * n8n begrenzt die Request-Größe standardmäßig auf ca. 16 MB.
 * Beide Bilder werden in einem Request gesendet, daher max. 8 MB pro Datei.
 */
export const MAX_FILE_SIZE_MB = 8;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** KI-Bildgenerierung kann dauern – danach wird die Anfrage abgebrochen. */
export const REQUEST_TIMEOUT_MS = 180_000;
