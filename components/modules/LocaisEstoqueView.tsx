'use client';
// Locais de estoque da loja: onde o item fica guardado (Estoque geral, Câmara fria, Bar...), e de qual local de estoque
// cada local de preparo (Cozinha, Bar, Pizzaria...) tira os itens que vende. Em modo "Estoque próprio" os locais
// nascem aqui e são criados no Norte Estoque; em modo Omie o cadastro continua no Omie (a tela só mostra e mapeia).
import React, { useCallback, useEffect, useState } from 'react';
import { Warehouse, Plus, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchLocaisEstoque, salvarLocalEstoque, criarLocalEstoque, fetchPrintSectors, type LocaisEstoqueStatus } from '@/lib/api';
import { listarLocais } from '@/lib/locaisPreparo';
import { modoDaLoja, usaEstoque, ehProprio, nomeSistemaEstoque } from '@/lib/modoEstoque';
import type { PrintSector, Store } from '@/types';

export const LocaisEstoqueView: React.FC<{ store: Store; podeEditar: boolean }> = ({ store, podeEditar }) => {
  const modo = modoDaLoja(store);
  const [carregando, setCarregando] = useState(true);
  const [estoque, setEstoque] = useState<LocaisEstoqueStatus | null>(null);
  const [setores, setSetores] = useState<PrintSector[]>([]);
  const [novoNome, setNovoNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [est, sts] = await Promise.all([
      fetchLocaisEstoque(store.id).catch(() => null),
      fetchPrintSectors(store.id).catch(() => [] as PrintSector[]),
    ]);
    setEstoque(est);
    setSetores(sts);
    setCarregando(false);
  }, [store.id]);

  useEffect(() => { if (usaEstoque(modo)) carregar(); else setCarregando(false); }, [carregar, modo]);

  if (!usaEstoque(modo)) {
    return (
      <Card className="p-5 space-y-1">
        <p className="text-[16px] font-semibold text-[var(--text)]">Esta loja não controla estoque</p>
        <p className="text-[14px] text-[var(--text-muted)]">As vendas não baixam estoque. Para usar locais de estoque, o Master Admin troca o modo da loja em Editar Loja (antes da primeira baixa).</p>
      </Card>
    );
  }
  if (carregando) return <p className="text-sm text-[var(--text-muted)] py-6 text-center">Carregando locais de estoque...</p>;

  const sistema = nomeSistemaEstoque(modo);
  const integrado = !!estoque?.configurado;
  const locais = estoque?.locais ?? [];
  const mapa = estoque?.mapa ?? {};
  const locaisPreparo = listarLocais(setores.map((s) => ({ id: s.id, name: s.name, base: s.base })));
  const nomeDoLocalEstoque = (codigo: number) => locais.find((l) => l.codigo === codigo)?.nome ?? `Local ${codigo}`;
  const semMapa = locaisPreparo.filter((l) => !mapa[l.chave]);

  const criar = async () => {
    const nome = novoNome.trim();
    if (nome.length < 2) { toast.error('Digite o nome do local de estoque.'); return; }
    setCriando(true);
    try {
      const r = await criarLocalEstoque(store.id, nome);
      if (!r.success) { toast.error(r.message || 'Não consegui criar o local.'); return; }
      setNovoNome('');
      toast.success(`Local de estoque "${nome}" criado.`);
      await carregar();
    } finally { setCriando(false); }
  };

  const escolher = async (chave: string, valor: string) => {
    const local = valor ? locais.find((l) => String(l.codigo) === valor) ?? null : null;
    setSalvando(chave);
    try {
      const r = await salvarLocalEstoque(store.id, chave, local);
      if (!r.success) { toast.error(r.message || 'Não consegui salvar.'); return; }
      setEstoque((prev) => {
        if (!prev) return prev;
        const proximo = { ...prev.mapa };
        if (local) proximo[chave] = local.codigo; else delete proximo[chave];
        return { ...prev, mapa: proximo };
      });
    } finally { setSalvando(null); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">Locais de estoque</h3>
        <p className="text-[13px] leading-snug text-[var(--text-muted)] mt-0.5">
          {ehProprio(modo)
            ? 'Onde cada item fica guardado no estoque da loja. Crie os locais aqui (eles aparecem no Norte Estoque) e diga de qual deles cada local de preparo tira o que vende.'
            : `Os locais vêm do ${sistema}. Aqui você diz de qual deles cada local de preparo tira o que vende.`}
        </p>
      </div>

      {!integrado && (
        <p className="text-xs text-[var(--warn)] bg-[var(--warn)]/10 rounded-[var(--r-md)] p-3">
          A integração com o Norte Estoque não está ligada nesta loja. Ligue em Configurações &gt; Integrações para ver e criar locais.
        </p>
      )}
      {integrado && estoque?.erro && (
        <p className="text-xs text-[var(--warn)] bg-[var(--warn)]/10 rounded-[var(--r-md)] p-3">
          Não consegui ler os locais de estoque agora ({estoque.erro}). As escolhas já salvas continuam valendo.
        </p>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Warehouse size={18} className="text-[var(--brand)]" aria-hidden />
          <p className="text-[15px] font-semibold text-[var(--text)]">Locais da loja</p>
          <Badge variant="default">{locais.length}</Badge>
        </div>
        {locais.length === 0 ? (
          <p className="text-[14px] text-[var(--text-muted)]">{integrado ? 'Nenhum local de estoque cadastrado ainda.' : 'Sem locais para mostrar.'}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface-2)]/60">
            {locais.map((l) => {
              const usadoPor = locaisPreparo.filter((p) => mapa[p.chave] === l.codigo).map((p) => p.nome);
              return (
                <li key={l.codigo} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                  <span className="text-[14px] font-medium text-[var(--text)]">{l.nome}</span>
                  <span className="text-xs text-[var(--text-muted)]">{usadoPor.length ? `Abastece: ${usadoPor.join(', ')}` : 'Nenhum local de preparo usa este local'}</span>
                </li>
              );
            })}
          </ul>
        )}
        {ehProprio(modo) && integrado && podeEditar && (
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="flex-1 min-w-[180px]">
              <Input label="Novo local de estoque" placeholder="Ex: Câmara fria" value={novoNome} maxLength={60} onChange={(e) => setNovoNome(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') criar(); }} />
            </div>
            <Button onClick={criar} isLoading={criando}><Plus size={16} /> Criar local</Button>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <p className="text-[15px] font-semibold text-[var(--text)]">De onde cada local de preparo tira o estoque</p>
        <ul className="divide-y divide-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface-2)]/60">
          {locaisPreparo.map((p) => {
            const atual = mapa[p.chave];
            return (
              <li key={p.chave} className="flex flex-wrap items-center gap-3 px-3 py-3 max-sm:flex-col max-sm:items-stretch">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[var(--text)] flex items-center gap-1.5"><span className="shrink-0 mr-1">{atual ? <CheckCircle2 size={18} className="text-[var(--ok)]" aria-label="Ligado" /> : <AlertTriangle size={18} className="text-[var(--warn)]" aria-label="Sem local" />}</span>{p.nome} <ArrowRight size={13} className="text-[var(--text-muted)]" aria-hidden /> <span className="text-[var(--text-muted)] font-normal">{atual ? nomeDoLocalEstoque(atual) : 'sem local escolhido'}</span></p>
                </div>
                <select
                  value={atual ? String(atual) : ''}
                  disabled={!podeEditar || salvando === p.chave || locais.length === 0}
                  onChange={(e) => escolher(p.chave, e.target.value)}
                  aria-label={`Local de estoque de ${p.nome}`}
                  className="min-w-[220px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] max-sm:text-base disabled:opacity-60"
                >
                  <option value="">{locais.length === 0 ? 'Cadastre um local primeiro' : 'Escolha o local...'}</option>
                  {locais.map((l) => <option key={l.codigo} value={l.codigo}>{l.nome}</option>)}
                </select>
              </li>
            );
          })}
        </ul>
        {semMapa.length > 0 && locais.length > 0 && (
          <p className="text-xs text-[var(--text-muted)]">Local de preparo sem local de estoque usa o local padrão da loja ao baixar ({semMapa.map((p) => p.nome).join(', ')}).</p>
        )}
      </Card>
    </div>
  );
};
