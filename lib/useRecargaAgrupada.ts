import { useEffect, useMemo, useRef } from 'react';
import { agrupar } from '@/lib/agrupar';

// Recarga de tela: `pedir` (para os pings do Realtime) agrupa rajadas em 800 ms; `rodar` (para o polling) executa já.
// Os dois marcam `ultima`, e o usePolling pula o ciclo se houve recarga há menos de 4 s.
export function useRecargaAgrupada(fn: () => void, ms = 800) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const ultima = useRef(0);
  const api = useMemo(() => {
    const rodar = () => { ultima.current = Date.now(); fnRef.current(); };
    const pedir = agrupar(rodar, ms);
    return { rodar, pedir, ultima };
  }, [ms]);
  useEffect(() => () => api.pedir.cancelar(), [api]);
  return api;
}
