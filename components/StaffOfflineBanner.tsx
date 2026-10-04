'use client';
// Faixa fixa para a EQUIPE quando cai a internet (pesquisa de design, 04/10): mostra que está offline e quantas
// ações estão na fila, e some sozinha quando sincroniza. Só leitura da fila (lib/offline/queue.countPending).
import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { countPending } from '@/lib/offline/queue';

export const StaffOfflineBanner: React.FC = () => {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    // Offline = navegador sem rede OU Wi-Fi sem internet de verdade (marca __ntbOfflineAt, lib/offline/network.ts).
    const atualizarRede = () => {
      const marca = (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt;
      const semInternetReal = !!marca && Date.now() - marca < 30000;
      setOnline(typeof navigator === 'undefined' ? true : navigator.onLine && !semInternetReal);
    };
    atualizarRede();
    window.addEventListener('online', atualizarRede);
    window.addEventListener('offline', atualizarRede);
    let vivo = true;
    const lerFila = () => { countPending().then((n) => { if (vivo) setPending(n); }).catch(() => {}); };
    lerFila();
    const t = setInterval(() => { lerFila(); atualizarRede(); }, 5000);
    return () => { vivo = false; clearInterval(t); window.removeEventListener('online', atualizarRede); window.removeEventListener('offline', atualizarRede); };
  }, []);

  if (online && pending === 0) return null;
  const sincronizando = online && pending > 0;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-40 flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-semibold ${sincronizando ? 'bg-[var(--warn-bg,#fff3dd)] text-[var(--warn)]' : 'bg-[var(--err-fill)] text-white'}`}
    >
      {sincronizando ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
      <span>
        {sincronizando
          ? `Sincronizando ${pending} ${pending === 1 ? 'ação pendente' : 'ações pendentes'}…`
          : `Sem internet${pending > 0 ? ` · ${pending} ${pending === 1 ? 'ação na fila' : 'ações na fila'}` : ''}. O que você lançar fica salvo e sincroniza quando a conexão voltar.`}
      </span>
    </div>
  );
};
