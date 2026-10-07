'use client';

// Casca do cadastro de loja do Master Admin (06/10/2026): navegação por seções à esquerda (abas rolantes no celular),
// conteúdo da seção à direita com rolagem própria e rodapé fixo (erro + salvar). Quem usa decide o que vai em cada seção.
// Todas as seções ficam MONTADAS (só escondidas): o estado do formulário e o foco nunca se perdem ao trocar de seção.
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle } from 'lucide-react';

export interface SecaoNav {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Frase curta sob o nome na navegação (estado atual da seção). */
  resumo?: string;
  /** Ponto de atenção (ex.: campo obrigatório vazio). */
  alerta?: boolean;
}

export const LojaModalShell: React.FC<{
  secoes: SecaoNav[];
  ativa: string;
  onAtiva: (id: string) => void;
  /** Linha acima da navegação (ex.: nome da loja e selo de status). */
  cabecalho?: React.ReactNode;
  rodape: React.ReactNode;
  erro?: string | null;
  children: React.ReactNode;
}> = ({ secoes, ativa, onAtiva, cabecalho, rodape, erro, children }) => {
  const painelRef = React.useRef<HTMLDivElement>(null);
  // Trocar de seção sempre começa do topo.
  React.useEffect(() => { painelRef.current?.scrollTo({ top: 0 }); }, [ativa]);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {cabecalho && <div className="flex-shrink-0 px-5 pb-3 border-b border-[var(--border)]">{cabecalho}</div>}
      <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
        {/* Navegação: coluna no computador, abas rolantes no celular */}
        <nav
          aria-label="Seções do cadastro da loja"
          className="flex-shrink-0 sm:w-[236px] sm:overflow-y-auto sm:border-r border-b sm:border-b-0 border-[var(--border)] bg-[var(--surface-2)]/60"
        >
          <div role="tablist" aria-orientation="vertical" className="flex sm:flex-col gap-1 p-2 sm:p-3 overflow-x-auto sm:overflow-x-visible snap-x">
            {secoes.map((s) => {
              const on = s.id === ativa;
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  id={`aba-loja-${s.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={`painel-loja-${s.id}`}
                  onClick={() => onAtiva(s.id)}
                  className={`group relative flex items-center gap-3 text-left rounded-[12px] px-3 py-2.5 max-sm:py-2 max-sm:px-3 snap-start flex-shrink-0 sm:flex-shrink u-motion u-press-sm ${
                    on
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgba(0,0,0,0.08)] ring-1 ring-[var(--brand)]/25'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface)]/70 hover:text-[var(--text)]'
                  }`}
                >
                  <span className={`flex items-center justify-center w-8 h-8 rounded-[10px] flex-shrink-0 ${on ? 'bg-[var(--brand)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] ring-1 ring-[var(--border)]'}`}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[13px] leading-tight ${on ? 'font-semibold' : 'font-medium'}`}>{s.label}</span>
                    {s.resumo && <span className="block text-[11px] leading-tight text-[var(--text-muted)] truncate max-sm:hidden mt-0.5">{s.resumo}</span>}
                  </span>
                  {s.alerta && <span aria-label="Precisa de atenção" className="absolute right-2 top-2 w-2 h-2 rounded-full bg-[var(--warn)]" />}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Painel da seção */}
        <div ref={painelRef} className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-[820px] px-5 sm:px-8 py-5 sm:py-6 space-y-6">{children}</div>
        </div>
      </div>

      {/* Rodapé fixo */}
      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {erro && (
          <div role="alert" className="mb-2 bg-[var(--err)]/10 text-[var(--err)] p-2.5 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /><span>{erro}</span>
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">{rodape}</div>
      </div>
    </div>
  );
};

/** Conteúdo de UMA seção: só aparece quando é a ativa, mas fica montado. */
export const SecaoLoja: React.FC<{
  id: string;
  ativa: string;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}> = ({ id, ativa, titulo, descricao, children }) => (
  <section
    id={`painel-loja-${id}`}
    role="tabpanel"
    aria-labelledby={`aba-loja-${id}`}
    hidden={ativa !== id}
    className="space-y-5"
  >
    <header>
      <h4 className="text-[18px] font-semibold tracking-[-0.01em] text-[var(--text)]">{titulo}</h4>
      {descricao && <p className="text-[13px] text-[var(--text-muted)] mt-1 max-w-[62ch]">{descricao}</p>}
    </header>
    {children}
  </section>
);

/** Bloco de opção dentro de uma seção (cartão claro com título e texto de apoio). */
export const BlocoOpcao: React.FC<{
  titulo?: string;
  descricao?: string;
  icone?: React.ReactNode;
  children?: React.ReactNode;
  direita?: React.ReactNode;
}> = ({ titulo, descricao, icone, children, direita }) => (
  <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)]/50 p-4 space-y-3">
    {(titulo || direita) && (
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {titulo && <h5 className="text-[14px] font-semibold text-[var(--text)] flex items-center gap-2">{icone}{titulo}</h5>}
          {descricao && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{descricao}</p>}
        </div>
        {direita}
      </div>
    )}
    {children}
  </div>
);

/** Interruptor acessível usado nos blocos. */
export const Interruptor: React.FC<{ ligado: boolean; onChange: (v: boolean) => void; rotulo: string }> = ({ ligado, onChange, rotulo }) => (
  <button
    type="button"
    role="switch"
    aria-checked={ligado}
    aria-label={rotulo}
    onClick={() => onChange(!ligado)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors ${ligado ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ligado ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>
);
