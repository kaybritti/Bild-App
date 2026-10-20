import { useEffect, useState } from 'react';
import { subscribeToAuth } from '../services/authService';
import type { AuthState } from '../types';

/** Aktueller Login-Zustand; folgt Anmeldung, Abmeldung und Token-Erneuerung automatisch. */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    // Nach dem Link aus der Passwort-Mail bleibt der Zustand „recovery“, auch wenn weitere
    // Events (z. B. INITIAL_SESSION, TOKEN_REFRESHED) folgen – bis das Passwort geändert ist.
    let recovering = false;
    return subscribeToAuth((user, event) => {
      if (event === 'PASSWORD_RECOVERY') recovering = true;
      if (event === 'USER_UPDATED' || !user) recovering = false;
      setState(
        !user ? { status: 'signedOut' } : recovering ? { status: 'recovery', user } : { status: 'signedIn', user },
      );
    });
  }, []);

  return state;
}
