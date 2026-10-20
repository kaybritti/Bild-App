import { Loader2 } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Studio } from './components/Studio';
import { useAuth } from './hooks/useAuth';
import { signOut } from './services/authService';

export default function App() {
  const auth = useAuth();

  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        userName={auth.status === 'signedIn' ? auth.user.name : undefined}
        onSignOut={auth.status === 'signedIn' ? () => void signOut() : undefined}
      />

      {auth.status === 'loading' && (
        <main className="flex flex-1 items-center justify-center px-4">
          <p
            role="status"
            className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]"
          >
            <Loader2 className="size-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
            Anmeldung wird geprüft
          </p>
        </main>
      )}
      {auth.status === 'signedOut' && <AuthScreen />}
      {auth.status === 'signedIn' && <Studio key={auth.user.id} />}

      <Footer />
    </div>
  );
}
