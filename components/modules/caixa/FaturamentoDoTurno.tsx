'use client';
// Faturamento do turno destrinchado (migration 173, pedido do Joaquim 08/10/2026): usado no fechamento do caixa e no
// Histórico de Turnos. A conta fecha na tela: itens - descontos + taxa + outras taxas + pago a mais - cortesia = faturado.
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CashShiftSummary } from '@/lib/api';
import { detalheDoResumo } from '@/lib/caixaResumo';
import { formatBRL } from '@/lib/calc';
import { getPaymentMethodLabel, getCardBrandLabel } from '@/lib/labels';

const Linha = ({ rotulo, valor, sinal = '', forte = false, tom }: { rotulo: string; valor: number; sinal?: string; forte?: boolean; tom?: 'warn' | 'muted' }) => (
  <div className={`flex items-center justify-between px-3 py-2 text-sm ${forte ? 'bg-[var(--surface-2)]' : ''}`}>
    <span className={tom === 'warn' ? 'text-[var(--warn)]' : forte ? 'font-bold text-[var(--text)]' : 'text-[var(--text)]'}>{rotulo}</span>
    <span className={`num ${forte ? 'font-bold text-[var(--text)]' : 'font-semibold text-[var(--text)]'}`}>{sinal}R$ {formatBRL(valor)}</span>
  </div>
);

export function FaturamentoDoTurno({ resumo }: { resumo: CashShiftSummary }) {
  const d = detalheDoResumo(resumo);
  const [verContas, setVerContas] = useState(false);
  const [verProdutos, setVerProdutos] = useState(false);
  if (!d) return null;
  const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const temCancel = d.cancelados.qtd > 0 || d.zeradas > 0 || d.estornadas.qtd > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h4 className="text-[13px] font-semibold text-[var(--text-muted)]">Faturamento do turno</h4>
        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
          <Linha rotulo={`Itens vendidos (${d.qtdItens})`} valor={d.itens} />
          {d.desconto > 0.005 && <Linha rotulo="Descontos e cupons" valor={d.desconto} sinal="− " />}
          <Linha rotulo={`Taxa de serviço (${d.taxaQtd} ${d.taxaQtd === 1 ? 'conta' : 'contas'})`} valor={d.taxa} sinal="+ " />
          {d.outras > 0.005 && <Linha rotulo="Outras taxas (rolha, troca, frete…)" valor={d.outras} sinal="+ " />}
          {d.excesso > 0.005 && <Linha rotulo="Pago a mais (gorjeta / troco não dado)" valor={d.excesso} sinal="+ " />}
          {d.cortesiaParcial > 0.005 && <Linha rotulo="Cortesia em conta paga" valor={d.cortesiaParcial} sinal="− " />}
          <Linha rotulo="Total faturado" valor={d.faturado} forte />
        </div>
        {d.funcionarios.qtd > 0 && (
          <p className="text-[13px] text-[var(--text-muted)]">
            Consumo de funcionários (já incluso): R$ {formatBRL(d.funcionarios.total)} em {d.funcionarios.qtd} {d.funcionarios.qtd === 1 ? 'conta' : 'contas'}.
          </p>
        )}
        {d.cortesia.total > 0.005 && (
          <p className="text-[13px] text-[var(--warn)]">
            Cortesia: R$ {formatBRL(d.cortesia.total)} em {d.cortesia.contas} {d.cortesia.contas === 1 ? 'conta' : 'contas'}. Não entra no faturamento.
          </p>
        )}
      </div>

      {temCancel && (
        <div className="space-y-1.5">
          <h4 className="text-[13px] font-semibold text-[var(--text-muted)]">Cancelamentos (fora do faturamento)</h4>
          <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden text-sm">
            {d.cancelados.qtd > 0 && <Linha rotulo={`Itens cancelados (${d.cancelados.qtd})`} valor={d.cancelados.total} />}
            {d.zeradas > 0 && (
              <div className="flex justify-between px-3 py-2"><span className="text-[var(--text)]">Contas fechadas em zero</span><span className="num font-semibold text-[var(--text)]">{d.zeradas}</span></div>
            )}
            {d.estornadas.qtd > 0 && <Linha rotulo={`Vendas estornadas (${d.estornadas.qtd})`} valor={d.estornadas.total} />}
          </div>
        </div>
      )}

      {d.movimentos.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[13px] font-semibold text-[var(--text-muted)]">Sangrias e suprimentos</h4>
          <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
            {d.movimentos.map((m, i) => (
              <div key={i} className="px-3 py-2 text-sm flex justify-between gap-3">
                <span className="text-[var(--text)] min-w-0">{hora(m.quando)} · {m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}{m.motivo ? <span className="text-[var(--text-muted)]"> · {m.motivo}</span> : null}</span>
                <span className="num font-semibold text-[var(--text)] shrink-0">{m.tipo === 'sangria' ? '− ' : '+ '}R$ {formatBRL(m.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {d.contas.length > 0 && (
        <div className="space-y-1.5">
          <button type="button" onClick={() => setVerContas((v) => !v)} aria-expanded={verContas}
            className="w-full flex items-center justify-between text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] u-motion min-h-[44px]">
            <span>Contas do turno ({d.contas.length})</span>
            <ChevronDown size={16} className={`u-motion ${verContas ? 'rotate-180' : ''}`} />
          </button>
          {verContas && (
            <div className="rounded-xl border border-[var(--border)] overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] text-[12px]">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Hora</th>
                    <th className="text-left px-3 py-2 font-semibold">Onde</th>
                    <th className="text-left px-3 py-2 font-semibold">Forma</th>
                    <th className="text-right px-3 py-2 font-semibold">Itens</th>
                    <th className="text-right px-3 py-2 font-semibold">Taxa</th>
                    <th className="text-right px-3 py-2 font-semibold">Cortesia</th>
                    <th className="text-right px-3 py-2 font-semibold">Recebido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {d.contas.map((c, i) => (
                    <tr key={i} className={c.estornada ? 'opacity-60 line-through' : ''}>
                      <td className="px-3 py-2 num whitespace-nowrap">{hora(c.quando)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{c.tipo === 'balcao' ? 'Balcão' : `Mesa ${c.mesa ?? '?'}`}{c.funcionario ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--info)]/10 text-[var(--info)] text-[11px] font-semibold">Funcionário</span> : null}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">
                        {(c.formas as { method: string; brand?: string | null }[]).map((f) => `${getPaymentMethodLabel(f.method)}${f.brand ? ` ${getCardBrandLabel(f.brand)}` : ''}`).join(' + ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-right num">{formatBRL(c.itens - c.desconto)}</td>
                      <td className="px-3 py-2 text-right num">{c.taxa + c.excesso > 0.005 ? formatBRL(c.taxa + c.excesso) : '—'}</td>
                      <td className="px-3 py-2 text-right num">{c.cortesia > 0.005 ? formatBRL(c.cortesia) : '—'}</td>
                      <td className="px-3 py-2 text-right num font-semibold">{formatBRL(c.recebido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {d.produtos.length > 0 && (
        <div className="space-y-1.5">
          <button type="button" onClick={() => setVerProdutos((v) => !v)} aria-expanded={verProdutos}
            className="w-full flex items-center justify-between text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] u-motion min-h-[44px]">
            <span>Produtos vendidos ({d.produtos.length})</span>
            <ChevronDown size={16} className={`u-motion ${verProdutos ? 'rotate-180' : ''}`} />
          </button>
          {verProdutos && (
            <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
              {d.produtos.map((p, i) => (
                <div key={i} className="flex justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-[var(--text)] min-w-0"><span className="num text-[var(--text-muted)]">{p.quantidade}×</span> {p.nome} <span className="text-[var(--text-muted)]">· {p.categoria}</span></span>
                  <span className="num font-semibold text-[var(--text)] shrink-0">R$ {formatBRL(p.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
