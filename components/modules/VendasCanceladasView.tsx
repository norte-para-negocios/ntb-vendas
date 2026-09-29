'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fetchCanceledSales, subscribeToStoreOrderChanges } from '@/lib/api';
import { formatBRL } from '@/lib/calc';
import { getPaymentMethodLabel } from '@/lib/labels';
import { motivoCancelamento, resumoCanceladas, valorCancelado, VendasCanceladas } from '@/lib/vendasCanceladas';

const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const onde = (tipo: string, mesa: number | null) => (tipo === 'counter' ? 'Balcão' : `Mesa ${mesa ?? '?'}`);

export const VendasCanceladasView: React.FC<{ storeId: string }> = ({ storeId }) => {
  const [dados, setDados] = useState<VendasCanceladas | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const ativo = useRef(true);

  const carregar = useCallback(async () => {
    // fim do dia inclusivo
    const fimIso = fim ? new Date(new Date(fim).getTime() + 24 * 3600 * 1000).toISOString() : undefined;
    const r = await fetchCanceledSales(storeId, inicio || undefined, fimIso);
    if (!ativo.current) return;
    if (r) setDados(r); // falha de rede mantém o que já estava na tela
    setCarregado(true);
  }, [storeId, inicio, fim]);

  useEffect(() => {
    ativo.current = true;
    carregar();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const desinscrever = subscribeToStoreOrderChanges(storeId, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(carregar, 1000);
    }, undefined, 'vendas_canceladas');
    return () => { ativo.current = false; if (debounce) clearTimeout(debounce); desinscrever(); };
  }, [storeId, carregar]);

  if (!carregado) return <div className="p-8 text-center text-[var(--text-muted)]">Carregando vendas canceladas…</div>;
  const pedidos = dados?.pedidos ?? [];
  const itens = dados?.itens ?? [];
  const resumo = resumoCanceladas(pedidos);

  return (
    <div className="p-4 sm:p-5 space-y-5">
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Data inicial</label>
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9 max-sm:h-11 px-3 rounded-lg bg-[var(--surface-2)] text-[var(--text)] text-[14px] max-sm:text-base" />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Data final</label>
          <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-9 max-sm:h-11 px-3 rounded-lg bg-[var(--surface-2)] text-[var(--text)] text-[14px] max-sm:text-base" />
        </div>
        <p className="text-[13px] text-[var(--text-muted)] num pb-2">
          {resumo.quantidade} {resumo.quantidade === 1 ? 'venda cancelada' : 'vendas canceladas'} · R$ {formatBRL(resumo.valorTotal)}
        </p>
      </div>

      <section>
        <h4 className="text-[13px] font-semibold text-[var(--text-muted)] mb-2">Vendas canceladas</h4>
        {pedidos.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-3">Nenhuma venda cancelada neste período.</p>
        ) : (
          <div className="space-y-1.5">
            {pedidos.map((p) => {
              const abertaAgora = aberta === p.id;
              return (
                <div key={p.id} className="rounded-xl bg-[var(--surface-2)] overflow-hidden">
                  <button type="button" onClick={() => setAberta(abertaAgora ? null : p.id)} aria-expanded={abertaAgora} className="w-full flex items-center justify-between gap-2 p-3 max-sm:min-h-[56px] text-left">
                    <div className="min-w-0">
                      <p className="font-semibold text-[15px] text-[var(--text)]">{onde(p.order_type, p.mesa)} · {dia(p.created_at)} {hora(p.created_at)}</p>
                      <p className="text-[13px] text-[var(--warn)] font-medium">{motivoCancelamento(p)}</p>
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="num font-semibold text-[15px] text-[var(--text)] line-through decoration-[var(--text-muted)]/50">R$ {formatBRL(valorCancelado(p))}</span>
                      <ChevronDown size={16} className={`text-[var(--text-muted)] transition-transform ${abertaAgora ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {abertaAgora && (
                    <div className="px-3 pb-3 space-y-3 text-sm">
                      <div className="rounded-lg bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
                        {p.itens.map((it, i) => (
                          <div key={i} className="flex justify-between gap-2 px-3 py-2"><span>{it.quantity}× {it.product_name ?? 'Produto'}</span><span className="num">R$ {formatBRL(it.price_at_time * it.quantity)}</span></div>
                        ))}
                      </div>
                      {p.pagamento?.methods && p.pagamento.methods.length > 0 && (
                        <p className="text-[13px] text-[var(--text-muted)]">Pagamento estornado: {p.pagamento.methods.map((m) => `${getPaymentMethodLabel(m.method)} R$ ${formatBRL(m.amount)}`).join(' · ')}{p.pagamento.operador_nome ? ` · recebido por ${p.pagamento.operador_nome}` : ''}</p>
                      )}
                      {p.notas.map((n, i) => (
                        <p key={i} className="text-[13px] text-[var(--text-muted)]">
                          {n.modelo === '55' ? 'NF-e' : 'NFC-e'} nº {n.numero ?? '?'} (série {n.serie ?? '?'}) cancelada{n.cancelada_em ? ` em ${dia(n.cancelada_em)} ${hora(n.cancelada_em)}` : ''}{n.justificativa ? ` — “${n.justificativa}”` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h4 className="text-[13px] font-semibold text-[var(--text-muted)] mb-1">Itens cancelados (a venda continuou)</h4>
        <p className="text-[12px] text-[var(--text-muted)] mb-2">Itens tirados de uma comanda que seguiu valendo.</p>
        {itens.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-3">Nenhum item cancelado neste período.</p>
        ) : (
          <div className="rounded-xl bg-[var(--surface-2)] divide-y divide-[var(--border)] overflow-hidden">
            {itens.map((it) => (
              <div key={it.id} className="flex justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0"><p className="font-medium text-[var(--text)]">{it.quantity}× {it.product_name ?? 'Produto'}</p><p className="text-[12px] text-[var(--text-muted)]">{onde(it.order_type, it.mesa)} · {dia(it.created_at)} {hora(it.created_at)}</p></div>
                <span className="num shrink-0">R$ {formatBRL(it.price_at_time * it.quantity)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
