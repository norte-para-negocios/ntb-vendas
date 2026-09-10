'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X } from 'lucide-react';
import { SPRING_SHEET } from '@/lib/motion';

// Pedido direto do dono (2026-09-10): a atualização automática do app
// desktop já baixa e aplica sozinha (ver desktop/electron/main.js), mas
// era inteiramente invisível — só uma Notification passageira do SO, que
// some sozinha e pode nem aparecer (foco ocupado, "não perturbe"). Sem
// nada na TELA, "acho que a atualização não está funcionando" é a reação
// natural de quem nunca vê prova nenhuma de que ela rodou. Este banner
// fica fixo até alguém agir: "Atualizar agora" fecha e reabre o app já
// na versão nova (`quitAndInstall`, ver main.js); "Depois" só esconde até
// o próximo reinício — a instalação automática ao fechar o app continua
// garantida de qualquer jeito (`autoInstallOnAppQuit`), o botão só existe
// pra quem não quer esperar sem saber se vai mesmo acontecer.
export function DesktopUpdateBanner() {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronApp?.isElectron) return;
    window.electronApp.onUpdateDownloaded?.((info) => setUpdateVersion(info.version));
  }, []);

  if (!updateVersion || dismissed) return null;

  const handleInstall = () => {
    setInstalling(true);
    window.electronApp?.installUpdate?.();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={SPRING_SHEET}
        className="fixed bottom-4 right-4 z-[9999] flex items-center gap-3 rounded-[var(--r-lg)] bg-[var(--ink)] px-4 py-3 shadow-2xl border border-white/10"
        style={{ maxWidth: 420 }}
      >
        <div className="shrink-0 w-9 h-9 rounded-full bg-[var(--brand)]/20 flex items-center justify-center">
          <Download size={18} className="text-[var(--brand)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white">Nova versão pronta (v{updateVersion})</p>
          <p className="text-[12px] text-white/50">Atualiza em segundos — o app fecha e reabre sozinho.</p>
        </div>
        <button
          onClick={handleInstall}
          disabled={installing}
          className="shrink-0 px-3 py-1.5 rounded-[var(--r-md)] bg-[var(--brand)] text-white text-[13px] font-semibold u-motion u-press disabled:opacity-60"
        >
          {installing ? 'Atualizando...' : 'Atualizar agora'}
        </button>
        {!installing && (
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 text-white/40 hover:text-white/80 u-motion"
            aria-label="Depois"
            title="Depois"
          >
            <X size={16} />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
