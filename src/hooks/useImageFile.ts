import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectedImage } from '../types';
import { validateImageFile } from '../utils/validateImage';

/** Verwaltet eine ausgewählte Bilddatei inklusive Validierung und Vorschau-URL. */
export function useImageFile() {
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Verhindert, dass eine langsamere, ältere Validierung eine neuere Auswahl überschreibt.
  const selectionId = useRef(0);

  useEffect(() => {
    if (!image) return;
    return () => URL.revokeObjectURL(image.previewUrl);
  }, [image]);

  const select = useCallback(async (file: File) => {
    const id = ++selectionId.current;
    const result = await validateImageFile(file);
    if (id !== selectionId.current) return;

    if (!result.ok) {
      // Ungültige Datei wird nicht übernommen, ein bereits gewähltes Bild bleibt erhalten.
      setError(result.error);
      return;
    }
    setError(null);
    setImage({ file: result.file, previewUrl: URL.createObjectURL(result.file) });
  }, []);

  const remove = useCallback(() => {
    selectionId.current++;
    setImage(null);
    setError(null);
  }, []);

  /** Für Bilder, die zwar die Prüfung bestehen, aber vom Browser nicht dargestellt werden können. */
  const reject = useCallback((message: string) => {
    selectionId.current++;
    setImage(null);
    setError(message);
  }, []);

  return { image, error, select, remove, reject };
}
