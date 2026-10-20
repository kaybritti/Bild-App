import { useEffect, useRef, useState } from 'react';
import { TURNSTILE_SITE_KEY } from '../config';
import { ErrorMessage } from './ErrorMessage';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loader: Promise<Turnstile> | null = null;

/** Lädt das Turnstile-Skript einmalig; nach einem Fehler wird beim nächsten Mal neu geladen. */
function loadTurnstile(): Promise<Turnstile> {
  loader ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')));
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.append(script);
  }).catch((error: unknown) => {
    loader = null;
    throw error;
  });
  return loader;
}

interface CaptchaProps {
  /** Erhält das Token, sobald die Prüfung bestanden ist, und null, wenn es abläuft. */
  onToken: (token: string | null) => void;
}

/**
 * Cloudflare Turnstile. Ein Token gilt für genau eine Anfrage – nach jedem Absenden
 * muss die Komponente neu gemountet werden (z. B. über einen wechselnden key).
 */
export function Captcha({ onToken }: CaptchaProps) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | undefined;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return;
        widgetId = turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          language: 'de',
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      onToken(null);
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [onToken]);

  if (failed) {
    return (
      <ErrorMessage>Die Sicherheitsprüfung konnte nicht geladen werden. Bitte die Seite neu laden.</ErrorMessage>
    );
  }
  return <div ref={container} className="min-h-[65px]" />;
}
