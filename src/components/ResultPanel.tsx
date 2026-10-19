import { AlertCircle, Download, ImageIcon, Maximize2, RefreshCw, RotateCcw } from 'lucide-react';
import type { Ref } from 'react';
import type { GenerationState } from '../types';
import { buildDownloadName, formatTime } from '../utils/format';

interface ResultPanelProps {
  ref?: Ref<HTMLElement>;
  state: GenerationState;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onStartOver: () => void;
}

const DESCRIPTIONS: Record<GenerationState['status'], string> = {
  idle: 'Hier erscheint das Bild, das der n8n-Workflow aus Person und Kleidungsstück erstellt.',
  loading: 'Deine Bilder wurden übertragen. Der Workflow erstellt jetzt dein neues Bild.',
  success: '',
  error: 'Deine ausgewählten Bilder bleiben erhalten – du kannst es direkt noch einmal versuchen.',
};

export function ResultPanel({ ref, state, canRegenerate, onRegenerate, onStartOver }: ResultPanelProps) {
  const description =
    state.status === 'success'
      ? `Erstellt um ${formatTime(state.result.createdAt)} Uhr · ${state.result.mimeType === 'image/webp' ? 'WebP' : 'JPEG'}`
      : DESCRIPTIONS[state.status];

  return (
    <section
      ref={ref}
      aria-labelledby="result-heading"
      className="scroll-mt-6 border-t border-ink/10 pt-10 sm:pt-14 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr] lg:gap-x-16"
    >
      <div className="lg:col-start-1 lg:row-start-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
          <span aria-hidden="true">03 — </span>Ergebnis
        </p>
        <h2 id="result-heading" className="mt-3 font-serif text-4xl leading-none sm:text-5xl">
          Dein Look
        </h2>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-stone-dark">{description}</p>
      </div>

      <div className="mt-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
        <div
          className={`relative w-full overflow-hidden bg-sand-light ${
            state.status === 'error' ? 'flex min-h-96 lg:aspect-[4/5]' : 'aspect-[4/5]'
          }`}
        >
          <ResultFrame state={state} onRetry={onRegenerate} canRetry={canRegenerate} />
        </div>
      </div>

      {state.status === 'success' && (
        <div className="mt-6 flex flex-col gap-3 xs:flex-row xs:flex-wrap lg:col-start-1 lg:row-start-2 lg:mt-10 lg:flex-col lg:self-start">
          <a
            href={state.result.url}
            download={buildDownloadName(state.result.mimeType, state.result.createdAt)}
            className="inline-flex h-12 items-center justify-center gap-2.5 bg-ink px-7 text-[11px] font-medium uppercase tracking-[0.24em] text-paper transition-colors hover:bg-black"
          >
            <Download className="size-4" strokeWidth={1.5} aria-hidden="true" />
            Download
          </a>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={!canRegenerate}
            className="inline-flex h-12 items-center justify-center gap-2.5 px-7 text-[11px] font-medium uppercase tracking-[0.24em] outline outline-ink transition-colors -outline-offset-1 hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-3 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink"
          >
            <RefreshCw className="size-4" strokeWidth={1.5} aria-hidden="true" />
            Erneut generieren
          </button>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 lg:pt-3">
            <a
              href={state.result.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 py-2 text-xs text-stone-dark underline-offset-4 hover:text-ink hover:underline"
            >
              <Maximize2 className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              In voller Größe öffnen
            </a>
            <button
              type="button"
              onClick={onStartOver}
              className="inline-flex items-center gap-2 py-2 text-xs text-stone-dark underline-offset-4 hover:text-ink hover:underline"
            >
              <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              Neu beginnen
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

interface ResultFrameProps {
  state: GenerationState;
  canRetry: boolean;
  onRetry: () => void;
}

function ResultFrame({ state, canRetry, onRetry }: ResultFrameProps) {
  switch (state.status) {
    case 'idle':
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <ImageIcon className="size-7 text-stone" strokeWidth={1} aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
            Noch kein Bild generiert
          </p>
        </div>
      );

    case 'loading':
      return (
        <div role="status" aria-live="polite" className="absolute inset-0">
          <div
            className="absolute inset-0 animate-shimmer bg-[linear-gradient(105deg,transparent_35%,rgb(255_255_255/0.5)_50%,transparent_65%)] bg-size-[250%_100%]"
            aria-hidden="true"
          />
          <div className="relative flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
            <p className="font-serif text-3xl italic sm:text-4xl">Creating your image…</p>
            <div className="h-px w-40 overflow-hidden bg-ink/15" aria-hidden="true">
              <div className="h-full w-1/4 animate-progress bg-ink" />
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
              Das kann einen Moment dauern
            </p>
          </div>
        </div>
      );

    case 'success':
      return (
        <img
          src={state.result.url}
          alt="Generiertes Bild: die Person mit dem ausgewählten Kleidungsstück"
          className="absolute inset-0 size-full animate-fade-in object-contain"
        />
      );

    case 'error':
      return (
        <div role="alert" className="flex w-full flex-col items-center justify-center gap-5 px-6 py-12 text-center sm:p-12">
          <AlertCircle className="size-7 text-error" strokeWidth={1.25} aria-hidden="true" />
          <p className="font-serif text-2xl sm:text-3xl">Das hat leider nicht geklappt</p>
          <p className="max-w-md text-sm leading-relaxed text-ink/80">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            disabled={!canRetry}
            className="mt-2 inline-flex h-12 items-center justify-center gap-2.5 bg-ink px-7 text-[11px] font-medium uppercase tracking-[0.24em] text-paper transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="size-4" strokeWidth={1.5} aria-hidden="true" />
            Erneut versuchen
          </button>
        </div>
      );
  }
}
