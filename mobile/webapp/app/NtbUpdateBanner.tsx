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
  // "Depois" (30/09, pedido do dono): atualização não pode travar o uso do app. Desde 14/10 o aviso é em tela cheia e o
  // "Atualizar depois" vale até o dia seguinte (guardado no aparelho; reabrir o app no mesmo dia não mostra de novo).
  const [adiada, setAdiada] = useState<string | null>(() => lerAdiada());
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

  const depois = () => { guardarAdiada(nova.versionName); setAdiada(nova.versionName); };

  // Não é obrigatória (30/09: a tela obrigatória travou o Sertão): tela cheia com "Atualizar agora" e "Atualizar depois";
  // depois = volta no dia seguinte (14/10, pedido do dono).
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ntb-atualizacao-titulo" style={{ position: 'fixed', inset: 0, zIndex: 10000, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      className="flex items-center justify-center bg-black/55 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-[24px] bg-[var(--surface)] p-6 shadow-2xl border border-[var(--border)] text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center bg-[var(--brand)]/12 text-[var(--brand)] text-[26px] font-bold" aria-hidden="true">↓</div>
        <p id="ntb-atualizacao-titulo" className="text-[19px] font-bold text-[var(--text)] tracking-[-0.01em]">Nova versão do Norte Vendas{nova.versionName ? ` ${formatAppVersion(nova.versionName)}` : ''}</p>
        <p className="text-[14px] text-[var(--text-muted)] mt-2">{aviso || 'Tem melhorias e correções. Toque em Atualizar agora e confirme a instalação. Leva menos de um minuto.'}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={atualizar} disabled={baixando} className="h-12 w-full rounded-full bg-[var(--brand-fill,var(--brand))] text-white font-bold text-[16px] disabled:opacity-60">
            {baixando ? 'Baixando…' : 'Atualizar agora'}
          </button>
          <button type="button" onClick={depois} disabled={baixando} className="h-12 w-full rounded-full bg-[var(--surface-2)] text-[var(--text)] font-semibold text-[16px]">Atualizar depois</button>
        </div>
      </div>
    </div>
  );
}

// "Atualizar depois" vale até o fim do dia: guarda a versão adiada e a data de hoje (aparelho).
const CHAVE_ADIADA = 'ntb-atualizacao-adiada';
const hoje = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso do aparelho
function lerAdiada(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_ADIADA) || 'null') as { versao?: string; dia?: string } | null;
    return v && v.dia === hoje() ? v.versao ?? null : null;
  } catch { return null; }
}
function guardarAdiada(versao: string) {
  try { localStorage.setItem(CHAVE_ADIADA, JSON.stringify({ versao, dia: hoje() })); } catch { /* sem armazenamento: vale só nesta sessão */ }
}
