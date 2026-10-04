'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchTables, fetchKitchenOrders, fetchPrintSectors, fetchRecentPrintJobs, fetchFiscalNotas, fetchExceptionsReport, fetchLowStockAlerts, fetchIntegracaoBaixas } from '@/lib/api';
import { toast } from '@/components/Toast';
import { playNewOrderAlert, playReadyAlert, playItemLateAlert, playPrintFailureAlert, vibrateAlert } from '@/lib/audioAlert';
import { aoPublicar, mesasRecentes, kdsRecente } from '@/lib/dadosAoVivo';
import { resolveStoreModules } from '@/lib/storeModules';
import { listarLocaisComTela, type SetorLike } from '@/lib/locaisPreparo';
import { contarPorLocal, itemPrecisaAcao, locaisAcessiveis, type ItemKds } from '@/lib/producaoNav';
import {
  resolverPrefs, tiposAplicaveis, publicosDoUsuario, detectarMesas, detectarItens, detectarImpressoras, detectarNotas,
  detectarSangrias, detectarEstoque, detectarBaixas, reconciliar, filtrarEventos, contarNaoLidos, marcarLidos as marcarLidosLib, somDoEvento,
  serializarEventos, restaurarEventos, type Detectado, type EventoNotificacao, type ItemKdsCompleto, type Som, type TipoNotificacao,
} from '@/lib/notificacoes';
import type { Store, StoreUser, Table } from '@/types';

// Dado publicado por uma tela aberta vale por este tempo; passado disso o sino busca sozinho.
const IDADE_MAX_MS = 12000;
// Rede de segurança (o Realtime nem sempre entrega entre aparelhos): 45 s, só com a aba visível.
const RAPIDO_MS = 45000;

interface Opcoes {
  store: Store;
  user: Pick<StoreUser, 'id' | 'role' | 'assigned_table_ids'> & { permissions?: { caixa?: boolean; kitchen?: boolean; bar?: boolean } };
  /** Abas acessíveis (computeAccessibleTabIds) — define quais bases (Cozinha/Bar) o usuário enxerga. */
  acessiveis: Set<string>;
  abaAtual: string;
}

function tocar(som: Som) {
  if (som === 'mesa') { playNewOrderAlert(); vibrateAlert([200, 100, 200, 100, 200]); }
  else if (som === 'pedido') { playNewOrderAlert(); vibrateAlert([100, 60, 100]); }
  else if (som === 'pronto') playReadyAlert();
  else if (som === 'atraso') playItemLateAlert();
  else playPrintFailureAlert();
}

export function useStoreNotifications({ store, user, acessiveis, abaAtual }: Opcoes) {
  const storeId = store.id;
  const chave = `ntb-notif:${storeId}:${user.id ?? 'universal'}`;
  const [eventos, setEventos] = useState<EventoNotificacao[]>(() => { try { return restaurarEventos(localStorage.getItem(chave)); } catch { return []; } });
  // Locais de preparo do último acesso: o menu já nasce como "Produção" (sem piscar Cozinha/Bar até a rede responder).
  const chaveSetores = `ntb-setores:${storeId}`;
  const [setores, setSetores] = useState<SetorLike[]>(() => {
    try { const j = JSON.parse(localStorage.getItem(chaveSetores) ?? '[]'); return Array.isArray(j) ? j.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string') : []; } catch { return []; }
  });
  const [counts, setCounts] = useState({ tables: 0, kitchen: 0, bar: 0 });
  const [porLocal, setPorLocal] = useState<Record<string, number>>({});
  const [pausado, setPausado] = useState(false);

  const modulos = resolveStoreModules(store);
  const prefs = useMemo(() => resolverPrefs(store.config), [store.config]);
  const aplicaveis = useMemo(() => tiposAplicaveis(store), [store]);
  const publicos = useMemo(() => publicosDoUsuario(user), [user]);
  const locais = useMemo(() => listarLocaisComTela(setores, { cozinha: modulos.kitchen_kds, bar: modulos.bar_kds }), [setores, modulos.kitchen_kds, modulos.bar_kds]);
  // Gerência vê tudo; as demais funções só os locais cuja base (Cozinha/Bar) elas acessam.
  const locaisPermitidos = useMemo(
    () => (publicos.includes('gerencia') ? null : new Set(locaisAcessiveis(locais, acessiveis).map((l) => l.chave))),
    [publicos, locais, acessiveis],
  );

  // Jurisdição de mesas (garçom/caixa com mesas atribuídas): "item pronto" só das mesas dele. Sem atribuição = todas.
  const mesasDoUsuario = useMemo(() => {
    if (publicos.includes('gerencia')) return null;
    const ids = user.assigned_table_ids;
    return ids && ids.length > 0 ? new Set(ids) : null;
  }, [publicos, user.assigned_table_ids]);

  // Refs: o poll e os eventos de realtime sempre leem o estado mais novo sem reassinar o canal.
  const ctxRef = useRef({ prefs, aplicaveis, publicos, locaisPermitidos, mesasDoUsuario, abaAtual, setores, modulos });
  useEffect(() => { ctxRef.current = { prefs, aplicaveis, publicos, locaisPermitidos, mesasDoUsuario, abaAtual, setores, modulos }; });
  const eventosRef = useRef(eventos);
  const rodou = useRef<Record<string, boolean>>({});

  const aplicar = useCallback((grupo: string, detectados: Detectado[], vistos: TipoNotificacao[]) => {
    const { lista, novos } = reconciliar(eventosRef.current, detectados, vistos, Date.now());
    // Só mexe no estado/armazenamento quando algo mudou (a tela repete a leitura a cada poucos segundos).
    const antes = serializarEventos(eventosRef.current);
    const depois = serializarEventos(lista);
    eventosRef.current = lista;
    if (antes !== depois) {
      setEventos(lista);
      try { localStorage.setItem(chave, depois); } catch { /* sem persistência */ }
    }
    const primeira = !rodou.current[grupo];
    rodou.current[grupo] = true;
    if (primeira) return; // abrir o app não toca som do que já estava lá
    const c = ctxRef.current;
    const meus = filtrarEventos(novos, { prefs: c.prefs, aplicaveis: c.aplicaveis, publicos: c.publicos, locaisPermitidos: c.locaisPermitidos, mesasDoUsuario: c.mesasDoUsuario });
    new Set(meus.map((e) => somDoEvento(e, { prefs: c.prefs, abaAtual: c.abaAtual })).filter((s): s is Som => !!s)).forEach(tocar);
    if (meus.some((e) => e.tipo === 'pedido_novo')) toast.info('Novo pedido chegou! 🔔');
    if (meus.some((e) => e.tipo === 'chamada_garcom' || e.tipo === 'pedido_conta')) toast.info('Atenção na mesa! 🔔');
  }, [chave]);

  const carregarSetores = useCallback(() => {
    fetchPrintSectors(storeId).then((l) => {
      const novos = l.map((s) => ({ id: s.id, name: s.name, base: s.base }));
      setSetores(novos);
      try { localStorage.setItem(`ntb-setores:${storeId}`, JSON.stringify(novos)); } catch { /* sem persistência */ }
    }).catch(() => {});
  }, [storeId]);

  // Última leitura feita pelo próprio sino (por fonte), para não repetir a consulta quando só uma tela publicou dado de outra fonte.
  const proprio = useRef<Record<string, { em: number; dados: any }>>({});
  const lerFonte = useCallback(async <T,>(nome: string, publicado: T | null, buscar: () => Promise<T>, idadeMax: number): Promise<T> => {
    if (publicado) return publicado;
    const p = proprio.current[nome];
    if (p && Date.now() - p.em <= idadeMax) return p.dados as T;
    const dados = await buscar();
    proprio.current[nome] = { em: Date.now(), dados };
    return dados;
  }, []);

  const carregarRapido = useCallback(async (idadeProprio = IDADE_MAX_MS) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setPausado(true); return; }
    setPausado(false);
    const detectados: Detectado[] = [];
    const vistos: TipoNotificacao[] = [];
    try {
      // Tela de Mesas/Caixa aberta já busca a cada 5 s: reaproveita (até 12 s) em vez de repetir a consulta.
      const mesasLista = await lerFonte<Table[]>('mesas', mesasRecentes<Table>(storeId, IDADE_MAX_MS), () => fetchTables(storeId), idadeProprio);
      const mesas = detectarMesas(mesasLista);
      detectados.push(...mesas);
      vistos.push('chamada_garcom', 'pedido_conta');
      const nMesas = new Set(mesas.map((m) => m.id.split(':')[1])).size;
      setCounts((c) => (c.tables === nMesas ? c : { ...c, tables: nMesas }));
    } catch { /* mantém o que já tinha */ }

    const { aplicaveis: ap, setores: st, modulos: m } = ctxRef.current;
    // Contadores de Cozinha/Bar/Produção sempre contam (como o badge antigo); só os AVISOS dependem de a loja usar KDS.
    if (m.kitchen_kds || m.bar_kds) {
      let falhou = false;
      const onError = () => { falhou = true; };
      const [k, b] = await Promise.all([
        m.kitchen_kds ? lerFonte<any[]>('kds:kitchen', kdsRecente<any>(storeId, 'kitchen', IDADE_MAX_MS), () => fetchKitchenOrders(storeId, 'kitchen', onError), idadeProprio) : Promise.resolve([]),
        m.bar_kds ? lerFonte<any[]>('kds:bar', kdsRecente<any>(storeId, 'bar', IDADE_MAX_MS), () => fetchKitchenOrders(storeId, 'bar', onError), idadeProprio) : Promise.resolve([]),
      ]);
      if (!falhou) {
        const nomes = Object.fromEntries(st.map((s) => [s.id, s.name]));
        const agora = Date.now();
        if (ap.has('pedido_novo')) {
          detectados.push(...detectarItens(k as ItemKdsCompleto[], 'kitchen', nomes, agora), ...detectarItens(b as ItemKdsCompleto[], 'bar', nomes, agora));
          vistos.push('pedido_novo', 'item_pronto', 'item_atrasado');
        }
        const nK = (k as ItemKds[]).filter(itemPrecisaAcao).length;
        const nB = (b as ItemKds[]).filter(itemPrecisaAcao).length;
        setCounts((c) => (c.kitchen === nK && c.bar === nB ? c : { ...c, kitchen: nK, bar: nB }));
        const novoPorLocal = contarPorLocal({ kitchen: k as ItemKds[], bar: b as ItemKds[] }, new Set(st.map((s) => s.id)));
        setPorLocal((p) => (JSON.stringify(p) === JSON.stringify(novoPorLocal) ? p : novoPorLocal));
      }
    }
    aplicar('rapido', detectados, vistos);
  }, [storeId, aplicar, lerFonte]);

  // Fontes lentas (só gerência/caixa): impressão, notas fiscais, sangria; estoque a cada 10 min.
  const ultimoEstoque = useRef(0);
  const carregarLento = useCallback(async () => {
    const { publicos: pu } = ctxRef.current;
    if (!pu.includes('gerencia') && !pu.includes('caixa')) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const detectados: Detectado[] = [];
    const vistos: TipoNotificacao[] = [];
    const agora = Date.now();
    try { detectados.push(...detectarImpressoras(await fetchRecentPrintJobs(storeId, 30), agora)); vistos.push('impressora_falhou'); } catch { /* fonte fora */ }
    try { detectados.push(...detectarNotas(await fetchFiscalNotas(storeId), agora)); vistos.push('nota_rejeitada'); } catch { /* fonte fora */ }
    try {
      const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
      detectados.push(...detectarSangrias((await fetchExceptionsReport(storeId, inicio, new Date())).events));
      vistos.push('sangria_alta');
    } catch { /* fonte fora */ }
    if (pu.includes('gerencia')) {
      try { detectados.push(...detectarBaixas((await fetchIntegracaoBaixas(storeId)).itens)); vistos.push('baixa_estoque_erro'); } catch { /* fonte fora */ }
    }
    if (pu.includes('gerencia') && agora - ultimoEstoque.current > 10 * 60000) {
      ultimoEstoque.current = agora;
      try { detectados.push(...detectarEstoque(await fetchLowStockAlerts(storeId))); vistos.push('estoque_baixo'); } catch { /* fonte fora */ }
    }
    aplicar('lento', detectados, vistos);
  }, [storeId, aplicar]);

  useEffect(() => {
    carregarSetores();
    carregarRapido();
    carregarLento();

    // Uma leitura por vez: pings em rajada, tela publicando dado e o relógio viram no máximo uma rodada a cada ~1,5 s.
    let emAndamento = false;
    let pendente = false;
    let timer: number | undefined;
    let porPublicacao = false;
    const rodar = async () => {
      if (document.visibilityState !== 'visible') return; // aba oculta: não gasta rede; ao voltar, atualiza
      if (emAndamento) { pendente = true; return; }
      emAndamento = true;
      const idade = porPublicacao ? 40000 : IDADE_MAX_MS; porPublicacao = false;
      try { await carregarRapido(idade); } finally {
        emAndamento = false;
        if (pendente) { pendente = false; agendar(); }
      }
    };
    const agendar = () => { if (timer !== undefined) return; timer = window.setTimeout(() => { timer = undefined; void rodar(); }, 1500); };

    const onSetores = () => carregarSetores();
    window.addEventListener('ntb-setores-changed', onSetores);
    const aoVoltar = () => { if (document.visibilityState === 'visible') { void rodar(); carregarSetores(); } };
    document.addEventListener('visibilitychange', aoVoltar);
    const canal = supabase.channel(`notifications_${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_change_pings', filter: `store_id=eq.${storeId}` }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, agendar)
      .subscribe();
    // Tela de Mesas/Caixa/Cozinha/Bar publicou dado novo: detecta já (sem nova consulta, usa o que ela buscou).
    const pararPublicacao = aoPublicar(() => { porPublicacao = true; agendar(); });
    const rapido = window.setInterval(() => { void rodar(); }, RAPIDO_MS);
    const lento = window.setInterval(() => { if (document.visibilityState === 'visible') carregarLento(); }, 5 * 60000);
    const setoresTimer = window.setInterval(() => { if (document.visibilityState === 'visible') carregarSetores(); }, 5 * 60000);
    return () => {
      supabase.removeChannel(canal);
      pararPublicacao();
      window.removeEventListener('ntb-setores-changed', onSetores);
      document.removeEventListener('visibilitychange', aoVoltar);
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(rapido); window.clearInterval(lento); window.clearInterval(setoresTimer);
    };
  }, [storeId, carregarRapido, carregarLento, carregarSetores]);

  const visiveis = useMemo(() => filtrarEventos(eventos, { prefs, aplicaveis, publicos, locaisPermitidos, mesasDoUsuario }), [eventos, prefs, aplicaveis, publicos, locaisPermitidos, mesasDoUsuario]);
  const marcarLidos = useCallback((ids?: string[]) => {
    const lista = marcarLidosLib(eventosRef.current, ids);
    eventosRef.current = lista;
    setEventos(lista);
    try { localStorage.setItem(chave, serializarEventos(lista)); } catch { /* sem persistência */ }
  }, [chave]);

  return { counts, porLocal, locais, eventos: visiveis, naoLidos: contarNaoLidos(visiveis), marcarLidos, pausado };
}
