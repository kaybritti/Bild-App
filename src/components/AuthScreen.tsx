import { useState, type FormEvent } from 'react';
import { IS_CAPTCHA_ENABLED, IS_SUPABASE_CONFIGURED, MIN_PASSWORD_LENGTH } from '../config';
import { AuthServiceError, requestPasswordReset, resendConfirmation, signIn, signUp } from '../services/authService';
import { Captcha } from './Captcha';
import { ErrorMessage } from './ErrorMessage';
import { Field, SubmitButton, TextButton } from './FormFields';

type Mode = 'signIn' | 'signUp' | 'reset';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'signIn', label: 'Anmelden' },
  { mode: 'signUp', label: 'Registrieren' },
];

const HEADLINES: Record<Mode, [string, string]> = {
  signIn: ['Willkommen ', 'zurück.'],
  signUp: ['Konto anlegen. ', 'Look erstellen.'],
  reset: ['Passwort vergessen? ', 'Kein Problem.'],
};

const INTROS: Record<Mode, string> = {
  signIn: 'Melde dich mit deiner E-Mail-Adresse und deinem Passwort an, um Bilder zu generieren.',
  signUp:
    'Registriere dich mit Name, E-Mail-Adresse und Passwort. Nach der Bestätigung deiner E-Mail kannst du dich jederzeit anmelden.',
  reset: 'Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegen kannst.',
};

const SUBMIT_LABELS: Record<Mode, string> = {
  signIn: 'Anmelden',
  signUp: 'Konto anlegen',
  reset: 'Link senden',
};

/** Anmeldung, Registrierung und Passwort-Zurücksetzen über Supabase Auth. */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Nach der Registrierung oder bei unbestätigter Adresse: Bestätigungs-Mail erneut anbieten.
  const [canResend, setCanResend] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Turnstile-Tokens gelten nur einmal; ein neuer key erzeugt nach jedem Versuch ein neues Widget.
  const [captchaKey, setCaptchaKey] = useState(0);

  const switchMode = (next: Mode) => {
    if (next === mode || submitting) return;
    setMode(next);
    setError(null);
    setNotice(null);
    setCanResend(false);
    setPassword('');
  };

  /** Führt eine Auth-Aktion aus und kümmert sich um Ladezustand, Fehler und das CAPTCHA. */
  const perform = async (action: (token: string | undefined) => Promise<void>) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await action(captchaToken ?? undefined);
    } catch (err) {
      if (err instanceof AuthServiceError && err.emailNotConfirmed) setCanResend(true);
      setError(
        err instanceof AuthServiceError ? err.message : 'Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.',
      );
    } finally {
      setSubmitting(false);
      if (IS_CAPTCHA_ENABLED) setCaptchaKey((key) => key + 1);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void perform(async (token) => {
      if (mode === 'signUp') {
        await signUp(name.trim(), email.trim(), password, token);
        setMode('signIn');
        setPassword('');
        setCanResend(true);
        setNotice(
          'Fast geschafft – bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben. Danach kannst du dich hier anmelden.',
        );
      } else if (mode === 'reset') {
        await requestPasswordReset(email.trim(), token);
        setNotice(
          'Falls zu dieser Adresse ein Konto besteht, haben wir dir einen Link geschickt. Bitte prüfe dein Postfach.',
        );
      } else {
        // Bei Erfolg wechselt useAuth automatisch zum Studio.
        await signIn(email.trim(), password, token);
      }
    });
  };

  const handleResend = () => {
    void perform(async (token) => {
      await resendConfirmation(email.trim(), token);
      setNotice('Wir haben dir die Bestätigungs-Mail erneut geschickt. Bitte prüfe auch den Spam-Ordner.');
    });
  };

  const disabled = submitting || !IS_SUPABASE_CONFIGURED;
  const awaitingCaptcha = IS_CAPTCHA_ENABLED && !captchaToken;
  const [headline, emphasis] = HEADLINES[mode];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 sm:px-8 sm:pb-28">
      <div className="grid gap-12 pt-10 sm:pt-16 lg:grid-cols-2 lg:gap-20 lg:pt-20">
        <section>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
            Virtual Fitting · Mitgliederbereich
          </p>
          <h1 className="mt-4 max-w-2xl font-serif text-[2.75rem] leading-[0.95] sm:text-6xl lg:text-7xl">
            {headline}
            <em className="font-normal">{emphasis}</em>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-stone-dark sm:text-base">{INTROS[mode]}</p>
        </section>

        <section aria-label={SUBMIT_LABELS[mode]} className="w-full max-w-sm lg:pt-4">
          <div className="flex gap-8">
            {MODES.map(({ mode: option, label }) => (
              <button
                key={option}
                type="button"
                onClick={() => switchMode(option)}
                aria-pressed={mode === option}
                className={`border-b pb-2 text-[12px] font-medium uppercase tracking-[0.28em] transition-colors ${
                  mode === option ? 'border-ink text-ink' : 'border-transparent text-stone-dark hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-7">
            {mode === 'signUp' && (
              <Field
                label="Name"
                type="text"
                value={name}
                onChange={setName}
                autoComplete="name"
                disabled={disabled}
                maxLength={100}
              />
            )}
            <Field
              label="E-Mail"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              disabled={disabled}
            />
            {mode !== 'reset' && (
              <div className="flex flex-col gap-2">
                <Field
                  label="Passwort"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                  disabled={disabled}
                  minLength={mode === 'signUp' ? MIN_PASSWORD_LENGTH : undefined}
                  hint={mode === 'signUp' ? `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen` : undefined}
                />
                {mode === 'signIn' && (
                  <TextButton onClick={() => switchMode('reset')} disabled={submitting}>
                    Passwort vergessen?
                  </TextButton>
                )}
              </div>
            )}

            {IS_CAPTCHA_ENABLED && <Captcha key={captchaKey} onToken={setCaptchaToken} />}

            <SubmitButton disabled={disabled || awaitingCaptcha} submitting={submitting}>
              {SUBMIT_LABELS[mode]}
            </SubmitButton>
            {mode === 'reset' && (
              <TextButton onClick={() => switchMode('signIn')} disabled={submitting}>
                Zurück zur Anmeldung
              </TextButton>
            )}
          </form>

          <div className="mt-6 flex flex-col gap-4">
            {error && <ErrorMessage>{error}</ErrorMessage>}
            {notice && (
              <p role="status" className="text-sm leading-relaxed text-ink">
                {notice}
              </p>
            )}
            {canResend && mode === 'signIn' && (
              <TextButton onClick={handleResend} disabled={disabled || awaitingCaptcha || !email.trim()}>
                Bestätigungs-Mail erneut senden
              </TextButton>
            )}
            {!IS_SUPABASE_CONFIGURED && (
              <ErrorMessage>
                Der Login ist nicht konfiguriert. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY in der
                .env-Datei setzen und die App neu starten.
              </ErrorMessage>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
