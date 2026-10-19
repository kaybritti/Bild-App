import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB, type SupportedMimeType } from '../config';
import { formatFileSize } from './format';

export type ValidationResult = { ok: true; file: File } | { ok: false; error: string };

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** Erkennt JPEG/WebP anhand der Datei-Signatur (Magic Bytes) statt nur anhand der Endung. */
export async function detectImageType(blob: Blob): Promise<SupportedMimeType | null> {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function isAcceptedMimeType(type: string): type is SupportedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(type);
}

export async function validateImageFile(file: File): Promise<ValidationResult> {
  // Manche Systeme liefern keinen MIME-Typ – dann entscheidet die Signaturprüfung.
  if (file.type && !isAcceptedMimeType(file.type)) {
    return { ok: false, error: 'Dieses Format wird nicht unterstützt. Bitte ein JPEG- oder WebP-Bild wählen.' };
  }
  if (file.size === 0) {
    return { ok: false, error: 'Die Datei ist leer. Bitte ein anderes Bild wählen.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `Die Datei ist zu groß (${formatFileSize(file.size)}). Erlaubt sind maximal ${MAX_FILE_SIZE_MB} MB.`,
    };
  }

  let detected: SupportedMimeType | null;
  try {
    detected = await detectImageType(file);
  } catch {
    return { ok: false, error: 'Die Datei konnte nicht gelesen werden. Bitte erneut versuchen.' };
  }
  if (!detected) {
    return { ok: false, error: 'Die Datei ist kein gültiges JPEG- oder WebP-Bild oder sie ist beschädigt.' };
  }

  // Sicherstellen, dass der Multipart-Teil den korrekten Content-Type trägt.
  const normalized =
    file.type === detected ? file : new File([file], file.name, { type: detected, lastModified: file.lastModified });
  return { ok: true, file: normalized };
}
