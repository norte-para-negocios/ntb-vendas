'use client';
import React, { useState } from 'react';
import { ChipsLocal } from '@/components/modules/ProducaoCabecalho';
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
      {abas.length > 1 && (
        <div className="mb-3">
          <ChipsLocal value={atual.chave} onChange={escolher} opcoes={abas.map((a) => ({ id: a.chave, nome: a.nome, count: a.count }))} />
        </div>
      )}
      {renderKds(atual)}
    </div>
  );
};
