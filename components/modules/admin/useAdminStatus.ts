import { useEffect, useMemo, useState } from 'react';
import { fetchPrinterConfigs, fetchOpenCashShifts, fetchStoreTeamMembers, fetchStoreFiscalConfig, fetchMenu, fetchNtbEstoqueIntegracaoStatus, resolverUrlApi } from '@/lib/api';
import { auditarCardapio } from '@/lib/cardapioIntegridade';
import { statusVendas, statusCaixa, statusConfig, statusEquipe, statusCardapio, contarContasDeHoje, type Status, type Prontidao } from '@/lib/adminStatus';
import type { AreaId } from '@/lib/adminNav';
import type { Order } from '@/types';

interface Args {
  storeId: string;
  /** Vendas já carregadas pela Administração (null = ainda não chegaram). */
  sales: Order[] | null;
  /** Só calcula o status do cardápio para quem enxerga a Saúde do cardápio. */
  incluirCardapio: boolean;
  /** stores.stock_mode: 'nenhum' não gera alerta de código; 'proprio' acusa código repetido. */
  modoEstoque?: string | null;
}

// Cada fonte falha sozinha: o cartão daquela área só mostra o título (status null).
export function useAdminStatus({ storeId, sales, incluirCardapio, modoEstoque }: Args): Partial<Record<AreaId, Status | null>> {
  const [impressoras, setImpressoras] = useState<{ is_active: boolean }[] | null>(null);
  const [abertos, setAbertos] = useState<number | null>(null);
  const [pessoas, setPessoas] = useState<number | null>(null);
  const [prontidao, setProntidao] = useState<Prontidao | null>(null);
  const [ambiente, setAmbiente] = useState<'homologacao' | 'producao' | null>(null);
  const [alertas, setAlertas] = useState<number | null>(null);
  const [estoqueSemVinculo, setEstoqueSemVinculo] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchPrinterConfigs(storeId).then((l) => vivo && setImpressoras(l)).catch(() => {});
    fetchOpenCashShifts(storeId).then((l) => vivo && setAbertos(l.length)).catch(() => {});
    fetchStoreTeamMembers(storeId).then((l) => vivo && setPessoas(l.length)).catch(() => {});
    fetch(resolverUrlApi(`/api/fiscal/prontidao?storeId=${storeId}`)).then((r) => r.json()).then((j) => { if (vivo && j?.ok) setProntidao(j); }).catch(() => {});
    fetchStoreFiscalConfig(storeId).then((c) => { if (vivo && c?.ambiente) setAmbiente(c.ambiente); }).catch(() => {});
    return () => { vivo = false; };
  }, [storeId]);

  useEffect(() => {
    if (!incluirCardapio) { setAlertas(null); return; }
    let vivo = true;
    Promise.all([fetchMenu(storeId, false, true), fetchNtbEstoqueIntegracaoStatus(storeId)]).then(([m, integ]) => {
      if (!vivo || (m as { error?: unknown }).error) return;
      const produtos = m.products.map((p) => ({
        id: p.id, name: p.name, price: Number(p.price), category_id: p.category_id ?? null, available: p.available,
        order: p.order ?? null, omie_codigo: p.omie_codigo ?? null, fee_type: p.fee_type ?? null,
        grupos: (p.option_groups ?? []).map((g) => ({
          name: g.name, required: g.required,
          opcoes: (g.options ?? []).filter((o) => o.available !== false).length,
          temCodigoOmie: (g.options ?? []).some((o) => !!o.omie_codigo || Object.values(o.variants ?? {}).some((v) => !!v?.omie_codigo)),
        })),
      }));
      const achados = auditarCardapio({ categorias: m.categories.map((c) => ({ id: c.id, name: c.name, order: c.order ?? null })), produtos }, { integracaoLigada: integ.configurado && integ.ativo, modoEstoque });
      setAlertas(achados.filter((a) => a.severidade === 'alta').length);
      setEstoqueSemVinculo(achados.some((a) => a.tipo === 'sem_codigo_omie' && a.severidade === 'alta'));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [storeId, incluirCardapio, modoEstoque]);

  return useMemo(() => ({
    vendas: statusVendas(sales ? contarContasDeHoje(sales) : null),
    caixa: statusCaixa(abertos),
    cardapio: statusCardapio(alertas, { estoqueSemVinculo }),
    equipe: statusEquipe(pessoas),
    config: statusConfig(impressoras, prontidao, ambiente),
  }), [sales, abertos, alertas, estoqueSemVinculo, pessoas, impressoras, prontidao, ambiente]);
}
