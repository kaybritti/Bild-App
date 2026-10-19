import { useEffect, useState } from 'react';
import { subscribeToAuth } from '../services/authService';
import type { AuthState } from '../types';

/** Aktueller Login-Zustand; folgt Anmeldung, Abmeldung und Token-Erneuerung automatisch. */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(
    () => subscribeToAuth((user) => setState(user ? { status: 'signedIn', user } : { status: 'signedOut' })),
    [],
  );

  return state;
}
