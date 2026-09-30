'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { registerPlugin } from '@capacitor/core';
import { formatAppVersion } from '@/lib/appVersion';

// Atualização automática do app Android (equivalente do DesktopUpdateBanner do
// Windows). A checagem e o download são do plugin nativo NtbUpdater; aqui só
// fica o aviso. O Android sempre mostra uma tela de confirmação do sistema pra
// instalar — não dá pra instalar sem esse toque.
interface NtbUpdaterPlugin {
  checkForUpdate(opts: { manifestUrl: string }): Promise<{ available: boolean; versionCode?: number; versionName?: string; url?: string; erro?: string }>;
  downloadAndInstall(opts: { url: string }): Promise<{ status: 'instalador-aberto' | 'permissao' }>;
}
const NtbUpdater = registerPlugin<NtbUpdaterPlugin>('NtbUpdater');

const MANIFEST_URL = process.env.NEXT_PUBLIC_NTB_UPDATE_URL || 'https://updates.norteparanegocios.com.br/ntb-vendas-android/latest.json';
const CHECAR_A_CADA_MS = 10 * 60 * 1000;

export function NtbUpdateBanner() {
  const [nova, setNova] = useState<{ versionName: string; url: string } | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // "Depois" (30/09, pedido do dono): atualização não pode travar o uso do app.
  const [adiada, setAdiada] = useState<string | null>(null);
  const ultimaChecagem = useRef(0);

  const checar = useCallback(async () => {
    if (Date.now() - ultimaChecagem.current < 60 * 1000) return;
    ultimaChecagem.current = Date.now();
    try {
      const r = await NtbUpdater.checkForUpdate({ manifestUrl: MANIFEST_URL });
      if (r.available && r.url) setNova({ versionName: r.versionName || '', url: r.url });
    } catch {
      // Sem casca nativa (navegador) ou sem rede: silencioso, tenta de novo depois.
    }
  }, []);

  useEffect(() => {
    const primeira = setTimeout(checar, 4000);
    const intervalo = setInterval(checar, CHECAR_A_CADA_MS);
    const aoVoltar = () => { if (document.visibilityState === 'visible') checar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearTimeout(primeira); clearInterval(intervalo); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [checar]);

  const atualizar = async () => {
    if (!nova || baixando) return;
    setBaixando(true);
    setAviso(null);
    try {
      const r = await NtbUpdater.downloadAndInstall({ url: nova.url });
      if (r.status === 'permissao') setAviso('Na tela que abriu, ative "Permitir desta fonte" e volte aqui para tocar em Atualizar de novo.');
    } catch (e: any) {
      setAviso(`Não foi possível baixar agora (${e?.message || 'sem conexão'}). Tente de novo.`);
    } finally {
      setBaixando(false);
    }
  };

  if (!nova || adiada === nova.versionName) return null;

  // 30/09: não é mais obrigatória (travava o uso) — aviso no rodapé com "Depois".
  return (
    <div style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom) + 88px)', zIndex: 10000 }} className="rounded-[18px] bg-[var(--surface)] p-4 shadow-2xl border border-[var(--border)]">
      <p className="text-[15px] font-bold text-[var(--text)]">Nova versão do Norte Vendas{nova.versionName ? ` (${formatAppVersion(nova.versionName)})` : ''}</p>
      <p className="text-[13px] text-[var(--text-muted)] mt-1">{aviso || 'Atualize quando puder: toque em Atualizar e confirme a instalação.'}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setAdiada(nova.versionName)} className="h-11 flex-1 rounded-full bg-[var(--surface-2)] text-[var(--text)] font-semibold text-[15px]">Depois</button>
        <button type="button" onClick={atualizar} disabled={baixando} className="h-11 flex-1 rounded-full bg-[var(--brand-fill,var(--brand))] text-white font-bold text-[15px] disabled:opacity-60">
          {baixando ? 'Baixando…' : 'Atualizar'}
        </button>
      </div>
    </div>
  );
}
