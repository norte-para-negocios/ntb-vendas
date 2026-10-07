'use client';

// Seção "Preparo e impressão" do cadastro de loja (Master Admin, 06/10/2026).
// Os locais de preparo NÃO são fixos: Cozinha e Bar (sempre) + quantos o admin criar (Pizzaria, Sushi, Churrasqueira...).
// Para CADA local: Acompanhamento (tela de produção/KDS) ou Impressão direta (impressora).
// Loja já existente: criar/renomear/apagar local grava na hora (print_sectors). Loja nova: os locais ficam pendentes e o
// pai os cria depois de criar a loja (chave provisória 'setor:tmp-N').
import React from 'react';
import { ChefHat, Wine, Printer, MonitorPlay, Plus, Trash2, Pencil, Check, X, Utensils, Info } from 'lucide-react';
import { fetchPrintSectors, createPrintSector, updatePrintSector, deletePrintSector, fetchPrinterConfigs } from '@/lib/api';
import { ALL_ON, modoDoLocal, type LocalModo, type LocaisModo, type OrderFlow } from '@/lib/storeModules';
import { chaveLocal, type BaseLocal } from '@/lib/locaisPreparo';
import { toast } from '@/components/Toast';
import { confirm } from '@/components/ConfirmDialog';
import { BlocoOpcao } from './LojaModalShell';
import type { PrinterConfig } from '@/types';

export interface LocalPendente { tmpId: string; name: string; base: BaseLocal }

interface Props {
  storeId: string | null;
  /** Valores atuais do formulário (de onde sai o modo "de hoje" de cada local). */
  orderFlow: OrderFlow;
  modKitchenKds: boolean;
  modBarKds: boolean;
  /** Modos já escolhidos explicitamente nesta edição (ou lidos de config.locais_preparo_modo). */
  modos: LocaisModo;
  /** Chamado com o mapa COMPLETO (todos os locais) sempre que o admin muda o modo de algum local. */
  onModosChange: (completo: LocaisModo) => void;
  pendentes: LocalPendente[];
  onPendentesChange: (p: LocalPendente[]) => void;
}

const OPCOES: { valor: LocalModo; titulo: string; texto: string; icone: typeof MonitorPlay }[] = [
  { valor: 'acompanhamento', titulo: 'Acompanhamento', texto: 'Tem tela de produção (KDS): o pedido aparece, a equipe marca "preparando" e "pronto".', icone: MonitorPlay },
  { valor: 'impressao', titulo: 'Impressão direta', texto: 'Sem tela: o pedido sai na impressora do local assim que é enviado.', icone: Printer },
];

export const PreparoImpressaoSection: React.FC<Props> = ({ storeId, orderFlow, modKitchenKds, modBarKds, modos, onModosChange, pendentes, onPendentesChange }) => {
  const [setores, setSetores] = React.useState<{ id: string; name: string; base: BaseLocal }[]>([]);
  const [impressoras, setImpressoras] = React.useState<PrinterConfig[]>([]);
  const [carregando, setCarregando] = React.useState(false);
  const [novoNome, setNovoNome] = React.useState('');
  const [novaBase, setNovaBase] = React.useState<BaseLocal>('kitchen');
  const [editando, setEditando] = React.useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = React.useState('');

  const carregar = React.useCallback(async () => {
    if (!storeId) { setSetores([]); setImpressoras([]); return; }
    setCarregando(true);
    try {
      const [s, p] = await Promise.all([fetchPrintSectors(storeId), fetchPrinterConfigs(storeId)]);
      setSetores(s.map((x) => ({ id: x.id, name: x.name, base: x.base })));
      setImpressoras(p);
    } finally { setCarregando(false); }
  }, [storeId]);
  React.useEffect(() => { carregar(); }, [carregar]);

  // Lista de locais (Cozinha e Bar sempre; depois os criados — já gravados ou pendentes).
  const locais = React.useMemo(() => {
    const base = [
      { chave: 'kitchen', nome: 'Cozinha', base: 'kitchen' as BaseLocal, id: null as string | null, tmp: false, fixo: true },
      { chave: 'bar', nome: 'Bar', base: 'bar' as BaseLocal, id: null as string | null, tmp: false, fixo: true },
    ];
    setores.forEach((s) => base.push({ chave: chaveLocal(s.id, s.base), nome: s.name, base: s.base, id: s.id, tmp: false, fixo: false }));
    pendentes.forEach((p) => base.push({ chave: `setor:${p.tmpId}`, nome: p.name, base: p.base, id: p.tmpId, tmp: true, fixo: false }));
    return base;
  }, [setores, pendentes]);

  // Modo efetivo: o escolhido; senão o que a loja já faz hoje (fluxo + módulos KDS).
  const pseudoLoja = React.useMemo(() => ({ config: { order_flow: orderFlow, modules: { ...ALL_ON, kitchen_kds: modKitchenKds, bar_kds: modBarKds }, locais_preparo_modo: modos } }), [orderFlow, modKitchenKds, modBarKds, modos]);
  const modoEfetivo = (chave: string): LocalModo => modoDoLocal(pseudoLoja, chave);
  const mapaCompleto = (override?: { chave: string; modo: LocalModo }): LocaisModo => {
    const m: LocaisModo = {};
    locais.forEach((l) => { m[l.chave] = modoEfetivo(l.chave); });
    if (override) m[override.chave] = override.modo;
    return m;
  };

  const escolher = (chave: string, modo: LocalModo) => {
    if (modoEfetivo(chave) === modo && modos[chave] === modo) return;
    onModosChange(mapaCompleto({ chave, modo }));
  };

  const impressorasDoLocal = (l: { chave: string; id: string | null; tmp: boolean; base: BaseLocal }) => {
    if (l.tmp) return [];
    if (l.chave === 'kitchen') return impressoras.filter((p) => !p.sector_id && (p.destination === 'kitchen' || p.destination === 'all') && p.is_active);
    if (l.chave === 'bar') return impressoras.filter((p) => !p.sector_id && (p.destination === 'bar' || p.destination === 'all') && p.is_active);
    return impressoras.filter((p) => p.sector_id === l.id && p.is_active);
  };

  const adicionar = async () => {
    const nome = novoNome.trim();
    if (nome.length < 2) { toast.error('Dê um nome ao local (ex.: Pizzaria).'); return; }
    if (locais.some((l) => l.nome.toLowerCase() === nome.toLowerCase())) { toast.error('Já existe um local com esse nome.'); return; }
    if (storeId) {
      const r = await createPrintSector(storeId, nome, novaBase);
      if (!r) { toast.error('Não foi possível criar o local.'); return; }
      toast.success(`Local "${nome}" criado.`);
      await carregar();
    } else {
      onPendentesChange([...pendentes, { tmpId: `tmp-${Date.now().toString(36)}`, name: nome, base: novaBase }]);
    }
    setNovoNome('');
  };

  const salvarNome = async (l: { id: string | null; tmp: boolean }) => {
    const nome = nomeEdicao.trim();
    if (nome.length < 2) return;
    if (l.tmp) onPendentesChange(pendentes.map((p) => (p.tmpId === l.id ? { ...p, name: nome } : p)));
    else if (l.id) { await updatePrintSector(l.id, { name: nome }); await carregar(); }
    setEditando(null);
  };

  const apagar = async (l: { id: string | null; tmp: boolean; nome: string }) => {
    if (l.tmp) { onPendentesChange(pendentes.filter((p) => p.tmpId !== l.id)); return; }
    const ok = await confirm({ message: `Apagar o local "${l.nome}"? Categorias e impressoras ligadas a ele voltam para a Cozinha/Bar. O histórico de vendas não muda.`, confirmLabel: 'Apagar' });
    if (!ok || !l.id) return;
    await deletePrintSector(l.id);
    toast.success('Local apagado.');
    await carregar();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-[var(--info)]/8 border border-[var(--info)]/20 p-3 text-[12px] text-[var(--text)]">
        <Info size={15} className="text-[var(--info)] flex-shrink-0 mt-0.5" />
        <p>
          Cozinha e Bar existem em toda loja. Crie os outros locais que a operação tem (Pizzaria, Sushi, Churrasqueira…) e escolha, para cada um, se a equipe
          <strong> acompanha numa tela</strong> ou se o pedido <strong>imprime direto</strong>. As impressoras e as categorias de cada local se configuram depois,
          no painel do lojista (Configurações → Impressão e Locais de preparo).
        </p>
      </div>

      <div className="space-y-3">
        {locais.map((l) => {
          const modo = modoEfetivo(l.chave);
          const imps = impressorasDoLocal(l);
          const Icone = l.base === 'bar' ? Wine : l.fixo ? ChefHat : Utensils;
          return (
            <div key={l.chave} className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/50">
                <span className="w-9 h-9 rounded-[10px] bg-[var(--brand)]/10 text-[var(--brand)] flex items-center justify-center flex-shrink-0"><Icone size={18} /></span>
                <div className="min-w-0 flex-1">
                  {editando === l.chave ? (
                    <div className="flex items-center gap-1.5">
                      <input autoFocus value={nomeEdicao} onChange={(e) => setNomeEdicao(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') salvarNome(l); if (e.key === 'Escape') setEditando(null); }}
                        className="h-8 flex-1 min-w-0 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm" aria-label="Novo nome do local" />
                      <button type="button" onClick={() => salvarNome(l)} aria-label="Salvar nome" className="p-1.5 rounded-md text-[var(--ok)] hover:bg-[var(--ok)]/10"><Check size={16} /></button>
                      <button type="button" onClick={() => setEditando(null)} aria-label="Cancelar" className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)]"><X size={16} /></button>
                    </div>
                  ) : (
                    <>
                      <p className="text-[14px] font-semibold text-[var(--text)] truncate">{l.nome}{l.tmp && <span className="ml-2 text-[11px] font-medium text-[var(--warn)]">será criado ao salvar a loja</span>}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{l.fixo ? 'Local padrão da loja' : 'Local criado para esta loja'}</p>
                    </>
                  )}
                </div>
                {!l.fixo && editando !== l.chave && (
                  <div className="flex items-center gap-0.5">
                    <button type="button" onClick={() => { setEditando(l.chave); setNomeEdicao(l.nome); }} aria-label={`Renomear ${l.nome}`} className="p-2 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"><Pencil size={15} /></button>
                    <button type="button" onClick={() => apagar(l)} aria-label={`Apagar ${l.nome}`} className="p-2 rounded-md text-[var(--text-muted)] hover:text-[var(--err)] hover:bg-[var(--err)]/10"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>

              <div role="radiogroup" aria-label={`Como ${l.nome} trabalha`} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
                {OPCOES.map((o) => {
                  const on = modo === o.valor;
                  const I = o.icone;
                  return (
                    <button
                      key={o.valor}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => escolher(l.chave, o.valor)}
                      className={`text-left rounded-[var(--r-md)] border-2 p-3 u-motion u-press-sm flex items-start gap-3 ${on ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'border-[var(--border)] hover:border-[var(--brand)]/40'}`}
                    >
                      <span className={`mt-0.5 w-8 h-8 rounded-[9px] flex items-center justify-center flex-shrink-0 ${on ? 'bg-[var(--brand)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}><I size={16} /></span>
                      <span className="min-w-0">
                        <span className={`block text-[13px] font-semibold ${on ? 'text-[var(--brand)]' : 'text-[var(--text)]'}`}>{o.titulo}</span>
                        <span className="block text-[11.5px] leading-snug text-[var(--text-muted)] mt-0.5">{o.texto}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="px-4 pb-3 -mt-1">
                {modo === 'impressao' ? (
                  storeId ? (
                    <p className={`text-[11.5px] ${imps.length ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>
                      {imps.length ? `${imps.length} impressora(s) ativa(s) para este local: ${imps.map((p) => p.name).join(', ')}.` : 'Nenhuma impressora ativa cadastrada para este local ainda: cadastre em Configurações → Impressão no painel do lojista.'}
                    </p>
                  ) : (
                    <p className="text-[11.5px] text-[var(--text-muted)]">As impressoras deste local são cadastradas depois, no painel do lojista (Configurações → Impressão).</p>
                  )
                ) : (
                  <p className="text-[11.5px] text-[var(--text-muted)]">A tela deste local aparece em Produção/Cozinha/Bar no painel do lojista.</p>
                )}
              </div>
            </div>
          );
        })}
        {carregando && <p className="text-xs text-[var(--text-muted)]">Carregando locais…</p>}
      </div>

      <BlocoOpcao titulo="Novo local de preparo" descricao="Ex.: Pizzaria, Sushi, Churrasqueira, Sobremesas.">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }}
            placeholder="Nome do local"
            aria-label="Nome do novo local"
            className="h-[38px] flex-1 min-w-0 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] max-sm:text-base"
          />
          <select
            value={novaBase}
            onChange={(e) => setNovaBase(e.target.value as BaseLocal)}
            aria-label="Tipo de local"
            className="h-[38px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
          >
            <option value="kitchen">Tipo cozinha</option>
            <option value="bar">Tipo bar</option>
          </select>
          <button type="button" onClick={adicionar} className="h-[38px] inline-flex items-center justify-center gap-1.5 rounded-[var(--r-md)] bg-[var(--brand-fill,var(--brand))] text-white px-4 text-sm font-semibold u-motion u-press-sm">
            <Plus size={16} /> Adicionar
          </button>
        </div>
      </BlocoOpcao>
    </div>
  );
};
