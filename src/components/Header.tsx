import { Sparkles } from 'lucide-react';

export function Header() {
  return (
    <header className="border-b border-ink/10">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-8">
        <a href="/" className="flex items-center gap-2.5" aria-label="AI Image Studio – Startseite">
          <Sparkles className="size-4" strokeWidth={1.25} aria-hidden="true" />
          <span className="text-[12px] font-medium uppercase tracking-[0.32em] sm:text-[13px]">AI Image Studio</span>
        </a>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
          Create your look
        </p>
      </div>
    </header>
  );
}
