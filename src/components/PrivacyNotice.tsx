import { ShieldCheck } from 'lucide-react';

export function PrivacyNotice() {
  return (
    <p className="flex max-w-md items-start gap-2 text-xs leading-relaxed text-stone-dark">
      <ShieldCheck className="mt-px size-4 shrink-0" strokeWidth={1.25} aria-hidden="true" />
      <span>
        Deine Fotos werden zur Verarbeitung an einen externen Dienst (n8n-Workflow) übertragen. Die App selbst speichert
        keine Bilder. Bildmetadaten werden vor der Weitergabe entfernt. Für den Missbrauchsschutz werden Nutzer-ID und
        Anfragezeiten vorübergehend gespeichert. Zahlungen wickelt Stripe ab; die App sieht keine Kartendaten.
      </span>
    </p>
  );
}
