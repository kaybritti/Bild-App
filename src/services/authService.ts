import { isAuthApiError, isAuthRetryableFetchError, isAuthWeakPasswordError, type User } from '@supabase/supabase-js';
import { MIN_PASSWORD_LENGTH } from '../config';
import type { AuthUser } from '../types';
import { supabase } from './supabaseClient';

/** Fehler mit einer Nachricht, die direkt in der Oberfläche angezeigt werden kann. */
export class AuthServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

const NOT_CONFIGURED =
  'Der Login ist nicht konfiguriert. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY in der .env-Datei setzen und die App neu starten.';

function requireClient() {
  if (!supabase) throw new AuthServiceError(NOT_CONFIGURED);
  return supabase;
}

function toAuthServiceError(error: unknown): AuthServiceError {
  if (isAuthWeakPasswordError(error)) {
    return new AuthServiceError(`Das Passwort ist zu schwach. Bitte mindestens ${MIN_PASSWORD_LENGTH} Zeichen verwenden.`);
  }
  if (isAuthRetryableFetchError(error) || error instanceof TypeError) {
    return new AuthServiceError('Der Login-Dienst ist nicht erreichbar. Bitte die Internetverbindung prüfen.');
  }
  if (isAuthApiError(error)) {
    switch (error.code) {
      case 'invalid_credentials':
        return new AuthServiceError('E-Mail-Adresse oder Passwort ist falsch.');
      case 'email_not_confirmed':
        return new AuthServiceError(
          'Deine E-Mail-Adresse ist noch nicht bestätigt. Bitte klicke zuerst auf den Link in der Bestätigungs-Mail.',
        );
      case 'user_already_exists':
      case 'email_exists':
        return new AuthServiceError('Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte melde dich an.');
      case 'email_address_invalid':
        return new AuthServiceError('Diese E-Mail-Adresse ist ungültig.');
      case 'signup_disabled':
        return new AuthServiceError('Registrierungen sind derzeit deaktiviert.');
      case 'over_email_send_rate_limit':
        return new AuthServiceError('Es wurden zu viele E-Mails verschickt. Bitte später erneut versuchen.');
      case 'over_request_rate_limit':
        return new AuthServiceError('Zu viele Versuche. Bitte einen Moment warten und erneut versuchen.');
    }
    if (error.status === 429) {
      return new AuthServiceError('Zu viele Versuche. Bitte einen Moment warten und erneut versuchen.');
    }
  }
  return new AuthServiceError('Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.');
}

function toAuthUser(user: User): AuthUser {
  const email = user.email ?? '';
  const metaName: unknown = user.user_metadata?.name;
  const name = typeof metaName === 'string' && metaName.trim() ? metaName.trim() : email.split('@')[0];
  return { id: user.id, email, name };
}

/**
 * Legt ein Konto an. Supabase verschickt danach eine Bestätigungs-Mail;
 * erst nach dem Klick auf den Link ist ein Login möglich.
 */
export async function signUp(name: string, email: string, password: string): Promise<void> {
  const client = requireClient();
  let result;
  try {
    result = await client.auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: window.location.origin },
    });
  } catch (error) {
    throw toAuthServiceError(error);
  }
  if (result.error) throw toAuthServiceError(result.error);

  // Bei aktiver E-Mail-Bestätigung meldet Supabase ein bestehendes Konto nicht als Fehler,
  // sondern liefert einen Nutzer ohne Identitäten zurück.
  if (result.data.user && result.data.user.identities?.length === 0) {
    throw new AuthServiceError('Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte melde dich an.');
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const client = requireClient();
  let result;
  try {
    result = await client.auth.signInWithPassword({ email, password });
  } catch (error) {
    throw toAuthServiceError(error);
  }
  if (result.error) throw toAuthServiceError(result.error);
}

/**
 * Meldet ab. Supabase entfernt die lokale Session auch dann, wenn der Server nicht
 * erreichbar ist – ein Fehler wird deshalb nicht an die Oberfläche weitergegeben.
 */
export async function signOut(): Promise<void> {
  await supabase?.auth.signOut().catch(() => undefined);
}

/**
 * Meldet den aktuellen Nutzer sofort (gespeicherte Session) und bei jeder Änderung.
 * Gibt eine Funktion zum Abbestellen zurück.
 */
export function subscribeToAuth(onChange: (user: AuthUser | null) => void): () => void {
  if (!supabase) {
    onChange(null);
    return () => {};
  }
  // onAuthStateChange liefert direkt nach dem Abonnieren das Event INITIAL_SESSION.
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session ? toAuthUser(session.user) : null);
  });
  return () => data.subscription.unsubscribe();
}
