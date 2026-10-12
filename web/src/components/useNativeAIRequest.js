import { useCallback, useEffect, useRef, useState } from 'react';

function cancelled() {
  const error = new Error('Request canceled.');
  error.name = 'AbortError';
  return error;
}

// Native endpoints keep their existing payload, identity and workflow rules.
export default function useNativeAIRequest() {
  const current = useRef(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current?.abort(); };
  }, []);
  const cancel = useCallback(() => {
    current.current?.abort();
    if (mounted.current) setBusy(false);
  }, []);
  const run = useCallback(async (start) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    if (mounted.current) setBusy(true);
    try {
      const answer = await start(controller.signal);
      if (controller.signal.aborted || !mounted.current) throw cancelled();
      return answer;
    } catch (error) {
      if (controller.signal.aborted) throw cancelled();
      throw error;
    } finally {
      if (current.current === controller) {
        current.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }, []);
  return { run, cancel, busy };
}
