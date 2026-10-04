'use client';
import React, { useState } from 'react';
import { SegmentedControl } from '@/components/ui';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { useNotificacoes } from '@/components/NotificacoesContext';
import { abasProducao, locaisAcessiveis } from '@/lib/producaoNav';
import type { Store } from '@/types';

export const ProducaoView: React.FC<{ store: Store; acessiveis: Set<string>; renderKds: (local: { chave: string; base: 'kitchen' | 'bar'; setorId: string | null }) => React.ReactNode }> = ({ store, acessiveis, renderKds }) => {
  const { locais, porLocal } = useNotificacoes();
  const visiveis = locaisAcessiveis(locais, acessiveis);
  const chaveSalva = `ntb-producao-aba:${store.id}`;
  const [ativa, setAtiva] = useState<string>(() => { try { return localStorage.getItem(chaveSalva) || ''; } catch { return ''; } });
  const abas = abasProducao(visiveis, porLocal);
  const atual = abas.find((a) => a.chave === ativa) ?? abas[0];
  if (!atual) return <p className="text-sm text-[var(--text-muted)]">Nenhum local de preparo disponível para o seu usuário.</p>;
  const escolher = (v: string) => { setAtiva(v); try { localStorage.setItem(chaveSalva, v); } catch { /* sem persistência */ } };
  return (
    <div>
      <div className="overflow-x-auto no-scrollbar mb-4 -mx-1 px-1">
        <SegmentedControl
          value={atual.chave}
          onChange={escolher}
          options={abas.map((a) => ({
            value: a.chave,
            label: <>{a.nome} <AnimatedNumber value={a.count} format={(n) => String(Math.round(n))} className="num font-medium text-[var(--text-muted)]" /></>,
          }))}
        />
      </div>
      {renderKds(atual)}
    </div>
  );
};
