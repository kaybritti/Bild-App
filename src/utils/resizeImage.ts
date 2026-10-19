import { UPLOAD_MAX_EDGE_PX, UPLOAD_TARGET_BYTES } from '../config';

/** Abstufungen, bis das Bild klein genug ist: erst Qualität senken, dann die Kantenlänge. */
const ATTEMPTS: { edge: number; quality: number }[] = [
  { edge: UPLOAD_MAX_EDGE_PX, quality: 0.9 },
  { edge: UPLOAD_MAX_EDGE_PX, quality: 0.8 },
  { edge: 1600, quality: 0.8 },
  { edge: 1280, quality: 0.75 },
];

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
  });
}

/**
 * Verkleinert Fotos über UPLOAD_TARGET_BYTES, damit beide Bilder zusammen unter das
 * Vercel-Limit von 4,5 MB passen. Kleinere Dateien werden unverändert zurückgegeben.
 * Wirft einen Fehler, wenn der Browser das Bild nicht dekodieren kann.
 */
export async function prepareForUpload(file: File): Promise<File> {
  if (file.size <= UPLOAD_TARGET_BYTES) return file;

  // imageOrientation: 'from-image' übernimmt die EXIF-Drehung von Handyfotos.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');

    let blob: Blob | null = null;
    for (const { edge, quality } of ATTEMPTS) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        // JPEG kennt keine Transparenz – sonst würden transparente WebP-Bereiche schwarz.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
      }
      blob = await toJpegBlob(canvas, quality);
      if (blob.size <= UPLOAD_TARGET_BYTES) break;
    }
    if (!blob || blob.size > UPLOAD_TARGET_BYTES) throw new Error('Image could not be reduced enough');

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'bild';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
