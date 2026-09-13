/** Schlichter Dialograhmen: Titel, Schliessen, Escape, Klick auf den Grund. */

import { useEffect, type JSX, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose(): void;
  wide?: boolean;
  children: ReactNode;
}): JSX.Element {
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
      <div className={`modal__box${wide ? ' modal__box--wide' : ''}`} role="dialog" aria-modal="true">
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
