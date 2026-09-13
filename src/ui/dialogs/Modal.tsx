/** Schlichter Dialograhmen: Titel, Schliessen, Escape, Klick auf den Grund. */

import { useEffect, type JSX, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  wide,
  size,
  children,
}: {
  title: string;
  onClose(): void;
  /** Kurzform fuer size="wide". */
  wide?: boolean;
  size?: 'wide' | 'xl';
  children: ReactNode;
}): JSX.Element {
  const variant = size ?? (wide ? 'wide' : null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal__box${variant ? ` modal__box--${variant}` : ''}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="modal__close" aria-label="Schließen" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
