import { Loader2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { IS_SUPABASE_CONFIGURED, MIN_PASSWORD_LENGTH } from '../config';
import { AuthServiceError, signIn, signUp } from '../services/authService';
import { ErrorMessage } from './ErrorMessage';

type Mode = 'signIn' | 'signUp';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'signIn', label: 'Anmelden' },
  { mode: 'signUp', label: 'Registrieren' },
];

interface FieldProps {
  label: string;
  type: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled: boolean;
  minLength?: number;
  maxLength?: number;
  hint?: string;
}

function Field({ label, type, value, onChange, autoComplete, disabled, minLength, maxLength, hint }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        required
        minLength={minLength}
        maxLength={maxLength}
        aria-describedby={hint ? hintId : undefined}
        className="h-12 w-full border-b border-ink/30 bg-transparent text-base transition-colors focus:border-ink disabled:text-stone-dark"
      />
      {hint && (
        <p id={hintId} className="text-xs text-stone-dark">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Anmeldung und Registrierung (Name, E-Mail, Passwort) über Supabase Auth. */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignUp = mode === 'signUp';

  const switchMode = (next: Mode) => {
    if (next === mode || submitting) return;
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      if (isSignUp) {
        await signUp(name.trim(), email.trim(), password);
        setMode('signIn');
        setPassword('');
        setNotice(
          'Fast geschafft – bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben. Danach kannst du dich hier anmelden.',
        );
      } else {
        // Bei Erfolg wechselt useAuth automatisch zum Studio.
        await signIn(email.trim(), password);
      }
    } catch (err) {
      setError(
        err instanceof AuthServiceError ? err.message : 'Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || !IS_SUPABASE_CONFIGURED;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 sm:px-8 sm:pb-28">
      <div className="grid gap-12 pt-10 sm:pt-16 lg:grid-cols-2 lg:gap-20 lg:pt-20">
        <section>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
            Virtual Fitting · Mitgliederbereich
          </p>
          <h1 className="mt-4 max-w-2xl font-serif text-[2.75rem] leading-[0.95] sm:text-6xl lg:text-7xl">
            {isSignUp ? (
              <>
                Konto anlegen. <em className="font-normal">Look erstellen.</em>
              </>
            ) : (
              <>
                Willkommen <em className="font-normal">zurück.</em>
              </>
            )}
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-stone-dark sm:text-base">
            {isSignUp
              ? 'Registriere dich mit Name, E-Mail-Adresse und Passwort. Nach der Bestätigung deiner E-Mail kannst du dich jederzeit anmelden.'
              : 'Melde dich mit deiner E-Mail-Adresse und deinem Passwort an, um Bilder zu generieren.'}
          </p>
        </section>

        <section aria-label={isSignUp ? 'Registrieren' : 'Anmelden'} className="w-full max-w-sm lg:pt-4">
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
            {isSignUp && (
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
            <Field
              label="Passwort"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              disabled={disabled}
              minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
              hint={isSignUp ? `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen` : undefined}
            />

            <button
              type="submit"
              disabled={disabled}
              aria-busy={submitting}
              className={`mt-3 inline-flex h-14 w-full items-center justify-center gap-3 px-10 text-[12px] font-medium uppercase tracking-[0.28em] transition-colors ${
                submitting
                  ? 'cursor-wait bg-ink text-paper'
                  : disabled
                    ? 'cursor-not-allowed bg-sand-light text-stone-dark'
                    : 'bg-ink text-paper hover:bg-black'
              }`}
            >
              {submitting && <Loader2 className="size-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />}
              {isSignUp ? 'Konto anlegen' : 'Anmelden'}
            </button>
          </form>

          <div className="mt-6 flex flex-col gap-4">
            {error && <ErrorMessage>{error}</ErrorMessage>}
            {notice && (
              <p role="status" className="text-sm leading-relaxed text-ink">
                {notice}
              </p>
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
