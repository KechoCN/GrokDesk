import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSnapshot } from '../shared/api';

export function errorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error:\s*/, '').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
}

export function useDesk() {
  const [state, setState] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const accept = useCallback((next: AppSnapshot) => {
    if (mounted.current) setState(old => !old || next.version >= old.version ? next : old);
  }, []);
  const run = useCallback(async <T,>(operation: Promise<T>): Promise<T | undefined> => {
    try {
      const result = await operation;
      if (result && typeof result === 'object' && 'conversations' in result && 'version' in result) accept(result as unknown as AppSnapshot);
      return result;
    } catch (reason) {
      if (mounted.current) setNotice(errorMessage(reason));
      return undefined;
    }
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    if (!window.grokdesk) { setError('desktop'); return; }
    const unsubscribe = window.grokdesk.onEvent(event => {
      if (event.type === 'state') accept(event.state);
      if (event.type === 'notice') setNotice(event.message);
    });
    window.grokdesk.bootstrap().then(accept).catch(reason => setError(errorMessage(reason)));
    return () => { mounted.current = false; unsubscribe(); };
  }, [accept]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return { state, accept, run, error, notice, setNotice };
}

export type RunAction = ReturnType<typeof useDesk>['run'];
