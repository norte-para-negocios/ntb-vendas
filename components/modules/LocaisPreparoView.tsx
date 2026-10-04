'use client';
// Cadastro único dos locais de preparo (Cozinha, Bar e locais criados como Pizzaria), todos como cartões iguais:
// categorias, impressora e baixa de estoque no Omie, com checklist do que ainda falta.
import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertTriangle, XCircle, Pencil, Trash2, Plus } from 'lucide-react';
import { Badge, Button, Card, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { confirm } from '@/components/ConfirmDialog';
import { LIST_ITEM_MOTION } from '@/lib/motion';
import {
  fetchPrintSectors, createPrintSector, updatePrintSector, deletePrintSector, updateCategorySector,
  fetchPrinterConfigs, updatePrinterConfig, fetchLocaisEstoque, salvarLocalEstoque, fetchMenu, setCategoryDestination,
  type LocaisEstoqueStatus,
} from '@/lib/api';
import { listarLocais, statusLocal, categoriasPorLocal, textoMoverCategoria, type BaseLocal, type EstadoItem, type LocalPreparo } from '@/lib/locaisPreparo';
import type { Category, PrinterConfig, PrintSector, Product, Store } from '@/types';

const nomeBase = (b: BaseLocal) => (b === 'bar' ? 'Bar' : 'Cozinha');

const ICONE_ESTADO: Record<EstadoItem, React.ReactNode> = {
  ok: <CheckCircle2 size={18} className="text-[var(--ok)]" aria-label="Pronto" />,
  aviso: <AlertTriangle size={18} className="text-[var(--warn)]" aria-label="Atenção" />,
  falta: <XCircle size={18} className="text-[var(--err)]" aria-label="Falta" />,
};

export const LocaisPreparoView: React.FC<{ store: Store }> = ({ store }) => {
  const [carregando, setCarregando] = useState(true);
  const [setores, setSetores] = useState<PrintSector[]>([]);
  const [impressoras, setImpressoras] = useState<PrinterConfig[]>([]);
  const [categorias, setCategorias] = useState<Category[]>([]);
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [estoque, setEstoque] = useState<LocaisEstoqueStatus | null>(null);
  const [novoNome, setNovoNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const [sts, imps, menu, est] = await Promise.all([
      fetchPrintSectors(store.id).catch(() => [] as PrintSector[]),
      fetchPrinterConfigs(store.id).catch(() => [] as PrinterConfig[]),
      fetchMenu(store.id, false, true).catch(() => null),
      fetchLocaisEstoque(store.id).catch(() => null),
    ]);
    setSetores(sts);
    setImpressoras(imps);
    if (menu) { setCategorias(menu.categories); setProdutos(menu.products); }
    setEstoque(est);
    setCarregando(false);
  }, [store.id]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) return <p className="text-sm text-[var(--text-muted)] py-6 text-center">Carregando locais de preparo...</p>;

  const setoresLike = setores.map((s) => ({ id: s.id, name: s.name, base: s.base }));
  const locais = listarLocais(setoresLike);
  const nomeDoLocal = (chave: string) => locais.find((x) => x.chave === chave)?.nome ?? 'outro local';
  const porLocal = categoriasPorLocal(categorias, produtos, setoresLike);
  const estoqueIntegrado = !!estoque?.configurado;
  const omieComLocais = estoqueIntegrado && estoque!.locais.length > 0;
  const impressorasDeTicket = impressoras.filter((p) => p.destination !== 'receipt');

  const criar = async () => {
    const nome = novoNome.trim();
    if (!nome) { toast.error('Digite o nome do local.'); return; }
    setCriando(true);
    try {
      await createPrintSector(store.id, nome, 'kitchen');
      setNovoNome('');
      toast.success(`Local "${nome}" criado. Veja abaixo o que falta configurar.`);
      await carregar();
    } catch (e: any) { toast.error('Erro ao criar local: ' + (e?.message || '')); }
    finally { setCriando(false); }
  };

  const salvarEdicao = async (l: LocalPreparo) => {
    const nome = editNome.trim();
    if (!nome || !l.setorId) return;
    try {
      await updatePrintSector(l.setorId, { name: nome });
      setEditando(null);
      toast.success('Local atualizado.');
      await carregar();
    } catch (e: any) { toast.error('Erro ao salvar: ' + (e?.message || '')); }
  };

  const excluir = async (l: LocalPreparo) => {
    if (!l.setorId) return;
    if (!(await confirm({ message: `Excluir o local "${l.nome}"? As categorias e produtos dele voltam pra ${nomeBase(l.base)}.`, variant: 'danger' }))) return;
    try {
      await deletePrintSector(l.setorId);
      await salvarLocalEstoque(store.id, l.chave, null);
      toast.success('Local excluído.');
      await carregar();
    } catch (e: any) { toast.error('Erro ao excluir: ' + (e?.message || '')); }
  };

  const escolherImpressora = async (l: LocalPreparo, printerId: string) => {
    if (!printerId) return;
    const r = await updatePrinterConfig(printerId, { sector_id: l.setorId, destination: l.base });
    if (!r.success) { toast.error(r.message || 'Erro ao salvar.'); return; }
    toast.success(`Impressora ligada a ${l.nome}.`);
    await carregar();
  };

  const escolherEstoque = async (l: LocalPreparo, codigoTxt: string) => {
    const codigo = Number(codigoTxt) || null;
    const local = codigo ? estoque!.locais.find((x) => x.codigo === codigo) ?? null : null;
    const r = await salvarLocalEstoque(store.id, l.chave, local);
    if (!r.success) { toast.error(r.message || 'Erro ao salvar.'); return; }
    setEstoque((atual) => {
      if (!atual) return atual;
      const mapa = { ...atual.mapa };
      if (codigo) mapa[l.chave] = codigo; else delete mapa[l.chave];
      return { ...atual, mapa };
    });
    toast.success(local ? `${l.nome} baixa no local ${local.nome}.` : `${l.nome} sem local de estoque escolhido.`);
  };

  // Uma categoria pertence a UM local. Local criado: categories.sector_id. Cozinha/Bar: destino de todos os produtos da
  // categoria (RPC 155) e sector_id = null.
  const alternarCategoria = async (l: LocalPreparo, cat: Category) => {
    if (ocupado) return;
    const atrib = porLocal.get(l.chave)?.find((x) => x.cat.id === cat.id)?.atrib;
    const ativa = !!atrib;
    if (l.setorId) {
      const novo = ativa ? null : l.setorId;
      setOcupado(true);
      setCategorias((prev) => prev.map((c) => (c.id === cat.id ? { ...c, sector_id: novo } : c)));
      try { await updateCategorySector(cat.id, novo); }
      catch (e: any) { toast.error('Erro ao mudar a categoria: ' + (e?.message || '')); await carregar(); }
      finally { setOcupado(false); }
      return;
    }
    const dest = l.base;
    const info = atrib ?? [...porLocal.values()].flat().find((x) => x.cat.id === cat.id)!.atrib;
    if (ativa && !info.misto) {
      toast.info(`${cat.name} já vai para ${l.nome}. Para mudar, marque-a no outro local.`);
      return;
    }
    const sai = !ativa && info.chave !== l.chave ? ` Ela sai de ${nomeDoLocal(info.chave)}.` : '';
    if (!(await confirm({ message: `${textoMoverCategoria(cat.name, l.nome, info.total)}${sai}` }))) return;
    setOcupado(true);
    try {
      const n = await setCategoryDestination(store.id, cat.id, dest);
      setCategorias((prev) => prev.map((c) => (c.id === cat.id ? { ...c, sector_id: null } : c)));
      setProdutos((prev) => prev.map((p) => (p.category_id === cat.id ? { ...p, destination: dest } : p)));
      toast.success(`${cat.name} agora vai para ${l.nome} (${n} produto(s) alterado(s)).`);
    } catch (e: any) { toast.error('Erro ao mudar a categoria: ' + (e?.message || '')); await carregar(); }
    finally { setOcupado(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">Locais de preparo</h3>
        <p className="text-[13px] leading-snug text-[var(--text-muted)] mt-0.5">
          Pra onde cada pedido vai: categorias, impressora e baixa de estoque de cada local. Cada local é separado dos outros; crie quantos precisar (ex.: Pizzaria).
        </p>
      </div>

      {estoqueIntegrado && estoque!.erro && (
        <p className="text-xs text-[var(--warn)] bg-[var(--warn)]/10 rounded-[var(--r-md)] p-3">
          Não consegui ler os locais do Omie agora ({estoque!.erro}). A escolha já salva continua valendo.
        </p>
      )}

      <AnimatePresence initial={false}>
        {locais.map((l) => {
          const categoriasDoLocal = porLocal.get(l.chave) ?? [];
          const produtosDoLocal = l.setorId ? produtos.filter((p) => p.sector_id === l.setorId && !categoriasDoLocal.some((c) => c.cat.id === p.category_id)) : [];
          const status = statusLocal({
            local: l,
            impressoras: impressoras.map((p) => ({ sector_id: p.sector_id, is_active: p.is_active, destination: p.destination })),
            mapaEstoque: estoqueIntegrado ? estoque!.mapa : null,
            categoriasDoLocal: categoriasDoLocal.length,
            produtosDoLocal: produtosDoLocal.length,
          });
          const impressoraAtual = impressorasDeTicket.find((p) => p.is_active && (l.setorId ? p.sector_id === l.setorId : !p.sector_id && (p.destination === l.base || p.destination === 'all')));
          const emEdicao = editando === l.chave;
          return (
            <motion.div key={l.chave} {...LIST_ITEM_MOTION}>
              <Card className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {emEdicao ? (
                    <div className="flex flex-wrap items-end gap-2 flex-1">
                      <div className="flex-1 min-w-[160px]"><Input label="Nome do local" value={editNome} maxLength={30} onChange={(e) => setEditNome(e.target.value)} /></div>
                      <Button size="sm" onClick={() => salvarEdicao(l)}>Salvar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-[16px] font-semibold text-[var(--text)] truncate">{l.nome}</p>
                        {status.completo && <Badge variant="success" dot>Completo</Badge>}
                      </div>
                      {l.setorId && (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setEditando(l.chave); setEditNome(l.nome); }}><Pencil size={14} /> Renomear</Button>
                          <Button size="sm" variant="ghost" onClick={() => excluir(l)}><Trash2 size={14} /> Excluir</Button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <ul className="divide-y divide-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface-2)]/60">
                  {status.itens.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-start gap-3 px-3 py-3 max-sm:flex-col">
                      <span className="mt-0.5 shrink-0">{ICONE_ESTADO[item.estado]}</span>
                      <div className="min-w-0 flex-1 u-motion">
                        <p className="text-[14px] text-[var(--text)]">{item.texto}</p>

                        {item.id === 'categorias' && (
                          <>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {categorias.length === 0 && <span className="text-xs text-[var(--text-muted)]">A loja ainda não tem categorias.</span>}
                              {categorias.map((c) => {
                                const mine = categoriasDoLocal.find((x) => x.cat.id === c.id);
                                const ativa = !!mine;
                                const hoje = ativa ? null : nomeDoLocal([...porLocal.values()].flat().find((x) => x.cat.id === c.id)?.atrib.chave ?? 'kitchen');
                                const misto = !!mine?.atrib.misto;
                                const titulo = misto
                                  ? `Mista: ${mine!.atrib.cozinha} produto(s) vão para a Cozinha e ${mine!.atrib.bar} para o Bar. Tocar aqui manda todos para ${l.nome}.`
                                  : hoje ? `Hoje em: ${hoje}` : undefined;
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => alternarCategoria(l, c)}
                                    disabled={ocupado}
                                    aria-pressed={ativa}
                                    title={titulo}
                                    className={`min-h-9 max-sm:min-h-11 px-3 rounded-full text-[13px] font-medium u-motion u-press-sm disabled:opacity-60 ${ativa ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--border)]'}`}
                                  >
                                    {c.name}{misto && <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-80">misto</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {categoriasDoLocal.some((x) => x.atrib.misto) && (
                              <p className="text-xs text-[var(--text-muted)] mt-2">
                                Categoria com a marca “misto” tem produtos indo para a Cozinha e outros para o Bar. Tocar nela aqui manda todos os produtos para {l.nome}.
                              </p>
                            )}
                          </>
                        )}

                        {item.id === 'impressora' && (
                          <select
                            value={impressoraAtual?.id ?? ''}
                            onChange={(e) => escolherImpressora(l, e.target.value)}
                            aria-label={`Impressora de ${l.nome}`}
                            className="mt-2 min-w-[220px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] max-sm:text-base"
                          >
                            <option value="">{impressorasDeTicket.length === 0 ? 'Nenhuma impressora cadastrada' : 'Escolha a impressora...'}</option>
                            {impressorasDeTicket.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}{p.sector_id && p.sector_id !== l.setorId ? ` (hoje: ${setores.find((s) => s.id === p.sector_id)?.name ?? 'outro local'})` : ''}
                              </option>
                            ))}
                          </select>
                        )}

                        {item.id === 'estoque' && omieComLocais && (
                          <select
                            value={estoque!.mapa[l.chave] ? String(estoque!.mapa[l.chave]) : ''}
                            onChange={(e) => escolherEstoque(l, e.target.value)}
                            aria-label={`Local de estoque (Omie) de ${l.nome}`}
                            className="mt-2 min-w-[220px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] max-sm:text-base"
                          >
                            <option value="">Escolha o local...</option>
                            {estoque!.locais.map((x) => <option key={x.codigo} value={x.codigo}>{x.nome}</option>)}
                          </select>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>

      <Card className="p-4 space-y-3">
        <p className="text-[15px] font-semibold text-[var(--text)]">Novo local</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <Input label="Nome" placeholder="Ex: Pizzaria" value={novoNome} maxLength={30} onChange={(e) => setNovoNome(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') criar(); }} />
          </div>
          <Button onClick={criar} isLoading={criando}><Plus size={16} /> Criar local</Button>
        </div>
      </Card>
    </div>
  );
};
