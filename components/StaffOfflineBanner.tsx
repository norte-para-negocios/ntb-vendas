'use client';
// Faixa fixa para a EQUIPE quando cai a internet (pesquisa de design, 04/10): mostra que está offline e quantas
// ações estão na fila, e some sozinha quando sincroniza. Só leitura da fila (lib/offline/queue.countPending).
import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { countPending, getFailedActions } from '@/lib/offline/queue';
import { OFFLINE_FLAG_MS } from '@/lib/supabaseClient';

export const StaffOfflineBanner: React.FC = () => {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [paradas, setParadas] = useState(0);

  useEffect(() => {
    // Offline = navegador sem rede OU Wi-Fi sem internet de verdade (marca __ntbOfflineAt, lib/offline/network.ts).
    const atualizarRede = () => {
      const marca = (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt;
      const semInternetReal = !!marca && Date.now() - marca < OFFLINE_FLAG_MS;
      setOnline(!semInternetReal);
    };
    atualizarRede();
    window.addEventListener('online', atualizarRede);
    window.addEventListener('offline', atualizarRede);
    let vivo = true;
    const lerFila = () => {
      // Ações que estouraram as tentativas não estão "sincronizando": contam à parte, senão o aviso fica eterno.
      Promise.all([countPending(), getFailedActions(3)]).then(([n, f]) => { if (vivo) { setParadas(f.length); setPending(Math.max(0, n - f.length)); } }).catch(() => {});
    };
    lerFila();
    const t = setInterval(() => { lerFila(); atualizarRede(); }, 5000);
    return () => { vivo = false; clearInterval(t); window.removeEventListener('online', atualizarRede); window.removeEventListener('offline', atualizarRede); };
  }, []);

  if (online && pending === 0 && paradas === 0) return null;
  if (online && pending === 0 && paradas > 0) {
    return (
      <div role="status" aria-live="polite" className="sticky top-0 z-40 flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-semibold bg-[var(--warn-bg,#fff3dd)] text-[var(--warn)]">
        <WifiOff size={14} aria-hidden="true" />
        <span>{`${paradas} ${paradas === 1 ? 'ação não sincronizou' : 'ações não sincronizaram'}. Avise o suporte para conferir.`}</span>
      </div>
    );
  }
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
