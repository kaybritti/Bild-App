/**
 * Serverfunktion (api/generate.ts), die Login prüft und die Bilder an n8n weiterleitet.
 * Webhook-URL und Zugangsdaten kennt nur der Server.
 */
export const GENERATE_ENDPOINT = '/api/generate';

/** Supabase (Login). Beide Werte sind öffentlich und landen im Browser-Bundle. */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
export const IS_SUPABASE_CONFIGURED = SUPABASE_URL !== '' && SUPABASE_PUBLISHABLE_KEY !== '';

/**
 * Cloudflare Turnstile (Schutz vor Bot-Registrierungen). Der Site Key ist öffentlich.
 * Leer = kein CAPTCHA. Erst setzen, dann in Supabase „Bot and Abuse Protection“ aktivieren.
 */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? '';
export const IS_CAPTCHA_ENABLED = TURNSTILE_SITE_KEY !== '';

/** Muss zu „Minimum password length“ in Supabase (Authentication → Providers → Email) passen. */
export const MIN_PASSWORD_LENGTH = 8;

export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/webp'] as const;
export type SupportedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

/** Wert für das accept-Attribut der Datei-Inputs (Endungen helfen Browsern ohne MIME-Erkennung). */
export const FILE_INPUT_ACCEPT = 'image/jpeg,image/webp,.jpg,.jpeg,.webp';

/** Größte Datei, die angenommen wird (größere Fotos werden vor dem Senden ohnehin verkleinert). */
export const MAX_FILE_SIZE_MB = 25;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Vercel-Funktionen nehmen pro Anfrage höchstens 4,5 MB an. Beide Bilder reisen in einer Anfrage,
 * daher wird jedes Bild im Browser neu kodiert (max. 2 MiB, lange Seite max. 2048 px, JPEG).
 */
export const UPLOAD_TARGET_BYTES = 2 * 1024 * 1024;
export const UPLOAD_MAX_EDGE_PX = 2048;

/** KI-Bildgenerierung kann dauern – danach wird die Anfrage abgebrochen. */
export const REQUEST_TIMEOUT_MS = 180_000;
