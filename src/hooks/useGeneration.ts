import { useCallback, useEffect, useRef, useState } from 'react';
import { GenerationError, generateImage } from '../services/n8nService';
import type { GenerationState } from '../types';

/** Steuert den Ablauf einer Bildgenerierung und verhindert doppelte Anfragen. */
export function useGeneration() {
  const [state, setState] = useState<GenerationState>({ status: 'idle' });
  // Ref statt State: greift sofort, auch bei sehr schnellen Doppelklicks.
  const inFlight = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const resultUrl = state.status === 'success' ? state.result.url : null;
  useEffect(() => {
    if (!resultUrl) return;
    return () => URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const generate = useCallback(async (bild1: File, bild2: File) => {
    if (inFlight.current) return;
    inFlight.current = true;

    const controller = new AbortController();
    controllerRef.current = controller;
    // Ein altes Ergebnis wird beim Start ausgeblendet (und dadurch freigegeben).
    setState({ status: 'loading' });

    try {
      const { blob, mimeType } = await generateImage(bild1, bild2, controller.signal);
      if (controller.signal.aborted) return;
      setState({
        status: 'success',
        result: { url: URL.createObjectURL(blob), mimeType, createdAt: new Date() },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: 'error',
        message:
          error instanceof GenerationError
            ? error.message
            : 'Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.',
      });
    } finally {
      inFlight.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({ status: 'idle' });
  }, []);

  return { state, generate, reset };
}
