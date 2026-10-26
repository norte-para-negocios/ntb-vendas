import type { Analise, Recorte } from '@/lib/reports/analiseVendas';
import type { SecaoRelatorio } from '@/lib/reports/relatorioCompletoHtml';

/** O que toda aba do painel de Relatórios recebe (período, filtros e carga ficam no RelatoriosPainel). */
export type PropsAba = {
  analise: Analise;
  analiseAnt: Analise | null;
  periodo: { de: string; ate: string };
  umDia: boolean;
  carregando: boolean;
  abrirLista: (titulo: string, r: Recorte) => void;
  pdf: (secoes?: SecaoRelatorio[], titulo?: string) => void;
  irParaDia: (dia: string) => void;
  irParaPessoa: (nome: string) => void;
  filtrarCategoria: (id: string) => void;
};
