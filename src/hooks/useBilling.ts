import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BillingError,
  type BillingStatus,
  fetchBillingStatus,
  isEntitled,
  openBillingPortal,
  startCheckout,
} from '../services/billingService';

export type BillingState =
  | { status: 'loading' }
  | { status: 'ready'; billing: BillingStatus }
  | { status: 'error'; message: string };

/** Nach dem Checkout kommt der Stripe-Webhook meist nach wenigen Sekunden an. */
const CONFIRM_ATTEMPTS = 8;
const CONFIRM_INTERVAL_MS = 2_000;

const messageOf = (error: unknown) =>
  error instanceof BillingError ? error.message : 'Die Abo-Daten sind gerade nicht verfügbar.';

/** Liest „?checkout=success|cancel“ nach der Rückkehr von Stripe einmalig aus und entfernt es aus der URL. */
function takeCheckoutResult(): string | null {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('checkout');
  if (result === null) return null;
  url.searchParams.delete('checkout');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return result;
}

// Beim Laden des Moduls lesen: React StrictMode führt Effekte doppelt aus, die URL wird aber sofort bereinigt.
const returnedFromCheckout = takeCheckoutResult() === 'success';

/** Abo-Status laden, nach dem Checkout auf die Bestätigung warten und zu Stripe weiterleiten. */
export function useBilling() {
  const [state, setState] = useState<BillingState>({ status: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (confirmCheckout: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setConfirming(confirmCheckout);
    try {
      for (let attempt = 1; ; attempt++) {
        const billing = await fetchBillingStatus(controller.signal);
        if (controller.signal.aborted) return;
        setState({ status: 'ready', billing });
        if (!confirmCheckout || isEntitled(billing) || attempt >= CONFIRM_ATTEMPTS) break;
        await new Promise(resolve => setTimeout(resolve, CONFIRM_INTERVAL_MS));
        if (controller.signal.aborted) return;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setState(previous => (previous.status === 'ready' ? previous : { status: 'error', message: messageOf(error) }));
    }
    setConfirming(false);
  }, []);

  useEffect(() => {
    void load(returnedFromCheckout);
    return () => controllerRef.current?.abort();
  }, [load]);

  // „Zurück“ aus Stripe stellt die Seite ggf. aus dem Back-Forward-Cache wieder her.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const refresh = useCallback(() => void load(false), [load]);

  const redirect = useCallback(async (action: () => Promise<void>) => {
    setActionError(null);
    setRedirecting(true);
    try {
      await action();
      // Die Seite wird verlassen; der Knopf bleibt bis dahin gesperrt.
    } catch (error) {
      setActionError(messageOf(error));
      setRedirecting(false);
    }
  }, []);

  return {
    state,
    confirming,
    redirecting,
    actionError,
    refresh,
    checkout: () => void redirect(startCheckout),
    manage: () => void redirect(openBillingPortal),
  };
}
