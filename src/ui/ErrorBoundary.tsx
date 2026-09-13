/**
 * Fehlergrenze. Ohne sie endet ein Fehler beim Aufbau in einer weissen Seite
 * ohne jeden Hinweis - gerade bei Web Bluetooth und localStorage, die je nach
 * Browser und Kontext unterschiedlich eingeschraenkt sind.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unbehandelter Fehler', error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h1>Da ist etwas schiefgegangen</h1>
        <p>
          Die Anwendung ist auf einen Fehler gelaufen. Die aufgezeichneten Daten liegen weiterhin im
          Browserspeicher.
        </p>
        <pre>{error.message}</pre>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
}
