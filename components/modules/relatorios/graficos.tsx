// Gráficos da aba Relatórios v2 (26/10/2026, pedido do dono: "mais gráficos, tipo a tela de Resumo"). Mesma paleta e
// mesmo cartão do Resumo (StoreDashboardView); tudo clicável abre a lista de contas por trás do número.
'use client';
import React from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import { BarChart3, ChevronRight, Printer } from 'lucide-react';
import { Card } from '@/components/ui';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { formatBRL } from '@/lib/calc';

export const COLORS = ['var(--brand)', 'var(--ok)', 'var(--info)', 'var(--warn)', 'var(--err)', 'var(--text-muted)'];
export const tooltipStyle = { background: 'var(--surface)', border: 'none', borderRadius: 12, boxShadow: 'var(--shadow-md)', color: 'var(--text)', fontSize: 13 };
export const brl = (n: number) => `R$ ${formatBRL(n)}`;
export const brlCurto = (n: number) => (n >= 10000 ? `R$${(n / 1000).toFixed(0)}k` : n >= 1000 ? `R$${(n / 1000).toFixed(1).replace('.', ',')}k` : `R$${Math.round(n)}`);
export const cardCls = 'p-5 max-sm:p-4 bg-[var(--surface)]';
const eixo = { fontSize: 12, fill: 'var(--text-muted)' };

export const SemDados = ({ texto = 'Nada neste período' }: { texto?: string }) => (
  <div className="h-full min-h-[120px] py-6 flex flex-col items-center justify-center gap-2 text-center">
    <span className="w-10 h-10 grid place-items-center rounded-full bg-[var(--surface-2)]"><BarChart3 size={18} className="text-[var(--text-muted)]" /></span>
    <p className="text-[14px] text-[var(--text-muted)]">{texto}</p>
  </div>
);

export function CabecalhoSecao({ icone, titulo, sub, onPdf, acao }: { icone?: React.ReactNode; titulo: string; sub?: string; onPdf?: () => void; acao?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h4 className="text-[16px] font-semibold text-[var(--text)] flex items-center gap-2">{icone}{titulo}</h4>
        {sub && <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {acao}
        {onPdf && <button type="button" onClick={onPdf} aria-label={`PDF de ${titulo}`} className="h-9 px-3 rounded-full bg-[var(--surface-2)] text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1.5 u-press"><Printer size={14} /> PDF</button>}
      </div>
    </div>
  );
}

export function Variacao({ atual, anterior }: { atual: number; anterior: number | null | undefined }) {
  if (anterior == null || anterior <= 0) return null; // sem período anterior para comparar: não mostra nada
  const p = ((atual - anterior) / anterior) * 100;
  const sobe = p >= 0;
  return <span className={`text-[12px] font-semibold num ${sobe ? 'text-[var(--ok)]' : 'text-[var(--err)]'}`}>{sobe ? '▲' : '▼'} {Math.abs(p).toFixed(0)}% <span className="font-normal text-[var(--text-muted)]">vs. anterior</span></span>;
}

function Sparkline({ valores, cor }: { valores: number[]; cor: string }) {
  const max = Math.max(...valores, 1); const min = Math.min(...valores, 0); const r = max - min || 1;
  const pts = valores.map((v, i) => `${(i / (valores.length - 1)) * 100},${30 - ((v - min) / r) * 28}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-16 h-7 shrink-0 opacity-70 pointer-events-none" aria-hidden>
      <polyline points={pts} fill="none" stroke={cor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Cartão de número grande como os do Resumo: valor animado, variação e mini-gráfico do período. */
export function KpiHero({ rotulo, valor, formato = 'brl', anterior, serie, cor = 'var(--brand)', icone, sub, delay = 0 }: {
  rotulo: string; valor: number; formato?: 'brl' | 'int'; anterior?: number | null; serie?: number[]; cor?: string; icone?: React.ReactNode; sub?: string; delay?: number;
}) {
  const fmt = formato === 'brl' ? (n: number) => `R$ ${formatBRL(n)}` : (n: number) => String(Math.round(n));
  return (
    <Card accentColor={cor} className="u-grow-in u-card p-4 bg-[var(--surface)]" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.03em] text-[var(--text-muted)] min-w-0">{rotulo}</p>
        {serie && serie.length >= 2 ? <Sparkline valores={serie} cor={cor} /> : icone && <span className="w-8 h-8 grid place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] shrink-0 -mt-1">{icone}</span>}
      </div>
      <p className="mt-1 text-[24px] max-sm:text-[19px] leading-tight font-bold tracking-[-0.02em] num text-[var(--text)] whitespace-nowrap"><AnimatedNumber value={valor} format={fmt} /></p>
      <div className="min-h-[18px]">{sub ? <span className="text-[12px] text-[var(--text-muted)]">{sub}</span> : <Variacao atual={valor} anterior={anterior} />}</div>
    </Card>
  );
}

/** Área do período atual + linha tracejada do período anterior. */
export function AreaComparada({ dados, onClick, altura = 280 }: { dados: { rotulo: string; atual: number; anterior: number | null; contas?: number }[]; onClick?: (i: number) => void; altura?: number }) {
  if (dados.every((d) => !d.atual && !d.anterior)) return <div style={{ height: altura }}><SemDados /></div>;
  const temAnterior = dados.some((d) => d.anterior != null && d.anterior > 0);
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(e) => { if (onClick && e?.activeTooltipIndex != null) onClick(Number(e.activeTooltipIndex)); }} className={onClick ? 'cursor-pointer' : ''}>
          <defs>
            <linearGradient id="relAreaAtual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="rotulo" tick={eixo} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={eixo} axisLine={false} tickLine={false} tickFormatter={brlCurto} width={58} />
          <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: unknown, n: unknown, it: { payload?: { contas?: number } }) => [n === 'atual' ? `${brl(Number(v))}${it?.payload?.contas != null ? ` · ${it.payload.contas} contas` : ''}` : brl(Number(v)), n === 'atual' ? 'Este período' : 'Período anterior']} />
          {temAnterior && <Legend verticalAlign="top" height={28} iconType="plainline" formatter={(v: string) => <span className="text-[12px] text-[var(--text-muted)]">{v === 'atual' ? 'Este período' : 'Período anterior'}</span>} />}
          {temAnterior && <Line type="monotone" dataKey="anterior" stroke="var(--text-muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          <Area type="monotone" dataKey="atual" stroke="var(--brand)" strokeWidth={2.5} fill="url(#relAreaAtual)" activeDot={{ r: 5 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras verticais simples (ex.: por hora num dia). */
export function Barras({ dados, onClick, altura = 260, formatar = brl }: { dados: { rotulo: string; valor: number; extra?: string }[]; onClick?: (i: number) => void; altura?: number; formatar?: (n: number) => string }) {
  if (dados.length === 0) return <div style={{ height: altura }}><SemDados /></div>;
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="rotulo" tick={eixo} axisLine={false} tickLine={false} minTickGap={6} />
          <YAxis tick={eixo} axisLine={false} tickLine={false} tickFormatter={formatar === brl ? brlCurto : undefined} width={formatar === brl ? 58 : 36} />
          <RechartsTooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v: unknown, _n: unknown, it: { payload?: { extra?: string } }) => [`${formatar(Number(v))}${it?.payload?.extra ? ` · ${it.payload.extra}` : ''}`, 'Total']} />
          <Bar dataKey="valor" radius={[6, 6, 0, 0]} fill="var(--brand)" className={onClick ? 'cursor-pointer' : ''} onClick={(_d: unknown, i: number) => onClick?.(i)} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Linha simples (ex.: ticket médio por dia). */
export function Linha({ dados, altura = 200, cor = 'var(--info)' }: { dados: { rotulo: string; valor: number }[]; altura?: number; cor?: string }) {
  if (dados.length < 2) return <div style={{ height: altura }}><SemDados texto="Precisa de pelo menos 2 dias com venda" /></div>;
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="rotulo" tick={eixo} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={eixo} axisLine={false} tickLine={false} tickFormatter={brlCurto} width={58} />
          <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: unknown) => [brl(Number(v)), 'Ticket médio']} />
          <Line type="monotone" dataKey="valor" stroke={cor} strokeWidth={2.5} dot={{ r: 3, fill: cor }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Rosca com legenda clicável ao lado (valor e %). */
export function Rosca({ dados, onClick, formatar = brl, centro }: { dados: { chave: string; rotulo: string; valor: number; extra?: string }[]; onClick?: (chave: string) => void; formatar?: (n: number) => string; centro?: string }) {
  const total = dados.reduce((s, d) => s + d.valor, 0);
  if (dados.length === 0 || total <= 0) return <SemDados />;
  const maxFatias = 6;
  const fatias = dados.length > maxFatias ? [...dados.slice(0, maxFatias - 1), { chave: '_outros', rotulo: `Outros (${dados.length - maxFatias + 1})`, valor: dados.slice(maxFatias - 1).reduce((s, d) => s + d.valor, 0) }] : dados;
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="relative w-[170px] h-[170px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={fatias} dataKey="valor" nameKey="rotulo" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none" className={onClick ? 'cursor-pointer' : ''} onClick={(d) => { const chave = (d as unknown as { chave?: string; payload?: { chave?: string } })?.payload?.chave ?? (d as unknown as { chave?: string })?.chave; if (chave && chave !== '_outros') onClick?.(chave); }}>
              {fatias.map((f, i) => <Cell key={f.chave} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: unknown) => [`${formatar(Number(v))} · ${((Number(v) / total) * 100).toFixed(0)}%`, '']} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">
          <div><p className="text-[11px] text-[var(--text-muted)]">{centro ?? 'Total'}</p><p className="text-[14px] font-bold num text-[var(--text)]">{formatar(total)}</p></div>
        </div>
      </div>
      <ul className="flex-1 w-full min-w-0 space-y-0.5">
        {fatias.map((f, i) => (
          <li key={f.chave}>
            <button type="button" disabled={!onClick || f.chave === '_outros'} onClick={() => onClick?.(f.chave)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[10px] hover:bg-[var(--surface-2)] disabled:hover:bg-transparent text-left u-motion">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="flex-1 min-w-0 truncate text-[13px] text-[var(--text)]">{f.rotulo}</span>
              <span className="text-[12px] text-[var(--text-muted)] num">{((f.valor / total) * 100).toFixed(0)}%</span>
              <span className="text-[13px] font-semibold num text-[var(--text)] min-w-[86px] text-right whitespace-nowrap">{formatar(f.valor)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranking em barras horizontais (top N), cada linha clicável. */
export function Ranking({ dados, onClick, max, duasColunas = false }: { dados: { chave: string; rotulo: string; sub?: string; valor: string; frac: number; extra?: string }[]; onClick?: (chave: string) => void; max?: number; duasColunas?: boolean }) {
  if (dados.length === 0) return <SemDados />;
  return (
    <div className={duasColunas ? 'lg:columns-2 lg:gap-x-6' : 'space-y-0.5'}>
      {dados.slice(0, max).map((d, i) => (
        <button key={d.chave} type="button" onClick={() => onClick?.(d.chave)} className="w-full text-left px-3 py-2 rounded-[12px] hover:bg-[var(--surface-2)] u-motion group break-inside-avoid block">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] text-[var(--text)] truncate min-w-0"><span className="text-[var(--text-muted)] num mr-1.5">{i + 1}</span>{d.rotulo}{d.sub && <span className="text-[12px] text-[var(--text-muted)] max-sm:hidden"> · {d.sub}</span>}</span>
            <span className="shrink-0 flex items-center gap-2">
              {d.extra && <span className="text-[12px] text-[var(--text-muted)] num max-sm:hidden">{d.extra}</span>}
              <span className="text-[14px] font-semibold num text-[var(--text)]">{d.valor}</span>
              <ChevronRight size={14} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100" />
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full u-motion" style={{ width: `${Math.max(2, Math.min(100, d.frac * 100))}%`, background: COLORS[i % 3 === 0 ? 0 : i % 3 === 1 ? 2 : 1] }} /></div>
        </button>
      ))}
    </div>
  );
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Mapa de calor dia da semana × hora; só as horas em que a loja vendeu. */
export function MapaCalor({ matriz, onClick }: { matriz: number[][]; onClick?: (dow: number, hora: number) => void }) {
  const horas = Array.from({ length: 24 }, (_, h) => h).filter((h) => matriz.some((l) => l[h] > 0));
  const max = Math.max(0, ...matriz.flat());
  if (horas.length === 0 || max <= 0) return <SemDados />;
  const de = horas[0]; const ate = horas[horas.length - 1];
  const faixa = Array.from({ length: ate - de + 1 }, (_, i) => de + i);
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="border-separate" style={{ borderSpacing: 3 }}>
        <thead><tr><th />{faixa.map((h) => <th key={h} className="text-[11px] font-medium text-[var(--text-muted)] num w-7 min-w-7">{String(h).padStart(2, '0')}</th>)}</tr></thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <tr key={d}>
              <th className="text-[12px] font-semibold text-[var(--text)] text-left pr-2">{DIAS[d]}</th>
              {faixa.map((h) => {
                const v = matriz[d][h]; const f = v / max;
                return (
                  <td key={h}>
                    <button type="button" disabled={v <= 0} onClick={() => onClick?.(d, h)} title={`${DIAS[d]} ${String(h).padStart(2, '0')}h · ${brl(v)}`} aria-label={`${DIAS[d]} ${h} horas: ${brl(v)}`}
                      className="block w-7 h-7 rounded-[6px] u-motion hover:ring-2 hover:ring-[var(--brand)] disabled:hover:ring-0"
                      style={{ background: v > 0 ? `color-mix(in srgb, var(--brand) ${Math.round(12 + f * 88)}%, transparent)` : 'var(--surface-2)' }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-2 text-[11px] text-[var(--text-muted)]"><span>Menos</span>{[0.15, 0.35, 0.6, 0.85, 1].map((f) => <span key={f} className="w-4 h-4 rounded-[4px]" style={{ background: `color-mix(in srgb, var(--brand) ${Math.round(12 + f * 88)}%, transparent)` }} />)}<span>Mais</span></div>
    </div>
  );
}

/** Barras agrupadas por pessoa: lançou × recebeu. */
export function BarrasEquipe({ dados, onClick, altura = 280 }: { dados: { nome: string; lancou: number; recebeu: number }[]; onClick?: (nome: string) => void; altura?: number }) {
  if (dados.length === 0) return <div style={{ height: altura }}><SemDados /></div>;
  const curto = (n: string) => (n.length > 12 ? `${n.split(' ')[0]}` : n);
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados.map((d) => ({ ...d, rotulo: curto(d.nome) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(e) => { if (e?.activeTooltipIndex != null) { const n = dados[Number(e.activeTooltipIndex)]?.nome; if (n) onClick?.(n); } }} className={onClick ? 'cursor-pointer' : ''}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="rotulo" tick={eixo} axisLine={false} tickLine={false} interval={0} angle={dados.length > 5 ? -30 : 0} textAnchor={dados.length > 5 ? 'end' : 'middle'} height={dados.length > 5 ? 56 : 30} />
          <YAxis tick={eixo} axisLine={false} tickLine={false} tickFormatter={brlCurto} width={58} />
          <RechartsTooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} labelFormatter={(_l, p) => String((p?.[0]?.payload as { nome?: string } | undefined)?.nome ?? '')} formatter={(v: unknown, n: unknown) => [brl(Number(v)), n === 'lancou' ? 'Lançou' : 'Recebeu']} />
          <Legend verticalAlign="top" height={28} formatter={(v: string) => <span className="text-[12px] text-[var(--text-muted)]">{v === 'lancou' ? 'Lançou (itens)' : 'Recebeu (contas)'}</span>} />
          <Bar dataKey="lancou" fill="var(--brand)" radius={[5, 5, 0, 0]} />
          <Bar dataKey="recebeu" fill="var(--ok)" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Mini barras por hora (24 colunas) para o cartão de cada pessoa. */
export function MiniHoras({ porHora, cor = 'var(--brand)' }: { porHora: number[]; cor?: string }) {
  const max = Math.max(1, ...porHora);
  const ativas = porHora.map((v, h) => ({ v, h })).filter((x) => x.v > 0);
  if (ativas.length === 0) return <div className="h-10 grid place-items-center text-[11px] text-[var(--text-muted)]">sem lançamentos</div>;
  const de = Math.max(0, ativas[0].h - 1); const ate = Math.min(23, ativas[ativas.length - 1].h + 1);
  return (
    <div>
      <div className="h-10 flex items-end gap-[2px]">
        {porHora.slice(de, ate + 1).map((v, i) => <div key={i} title={`${de + i}h · ${v} itens`} className="flex-1 rounded-t-[3px]" style={{ height: `${v > 0 ? Math.max(8, (v / max) * 100) : 4}%`, background: v > 0 ? cor : 'var(--surface-2)' }} />)}
      </div>
      <div className="flex justify-between text-[10px] text-[var(--text-muted)] num mt-0.5"><span>{String(de).padStart(2, '0')}h</span><span>{String(ate).padStart(2, '0')}h</span></div>
    </div>
  );
}
