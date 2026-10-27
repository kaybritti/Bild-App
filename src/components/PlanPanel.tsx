import { CreditCard, Loader2 } from 'lucide-react';
import { PLAN_MONTHLY_IMAGES, PLAN_PRICE_LABEL, PLAN_TRIAL_DAYS } from '../config';
import type { BillingState } from '../hooks/useBilling';
import { isEntitled } from '../services/billingService';
import { formatDate } from '../utils/format';
import { ErrorMessage } from './ErrorMessage';

interface PlanPanelProps {
  state: BillingState;
  confirming: boolean;
  redirecting: boolean;
  actionError: string | null;
  onCheckout: () => void;
  onManage: () => void;
  onRetry: () => void;
}

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]';
const PRIMARY =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2.5 bg-ink px-6 text-[11px] font-medium uppercase tracking-[0.24em] text-paper transition-colors hover:bg-black disabled:cursor-wait disabled:opacity-60';
const SECONDARY =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2.5 px-6 text-[11px] font-medium uppercase tracking-[0.24em] outline outline-ink transition-colors -outline-offset-1 hover:bg-ink hover:text-paper disabled:cursor-wait disabled:opacity-60';

/** Abo-Status über dem Upload: Testphase/Kontingent anzeigen, Checkout oder Kundenportal öffnen. */
export function PlanPanel({ state, confirming, redirecting, actionError, onCheckout, onManage, onRetry }: PlanPanelProps) {
  if (state.status === 'loading') {
    return (
      <p role="status" className={`flex items-center gap-3 ${LABEL}`}>
        <Loader2 className="size-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
        Abo wird geladen
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <ErrorMessage>{state.message}</ErrorMessage>
        <button type="button" onClick={onRetry} className="py-2 text-xs text-stone-dark underline-offset-4 hover:text-ink hover:underline">
          Erneut laden
        </button>
      </div>
    );
  }

  const { billing } = state;
  const entitled = isEntitled(billing);
  const until = billing.periodEnd ? formatDate(billing.periodEnd) : '';
  const remaining = Math.max(0, billing.allowance - billing.used);
  const manageButton = (
    <button type="button" onClick={onManage} disabled={redirecting} className={SECONDARY}>
      Abo verwalten
    </button>
  );

  let label: string;
  let text: string;
  let action = manageButton;
  if (confirming && !entitled) {
    label = 'Zahlung wird bestätigt';
    text = 'Einen Moment – sobald Stripe die Buchung bestätigt, kannst du loslegen.';
    action = <Loader2 className="size-5 animate-spin" strokeWidth={1.5} aria-hidden="true" />;
  } else if (entitled && billing.status === 'trialing') {
    label = 'Testphase';
    text = `Noch ${remaining} von ${billing.allowance} Bildern · kostenlos bis ${until}${billing.cancelAtPeriodEnd ? ', danach endet das Abo' : `, danach ${PLAN_PRICE_LABEL} / Monat`}.`;
  } else if (entitled) {
    label = 'Abo aktiv';
    text = `Noch ${remaining} von ${billing.allowance} Bildern in diesem Monat · ${billing.cancelAtPeriodEnd ? 'endet' : 'verlängert sich'} am ${until}.`;
  } else if (billing.status === 'past_due' || billing.status === 'unpaid') {
    label = 'Zahlung offen';
    text = 'Die letzte Zahlung ist fehlgeschlagen. Bitte aktualisiere deine Zahlungsmethode, um weiter zu generieren.';
  } else {
    label = 'Abo';
    text = `${PLAN_MONTHLY_IMAGES} Bilder pro Monat für ${PLAN_PRICE_LABEL} inkl. USt. · jederzeit kündbar.`;
    action = (
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onCheckout} disabled={redirecting} className={PRIMARY}>
          {redirecting ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <CreditCard className="size-4" strokeWidth={1.5} aria-hidden="true" />
          )}
          {billing.trialAvailable ? `${PLAN_TRIAL_DAYS} Tage kostenlos testen` : 'Abo abschließen'}
        </button>
        {billing.canManage && manageButton}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-y border-ink/10 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div role={confirming ? 'status' : undefined}>
        <p className={LABEL}>{label}</p>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed">{text}</p>
        {actionError && <ErrorMessage className="mt-2">{actionError}</ErrorMessage>}
      </div>
      {action}
    </div>
  );
}
