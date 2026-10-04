// components/modules/ReportsView.tsx
'use client';
import React, { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchCashShiftsHistory, fetchCashShiftSummary, fetchSalesHistory, fetchExceptionsReport } from '@/lib/api';
import { buildFechamentoWorkbook, fechamentoFileName, type FechamentoTurno } from '@/lib/reports/fechamentoXlsx';

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });

// Início e fim do dia em Bahia (UTC-3, sem horário de verão) como instantes UTC.
const limitesDoDia = (dia: string): [Date, Date] => [new Date(`${dia}T00:00:00-03:00`), new Date(`${dia}T23:59:59.999-03:00`)];

export const ReportsView: React.FC<{ storeId: string; storeName: string; storeSlug: string; userName: string }> = ({ storeId, storeName, storeSlug, userName }) => {
  const [dia, setDia] = useState(hojeISO());
  const [gerando, setGerando] = useState(false);

  const baixarFechamento = async () => {
    setGerando(true);
    try {
      const [ini, fim] = limitesDoDia(dia);
      const [turnosRows, vendas, exc] = await Promise.all([
        fetchCashShiftsHistory(storeId, 200),
        fetchSalesHistory(storeId, ini.toISOString(), fim.toISOString()),
        fetchExceptionsReport(storeId, ini, fim),
      ]);
      const doDia = turnosRows.filter((t) => new Date(t.opened_at) >= ini && new Date(t.opened_at) <= fim);
      const turnos: FechamentoTurno[] = [];
      for (const t of doDia) {
        // eslint-disable-next-line no-await-in-loop -- poucos turnos por dia
        const resumo = await fetchCashShiftSummary(t.id);
        if (resumo) turnos.push({ operador: t.operator_name ?? 'Equipe', abertoEm: t.opened_at, fechadoEm: t.closed_at, fundo: Number(t.opening_float), contado: t.closing_counted_cash, resumo });
      }
      const wb = await buildFechamentoWorkbook({
        loja: storeName, periodoLabel: new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('pt-BR'), geradoEm: new Date(), geradoPor: userName,
        turnos, vendas, excecoes: exc.events,
      });
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fechamentoFileName(storeSlug, dia);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(turnos.length === 0 ? 'Arquivo gerado (nenhum turno de caixa nesse dia).' : 'Arquivo gerado.');
    } catch (e) {
      console.error('baixarFechamento falhou:', e);
      toast.error('Não consegui gerar o arquivo. Tente de novo.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[17px] font-semibold text-[var(--text)]">Relatórios</h3>
        <p className="text-[13px] text-[var(--text-muted)]">Arquivos prontos para o contador conciliar. O Excel traz as abas Resumo, Formas de pagamento, Cartões, Caixa, Vendas, Itens e Exceções.</p>
      </div>
      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={22} className="text-[var(--brand)] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-[15px] font-semibold text-[var(--text)]">Fechamento do dia (Excel)</h4>
            <p className="text-[13px] text-[var(--text-muted)]">Todos os turnos de caixa do dia, com meios de pagamento e bandeiras (inclusive zeradas), ticket médio, vendas, itens e exceções.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[13px] text-[var(--text-muted)]">Dia
            <Input type="date" value={dia} max={hojeISO()} onChange={(e) => setDia(e.target.value)} />
          </label>
          <Button onClick={baixarFechamento} isLoading={gerando} disabled={!dia}><Download size={16} /> Baixar Excel</Button>
        </div>
      </Card>
    </div>
  );
};
