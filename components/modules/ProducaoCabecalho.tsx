'use client';
// Cabeçalho das telas de Produção (Cozinha/Bar/locais): mesmo padrão do "Pedidos do Dia" — contadores em tiles + chips de local.
import React from 'react';
import { Tile } from '@/components/modules/PedidosDoDiaView';

export const ResumoKds: React.FC<{ resumo: { novos: number; preparando: number; prontos: number; atrasados: number } }> = ({ resumo }) => (
  <div className="grid grid-cols-4 gap-2">
    <Tile rotulo="Novos" valor={resumo.novos} />
    <Tile rotulo="Preparando" valor={resumo.preparando} />
    <Tile rotulo="Prontos" valor={resumo.prontos} />
    <Tile rotulo="Atrasados" valor={resumo.atrasados} destaque={resumo.atrasados > 0} />
  </div>
);

export const ChipsLocal: React.FC<{ opcoes: { id: string; nome: string; count?: number }[]; value: string; onChange: (id: string) => void }> = ({ opcoes, value, onChange }) => (
  <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1" role="tablist">
    {opcoes.map((c) => (
      <button
        key={c.id}
        type="button"
        role="tab"
        aria-selected={value === c.id}
        onClick={() => onChange(c.id)}
        className={`shrink-0 min-h-9 max-sm:min-h-11 px-3 rounded-full text-[13px] font-semibold border u-motion ${value === c.id ? 'bg-[var(--brand-fill)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'}`}
      >
        {c.nome}{c.count !== undefined && <span className="opacity-70 num"> ({c.count})</span>}
      </button>
    ))}
  </div>
);
