import { useEffect, useRef } from 'react';
import { MAX_FILE_SIZE_MB } from '../config';
import { useBilling } from '../hooks/useBilling';
import { useGeneration } from '../hooks/useGeneration';
import { useImageFile } from '../hooks/useImageFile';
import { isEntitled } from '../services/billingService';
import { GenerateButton } from './GenerateButton';
import { ImageUploadCard } from './ImageUploadCard';
import { PlanPanel } from './PlanPanel';
import { PrivacyNotice } from './PrivacyNotice';
import { ResultPanel } from './ResultPanel';

const PREVIEW_ERROR = 'Das Bild konnte nicht angezeigt werden. Bitte eine andere Datei wählen.';

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Upload, Generierung und Ergebnis – nur für angemeldete Nutzer sichtbar. */
export function Studio() {
  const person = useImageFile();
  const garment = useImageFile();
  const { state, generate, reset } = useGeneration();
  const billing = useBilling();
  const resultRef = useRef<HTMLElement>(null);

  // Jeder Versuch zählt zum Kontingent – danach den Stand neu laden.
  const { refresh: refreshBilling } = billing;
  const finished = state.status === 'success' || state.status === 'error';
  useEffect(() => {
    if (finished) refreshBilling();
  }, [finished, refreshBilling]);

  const isLoading = state.status === 'loading';
  const hasBothImages = person.image !== null && garment.image !== null;
  const isPreparing = person.processing || garment.processing;
  // Der Server prüft das Abo ohnehin; ist der Status nicht ladbar, entscheidet er.
  const plan = billing.state.status === 'ready' ? billing.state.billing : null;
  const planBlock =
    billing.state.status === 'loading'
      ? 'Abo wird geladen'
      : plan && !isEntitled(plan)
        ? 'Für die Generierung ist ein Abo nötig'
        : plan && plan.used >= plan.allowance
          ? 'Kontingent für diesen Monat aufgebraucht'
          : null;
  const canGenerate = hasBothImages && !isLoading && !isPreparing && !planBlock;

  const handleGenerate = () => {
    if (!person.image || !garment.image || !canGenerate) return;
    void generate(person.image.file, garment.image.file);

    // Auf kleinen Bildschirmen liegt der Ergebnisbereich unterhalb – dorthin scrollen.
    const result = resultRef.current;
    if (result && result.getBoundingClientRect().top > window.innerHeight * 0.6) {
      result.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  };

  const handleStartOver = () => {
    reset();
    person.remove();
    garment.remove();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const hint = `JPEG oder WebP · max. ${MAX_FILE_SIZE_MB} MB`;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 sm:px-8 sm:pb-28">
      <section className="pb-10 pt-10 sm:pb-14 sm:pt-16 lg:pt-20">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
          Virtual Fitting · N°01
        </p>
        <h1 className="mt-4 max-w-2xl font-serif text-[2.75rem] leading-[0.95] sm:text-6xl lg:text-7xl">
          Zwei Bilder. <em className="font-normal">Ein neuer Look.</em>
        </h1>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-stone-dark sm:text-base">
          Lade ein Foto einer Person und ein Kleidungsstück hoch. Der Workflow kombiniert beides zu einem neuen Bild.
        </p>
      </section>

      <section aria-label="Abo" className="mb-12 sm:mb-16">
        <PlanPanel
          state={billing.state}
          confirming={billing.confirming}
          redirecting={billing.redirecting}
          actionError={billing.actionError}
          onCheckout={billing.checkout}
          onManage={billing.manage}
          onRetry={billing.refresh}
        />
      </section>

      <section aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="sr-only">
          Bilder auswählen
        </h2>
        <div className="grid grid-cols-1 gap-x-3 gap-y-10 xs:grid-cols-2 sm:gap-x-6 lg:gap-x-10">
          <ImageUploadCard
            index="01"
            label="Bild1"
            title="Person"
            hint={hint}
            image={person.image}
            error={person.error}
            disabled={isLoading}
            processing={person.processing}
            onSelect={person.select}
            onRemove={person.remove}
            onPreviewError={() => person.reject(PREVIEW_ERROR)}
          />
          <ImageUploadCard
            index="02"
            label="Bild2"
            title="Kleidungsstück"
            hint={hint}
            image={garment.image}
            error={garment.error}
            disabled={isLoading}
            processing={garment.processing}
            onSelect={garment.select}
            onRemove={garment.remove}
            onPreviewError={() => garment.reject(PREVIEW_ERROR)}
          />
        </div>
      </section>

      <section aria-label="Bild generieren" className="mt-12 flex flex-col items-center gap-5 text-center sm:mt-16">
        <GenerateButton
          onClick={handleGenerate}
          disabled={!canGenerate}
          loading={isLoading}
          describedBy="generate-hint"
        />
        <p id="generate-hint" className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
          {isLoading
            ? 'Bitte warten – die Anfrage läuft'
            : isPreparing
              ? 'Bild wird vorbereitet'
              : planBlock
                ? planBlock
                : hasBothImages
                  ? 'Bereit zur Generierung'
                  : 'Lade Bild1 und Bild2 hoch, um zu starten'}
        </p>
        <PrivacyNotice />
      </section>

      <div className="mt-16 sm:mt-24">
        <ResultPanel
          ref={resultRef}
          state={state}
          canRegenerate={canGenerate}
          onRegenerate={handleGenerate}
          onStartOver={handleStartOver}
        />
      </div>
    </main>
  );
}
