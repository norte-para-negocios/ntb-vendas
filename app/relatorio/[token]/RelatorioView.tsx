'use client';
import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Ban, Banknote, ChevronDown, Clock, FileText, KeyRound, LayoutGrid, Printer, Receipt, Search, Settings, ShieldCheck, ShoppingBag, Sparkles, Trophy, UserCog, Users, UtensilsCrossed, Wallet } from 'lucide-react';
import { Badge, Button, Card, SegmentedControl } from '@/components/ui';
import type { Categoria, SecaoLogin } from '@/lib/relatorioAuditoria';

// Relatório diário de auditoria — mesma linguagem visual do Norte Vendas (cartões brancos sobre fundo cinza, números grandes,
// ícones em círculo, botões em pílula, controle segmentado), usando os componentes do próprio app.
type Resumo = { acoes: number; logins: number; alertas: number; reimpressoes: number; cancelamentos: number; pagamentos: number; recebido: number; porHora: number[]; pico: { h: number; n: number } | null; maisAtivo: { nome: string; n: number } | null; maisCancelou: { nome: string; n: number } | null };
type Icone = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

const CAT: Record<Categoria, { rotulo: string; Icone: Icone }> = {
  acesso: { rotulo: 'Acesso', Icone: KeyRound }, pedido: { rotulo: 'Pedidos', Icone: ShoppingBag }, pagamento: { rotulo: 'Pagamentos', Icone: Banknote },
  impressao: { rotulo: 'Impressão', Icone: Printer }, mesa: { rotulo: 'Mesas', Icone: LayoutGrid }, caixa: { rotulo: 'Caixa', Icone: Wallet },
  fiscal: { rotulo: 'Notas fiscais', Icone: Receipt }, cardapio: { rotulo: 'Cardápio', Icone: UtensilsCrossed }, equipe: { rotulo: 'Equipe', Icone: UserCog },
  config: { rotulo: 'Configurações', Icone: Settings }, ponto: { rotulo: 'Ponto', Icone: Clock }, outro: { rotulo: 'Outros', Icone: FileText },
};

const PALETA = ['var(--brand)', 'var(--info)', 'var(--ok)', 'var(--warn)', 'var(--promo)', '#0a7ea4'];
const corDe = (i: number, sistema: boolean) => (sistema ? 'var(--text-muted)' : PALETA[i % PALETA.length]);
const BRL = (v: number) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const tinta = (cor: string, pct = 13) => `color-mix(in srgb, ${cor} ${pct}%, transparent)`;

// Valores em reais ganham destaque dentro da frase.
function comValores(texto: string) {
  return texto.split(/(R\$\s?[\d.]+,\d{2})/g).map((p, i) => (i % 2 ? <b key={i} className="font-semibold num">{p}</b> : p));
}

const iniciais = (n: string) => n.replace(/\(.*\)/, '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
const hm = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function diaExtenso(dia: string) {
  const d = new Date(`${dia}T12:00:00-03:00`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...o }).format(d);
  const sem = f({ weekday: 'long' });
  return { sem: sem.charAt(0).toUpperCase() + sem.slice(1), resto: f({ day: 'numeric', month: 'long', year: 'numeric' }) };
}

function porHora(linhas: SecaoLogin['linhas']): [number, SecaoLogin['linhas']][] {
  const m = new Map<number, SecaoLogin['linhas']>();
  for (const l of linhas) m.set(l.h, [...(m.get(l.h) ?? []), l]);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function resumoCategorias(linhas: SecaoLogin['linhas']) {
  const c: Partial<Record<Categoria, number>> = {};
  for (const l of linhas) c[l.categoria] = (c[l.categoria] ?? 0) + 1;
  return (Object.entries(c) as [Categoria, number][]).sort((a, b) => b[1] - a[1]);
}

function StatCard({ titulo, valor, Icone, cor, destaque }: { titulo: string; valor: string | number; Icone: Icone; cor: string; destaque?: boolean }) {
  return (
    <Card className="u-grow-in p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-[var(--text-muted)]">{titulo}</p>
          <h3 className="text-[28px] leading-tight font-bold tracking-[-0.02em] mt-1 num" style={{ color: destaque ? cor : 'var(--text)' }}>{valor}</h3>
        </div>
        <div className="w-9 h-9 grid place-items-center rounded-full flex-shrink-0" style={{ background: tinta(cor), color: cor }}><Icone size={17} /></div>
      </div>
    </Card>
  );
}

function Destaque({ Icone, cor, titulo, valor, sub }: { Icone: Icone; cor: string; titulo: string; valor: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <div className="w-10 h-10 rounded-[12px] grid place-items-center shrink-0" style={{ background: tinta(cor, 16), color: cor }}><Icone size={19} /></div>
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-[var(--text-muted)]">{titulo}</p>
        <p className="text-[19px] leading-tight font-bold tracking-[-0.01em] truncate num">{valor}</p>
        {sub && <p className="text-[12.5px] text-[var(--text-muted)] truncate">{sub}</p>}
      </div>
    </div>
  );
}

function GraficoHora({ secoes, cores }: { secoes: SecaoLogin[]; cores: string[] }) {
  const pessoas = secoes.map((s, i) => ({ s, cor: cores[i] })).filter((x) => x.s.chave !== '(sistema)');
  const totais = Array.from({ length: 24 }, (_, h) => pessoas.reduce((t, x) => t + x.s.porHora[h], 0));
  const ativos = totais.map((n, h) => (n ? h : -1)).filter((h) => h >= 0);
  if (!ativos.length) return null;
  const de = Math.max(0, ativos[0] - 1), ate = Math.min(23, ativos[ativos.length - 1] + 1);
  const max = Math.max(1, ...totais);
  const horas = Array.from({ length: ate - de + 1 }, (_, k) => de + k);
  return (
    <Card className="u-grow-in p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2"><Activity size={16} className="text-[var(--brand)]" /><h3 className="text-[15px] font-semibold">Movimento por hora</h3></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">{pessoas.map((x) => <span key={x.s.chave} className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-muted)]"><i className="w-2.5 h-2.5 rounded-full" style={{ background: x.cor }} />{x.s.nome.split(' ')[0]}</span>)}</div>
      </div>
      <div className="flex items-end gap-1.5 h-[150px]">
        {horas.map((h) => (
          <div key={h} className="flex-1 flex flex-col justify-end items-center h-full min-w-0" title={`${String(h).padStart(2, '0')}h: ${totais[h]} ações`}>
            <span className="text-[11px] text-[var(--text-muted)] num mb-1 h-4">{totais[h] || ''}</span>
            <div className="w-full flex flex-col-reverse rounded-[6px] overflow-hidden" style={{ height: `${(totais[h] / max) * 100}%`, minHeight: totais[h] ? 4 : 0 }}>
              {pessoas.map((x) => x.s.porHora[h] ? <div key={x.s.chave} style={{ flex: x.s.porHora[h], background: x.cor }} /> : null)}
            </div>
            <span className="text-[11px] text-[var(--text-muted)] num mt-1.5">{h}h</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Atividade({ porHora: v, cor }: { porHora: number[]; cor: string }) {
  const max = Math.max(1, ...v);
  return (
    <div className="w-full sm:w-[250px] shrink-0" aria-label="Ações por hora do dia">
      <div className="flex items-end gap-[3px] h-8">
        {v.map((n, h) => <div key={h} title={`${String(h).padStart(2, '0')}h: ${n} ações`} className="flex-1 rounded-[3px]" style={{ height: n ? `${18 + (n / max) * 82}%` : '8%', background: n ? cor : 'var(--border)', minHeight: 3 }} />)}
      </div>
      <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1 num"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
    </div>
  );
}

function Linha({ l, nome }: { l: SecaoLogin['linhas'][number]; nome?: string }) {
  const { Icone } = CAT[l.categoria];
  return (
    <li className="flex items-start gap-3 px-5 py-2.5 border-t border-[var(--border)] first:border-t-0" style={l.alerta ? { background: 'color-mix(in srgb, var(--err) 5%, transparent)' } : undefined}>
      <span className="w-[46px] shrink-0 pt-[3px] text-[13px] text-[var(--text-muted)] num">{l.hora.slice(0, 5)}</span>
      <span className="w-7 h-7 grid place-items-center rounded-full shrink-0" style={{ background: l.alerta ? 'color-mix(in srgb, var(--err) 12%, transparent)' : 'var(--surface-2)' }}><Icone size={14} className={l.alerta ? 'text-[var(--err)]' : 'text-[var(--text-muted)]'} /></span>
      <span className="min-w-0 flex-1 text-[15px] leading-snug text-[var(--text)]">
        {nome && <><b className="font-semibold">{nome}</b><span className="text-[var(--text-muted)]"> · </span></>}
        <span className={l.alerta ? 'font-medium' : ''}>{comValores(l.texto)}</span>
      </span>
      {l.alerta ? <span className="shrink-0 mt-0.5"><Badge variant="warning" dot>conferir</Badge></span> : (l.categoria === 'pagamento' || l.categoria === 'caixa' || l.categoria === 'fiscal') ? <span className="shrink-0 mt-0.5"><Badge variant="success">{CAT[l.categoria].rotulo.toLowerCase()}</Badge></span> : null}
    </li>
  );
}

export default function RelatorioView({ loja, dia, geradoEm, secoes, resumo }: { loja: string; dia: string; geradoEm: string; secoes: SecaoLogin[]; resumo: Resumo }) {
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'tudo' | 'conferir'>('tudo');
  const [cat, setCat] = useState<Categoria | 'todas'>('todas');
  const [fechados, setFechados] = useState<Record<string, boolean>>({});
  const { sem, resto } = diaExtenso(dia);

  const passa = (l: SecaoLogin['linhas'][number]) => (filtro === 'tudo' || l.alerta) && (cat === 'todas' || l.categoria === cat) && (!busca || l.texto.toLowerCase().includes(busca.toLowerCase()));
  const conferir = useMemo(() => secoes.flatMap((s) => s.linhas.filter((l) => l.alerta).map((l) => ({ ...l, nome: s.nome }))).sort((a, b) => a.hora.localeCompare(b.hora)), [secoes]);
  const cores = useMemo(() => secoes.map((x, i) => corDe(i, x.chave === '(sistema)')), [secoes]);
  const categorias = useMemo(() => [...new Set(secoes.flatMap((s) => s.linhas.map((l) => l.categoria)))], [secoes]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] print:bg-white">
      <style>{`@media print{.nao-imprime{display:none!important}}`}</style>

      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/85 backdrop-blur-md nao-imprime">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-7 h-7 rounded-[9px] grid place-items-center text-white text-[13px] font-bold" style={{ background: 'var(--brand-fill)' }}>N</span>
            <span className="text-[15px] font-semibold truncate">Norte Vendas</span>
            <span className="text-[var(--text-muted)] text-[15px] max-sm:hidden">· Auditoria</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer size={14} /> Salvar em PDF</Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-8 space-y-8">
        <div className="u-grow-in">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">Auditoria do dia</p>
          <h1 className="text-[34px] max-sm:text-[28px] leading-tight font-bold tracking-[-0.025em] mt-1">{sem}, {resto}</h1>
          <p className="text-[15px] text-[var(--text-muted)] mt-1">{loja}</p>
        </div>

        {resumo.acoes > 0 && (
          <Card className="u-grow-in p-5 sm:p-6" style={{ background: 'linear-gradient(135deg, var(--brand-soft), var(--surface) 70%)' }}>
            <div className="flex items-center gap-2 mb-4"><Sparkles size={16} className="text-[var(--brand)]" /><h2 className="text-[15px] font-semibold">Destaques do dia</h2></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <Destaque Icone={Banknote} cor="var(--ok)" titulo="Recebido no caixa" valor={BRL(resumo.recebido)} sub={`${resumo.pagamentos} pagamentos`} />
              <Destaque Icone={Activity} cor="var(--info)" titulo="Pico de movimento" valor={resumo.pico ? `${String(resumo.pico.h).padStart(2, '0')}h` : '—'} sub={resumo.pico ? `${resumo.pico.n} ações na hora` : undefined} />
              <Destaque Icone={Trophy} cor="var(--brand)" titulo="Mais ativo" valor={resumo.maisAtivo ? resumo.maisAtivo.nome.split(' ')[0] : '—'} sub={resumo.maisAtivo ? `${resumo.maisAtivo.n} ações` : undefined} />
              <Destaque Icone={Ban} cor={resumo.maisCancelou ? 'var(--err)' : 'var(--ok)'} titulo="Mais cancelamentos" valor={resumo.maisCancelou ? resumo.maisCancelou.nome.split(' ')[0] : 'Nenhum'} sub={resumo.maisCancelou ? `${resumo.maisCancelou.n} de ${resumo.cancelamentos}` : undefined} />
            </div>
          </Card>
        )}

        <section aria-label="Resumo do dia" className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard titulo="Ações da equipe" valor={resumo.acoes} Icone={Users} cor="var(--brand)" />
          <StatCard titulo="Logins ativos" valor={resumo.logins} Icone={ShieldCheck} cor="var(--info)" />
          <StatCard titulo="Para conferir" valor={resumo.alertas} Icone={AlertTriangle} cor="var(--warn)" destaque={resumo.alertas > 0} />
          <StatCard titulo="Reimpressões" valor={resumo.reimpressoes} Icone={Printer} cor="var(--promo)" />
          <StatCard titulo="Cancelamentos" valor={resumo.cancelamentos} Icone={Ban} cor="var(--err)" destaque={resumo.cancelamentos > 0} />
          <StatCard titulo="Pagamentos" valor={resumo.pagamentos} Icone={Banknote} cor="var(--ok)" />
        </section>

        <GraficoHora secoes={secoes} cores={cores} />

        {!secoes.length && (
          <Card className="p-10 text-center">
            <p className="text-[17px] font-semibold">Nenhuma ação registrada neste dia.</p>
            <p className="text-[14px] text-[var(--text-muted)] mt-1">Quando a equipe usar o sistema, tudo aparece aqui, por login.</p>
          </Card>
        )}

        {conferir.length > 0 && (
          <section aria-label="Para conferir">
            <div className="flex items-center gap-2 mb-1"><h2 className="text-[17px] font-semibold">Para conferir</h2><Badge variant="critical">{conferir.length}</Badge></div>
            <p className="text-[13.5px] text-[var(--text-muted)] mb-3">Cancelamentos, reimpressões, exclusões, pedidos movidos de mesa, preço ou pagamento alterado e acessos negados. Não é prova de erro: é o que merece um olhar.</p>
            <Card><ul className="max-h-[480px] overflow-auto print:max-h-none">{conferir.map((l, i) => <Linha key={i} l={l} nome={l.nome} />)}</ul></Card>
          </section>
        )}

        {secoes.length > 0 && (
          <section aria-label="Por login" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 nao-imprime">
              <h2 className="text-[17px] font-semibold">Por login</h2>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative"><Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar mesa, produto, nota…" className="h-[38px] w-[240px] max-w-full pl-9 pr-3 rounded-full bg-[var(--surface)] text-[14px] outline-none border border-[var(--border)] focus:border-[var(--brand)]" /></label>
                <SegmentedControl value={filtro} onChange={(v) => setFiltro(v as 'tudo' | 'conferir')} options={[{ value: 'tudo', label: 'Tudo' }, { value: 'conferir', label: 'Para conferir' }]} />
              </div>
              <div className="w-full flex flex-wrap gap-1.5">
                {(['todas', ...categorias] as const).map((c) => (
                  <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c} className={`h-8 px-3.5 rounded-full text-[13px] font-semibold transition-colors ${cat === c ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)]'}`}>{c === 'todas' ? 'Todas' : CAT[c].rotulo}</button>
                ))}
              </div>
            </div>

            {secoes.map((s, i) => {
              const linhas = s.linhas.filter(passa);
              const aberto = !(fechados[s.chave] ?? false);
              const sistema = s.chave === '(sistema)';
              const cor = cores[i];
              return (
                <Card key={s.chave} className="u-grow-in" style={{ animationDelay: `${i * 50}ms`, boxShadow: `inset 0 3px 0 ${cor}, var(--shadow-sm)` }}>
                  <button onClick={() => setFechados((o) => ({ ...o, [s.chave]: aberto }))} aria-expanded={aberto} className="w-full text-left p-5 flex flex-wrap sm:flex-nowrap items-center gap-4 hover:bg-[var(--surface-2)] transition-colors">
                    <span className="w-12 h-12 rounded-full grid place-items-center text-[16px] font-bold shrink-0" style={{ background: tinta(cor, 15), color: cor, boxShadow: `inset 0 0 0 2px ${tinta(cor, 35)}` }}>{sistema ? <Users size={19} /> : iniciais(s.nome)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-[17px] font-semibold truncate">{s.nome}</span>{s.papel && <Badge>{s.papel}</Badge>}{s.alertas > 0 && <Badge variant="warning" dot>{s.alertas} para conferir</Badge>}</div>
                      <p className="text-[13.5px] text-[var(--text-muted)] mt-0.5 num">{s.total} ações · das {hm(s.primeira)} às {hm(s.ultima)}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">{resumoCategorias(s.linhas).slice(0, 5).map(([c, n]) => <Badge key={c}>{n} {CAT[c].rotulo.toLowerCase()}</Badge>)}</div>
                    </div>
                    <Atividade porHora={s.porHora} cor={cor} />
                    <ChevronDown size={18} className={`text-[var(--text-muted)] transition-transform nao-imprime ${aberto ? 'rotate-180' : ''}`} />
                  </button>
                  {aberto && (
                    <div className="border-t border-[var(--border)]">
                      {linhas.length ? porHora(linhas).map(([h, grupo]) => (
                        <div key={h}>
                          <div className="flex items-center justify-between px-5 py-2 bg-[var(--surface-2)] border-t border-[var(--border)] first:border-t-0">
                            <span className="text-[13px] font-bold num" style={{ color: cor }}>{String(h).padStart(2, '0')}h</span>
                            <span className="text-[12.5px] text-[var(--text-muted)] num">{grupo.length} {grupo.length === 1 ? 'ação' : 'ações'}</span>
                          </div>
                          <ul>{grupo.map((l, j) => <Linha key={j} l={l} />)}</ul>
                        </div>
                      )) : <p className="p-5 text-[14px] text-[var(--text-muted)]">Nada neste filtro.</p>}
                    </div>
                  )}
                </Card>
              );
            })}
          </section>
        )}

        <footer className="text-[12.5px] leading-relaxed text-[var(--text-muted)] max-w-2xl pb-8">
          <p>Gerado em {geradoEm} (horário de Brasília). Cada linha mostra o login que estava ativo no aparelho quando a ação foi feita; o sistema não tem como provar que foi a própria pessoa, então use como guia de conferência.</p>
          <p className="mt-1">Ações sem login são de clientes pelo QR Code e de processos automáticos do sistema.</p>
        </footer>
      </main>
    </div>
  );
}
