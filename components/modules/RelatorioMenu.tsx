// components/modules/RelatorioMenu.tsx — botão "Relatório" do Histórico de vendas (PDF, Excel, lista).
'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Printer, FileSpreadsheet, FileText, List, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchMenu } from '@/lib/api';
import { printRelatorioDia } from '@/lib/print';
import { montarPainelDeVendas } from '@/lib/reports/painelDia';
import { buildFechamentoWorkbook } from '@/lib/reports/fechamentoXlsx';
import { baixarWorkbook } from '@/lib/reports/baixar';
import { hojeISO } from '@/lib/reports/dia';
import type { Order } from '@/types';

export const RelatorioMenu: React.FC<{
  storeId: string; storeName: string; storeSlug: string; userName: string;
  vendas: Order[]; periodoLabel: string; disabled?: boolean;
  onPrintList: () => void; onCsv: () => void;
}> = ({ storeId, storeName, storeSlug, userName, vendas, periodoLabel, disabled, onPrintList, onCsv }) => {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const nomes = useRef<Map<string, string> | null>(null);

  // Fecha ao clicar fora e com Esc.
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  // Nomes das categorias, buscados uma vez ao abrir o menu; se falhar, cai em "Sem categoria".
  const garantirNomes = async (): Promise<(id: string) => string | undefined> => {
    if (!nomes.current) {
      try {
        // Limite de 8s: sem rede o relatório sai mesmo assim (categoria vira "Sem categoria").
        const menu = await Promise.race([fetchMenu(storeId, false, true), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
        nomes.current = new Map(menu.categories.map((c) => [c.id, c.name]));
      } catch (e) {
        console.error('RelatorioMenu: categorias não carregaram:', e);
        nomes.current = new Map();
      }
    }
    const mapa = nomes.current;
    return (id) => mapa.get(id);
  };

  const meta = () => ({ loja: storeName, periodoLabel, geradoEm: new Date(), geradoPor: userName });

  const pdf = async () => {
    setAberto(false);
    setOcupado(true);
    try {
      const nomeCat = await garantirNomes();
      const ok = await printRelatorioDia(montarPainelDeVendas(vendas, nomeCat), { ...meta(), titulo: 'Relatório de vendas' });
      if (!ok) toast.error('Não consegui abrir a impressão. Confira o bloqueador de janelas.');
    } catch (e) {
      console.error('RelatorioMenu pdf falhou:', e);
      toast.error('Não consegui gerar o relatório. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const excel = async () => {
    setAberto(false);
    setOcupado(true);
    try {
      const nomeCat = await garantirNomes();
      const wb = await buildFechamentoWorkbook({ ...meta(), painel: montarPainelDeVendas(vendas, nomeCat), nomeCategoria: nomeCat, turnos: [], vendas, excecoes: [] });
      await baixarWorkbook(wb, `relatorio-vendas_${hojeISO()}_${storeSlug}.xlsx`);
      toast.success('Arquivo gerado.');
    } catch (e) {
      console.error('RelatorioMenu excel falhou:', e);
      toast.error('Não consegui gerar o arquivo. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const item = 'w-full min-h-11 flex items-center gap-2 px-3 py-2 rounded-[10px] text-[14px] text-left text-[var(--text)] hover:bg-[var(--surface-2)] u-press';

  return (
    <div ref={raiz} className="relative max-sm:flex-1">
      <Button variant="secondary" size="sm" className="max-sm:!h-11 max-sm:w-full" onClick={() => setAberto((v) => !v)} disabled={disabled} isLoading={ocupado}
        aria-haspopup="menu" aria-expanded={aberto} title="Relatório">
        <Printer size={15} />
        Relatório
        <ChevronDown size={14} />
      </Button>
      {aberto && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 max-sm:left-0 max-sm:right-auto max-sm:w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-md)]">
          <button type="button" role="menuitem" className={item} onClick={pdf}><FileText size={16} /> PDF / Imprimir</button>
          <button type="button" role="menuitem" className={item} onClick={excel}><FileSpreadsheet size={16} /> Excel</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setAberto(false); onPrintList(); }}><List size={16} /> Lista para imprimir</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setAberto(false); onCsv(); }}><List size={16} /> Lista por venda (CSV)</button>
        </div>
      )}
    </div>
  );
};
