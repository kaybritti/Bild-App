import { ImagePlus, RefreshCw, X } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { FILE_INPUT_ACCEPT } from '../config';
import type { SelectedImage } from '../types';
import { formatFileSize } from '../utils/format';
import { ErrorMessage } from './ErrorMessage';

interface ImageUploadCardProps {
  /** Laufende Nummer, z. B. „01“ */
  index: string;
  /** Feldbezeichnung, z. B. „Bild1“ */
  label: string;
  /** Beschreibender Titel, z. B. „Person“ */
  title: string;
  /** Kurzer Hinweis, solange noch kein Bild gewählt ist */
  hint: string;
  image: SelectedImage | null;
  error: string | null;
  disabled?: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  onPreviewError: () => void;
}

export function ImageUploadCard({
  index,
  label,
  title,
  hint,
  image,
  error,
  disabled = false,
  onSelect,
  onRemove,
  onPreviewError,
}: ImageUploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const captionId = useId();
  const errorId = useId();
  const describedBy = error ? `${captionId} ${errorId}` : captionId;

  const openPicker = () => inputRef.current?.click();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann.
    event.target.value = '';
    if (file) onSelect(file);
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (!disabled) setDragActive(true);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onSelect(file);
  };

  const framed = dragActive || image !== null;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-3 flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-dark sm:text-[11px]">
        <span>
          <span aria-hidden="true">{index} — </span>
          {label}
        </span>
        <span className="hidden sm:inline" aria-hidden="true">
          JPEG · WebP
        </span>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`relative aspect-[3/4] w-full overflow-hidden transition-colors ${
          dragActive ? 'bg-sand' : 'bg-sand-light'
        } ${framed ? 'outline outline-offset-4 outline-ink' : ''}`}
      >
        {image ? (
          <>
            <img
              src={image.previewUrl}
              alt={`Vorschau ${label}: ${title}`}
              onError={onPreviewError}
              className="absolute inset-0 size-full animate-fade-in object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 p-2.5 sm:p-4">
              <IconButton label={`${label} austauschen`} onClick={openPicker} disabled={disabled}>
                <RefreshCw className="size-4" strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
              <IconButton label={`${label} entfernen`} onClick={onRemove} disabled={disabled}>
                <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled}
            aria-label={`${label} (${title}) auswählen`}
            aria-describedby={describedBy}
            className="group absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center outline-offset-[-6px] disabled:cursor-not-allowed sm:gap-4"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-paper/60 transition-colors group-hover:bg-paper sm:size-14">
              <ImagePlus className="size-5" strokeWidth={1.25} aria-hidden="true" />
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] sm:text-xs">Bild wählen</span>
            <span className="hidden text-xs text-stone-dark sm:block">oder hierher ziehen</span>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={FILE_INPUT_ACCEPT}
          onChange={handleChange}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
      </div>

      <div className="mt-4 min-w-0">
        <p className="font-serif text-2xl leading-tight sm:text-3xl">{title}</p>
        <p id={captionId} className="mt-1 truncate font-mono text-[10px] text-stone-dark sm:text-[11px]">
          {image ? `${image.file.name} · ${formatFileSize(image.file.size)}` : hint}
        </p>
        {error && (
          <ErrorMessage id={errorId} className="mt-3">
            {error}
          </ErrorMessage>
        )}
      </div>
    </div>
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

function IconButton({ label, onClick, disabled, children }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-10 items-center justify-center rounded-full bg-paper/90 text-ink backdrop-blur-sm transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
