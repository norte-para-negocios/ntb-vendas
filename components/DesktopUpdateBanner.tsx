'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Download, RotateCcw, X } from 'lucide-react';
import { SPRING_SHEET } from '@/lib/motion';
import { formatAppVersion } from '@/lib/appVersion';

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

// Quanto tempo o "Entendi" segura a faixa de erro. Curto o bastante pra uma
// falha real voltar a incomodar no mesmo turno, longo o bastante pra não
// virar ruído em cima de quem está no meio de uma venda.
const ERRO_SILENCIO_MS = 30 * 60 * 1000;

export function DesktopUpdateBanner() {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [recuperou, setRecuperou] = useState(false);
  // Achado da revisão independente: `situacao`/`detalhe` já eram gravados
  // pelo processo principal (ver desktop/electron/main.js) e expostos pelo
  // IPC, mas NINGUÉM lia. Se a internet da loja caía no meio do download, o
  // erro ia só pro update.log, o toast do botão "procurar atualização"
  // continuava prometendo "o aviso aparece assim que terminar", e esse
  // aviso nunca vinha — o operador não tinha como saber de jeito nenhum.
  const [erroUpdate, setErroUpdate] = useState<string | null>(null);
  // Guardado pra não reaparecer a cada poll depois de o operador fechar;
  // um erro DIFERENTE (outro detalhe) volta a aparecer na hora, porque é
  // informação nova, não a mesma que ele já leu.
  //
  // Achado da revisão (2026-09-13): silenciar PRA SEMPRE pelo texto do erro
  // reabria justamente o buraco que este aviso existe pra fechar — no caso
  // mais comum (internet da loja fora por horas), toda checagem de 4 em 4h
  // devolve exatamente a MESMA mensagem, então um único "Entendi" apagaria
  // o aviso pro resto do dia enquanto a atualização segue falhando. Por
  // isso a dispensa é temporária: silencia pra deixar trabalhar, mas uma
  // falha que PERSISTE volta a aparecer — que é a verdade.
  const [erroDispensado, setErroDispensado] = useState<{ detalhe: string; em: number } | null>(null);
  // Redesenha junto com o poll (o `setErroUpdate` sozinho não redesenha
  // quando o detalhe é idêntico — React descarta state igual), senão a
  // janela de silêncio venceria sem ninguém perceber até o próximo clique.
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronApp?.isElectron) return;
    window.electronApp.onUpdateDownloaded?.((info) => setUpdateVersion(info.version));
    // Achado da revisão independente: quando o renderer morre, main.js
    // recarrega a janela sozinho — e até aqui isso era 100% invisível. Pra
    // quem está no caixa, a tela pisca e volta limpa, o que é
    // indistinguível de "a operação foi concluída". O aviso precisa vir do
    // processo principal porque quem sabe que houve recarga é ele; a página
    // que recebe este evento é uma página NOVA, sem memória do que morreu.
    window.electronApp.onRecuperouDeFalha?.(() => setRecuperou(true));
    // Pergunta o estado assim que a tela monta, em vez de só esperar o
    // evento acima. Achado real (2026-09-13): o evento é disparado UMA vez,
    // no instante em que o download termina — se a tela ainda não existia
    // (app recém-aberto) ou se a janela recarregou depois (inclusive pela
    // recuperação automática de tela branca), o aviso se perdia e a
    // atualização já baixada ficava invisível. Era exatamente o "nem
    // aparece o botão de atualizar".
    const consultar = () => {
      window.electronApp?.getUpdateStatus?.()
        .then((s) => {
          if (s?.versaoBaixada) setUpdateVersion(s.versaoBaixada);
          setErroUpdate(s?.situacao === 'erro' ? (s.detalhe || 'sem detalhe') : null);
          setAgora(Date.now());
        })
        .catch(() => {});
    };
    consultar();
    // A falha pode acontecer a QUALQUER momento com a tela já aberta (a
    // checagem automática roda de 4 em 4h, e o download demora) — sem um
    // poll, só quem recarregasse a janela por acaso veria o aviso. 60s é
    // barato: é uma leitura de variável em memória via IPC, sem rede.
    const t = setInterval(consultar, 60000);
    return () => clearInterval(t);
  }, []);

  const mostrarUpdate = !!updateVersion && !dismissed;
  // Atualização já baixada ganha a faixa de sucesso — um erro velho de uma
  // tentativa anterior não faz mais diferença nenhuma pra quem está na tela.
  const silenciado = !!erroDispensado
    && erroDispensado.detalhe === erroUpdate
    && agora - erroDispensado.em < ERRO_SILENCIO_MS;
  const mostrarErro = !!erroUpdate && !mostrarUpdate && !silenciado;
  if (!mostrarUpdate && !recuperou && !mostrarErro) return null;

  const handleInstall = () => {
    setInstalling(true);
    window.electronApp?.installUpdate?.();
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2" style={{ maxWidth: 420 }}>
    <AnimatePresence>
      {recuperou && (
      // Deliberadamente DIFERENTE do aviso de lacuna de impressão da estação
      // do caixa (CaixaPrintStation.tsx), que fala de pedido que pode não ter
      // sido impresso: este fala da JANELA do app, que morreu e recarregou
      // sozinha — o que estava digitado/aberto na tela se perdeu junto, e só
      // quem estava mexendo sabe dizer se a ação chegou a ser concluída.
      <motion.div
        key="recuperou"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={SPRING_SHEET}
        className="flex items-center gap-3 rounded-[var(--r-lg)] bg-[var(--warn)] px-4 py-3 shadow-2xl border border-black/10"
      >
        <div className="shrink-0 w-9 h-9 rounded-full bg-black/10 flex items-center justify-center">
          <RotateCcw size={18} className="text-[var(--ink)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-[var(--ink)]">O aplicativo travou e se recuperou sozinho</p>
          <p className="text-[12px] font-medium text-[var(--ink)]/80">Confira se a última coisa que você estava fazendo foi concluída.</p>
        </div>
        <button
          onClick={() => setRecuperou(false)}
          className="shrink-0 px-3 py-1.5 rounded-[var(--r-md)] bg-[var(--ink)] text-white text-[13px] font-semibold u-motion u-press"
        >
          Entendi
        </button>
      </motion.div>
      )}
      {mostrarErro && (
      // Terceiro estado da mesma pilha (recuperação de falha + atualização
      // baixada): a atualização TENTOU e não conseguiu. Texto sem jargão e
      // sem pedir nada pro operador — o electron-updater tenta de novo
      // sozinho na próxima checagem; ele só precisa saber que não é ele
      // que está esquecendo de atualizar o PDV.
      <motion.div
        key="erro-update"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={SPRING_SHEET}
        className="flex items-center gap-3 rounded-[var(--r-lg)] bg-[var(--err)] px-4 py-3 shadow-2xl border border-black/10"
      >
        <div className="shrink-0 w-9 h-9 rounded-full bg-black/15 flex items-center justify-center">
          <AlertTriangle size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-white">Não consegui baixar a atualização — vou tentar de novo sozinho.</p>
          <p className="text-[12px] font-medium text-white/80 break-words">{erroUpdate}</p>
        </div>
        <button
          onClick={() => setErroDispensado({ detalhe: erroUpdate, em: Date.now() })}
          className="shrink-0 px-3 py-1.5 rounded-[var(--r-md)] bg-white/20 hover:bg-white/30 text-white text-[13px] font-semibold u-motion u-press"
        >
          Entendi
        </button>
      </motion.div>
      )}
      {mostrarUpdate && (
      <motion.div
        key="update"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={SPRING_SHEET}
        className="flex items-center gap-3 rounded-[var(--r-lg)] bg-[var(--ink)] px-4 py-3 shadow-2xl border border-white/10"
      >
        <div className="shrink-0 w-9 h-9 rounded-full bg-[var(--brand)]/20 flex items-center justify-center">
          <Download size={18} className="text-[var(--brand)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white">Nova versão pronta ({formatAppVersion(updateVersion)})</p>
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
      )}
    </AnimatePresence>
    </div>
  );
}
