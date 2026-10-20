import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '../config';
import { AuthServiceError, updatePassword } from '../services/authService';
import { ErrorMessage } from './ErrorMessage';
import { Field, SubmitButton } from './FormFields';

/** Nach dem Link aus der Passwort-Mail: neues Passwort festlegen, danach geht es ins Studio. */
export function NewPasswordScreen() {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (password !== repeat) {
      setError('Die beiden Passwörter stimmen nicht überein.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Bei Erfolg meldet Supabase USER_UPDATED, useAuth wechselt dann zum Studio.
      await updatePassword(password);
    } catch (err) {
      setError(
        err instanceof AuthServiceError ? err.message : 'Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 sm:px-8 sm:pb-28">
      <div className="grid gap-12 pt-10 sm:pt-16 lg:grid-cols-2 lg:gap-20 lg:pt-20">
        <section>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
            Virtual Fitting · Mitgliederbereich
          </p>
          <h1 className="mt-4 max-w-2xl font-serif text-[2.75rem] leading-[0.95] sm:text-6xl lg:text-7xl">
            Neues Passwort. <em className="font-normal">Neuer Start.</em>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-stone-dark sm:text-base">
            Lege ein neues Passwort fest. Danach geht es direkt weiter ins Studio.
          </p>
        </section>

        <section aria-label="Neues Passwort festlegen" className="w-full max-w-sm lg:pt-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-7">
            <Field
              label="Neues Passwort"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              disabled={submitting}
              minLength={MIN_PASSWORD_LENGTH}
              hint={`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`}
            />
            <Field
              label="Passwort wiederholen"
              type="password"
              value={repeat}
              onChange={setRepeat}
              autoComplete="new-password"
              disabled={submitting}
              minLength={MIN_PASSWORD_LENGTH}
            />
            <SubmitButton disabled={submitting} submitting={submitting}>
              Passwort speichern
            </SubmitButton>
          </form>
          {error && <ErrorMessage className="mt-6">{error}</ErrorMessage>}
        </section>
      </div>
    </main>
  );
}
