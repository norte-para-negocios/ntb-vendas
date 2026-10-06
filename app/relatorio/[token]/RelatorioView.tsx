'use client';
import { useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Ban, Clock, KeyRound, LayoutGrid, Printer, Receipt, Search, Settings, ShieldCheck, ShoppingBag, UtensilsCrossed, UserCog, Wallet, Users, ChevronDown, FileText } from 'lucide-react';
import type { Categoria, SecaoLogin } from '@/lib/relatorioAuditoria';

type Resumo = { acoes: number; logins: number; alertas: number; reimpressoes: number; cancelamentos: number; pagamentos: number };

const CAT: Record<Categoria, { rotulo: string; Icone: React.ComponentType<{ size?: number; strokeWidth?: number }>; cor: string }> = {
  acesso: { rotulo: 'Acesso', Icone: KeyRound, cor: '#6e6e73' },
  pedido: { rotulo: 'Pedidos', Icone: ShoppingBag, cor: '#0066cc' },
  pagamento: { rotulo: 'Pagamentos', Icone: Banknote, cor: '#248a3d' },
  impressao: { rotulo: 'Impressão', Icone: Printer, cor: '#b25000' },
  mesa: { rotulo: 'Mesas', Icone: LayoutGrid, cor: '#484DB5' },
  caixa: { rotulo: 'Caixa', Icone: Wallet, cor: '#248a3d' },
  fiscal: { rotulo: 'Notas fiscais', Icone: Receipt, cor: '#8E1CA8' },
  cardapio: { rotulo: 'Cardápio', Icone: UtensilsCrossed, cor: '#0066cc' },
  equipe: { rotulo: 'Equipe', Icone: UserCog, cor: '#b25000' },
  config: { rotulo: 'Configurações', Icone: Settings, cor: '#6e6e73' },
  ponto: { rotulo: 'Ponto', Icone: Clock, cor: '#6e6e73' },
  outro: { rotulo: 'Outros', Icone: FileText, cor: '#6e6e73' },
};

const MATIZ = ['#484DB5', '#0a7ea4', '#248a3d', '#b25000', '#8E1CA8', '#c2255c', '#0066cc'];
const matiz = (s: string) => MATIZ[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % MATIZ.length];
const iniciais = (n: string) => n.replace(/\(.*\)/, '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
const hm = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function diaExtenso(dia: string) {
  const d = new Date(`${dia}T12:00:00-03:00`);
  const sem = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' }).format(d);
  const resto = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(d);
  return { sem: sem.charAt(0).toUpperCase() + sem.slice(1), resto };
}

function Atividade({ porHora, cor }: { porHora: number[]; cor: string }) {
  const max = Math.max(1, ...porHora);
  return (
    <div className="w-full" aria-label="Ações por hora do dia">
      <div className="flex items-end gap-[3px] h-9">
        {porHora.map((n, h) => (
          <div key={h} title={`${String(h).padStart(2, '0')}h: ${n} ações`} className="flex-1 rounded-[3px] min-h-[3px]" style={{ height: `${n ? 12 + (n / max) * 88 : 8}%`, background: n ? cor : 'var(--border)', opacity: n ? 1 : 0.7 }} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1 font-mono"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
    </div>
  );
}

function Linha({ l, nome, mostrarNome }: { l: SecaoLogin['linhas'][number]; nome?: string; mostrarNome?: boolean }) {
  const { Icone, cor } = CAT[l.categoria];
  return (
    <li className={`flex items-start gap-3 py-2.5 pl-3 pr-2 rounded-[var(--r-sm)] ${l.alerta ? 'bg-[color-mix(in_srgb,var(--err)_5%,transparent)] border-l-[3px] border-[var(--err)]' : 'border-l-[3px] border-transparent'}`}>
      <span className="font-mono text-[12px] text-[var(--text-muted)] w-[52px] shrink-0 pt-[3px]">{l.hora.slice(0, 5)}</span>
      <span className="grid place-items-center w-7 h-7 rounded-full shrink-0 mt-px" style={{ background: `color-mix(in srgb, ${cor} 14%, transparent)`, color: cor }}><Icone size={14} strokeWidth={2.2} /></span>
      <span className="min-w-0 flex-1 text-[14px] leading-snug text-[var(--text)]">
        {mostrarNome && nome && <b className="font-semibold mr-1.5">{nome}</b>}
        <span className={l.alerta ? 'font-medium' : ''}>{l.texto}</span>
      </span>
    </li>
  );
}

export default function RelatorioView({ loja, dia, geradoEm, secoes, resumo }: { loja: string; dia: string; geradoEm: string; secoes: SecaoLogin[]; resumo: Resumo }) {
  const [busca, setBusca] = useState('');
  const [soAlertas, setSoAlertas] = useState(false);
  const [cat, setCat] = useState<Categoria | 'todas'>('todas');
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const { sem, resto } = diaExtenso(dia);

  const passa = (l: SecaoLogin['linhas'][number]) => (!soAlertas || l.alerta) && (cat === 'todas' || l.categoria === cat) && (!busca || l.texto.toLowerCase().includes(busca.toLowerCase()));
  const conferir = useMemo(() => secoes.flatMap((s) => s.linhas.filter((l) => l.alerta).map((l) => ({ ...l, nome: s.nome }))).sort((a, b) => a.hora.localeCompare(b.hora)), [secoes]);
  const categorias = useMemo(() => [...new Set(secoes.flatMap((s) => s.linhas.map((l) => l.categoria)))], [secoes]);
  const kpis = [
    { n: resumo.acoes, t: 'ações da equipe', Icone: Users, destaque: false },
    { n: resumo.logins, t: 'logins ativos', Icone: ShieldCheck, destaque: false },
    { n: resumo.alertas, t: 'para conferir', Icone: AlertTriangle, destaque: resumo.alertas > 0 },
    { n: resumo.reimpressoes, t: 'reimpressões', Icone: Printer, destaque: false },
    { n: resumo.cancelamentos, t: 'cancelamentos', Icone: Ban, destaque: resumo.cancelamentos > 0 },
    { n: resumo.pagamentos, t: 'pagamentos', Icone: Banknote, destaque: false },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] print:bg-white">
      <style>{`@media print{.nao-imprime{display:none!important}details>*{display:block!important}details{break-inside:avoid}}@keyframes subir{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.sobe{animation:subir .5s var(--ease-out) both}`}</style>

      <header className="relative overflow-hidden text-white" style={{ background: 'var(--ink)' }}>
        <div aria-hidden className="absolute -top-24 -right-16 w-[420px] h-[420px] rounded-full opacity-60" style={{ background: 'radial-gradient(circle at 30% 30%, #484DB5 0%, transparent 65%)' }} />
        <div aria-hidden className="absolute -bottom-32 left-[8%] w-[320px] h-[320px] rounded-full opacity-35" style={{ background: 'radial-gradient(circle, #8b90ea 0%, transparent 70%)' }} />
        <div className="relative max-w-5xl mx-auto px-5 pt-8 pb-16 sm:pb-20">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] tracking-[0.14em] uppercase font-semibold text-white/70">Norte Vendas · Auditoria</span>
            <button onClick={() => window.print()} className="nao-imprime inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white/12 hover:bg-white/20 text-[13px] font-medium transition-colors"><Printer size={15} /> Salvar em PDF</button>
          </div>
          <h1 className="mt-7 leading-[1.02] tracking-tight font-semibold" style={{ fontSize: 'clamp(2rem, 6vw, 3.4rem)' }}>{sem}<span className="block text-white/70 font-normal" style={{ fontSize: '0.5em', letterSpacing: 0 }}>{resto}</span></h1>
          <p className="mt-4 text-white/85 text-[15px]">{loja}</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 -mt-10 sm:-mt-12 pb-16 relative">
        <section aria-label="Resumo do dia" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k, i) => (
            <div key={k.t} className="sobe rounded-[var(--r-lg)] bg-[var(--surface)] p-4 shadow-[var(--shadow-md)] border border-[var(--border)]" style={{ animationDelay: `${i * 50}ms` }}>
              <k.Icone size={17} strokeWidth={2.2} />
              <div className="mt-2 text-[28px] leading-none font-semibold tabular-nums" style={{ color: k.destaque ? 'var(--err)' : 'var(--text)' }}>{k.n}</div>
              <div className="mt-1 text-[12.5px] text-[var(--text-muted)]">{k.t}</div>
            </div>
          ))}
        </section>

        {!secoes.length && (
          <div className="mt-8 rounded-[var(--r-xl)] bg-[var(--surface)] border border-[var(--border)] p-10 text-center shadow-[var(--shadow-sm)]">
            <p className="text-[17px] font-semibold">Nenhuma ação registrada neste dia.</p>
            <p className="text-[14px] text-[var(--text-muted)] mt-1">Quando a equipe usar o sistema, tudo aparece aqui, por login.</p>
          </div>
        )}

        {conferir.length > 0 && (
          <section className="mt-8" aria-label="Para conferir">
            <h2 className="flex items-center gap-2 text-[18px] font-semibold"><AlertTriangle size={18} style={{ color: 'var(--err)' }} /> Para conferir <span className="text-[13px] font-normal text-[var(--text-muted)]">({conferir.length})</span></h2>
            <p className="text-[13.5px] text-[var(--text-muted)] mt-0.5">Cancelamentos, reimpressões, exclusões, pedidos movidos de mesa, preço ou pagamento alterado e acessos negados. Não é prova de erro: é o que merece um olhar.</p>
            <ul className="mt-3 rounded-[var(--r-xl)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow-sm)] p-2 max-h-[460px] overflow-auto print:max-h-none">
              {conferir.map((l, i) => <Linha key={i} l={l} nome={l.nome} mostrarNome />)}
            </ul>
          </section>
        )}

        {secoes.length > 0 && (
          <section className="mt-10" aria-label="Por login">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-[18px] font-semibold">Por login</h2>
              <div className="nao-imprime flex flex-wrap items-center gap-2">
                <label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar (mesa, produto, nota…)" className="h-10 w-[230px] max-w-full pl-9 pr-3 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[14px] outline-none focus:border-[var(--brand)]" /></label>
                <button onClick={() => setSoAlertas((v) => !v)} aria-pressed={soAlertas} className={`h-10 px-4 rounded-full text-[13.5px] font-medium border transition-colors ${soAlertas ? 'bg-[var(--err-fill)] text-white border-transparent' : 'bg-[var(--surface)] border-[var(--border)]'}`}>Só para conferir</button>
              </div>
            </div>
            <div className="nao-imprime mt-3 flex flex-wrap gap-1.5">
              {(['todas', ...categorias] as const).map((c) => (
                <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c} className={`h-8 px-3 rounded-full text-[12.5px] font-medium border transition-colors ${cat === c ? 'bg-[var(--brand-fill)] text-white border-transparent' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'}`}>{c === 'todas' ? 'Tudo' : CAT[c].rotulo}</button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {secoes.map((s, i) => {
                const linhas = s.linhas.filter(passa);
                const cor = s.chave === '(sistema)' ? '#6e6e73' : matiz(s.nome);
                const aberto = abertos[s.chave] ?? (secoes.length <= 2);
                return (
                  <article key={s.chave} className="sobe rounded-[var(--r-xl)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden" style={{ animationDelay: `${i * 60}ms` }}>
                    <button onClick={() => setAbertos((o) => ({ ...o, [s.chave]: !aberto }))} aria-expanded={aberto} className="w-full text-left p-4 sm:p-5 grid gap-4 sm:grid-cols-[1fr_260px] items-center hover:bg-[var(--surface-2)] transition-colors">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <span className="grid place-items-center w-12 h-12 rounded-full text-white font-semibold text-[16px] shrink-0" style={{ background: cor }}>{s.chave === '(sistema)' ? <Users size={20} /> : iniciais(s.nome)}</span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[16px] truncate">{s.nome}</span>{s.papel && <span className="text-[11.5px] font-medium px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${cor} 14%, transparent)`, color: cor }}>{s.papel}</span>}</div>
                          <div className="text-[13px] text-[var(--text-muted)] mt-0.5">{s.total} ações · das {hm(s.primeira)} às {hm(s.ultima)}{s.alertas > 0 && <span className="ml-2 font-medium" style={{ color: 'var(--err)' }}>⚠ {s.alertas} para conferir</span>}</div>
                        </div>
                        <ChevronDown size={18} className={`ml-auto shrink-0 text-[var(--text-muted)] transition-transform nao-imprime ${aberto ? 'rotate-180' : ''}`} />
                      </div>
                      <Atividade porHora={s.porHora} cor={cor} />
                    </button>
                    {aberto && (
                      <ul className="border-t border-[var(--border)] p-2 sm:p-3">
                        {linhas.length ? linhas.map((l, j) => <Linha key={j} l={l} />) : <li className="p-4 text-[14px] text-[var(--text-muted)]">Nada neste filtro.</li>}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <footer className="mt-12 text-[12.5px] leading-relaxed text-[var(--text-muted)] max-w-2xl">
          <p>Gerado em {geradoEm} (horário de Brasília). Cada linha mostra o login que estava ativo no aparelho quando a ação foi feita; o sistema não tem como provar que foi a própria pessoa, então use como guia de conferência.</p>
          <p className="mt-1">Ações sem login são de clientes pelo QR Code e de processos automáticos do sistema.</p>
        </footer>
      </main>
    </div>
  );
}
