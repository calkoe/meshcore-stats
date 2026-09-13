/** Export, Import und Verwerfen der Aufzeichnung. */

import { useRef, type JSX } from 'react';
import type { StoredModel } from '../../model/topology';
import { usePreferences } from '../../state/preferences';
import { localStorageKey, useMesh } from '../../state/store';
import { useInteraction } from '../interaction';

export function DataPanel(): JSX.Element {
  const controller = useMesh();
  const { prefs, set } = usePreferences();
  const { rendererRef } = useInteraction();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const exportData = (): void => {
    const blob = new Blob([JSON.stringify(controller.model.toJSON(), null, 1)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meshcore-topologie-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    controller.addLog('Aufzeichnung exportiert.', 'ok');
  };

  const importData = async (file: File): Promise<void> => {
    try {
      controller.loadStored(JSON.parse(await file.text()) as StoredModel);
      controller.addLog(
        `Import: ${controller.model.events.length} Ereignisse, ${controller.model.identities.size} Knoten.`,
        'ok',
      );
      rendererRef.current?.requestFit();
      controller.refreshNow();
    } catch (err) {
      controller.addLog(`Import fehlgeschlagen: ${String(err)}`, 'error');
    }
  };

  return (
    <>
      <div className="row">
        <button className="btn btn--sm" onClick={exportData}>
          Exportieren
        </button>
        <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>
          Importieren
        </button>
        <button
          className="btn btn--sm"
          title="Verwirft Pakete, Routen und Nachrichten. Die Kontakte mit Namen und Positionen bleiben stehen."
          onClick={() => {
            if (!window.confirm('Aufgezeichneten Verkehr und alle Nachrichten verwerfen? Die Kontakte bleiben erhalten.')) {
              return;
            }
            controller.clearTraffic();
            controller.addLog('Verkehr und Nachrichten verworfen, Kontakte behalten.');
          }}
        >
          Nur Verkehr verwerfen
        </button>
        <button
          className="btn btn--sm btn--danger"
          title="Verwirft zusätzlich alle Kontakte."
          onClick={() => {
            if (!window.confirm('Alle aufgezeichneten Pakete UND alle Knoten verwerfen?')) return;
            controller.clearData();
            localStorage.removeItem(localStorageKey());
            controller.addLog('Aufzeichnung vollständig verworfen.');
          }}
        >
          Alles verwerfen
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={prefs.persist}
          onChange={(e) => set('persist', e.target.checked)}
        />
        im Browser speichern
      </label>
      <input
        type="file"
        accept="application/json"
        hidden
        ref={fileRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importData(file);
          e.target.value = '';
        }}
      />
    </>
  );
}
