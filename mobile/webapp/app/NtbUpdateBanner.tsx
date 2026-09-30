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

  if (!nova) return null;

  // Pedido do dono (2026-09-29): versão nova = tela na frente de tudo, sem "Depois".
  return (
    <div role="alertdialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 10000 }} className="flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-[420px] rounded-[22px] bg-[var(--surface)] p-7 text-center shadow-2xl">
        <p className="text-[22px] font-bold text-[var(--text)]">Atualização obrigatória</p>
        <p className="text-[15px] text-[var(--text-muted)] mt-2">
          {aviso || `Nova versão do Norte Vendas${nova.versionName ? ` (${formatAppVersion(nova.versionName)})` : ''}. Toque em Atualizar e confirme a instalação.`}
        </p>
        <button
          type="button"
          onClick={atualizar}
          disabled={baixando}
          className="mt-6 h-14 w-full rounded-full bg-[var(--brand-fill,var(--brand))] text-white font-bold text-[17px] disabled:opacity-60"
        >
          {baixando ? 'Baixando…' : 'Atualizar'}
        </button>
      </div>
    </div>
  );
}
