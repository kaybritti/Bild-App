import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
  type AuthChangeEvent,
  type User,
} from '@supabase/supabase-js';
import { MIN_PASSWORD_LENGTH } from '../config';
import type { AuthUser } from '../types';
import { supabase } from './supabaseClient';

/** Fehler mit einer Nachricht, die direkt in der Oberfläche angezeigt werden kann. */
export class AuthServiceError extends Error {
  /** Gesetzt, wenn die Oberfläche anbieten soll, die Bestätigungs-Mail erneut zu senden. */
  readonly emailNotConfirmed: boolean;

  constructor(message: string, emailNotConfirmed = false) {
    super(message);
    this.name = 'AuthServiceError';
    this.emailNotConfirmed = emailNotConfirmed;
  }
}

const NOT_CONFIGURED =
  'Der Login ist nicht konfiguriert. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY in der .env-Datei setzen und die App neu starten.';

/** Längere Namen werden nicht angezeigt (user_metadata ist vom Nutzer frei änderbar). */
const MAX_NAME_LENGTH = 100;

function requireClient() {
  if (!supabase) throw new AuthServiceError(NOT_CONFIGURED);
  return supabase;
}

function toAuthServiceError(error: unknown): AuthServiceError {
  if (isAuthWeakPasswordError(error)) {
    return new AuthServiceError(
      `Das Passwort ist zu schwach oder zu häufig verwendet. Bitte mindestens ${MIN_PASSWORD_LENGTH} Zeichen und kein bekanntes Passwort verwenden.`,
    );
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
          true,
        );
      case 'user_already_exists':
      case 'email_exists':
        return new AuthServiceError('Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte melde dich an.');
      case 'email_address_invalid':
        return new AuthServiceError('Diese E-Mail-Adresse ist ungültig.');
      case 'email_address_not_authorized':
        return new AuthServiceError(
          'An diese E-Mail-Adresse können derzeit keine Mails verschickt werden. Bitte den Betreiber kontaktieren.',
        );
      case 'signup_disabled':
        return new AuthServiceError('Registrierungen sind derzeit deaktiviert.');
      case 'captcha_failed':
        return new AuthServiceError('Die Sicherheitsprüfung ist fehlgeschlagen. Bitte erneut versuchen.');
      case 'same_password':
        return new AuthServiceError('Das neue Passwort muss sich vom bisherigen unterscheiden.');
      case 'session_expired':
      case 'session_not_found':
        return new AuthServiceError('Der Link ist abgelaufen. Bitte fordere einen neuen an.');
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

/** Führt einen Supabase-Aufruf aus und übersetzt alle Fehler in AuthServiceError. */
async function run<T extends { error: unknown }>(call: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (error) {
    throw toAuthServiceError(error);
  }
  if (result.error) throw toAuthServiceError(result.error);
  return result;
}

function toAuthUser(user: User): AuthUser {
  const email = user.email ?? '';
  const metaName: unknown = user.user_metadata?.name;
  const name = typeof metaName === 'string' && metaName.trim() ? metaName.trim() : email.split('@')[0];
  return { id: user.id, email, name: name.slice(0, MAX_NAME_LENGTH) };
}

/**
 * Legt ein Konto an. Supabase verschickt danach eine Bestätigungs-Mail;
 * erst nach dem Klick auf den Link ist ein Login möglich.
 */
export async function signUp(name: string, email: string, password: string, captchaToken?: string): Promise<void> {
  const client = requireClient();
  const result = await run(() =>
    client.auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: window.location.origin, captchaToken },
    }),
  );

  // Bei aktiver E-Mail-Bestätigung meldet Supabase ein bestehendes Konto nicht als Fehler,
  // sondern liefert einen Nutzer ohne Identitäten zurück.
  if (result.data.user && result.data.user.identities?.length === 0) {
    throw new AuthServiceError('Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte melde dich an.');
  }
}

export async function signIn(email: string, password: string, captchaToken?: string): Promise<void> {
  const client = requireClient();
  await run(() => client.auth.signInWithPassword({ email, password, options: { captchaToken } }));
}

/** Verschickt die Bestätigungs-Mail einer Registrierung erneut. */
export async function resendConfirmation(email: string, captchaToken?: string): Promise<void> {
  const client = requireClient();
  await run(() =>
    client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin, captchaToken } }),
  );
}

/**
 * Verschickt einen Link zum Zurücksetzen des Passworts. Supabase meldet aus Datenschutzgründen
 * keinen Fehler, wenn es zur Adresse kein Konto gibt.
 */
export async function requestPasswordReset(email: string, captchaToken?: string): Promise<void> {
  const client = requireClient();
  await run(() => client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin, captchaToken }));
}

/** Setzt das Passwort des angemeldeten Nutzers (nach dem Link aus der Passwort-Mail). */
export async function updatePassword(password: string): Promise<void> {
  const client = requireClient();
  await run(() => client.auth.updateUser({ password }));
}

/**
 * Meldet ab. Supabase entfernt die lokale Session auch dann, wenn der Server nicht
 * erreichbar ist – ein Fehler wird deshalb nicht an die Oberfläche weitergegeben.
 */
export async function signOut(): Promise<void> {
  await supabase?.auth.signOut().catch(() => undefined);
}

/**
 * Liefert das Zugriffstoken der aktuellen Sitzung für die eigene Serverfunktion.
 * getSession() erneuert ein abgelaufenes Token automatisch; null bedeutet: nicht (mehr) angemeldet.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Meldet den aktuellen Nutzer sofort (gespeicherte Session) und bei jeder Änderung,
 * zusammen mit dem auslösenden Event. Gibt eine Funktion zum Abbestellen zurück.
 */
export function subscribeToAuth(onChange: (user: AuthUser | null, event: AuthChangeEvent | null) => void): () => void {
  if (!supabase) {
    onChange(null, null);
    return () => {};
  }
  // onAuthStateChange liefert direkt nach dem Abonnieren das Event INITIAL_SESSION.
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    onChange(session ? toAuthUser(session.user) : null, event);
  });
  return () => data.subscription.unsubscribe();
}
