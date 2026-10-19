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
