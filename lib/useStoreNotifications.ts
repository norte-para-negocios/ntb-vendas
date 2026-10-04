'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchTables, fetchKitchenOrders, fetchPrintSectors, fetchRecentPrintJobs, fetchFiscalNotas, fetchExceptionsReport, fetchLowStockAlerts } from '@/lib/api';
import { toast } from '@/components/Toast';
import { playNewOrderAlert, playReadyAlert, playItemLateAlert, playPrintFailureAlert, vibrateAlert } from '@/lib/audioAlert';
import { resolveStoreModules } from '@/lib/storeModules';
import { listarLocais, type SetorLike } from '@/lib/locaisPreparo';
import { contarPorLocal, itemPrecisaAcao, locaisAcessiveis, type ItemKds } from '@/lib/producaoNav';
import {
  resolverPrefs, tiposAplicaveis, publicosDoUsuario, detectarMesas, detectarItens, detectarImpressoras, detectarNotas,
  detectarSangrias, detectarEstoque, reconciliar, filtrarEventos, contarNaoLidos, marcarLidos as marcarLidosLib, somDoEvento,
  serializarEventos, restaurarEventos, type Detectado, type EventoNotificacao, type ItemKdsCompleto, type Som, type TipoNotificacao,
} from '@/lib/notificacoes';
import type { Store, StoreUser } from '@/types';

interface Opcoes {
  store: Store;
  user: Pick<StoreUser, 'id' | 'role'> & { permissions?: { caixa?: boolean; kitchen?: boolean; bar?: boolean } };
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
  const [setores, setSetores] = useState<SetorLike[]>([]);
  const [counts, setCounts] = useState({ tables: 0, kitchen: 0, bar: 0 });
  const [porLocal, setPorLocal] = useState<Record<string, number>>({});
  const [pausado, setPausado] = useState(false);

  const modulos = resolveStoreModules(store);
  const prefs = useMemo(() => resolverPrefs(store.config), [store.config]);
  const aplicaveis = useMemo(() => tiposAplicaveis(store), [store]);
  const publicos = useMemo(() => publicosDoUsuario(user), [user]);
  const locais = useMemo(() => listarLocais(setores, { cozinha: modulos.kitchen_kds, bar: modulos.bar_kds }), [setores, modulos.kitchen_kds, modulos.bar_kds]);
  // Gerência vê tudo; as demais funções só os locais cuja base (Cozinha/Bar) elas acessam.
  const locaisPermitidos = useMemo(
    () => (publicos.includes('gerencia') ? null : new Set(locaisAcessiveis(locais, acessiveis).map((l) => l.chave))),
    [publicos, locais, acessiveis],
  );

  // Refs: o poll e os eventos de realtime sempre leem o estado mais novo sem reassinar o canal.
  const ctxRef = useRef({ prefs, aplicaveis, publicos, locaisPermitidos, abaAtual, setores, modulos });
  useEffect(() => { ctxRef.current = { prefs, aplicaveis, publicos, locaisPermitidos, abaAtual, setores, modulos }; });
  const eventosRef = useRef(eventos);
  const rodou = useRef<Record<string, boolean>>({});

  const aplicar = useCallback((grupo: string, detectados: Detectado[], vistos: TipoNotificacao[]) => {
    const { lista, novos } = reconciliar(eventosRef.current, detectados, vistos, Date.now());
    eventosRef.current = lista;
    setEventos(lista);
    try { localStorage.setItem(chave, serializarEventos(lista)); } catch { /* sem persistência */ }
    const primeira = !rodou.current[grupo];
    rodou.current[grupo] = true;
    if (primeira) return; // abrir o app não toca som do que já estava lá
    const c = ctxRef.current;
    const meus = filtrarEventos(novos, { prefs: c.prefs, aplicaveis: c.aplicaveis, publicos: c.publicos, locaisPermitidos: c.locaisPermitidos });
    new Set(meus.map((e) => somDoEvento(e, { prefs: c.prefs, abaAtual: c.abaAtual })).filter((s): s is Som => !!s)).forEach(tocar);
    if (meus.some((e) => e.tipo === 'pedido_novo')) toast.info('Novo pedido chegou! 🔔');
    if (meus.some((e) => e.tipo === 'chamada_garcom' || e.tipo === 'pedido_conta')) toast.info('Atenção na mesa! 🔔');
  }, [chave]);

  const carregarSetores = useCallback(() => { fetchPrintSectors(storeId).then((l) => setSetores(l.map((s) => ({ id: s.id, name: s.name, base: s.base })))).catch(() => {}); }, [storeId]);

  const carregarRapido = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setPausado(true); return; }
    setPausado(false);
    const detectados: Detectado[] = [];
    const vistos: TipoNotificacao[] = [];
    try {
      const mesas = detectarMesas(await fetchTables(storeId));
      detectados.push(...mesas);
      vistos.push('chamada_garcom', 'pedido_conta');
      setCounts((c) => ({ ...c, tables: new Set(mesas.map((m) => m.id.split(':')[1])).size }));
    } catch { /* mantém o que já tinha */ }

    const { aplicaveis: ap, setores: st, modulos: m } = ctxRef.current;
    if (ap.has('pedido_novo')) {
      let falhou = false;
      const onError = () => { falhou = true; };
      const [k, b] = await Promise.all([
        m.kitchen_kds ? fetchKitchenOrders(storeId, 'kitchen', onError) : Promise.resolve([]),
        m.bar_kds ? fetchKitchenOrders(storeId, 'bar', onError) : Promise.resolve([]),
      ]);
      if (!falhou) {
        const nomes = Object.fromEntries(st.map((s) => [s.id, s.name]));
        const agora = Date.now();
        detectados.push(...detectarItens(k as ItemKdsCompleto[], 'kitchen', nomes, agora), ...detectarItens(b as ItemKdsCompleto[], 'bar', nomes, agora));
        vistos.push('pedido_novo', 'item_pronto', 'item_atrasado');
        setCounts((c) => ({ ...c, kitchen: (k as ItemKds[]).filter(itemPrecisaAcao).length, bar: (b as ItemKds[]).filter(itemPrecisaAcao).length }));
        setPorLocal(contarPorLocal({ kitchen: k as ItemKds[], bar: b as ItemKds[] }, new Set(st.map((s) => s.id))));
      }
    }
    aplicar('rapido', detectados, vistos);
  }, [storeId, aplicar]);

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
    const onSetores = () => carregarSetores();
    window.addEventListener('ntb-setores-changed', onSetores);
    const canal = supabase.channel(`notifications_${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_change_pings', filter: `store_id=eq.${storeId}` }, carregarRapido)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, carregarRapido)
      .subscribe();
    const rapido = window.setInterval(() => { if (document.visibilityState === 'visible') carregarRapido(); }, 30000);
    const lento = window.setInterval(() => { if (document.visibilityState === 'visible') carregarLento(); }, 4 * 60000);
    const setoresTimer = window.setInterval(carregarSetores, 60000);
    return () => {
      supabase.removeChannel(canal);
      window.removeEventListener('ntb-setores-changed', onSetores);
      window.clearInterval(rapido); window.clearInterval(lento); window.clearInterval(setoresTimer);
    };
  }, [storeId, carregarRapido, carregarLento, carregarSetores]);

  const visiveis = useMemo(() => filtrarEventos(eventos, { prefs, aplicaveis, publicos, locaisPermitidos }), [eventos, prefs, aplicaveis, publicos, locaisPermitidos]);
  const marcarLidos = useCallback((ids?: string[]) => {
    const lista = marcarLidosLib(eventosRef.current, ids);
    eventosRef.current = lista;
    setEventos(lista);
    try { localStorage.setItem(chave, serializarEventos(lista)); } catch { /* sem persistência */ }
  }, [chave]);

  return { counts, porLocal, locais, eventos: visiveis, naoLidos: contarNaoLidos(visiveis), marcarLidos, pausado };
}
