import { Loader2, Sparkles } from 'lucide-react';

interface GenerateButtonProps {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  describedBy?: string;
}

export function GenerateButton({ onClick, disabled, loading, describedBy }: GenerateButtonProps) {
  const stateClasses = loading
    ? 'cursor-wait bg-ink text-paper'
    : disabled
      ? 'cursor-not-allowed bg-sand-light text-stone-dark'
      : 'bg-ink text-paper hover:bg-black';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      aria-describedby={describedBy}
      className={`inline-flex h-14 w-full items-center justify-center gap-3 px-10 text-[12px] font-medium uppercase tracking-[0.28em] transition-colors sm:w-auto sm:min-w-80 ${stateClasses}`}
    >
      {loading ? (
        <>
          <Loader2 className="size-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
          <span className="normal-case tracking-[0.08em]">Creating your image…</span>
        </>
      ) : (
        <>
          <Sparkles className="size-4" strokeWidth={1.25} aria-hidden="true" />
          Generate Image
        </>
      )}
    </button>
  );
}
