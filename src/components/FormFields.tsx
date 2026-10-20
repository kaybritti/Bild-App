import { Loader2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';

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

export function Field({ label, type, value, onChange, autoComplete, disabled, minLength, maxLength, hint }: FieldProps) {
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

interface SubmitButtonProps {
  disabled: boolean;
  submitting: boolean;
  children: ReactNode;
}

export function SubmitButton({ disabled, submitting, children }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={disabled || submitting}
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
      {children}
    </button>
  );
}

interface TextButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

/** Unauffälliger Link-Button für Nebenaktionen („Passwort vergessen?“). */
export function TextButton({ onClick, disabled, children }: TextButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="self-start py-1 text-xs text-stone-dark underline underline-offset-4 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
