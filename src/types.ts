import type { SupportedMimeType } from './config';

export interface SelectedImage {
  file: File;
  previewUrl: string;
}

export interface GeneratedResult {
  url: string;
  mimeType: SupportedMimeType;
  createdAt: Date;
}

export type GenerationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: GeneratedResult }
  | { status: 'error'; message: string };

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser }
  /** Über den Link aus der Passwort-Mail angemeldet; erst ein neues Passwort festlegen. */
  | { status: 'recovery'; user: AuthUser };
