import { useEffect, useRef } from 'react';

// Fallback do Realtime (que no Contabo conecta mas não entrega eventos entre
// computadores): reexecuta `fn` a cada `ms` enquanto a aba está visível, e
// imediatamente ao voltar pro foco. `fn` fica em ref, então trocar a função
// a cada render não reinicia o intervalo.
export function usePolling(fn: () => void, ms = 5000, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const tick = () => { if (document.visibilityState === 'visible') ref.current(); };
    const id = window.setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [ms, enabled]);
}
