import { LogOut, Sparkles } from 'lucide-react';

interface HeaderProps {
  /** Gesetzt, sobald jemand angemeldet ist. */
  userName?: string;
  onSignOut?: () => void;
}

export function Header({ userName, onSignOut }: HeaderProps) {
  return (
    <header className="border-b border-ink/10">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-8">
        <a href="/" className="flex shrink-0 items-center gap-2.5" aria-label="AI Image Studio – Startseite">
          <Sparkles className="size-4" strokeWidth={1.25} aria-hidden="true" />
          {/* Unter 360px fehlt neben Name und „Abmelden“ der Platz für den Schriftzug. */}
          <span
            className={`text-[12px] font-medium uppercase tracking-[0.32em] sm:text-[13px] ${userName ? 'hidden xs:inline' : ''}`}
          >
            AI Image Studio
          </span>
        </a>
        {userName && onSignOut ? (
          <div className="flex min-w-0 items-center gap-4 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:gap-6 sm:text-[11px]">
            <span className="truncate" title={userName}>
              {userName}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="flex shrink-0 items-center gap-2 uppercase text-ink transition-colors hover:text-stone-dark"
            >
              <LogOut className="size-3.5" strokeWidth={1.25} aria-hidden="true" />
              Abmelden
            </button>
          </div>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
            Create your look
          </p>
        )}
      </div>
    </header>
  );
}
