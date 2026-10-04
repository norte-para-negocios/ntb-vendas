'use client';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Hand, Receipt, ChefHat, CheckCircle2, Clock, Package, FileWarning, Wallet, Printer, PackageX } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { useNotificacoes } from '@/components/NotificacoesContext';
import { LIST_ITEM_MOTION, SPRING_TAP } from '@/lib/motion';
import { tempoRelativo, type TipoNotificacao } from '@/lib/notificacoes';

const ICONE: Record<TipoNotificacao, React.ElementType> = {
  chamada_garcom: Hand, pedido_conta: Receipt, pedido_novo: ChefHat, item_pronto: CheckCircle2, item_atrasado: Clock,
  estoque_baixo: Package, nota_rejeitada: FileWarning, sangria_alta: Wallet, impressora_falhou: Printer, baixa_estoque_erro: PackageX,
};

export const NotificationBell: React.FC<{ variant: 'header' | 'sidebar'; collapsed?: boolean }> = ({ variant, collapsed }) => {
  const { eventos, naoLidos, marcarLidos, pausado } = useNotificacoes();
  const [aberto, setAberto] = useState(false);
  // O cabeçalho do celular tem backdrop-blur, que vira o "bloco de contenção" do `fixed` e empurra o Modal para fora da tela.
  // Por isso a janela vai para o <body> (portal). Fechada, ela não renderiza nada, então não há diferença entre servidor e cliente.
  const montado = typeof document !== 'undefined';
  const agora = Date.now();
  const botao = variant === 'sidebar'
    ? `flex items-center w-full px-3 h-10 rounded-[10px] text-[13px] font-medium u-motion whitespace-nowrap text-white/60 hover:bg-white/10 hover:text-white ${collapsed ? 'justify-center' : 'gap-3'}`
    : 'w-11 h-11 flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface-2)] rounded-full u-motion u-press shrink-0';
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={`relative ${botao}`} aria-label={naoLidos > 0 ? `Avisos, ${naoLidos} não lidos` : 'Avisos'}>
        <Bell size={variant === 'sidebar' ? 18 : 20} />
        {variant === 'sidebar' && !collapsed && <span>Avisos</span>}
        <AnimatePresence>
          {naoLidos > 0 && (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={SPRING_TAP}
              className={`bg-[var(--err-fill)] text-white text-[10px] font-semibold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center num ${variant === 'sidebar' && !collapsed ? 'ml-auto' : 'absolute top-1 right-1'}`}
            >
              <AnimatedNumber value={Math.min(naoLidos, 99)} format={(n) => String(Math.round(n))} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      {montado && createPortal(
      <Modal isOpen={aberto} onClose={() => setAberto(false)} title="Avisos" variant="sheet">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-[var(--text-muted)]">{pausado ? 'Sem conexão — os avisos voltam quando a internet voltar.' : 'Só o que pede uma ação sua.'}</p>
            <Button size="sm" variant="ghost" disabled={naoLidos === 0} onClick={() => marcarLidos()}>Marcar todos como lidos</Button>
          </div>
          {eventos.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">Nada pendente por aqui.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface-2)]/60">
              <AnimatePresence mode="popLayout">
                {eventos.map((e) => {
                  const Icone = ICONE[e.tipo];
                  return (
                    <motion.li key={e.id} {...LIST_ITEM_MOTION}>
                      <button type="button" onClick={() => marcarLidos([e.id])} className={`w-full min-h-11 flex items-start gap-3 px-3 py-3 text-left u-press-sm ${e.ativo ? '' : 'opacity-60'}`}>
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[var(--text)]"><Icone size={16} /></span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[15px] text-[var(--text)] ${e.lido ? 'font-medium' : 'font-semibold'}`}>{e.titulo}</span>
                          {e.detalhe && <span className="block text-[13px] text-[var(--text-muted)]">{e.detalhe}</span>}
                        </span>
                        <span className="shrink-0 text-right text-[12px] text-[var(--text-muted)] num">
                          {e.ativo ? tempoRelativo(e.criadoEm, agora) : 'resolvido'}
                          {!e.lido && e.ativo && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[var(--brand)] align-middle" />}
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </Modal>,
      document.body)}
    </>
  );
};
