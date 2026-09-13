/** Laufendes Protokoll der Ereignisse. */

import { useEffect, useRef, type JSX } from 'react';
import { useMesh, useSlice } from '../../state/store';

export function EventLog(): JSX.Element {
  const controller = useMesh();
  useSlice('ui');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  return (
    <div className="log" ref={ref}>
      {controller.log.map((line) => (
        <div key={line.id} className={`log__line log__line--${line.level}`}>
          {new Date(line.t).toLocaleTimeString('de-DE')} {line.msg}
        </div>
      ))}
    </div>
  );
}
