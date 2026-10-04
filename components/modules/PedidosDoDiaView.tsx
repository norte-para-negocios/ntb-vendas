'use client';
// "Pedidos do Dia": janela larga e organizada. Só visualização — a única ação é Reimprimir
// (itens sem registro de impressão em mesa ainda aberta, só no aparelho de caixa; decidido pelo chamador).
import React, { useMemo, useState } from 'react';
import { RotateCcw, Search, TriangleAlert } from 'lucide-react';
import { Badge, Button, SegmentedControl } from '@/components/ui';
import {
  FILTROS_PADRAO, agruparPorHora, agruparPorMesa, contarPorLocal, filtrarLinhas, horaCurta, resumir,
  type EstadoFiltro, type Filtros, type LinhaPedido,
} from '@/lib/pedidosDoDia';

export interface LocalOpcao { id: string; nome: string }
interface Props {
  linhas: LinhaPedido[];
  locais: LocalOpcao[];
  meuNome: string;
  soMeusInicial: boolean;
  podeReimprimir: boolean;
  reimprimindo: Set<string>;
  onReimprimir: (l: LinhaPedido) => void;
}

const Tile: React.FC<{ rotulo: string; valor: number; destaque?: boolean; onClick?: () => void }> = ({ rotulo, valor, destaque, onClick }) => {
  const cls = `text-left rounded-[var(--r-md)] border px-4 py-3 ${destaque ? 'border-[var(--warn)]/40 bg-[var(--warn)]/10' : 'border-[var(--border)] bg-[var(--surface-2)]'}`;
  const inner = (
    <>
      <p className="text-[12px] text-[var(--text-muted)] flex items-center gap-1">{destaque && <TriangleAlert size={12} className="text-[var(--warn)]" />}{rotulo}</p>
      <p className={`text-[22px] font-semibold num leading-tight ${destaque ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}>{valor}</p>
    </>
  );
  return onClick ? <button type="button" onClick={onClick} className={`${cls} u-press-sm max-sm:min-h-11`}>{inner}</button> : <div className={cls}>{inner}</div>;
};

const corDoLocal = (id: string) =>
  id === 'bar' ? 'bg-[var(--info)]/10 text-[var(--info)]' : id === 'kitchen' ? 'bg-[var(--warn)]/10 text-[var(--warn)]' : 'bg-[var(--brand)]/10 text-[var(--brand)]';

const COLUNAS = 'sm:grid-cols-[56px_minmax(0,1fr)_150px_110px_200px]';

const Linha: React.FC<{ l: LinhaPedido; localNome: string; mostrarMesa: boolean; podeReimprimir: boolean; reimprimindo: boolean; onReimprimir: () => void }> = ({ l, localNome, mostrarMesa, podeReimprimir, reimprimindo, onReimprimir }) => {
  const quem = l.addedByName ?? 'Cliente / QR';
  return (
    <div className={`grid items-start gap-x-4 gap-y-1 px-3 py-3 border-b border-[var(--border)] last:border-b-0 grid-cols-[48px_minmax(0,1fr)] ${COLUNAS}`}>
      <span className="num text-[13px] text-[var(--text-muted)] pt-0.5">{horaCurta(l.time)}</span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-[var(--text)] break-words"><span className="num">{l.quantity}×</span> {l.productName}</p>
        {l.addons && <p className="text-[13px] text-[var(--text-muted)] break-words">{l.addons}</p>}
        {l.observation && <p className="text-[13px] font-semibold text-[var(--warn)] break-words whitespace-pre-line">Obs: {l.observation}</p>}
        {l.client && <p className="text-[12px] text-[var(--text-muted)] break-words">Cliente: {l.client}</p>}
        {mostrarMesa && <p className="text-[12px] text-[var(--text-muted)]">Mesa {l.tableNumber}{l.closed ? ' · fechada' : ''}</p>}
      </div>
      <span className="max-sm:hidden text-[13px] text-[var(--text-muted)] break-words pt-0.5">{quem}</span>
      <span className="max-sm:hidden"><Badge color={corDoLocal(l.localId)}>{localNome}</Badge></span>
      <div className="max-sm:col-start-2 flex flex-wrap items-center gap-1.5 sm:justify-end">
        <span className="sm:hidden text-[12px] text-[var(--text-muted)]">{quem}</span>
        <span className="sm:hidden"><Badge color={corDoLocal(l.localId)}>{localNome}</Badge></span>
        {l.printed ? <Badge variant="success">Impresso</Badge> : l.closed ? <Badge>Sem registro</Badge> : <Badge variant="warning">Sem registro</Badge>}
        {!l.printed && !l.closed && podeReimprimir && (
          <Button size="sm" variant="secondary" disabled={reimprimindo} onClick={onReimprimir}>
            <RotateCcw size={14} className="mr-1" /> Reimprimir
          </Button>
        )}
      </div>
    </div>
  );
};

export const PedidosDoDiaView: React.FC<Props> = ({ linhas, locais, meuNome, soMeusInicial, podeReimprimir, reimprimindo, onReimprimir }) => {
  const [filtros, setFiltros] = useState<Filtros>({ ...FILTROS_PADRAO, soMeus: soMeusInicial, meuNome });
  const [agrupar, setAgrupar] = useState<'mesa' | 'hora'>('mesa');
  const set = (p: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...p }));

  const visiveis = useMemo(() => filtrarLinhas(linhas, filtros), [linhas, filtros]);
  const resumo = useMemo(() => resumir(visiveis), [visiveis]);
  const porLocal = useMemo(() => contarPorLocal(linhas, filtros), [linhas, filtros]);
  const grupos = useMemo(() => (agrupar === 'mesa' ? agruparPorMesa(visiveis) : agruparPorHora(visiveis)), [visiveis, agrupar]);
  const nomeDoLocal = (id: string) => locais.find((x) => x.id === id)?.nome ?? 'Cozinha';
  const chips: LocalOpcao[] = [{ id: 'todos', nome: 'Todos os locais' }, ...locais];

  return (
    <div className="space-y-4">
      {/* Controles ficam à vista enquanto a lista rola */}
      <div className="sticky top-0 z-10 -mx-5 -mt-5 px-5 pt-5 pb-3 bg-[var(--surface)] space-y-3 border-b border-[var(--border)]">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile rotulo="Itens lançados" valor={resumo.unidades} />
          <Tile rotulo="Impressos" valor={resumo.impressos} />
          <Tile
            rotulo="Sem registro (mesas abertas)"
            valor={resumo.semRegistroAbertas}
            destaque={resumo.semRegistroAbertas > 0}
            onClick={resumo.semRegistroAbertas > 0 ? () => set({ estado: 'sem_registro' }) : undefined}
          />
          <Tile rotulo="Mesas" valor={resumo.mesas} />
        </div>
        <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
          <label className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="search"
              value={filtros.busca}
              onChange={(e) => set({ busca: e.target.value })}
              placeholder="Buscar mesa, produto ou garçom"
              aria-label="Buscar pedidos"
              className="w-full h-10 max-sm:h-11 pl-9 pr-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] text-[14px] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand)]"
            />
          </label>
          <SegmentedControl
            options={[{ value: 'meus', label: 'Meus pedidos' }, { value: 'todos', label: 'Todos' }]}
            value={filtros.soMeus ? 'meus' : 'todos'}
            onChange={(v) => set({ soMeus: v === 'meus' })}
          />
          <SegmentedControl
            options={[{ value: 'mesa', label: 'Por mesa' }, { value: 'hora', label: 'Por hora' }]}
            value={agrupar}
            onChange={(v) => setAgrupar(v as 'mesa' | 'hora')}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={filtros.local === c.id}
                onClick={() => set({ local: c.id })}
                className={`shrink-0 min-h-9 max-sm:min-h-11 px-3 rounded-full text-[13px] font-semibold border u-motion ${filtros.local === c.id ? 'bg-[var(--brand-fill)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'}`}
              >
                {c.nome} <span className="opacity-70 num">({porLocal[c.id] ?? 0})</span>
              </button>
            ))}
          </div>
          <div className="sm:ml-auto w-full sm:w-auto">
            <SegmentedControl
              options={[{ value: 'todos', label: 'Todos' }, { value: 'impresso', label: 'Impressos' }, { value: 'sem_registro', label: 'Sem registro' }]}
              value={filtros.estado}
              onChange={(v) => set({ estado: v as EstadoFiltro })}
            />
          </div>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <div className="text-center py-10 space-y-3">
          <p className="text-[15px] text-[var(--text-muted)]">
            {linhas.length === 0
              ? 'Nenhum pedido lançado ainda hoje.'
              : filtros.soMeus && filtrarLinhas(linhas, { ...filtros, soMeus: false }).length > 0
                ? 'Nada lançado por você com esses filtros. Toque em "Todos" para ver os pedidos da equipe.'
                : 'Nenhum item com esses filtros.'}
          </p>
          {linhas.length > 0 && <Button size="sm" variant="secondary" onClick={() => setFiltros({ ...FILTROS_PADRAO, meuNome })}>Limpar filtros</Button>}
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <section key={g.chave} className="rounded-[var(--r-md)] border border-[var(--border)] overflow-hidden">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)]">
                <h4 className="text-[15px] font-semibold text-[var(--text)]">{g.titulo}</h4>
                <span className="text-[13px] text-[var(--text-muted)] num">{g.unidades} {g.unidades === 1 ? 'item' : 'itens'} · último às {horaCurta(g.ultimaHora)}</span>
                {g.fechada && agrupar === 'mesa' && <Badge>Mesa fechada</Badge>}
                {g.semRegistroAbertas > 0 && <Badge variant="warning">{g.semRegistroAbertas} sem registro</Badge>}
              </header>
              <div className={`hidden sm:grid ${COLUNAS} gap-x-4 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]`}>
                <span>Hora</span><span>Item</span><span>Lançado por</span><span>Local</span><span className="text-right">Impressão</span>
              </div>
              {g.linhas.map((l) => (
                <Linha
                  key={l.id}
                  l={l}
                  localNome={nomeDoLocal(l.localId)}
                  mostrarMesa={agrupar === 'hora'}
                  podeReimprimir={podeReimprimir}
                  reimprimindo={reimprimindo.has(l.id)}
                  onReimprimir={() => onReimprimir(l)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
