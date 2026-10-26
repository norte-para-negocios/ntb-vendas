// Aba "Visão geral" dos Relatórios v2 (26/10/2026): números grandes, faturamento × período anterior, picos, roscas,
// mapa de calor e rankings. Tudo clicável abre as contas por trás do número.
'use client';
import React, { useMemo } from 'react';
import { CalendarDays, Clock, Crown, Flame, Layers, Receipt, ShoppingBag, Store, TrendingUp, Users, Wallet } from 'lucide-react';
import { Card } from '@/components/ui';
import { diasDoPeriodo, periodoAnterior } from '@/lib/reports/periodo';
import { AreaComparada, Barras, CabecalhoSecao, KpiHero, Linha, MapaCalor, Ranking, Rosca, brl, cardCls } from './graficos';
import type { PropsAba } from './tipos';

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const diaLongo = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const hh = (h: number) => `${String(h).padStart(2, '0')}h`;

function Pico({ icone, rotulo, valor, sub, onClick }: { icone: React.ReactNode; rotulo: string; valor: string; sub?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="text-left rounded-[16px] bg-[var(--surface)] border border-[var(--border)] p-4 hover:bg-[var(--surface-2)] disabled:hover:bg-[var(--surface)] u-motion u-press-sm min-w-0">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.03em] text-[var(--text-muted)]">{icone}{rotulo}</span>
      <p className="mt-1 text-[18px] font-bold text-[var(--text)] truncate">{valor}</p>
      {sub && <p className="text-[13px] text-[var(--text-muted)] num truncate">{sub}</p>}
    </button>
  );
}

export const AbaVisaoGeral: React.FC<PropsAba> = ({ analise, analiseAnt, periodo, umDia, abrirLista, pdf, irParaDia, irParaPessoa, filtrarCategoria }) => {
  const k = analise.kpis; const ka = analiseAnt?.kpis ?? null;

  // Série completa (dias/horas sem venda viram zero) para o gráfico não "pular" datas.
  const serie = useMemo(() => {
    if (umDia) {
      const horas = [...analise.porHora, ...(analiseAnt?.porHora ?? [])].map((h) => h.hora);
      if (horas.length === 0) return [];
      const de = Math.min(...horas); const ate = Math.max(...horas);
      return Array.from({ length: ate - de + 1 }, (_, i) => {
        const h = de + i; const a = analise.porHora.find((x) => x.hora === h); const b = analiseAnt?.porHora.find((x) => x.hora === h);
        return { chave: String(h), rotulo: hh(h), atual: a?.total ?? 0, anterior: analiseAnt ? (b?.total ?? 0) : null, contas: a?.contas ?? 0 };
      });
    }
    let dias: string[] = []; let antes: string[] = [];
    try { dias = diasDoPeriodo(periodo.de, periodo.ate); const p = periodoAnterior(periodo.de, periodo.ate); antes = diasDoPeriodo(p.de, p.ate); } catch { return []; }
    const m = new Map(analise.porDia.map((d) => [d.dia, d])); const ma = new Map((analiseAnt?.porDia ?? []).map((d) => [d.dia, d]));
    return dias.map((d, i) => ({ chave: d, rotulo: diaCurto(d), atual: m.get(d)?.total ?? 0, anterior: analiseAnt ? (ma.get(antes[i])?.total ?? 0) : null, contas: m.get(d)?.contas ?? 0 }));
  }, [umDia, analise, analiseAnt, periodo.de, periodo.ate]);
  const sparkDias = analise.porDia.map((d) => d.total);
  const sparkContas = analise.porDia.map((d) => d.contas);
  const sparkTicket = analise.porDia.map((d) => d.ticket);

  const clicarSerie = (i: number) => {
    const p = serie[i]; if (!p) return;
    if (umDia) abrirLista(`Contas das ${p.rotulo}`, { hora: Number(p.chave) });
    else irParaDia(p.chave);
  };
  const semanaForte = analise.porDiaSemana.length ? analise.porDiaSemana.reduce((a, b) => (b.total > a.total ? b : a)) : null;
  const diaPico = k.diaPico ? analise.porDia.find((d) => d.dia === k.diaPico) : null;
  const horaPico = k.horaPico != null ? analise.porHora.find((h) => h.hora === k.horaPico) : null;
  const mesaTop = analise.mesas.find((m) => m.rotulo !== 'Balcão');
  const prodsValor = analise.produtos.slice().sort((a, b) => b.total - a.total).slice(0, 10);
  const pessoas = analise.equipe.filter((e) => e.nome !== 'Cliente pelo QR');
  const maxPes = Math.max(1, ...pessoas.map((e) => e.total));
  const maxMesa = Math.max(1, ...analise.mesas.map((m) => m.total));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <KpiHero rotulo={analise.modoItens ? 'Vendido (filtro)' : 'Faturamento'} valor={k.faturamento} anterior={ka?.faturamento} serie={sparkDias} icone={<Wallet size={15} />} />
        <KpiHero rotulo="Contas" valor={k.contas} formato="int" anterior={ka?.contas} serie={sparkContas} cor="var(--info)" icone={<Receipt size={15} />} delay={40} />
        <KpiHero rotulo="Ticket médio" valor={k.ticket} anterior={ka?.ticket} serie={sparkTicket} cor="var(--ok)" icone={<TrendingUp size={15} />} delay={80} />
        <KpiHero rotulo="Itens vendidos" valor={k.itens} formato="int" anterior={ka?.itens} cor="var(--warn)" icone={<ShoppingBag size={15} />} delay={120} />
        <KpiHero rotulo="Mesas atendidas" valor={k.mesasAtendidas} formato="int" anterior={ka?.mesasAtendidas} cor="var(--info)" icone={<Store size={15} />} delay={160} />
        {!analise.modoItens && <KpiHero rotulo="Taxa de serviço" valor={k.taxaServico} anterior={ka?.taxaServico} cor="var(--ok)" delay={200} />}
        {!analise.modoItens && <KpiHero rotulo="Cortesias" valor={k.cortesia} anterior={ka?.cortesia} cor="var(--warn)" delay={240} />}
        <KpiHero rotulo="Maior conta" valor={k.maiorConta} cor="var(--brand)" icone={<Crown size={15} />} sub={k.contas ? 'conta mais alta' : undefined} delay={280} />
        <KpiHero rotulo="Itens cancelados" valor={k.cancelados.qtd} formato="int" anterior={ka?.cancelados.qtd} cor="var(--err)" delay={320} />
        <KpiHero rotulo="Valor cancelado" valor={k.cancelados.valor} anterior={ka?.cancelados.valor} cor="var(--err)" delay={360} />
      </div>

      <Card className={cardCls}>
        <CabecalhoSecao icone={<Receipt size={17} className="text-[var(--text-muted)]" />} titulo={umDia ? 'Faturamento hora a hora' : 'Faturamento dia a dia'}
          sub={`${umDia ? 'Toque numa hora para ver as contas' : 'Toque num dia para abrir só ele'}${analiseAnt ? ' · linha tracejada = período anterior' : ''}`} onPdf={() => pdf([umDia ? 'horas' : 'dias'])} />
        <AreaComparada dados={serie} onClick={clicarSerie} />
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Pico icone={<CalendarDays size={13} />} rotulo={umDia ? 'Dia' : 'Melhor dia'} valor={diaPico ? diaLongo(diaPico.dia) : '—'} sub={diaPico ? `${brl(diaPico.total)} · ${diaPico.contas} contas` : undefined} onClick={diaPico && !umDia ? () => irParaDia(diaPico.dia) : undefined} />
        <Pico icone={<Clock size={13} />} rotulo="Hora mais forte" valor={horaPico ? `${hh(horaPico.hora)} às ${hh((horaPico.hora + 1) % 24)}` : '—'} sub={horaPico ? `${brl(horaPico.total)} · ${horaPico.contas} contas` : undefined} onClick={horaPico ? () => abrirLista(`Contas das ${hh(horaPico.hora)}`, { hora: horaPico.hora }) : undefined} />
        <Pico icone={<Flame size={13} />} rotulo="Dia da semana" valor={semanaForte && !umDia ? DIAS_SEMANA[semanaForte.dia] : '—'} sub={semanaForte && !umDia ? `${brl(semanaForte.total)} no período` : umDia ? 'escolha um período maior' : undefined} />
        <Pico icone={<Store size={13} />} rotulo="Mesa que mais vendeu" valor={mesaTop ? mesaTop.rotulo : '—'} sub={mesaTop ? `${brl(mesaTop.total)} · ${mesaTop.contas} contas` : undefined} onClick={mesaTop ? () => abrirLista(`Contas de ${mesaTop.rotulo}`, { local: mesaTop.rotulo }) : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Wallet size={17} className="text-[var(--text-muted)]" />} titulo="Formas de pagamento" sub="Toque para ver as contas" onPdf={() => pdf(['formas'])} />
          <Rosca dados={analise.formas.map((f) => ({ chave: f.chave, rotulo: `${f.rotulo} · ${f.contas}`, valor: f.total }))} onClick={(c) => abrirLista(`Contas pagas em ${analise.formas.find((f) => f.chave === c)?.rotulo ?? c}`, { forma: c })} />
        </Card>
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Layers size={17} className="text-[var(--text-muted)]" />} titulo="Vendas por categoria" sub="Toque para filtrar o relatório por ela" onPdf={() => pdf(['categorias'])} />
          <Rosca dados={analise.categorias.map((c) => ({ chave: c.id, rotulo: c.nome, valor: c.total }))} onClick={(id) => (id === '_sem' ? abrirLista('Vendas sem categoria', { categoria: '_sem' }) : filtrarCategoria(id))} />
        </Card>
        {analise.porTipo.mesa.total > 0 && analise.porTipo.balcao.total > 0 ? (
          <Card className={cardCls}>
            <CabecalhoSecao icone={<Store size={17} className="text-[var(--text-muted)]" />} titulo="Mesas × balcão" />
            <Rosca dados={[
              { chave: 'mesa', rotulo: `Mesas · ${analise.porTipo.mesa.contas} contas`, valor: analise.porTipo.mesa.total },
              { chave: 'balcao', rotulo: `Balcão · ${analise.porTipo.balcao.contas} contas`, valor: analise.porTipo.balcao.total },
            ]} onClick={(c) => (c === 'balcao' ? abrirLista('Contas do balcão', { local: 'Balcão' }) : undefined)} />
          </Card>
        ) : umDia ? (
          <Card className={cardCls}>
            <CabecalhoSecao icone={<Clock size={17} className="text-[var(--text-muted)]" />} titulo="Contas fechadas por hora" sub="Toque numa hora para ver as contas" />
            <Barras dados={analise.porHora.map((h) => ({ rotulo: hh(h.hora), valor: h.contas, extra: brl(h.total) }))} formatar={(n) => `${n} contas`} altura={220} onClick={(i) => { const h = analise.porHora[i]; if (h) abrirLista(`Contas das ${hh(h.hora)}`, { hora: h.hora }); }} />
          </Card>
        ) : (
          <Card className={cardCls}>
            <CabecalhoSecao icone={<CalendarDays size={17} className="text-[var(--text-muted)]" />} titulo="Por dia da semana" sub="Quanto cada dia da semana vendeu no período" />
            <Barras dados={[1, 2, 3, 4, 5, 6, 0].map((d) => { const x = analise.porDiaSemana.find((y) => y.dia === d); return { rotulo: DIAS_SEMANA[d].slice(0, 3), valor: x?.total ?? 0, extra: `${x?.contas ?? 0} contas` }; })} altura={220} />
          </Card>
        )}
        <Card className={cardCls}>
          <CabecalhoSecao icone={<TrendingUp size={17} className="text-[var(--text-muted)]" />} titulo="Ticket médio por dia" sub={umDia ? 'Escolha um período maior para ver a evolução' : `Média do período: ${brl(k.ticket)}`} />
          <Linha dados={umDia ? [] : analise.porDia.map((d) => ({ rotulo: diaCurto(d.dia), valor: d.ticket }))} />
        </Card>
      </div>

      {!umDia && (
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Flame size={17} className="text-[var(--text-muted)]" />} titulo="Quando a loja vende mais" sub="Dia da semana × hora · quanto mais forte a cor, mais vendeu · toque para ver as contas" />
          <MapaCalor matriz={analise.mapaCalor} onClick={(d, h) => abrirLista(`Contas de ${DIAS_SEMANA[d]} às ${hh(h)}`, { hora: h, diaSemana: d })} />
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className={cardCls}>
          <CabecalhoSecao icone={<ShoppingBag size={17} className="text-[var(--text-muted)]" />} titulo="Top 10 em faturamento" sub="Toque num produto para ver as vendas dele" onPdf={() => pdf(['produtos'], 'Produtos vendidos')} />
          <Ranking dados={prodsValor.map((p) => ({ chave: p.chave, rotulo: p.nome, sub: p.categoria, valor: brl(p.total), extra: `${p.qtd} un.`, frac: p.total / Math.max(1, prodsValor[0]?.total ?? 1) }))} onClick={(c) => abrirLista(`Vendas de ${analise.produtos.find((p) => p.chave === c)?.nome ?? ''}`, { produto: c })} />
        </Card>
        <Card className={cardCls}>
          <CabecalhoSecao icone={<ShoppingBag size={17} className="text-[var(--text-muted)]" />} titulo="Top 10 em quantidade" sub="Os que mais saíram" />
          <Ranking dados={analise.produtos.slice(0, 10).map((p) => ({ chave: p.chave, rotulo: p.nome, sub: p.categoria, valor: `${p.qtd} un.`, extra: brl(p.total), frac: p.qtd / Math.max(1, analise.produtos[0]?.qtd ?? 1) }))} onClick={(c) => abrirLista(`Vendas de ${analise.produtos.find((p) => p.chave === c)?.nome ?? ''}`, { produto: c })} />
        </Card>
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Users size={17} className="text-[var(--text-muted)]" />} titulo="Quem mais lançou" sub="Toque para ver tudo o que a pessoa fez" onPdf={() => pdf(['equipe'])} />
          <Ranking dados={pessoas.map((e) => ({ chave: e.nome, rotulo: e.nome, valor: brl(e.total), extra: `${e.itens} itens · ${e.contas} contas`, frac: e.total / maxPes }))} onClick={irParaPessoa} max={8} />
        </Card>
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Store size={17} className="text-[var(--text-muted)]" />} titulo="Mesas e balcão" sub={`${analise.mesas.length} locais · toque para ver as contas`} onPdf={() => pdf(['mesas'])} />
          <div className="max-h-[440px] overflow-y-auto pr-1">
            <Ranking dados={analise.mesas.map((m) => ({ chave: m.rotulo, rotulo: m.rotulo, valor: brl(m.total), extra: `${m.contas} contas · ticket ${brl(m.ticket)}`, frac: m.total / maxMesa }))} onClick={(r) => abrirLista(`Contas de ${r}`, { local: r })} />
          </div>
        </Card>
      </div>
    </div>
  );
};
