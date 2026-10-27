import { BILLING_ENDPOINT } from '../config';
import { getAccessToken } from './authService';

/** Fehler mit einer Nachricht, die direkt in der Oberfläche angezeigt werden kann. */
export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

/** Stripe-Abostatus (null = noch nie abonniert). */
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export interface BillingStatus {
  status: SubscriptionStatus | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  allowance: number;
  used: number;
  trialAvailable: boolean;
  canManage: boolean;
}

/** Nur mit diesen Status startet der Server eine Generierung. */
export function isEntitled(billing: BillingStatus): boolean {
  return (
    (billing.status === 'active' || billing.status === 'trialing') &&
    billing.periodEnd !== null &&
    billing.periodEnd.getTime() > Date.now()
  );
}

async function call(init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const token = await getAccessToken();
  if (!token) throw new BillingError('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
  let response: Response;
  try {
    response = await fetch(BILLING_ENDPOINT, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal,
    });
  } catch {
    if (signal?.aborted) throw new BillingError('Die Anfrage wurde abgebrochen.');
    throw new BillingError('Der Server ist nicht erreichbar. Bitte die Internetverbindung prüfen.');
  }
  let data: unknown = null;
  if (response.headers.get('content-type')?.includes('application/json')) {
    data = await response.json().catch(() => null);
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error
        ? data.error
        : `Die Abo-Daten konnten nicht geladen werden (HTTP ${response.status}).`;
    throw new BillingError(message);
  }
  return data;
}

export async function fetchBillingStatus(signal?: AbortSignal): Promise<BillingStatus> {
  const data = (await call({ method: 'GET' }, signal)) as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') throw new BillingError('Die Abo-Daten sind ungültig.');
  const periodEnd = typeof data.periodEnd === 'string' ? new Date(data.periodEnd) : null;
  return {
    status: typeof data.status === 'string' ? (data.status as SubscriptionStatus) : null,
    periodEnd: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : null,
    cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
    allowance: typeof data.allowance === 'number' ? data.allowance : 0,
    used: typeof data.used === 'number' ? data.used : 0,
    trialAvailable: data.trialAvailable === true,
    canManage: data.canManage === true,
  };
}

/** Holt eine Stripe-URL (Checkout oder Kundenportal) und leitet dorthin weiter. */
async function redirectTo(action: 'checkout' | 'portal'): Promise<void> {
  const data = await call({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const url = data && typeof data === 'object' && 'url' in data && typeof data.url === 'string' ? data.url : '';
  // Nur zu Stripe weiterleiten – nie zu einer beliebigen Adresse aus der Antwort.
  if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(url)) {
    throw new BillingError('Der Zahlungsdienst hat keine gültige Adresse geliefert.');
  }
  window.location.assign(url);
}

export const startCheckout = () => redirectTo('checkout');
export const openBillingPortal = () => redirectTo('portal');
