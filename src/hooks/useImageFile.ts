import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectedImage } from '../types';
import { prepareForUpload } from '../utils/resizeImage';
import { validateImageFile } from '../utils/validateImage';

/** Verwaltet eine ausgewählte Bilddatei inklusive Validierung, Verkleinerung und Vorschau-URL. */
export function useImageFile() {
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  // Verhindert, dass eine langsamere, ältere Auswahl eine neuere überschreibt.
  const selectionId = useRef(0);

  useEffect(() => () => { selectionId.current++; }, []);

  useEffect(() => {
    if (!image) return;
    return () => URL.revokeObjectURL(image.previewUrl);
  }, [image]);

  const select = useCallback(async (file: File) => {
    const id = ++selectionId.current;
    setProcessing(true);
    try {
      const result = await validateImageFile(file);
      if (id !== selectionId.current) return;
      if (!result.ok) {
        // Ungültige Datei wird nicht übernommen, ein bereits gewähltes Bild bleibt erhalten.
        setError(result.error);
        return;
      }

      let upload: File;
      try {
        upload = await prepareForUpload(result.file);
      } catch {
        if (id === selectionId.current) {
          setError('Das Bild konnte nicht verarbeitet werden. Bitte eine andere Datei wählen.');
        }
        return;
      }
      if (id !== selectionId.current) return;

      setError(null);
      setImage({ file: upload, previewUrl: URL.createObjectURL(upload) });
    } finally {
      if (id === selectionId.current) setProcessing(false);
    }
  }, []);

  const remove = useCallback(() => {
    selectionId.current++;
    setImage(null);
    setError(null);
    setProcessing(false);
  }, []);

  /** Für Bilder, die zwar die Prüfung bestehen, aber vom Browser nicht dargestellt werden können. */
  const reject = useCallback((message: string) => {
    selectionId.current++;
    setImage(null);
    setError(message);
    setProcessing(false);
  }, []);

  return { image, error, processing, select, remove, reject };
}
