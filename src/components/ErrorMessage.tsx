import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

interface ErrorMessageProps {
  id?: string;
  children: ReactNode;
  className?: string;
}

export function ErrorMessage({ id, children, className = '' }: ErrorMessageProps) {
  return (
    <p id={id} role="alert" className={`flex items-start gap-2 text-sm leading-snug text-error ${className}`}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
