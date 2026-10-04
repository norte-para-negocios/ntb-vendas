'use client';

// Navegação da Administração em 5 áreas. Evolução do menu anterior (mesmos tokens, alturas,
// raios, indicador por layoutId e crossfade de StoreAdminView), só reorganizado:
//  - computador: trilho de áreas (com status) + busca de ajustes, sub-abas em pílulas no topo;
//  - celular: lista de cartões (home) -> entra na área -> volta. O conteúdo (children) é UM nó só.
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, Wallet, UtensilsCrossed, Users, SlidersHorizontal, Lock, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { areasVisiveis, areaDaAba, abaInicial, corrigirAba, buscarAjustes, BUSCAVEIS, type AbaId, type AreaId, type NavCtx } from '@/lib/adminNav';
import { TOM_COR, type Status } from '@/lib/adminStatus';
import { SETTINGS_SECOES, podeBaixarApp } from '../StoreSettingsView';

const ICONE: Record<AreaId, (s: number) => React.ReactNode> = {
    vendas: (s) => <BarChart3 size={s} />, caixa: (s) => <Wallet size={s} />, cardapio: (s) => <UtensilsCrossed size={s} />,
    equipe: (s) => <Users size={s} />, config: (s) => <SlidersHorizontal size={s} />,
};

const ROTULO_SECAO: Record<string, string> = { ...Object.fromEntries(SETTINGS_SECOES.map((s) => [s.id, s.label])), regras: 'Regras do caixa' };
const FADE = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.12, ease: 'easeOut' as const } };

interface Props {
    ctx: NavCtx;
    activeTab: AbaId;
    onTab: (id: AbaId, alvo?: string) => void;
    status: Partial<Record<AreaId, Status | null>>;
    children: React.ReactNode;
}

export const AdminNavShell: React.FC<Props> = ({ ctx, activeTab, onTab, status, children }) => {
    const areas = areasVisiveis(ctx);
    // Se a aba ativa deixou de ser permitida, cai na primeira visível (nunca fica em branco).
    const corrigida = corrigirAba(activeTab, ctx);
    useEffect(() => { if (corrigida !== activeTab) onTab(corrigida); }, [corrigida, activeTab, onTab]);

    const areaAtiva = areaDaAba(corrigida);
    const abas = areas.find((a) => a.id === areaAtiva)?.abas ?? [];
    const rotuloArea = (id: AreaId) => areas.find((a) => a.id === id)?.label ?? '';

    // Celular: null = home (cartões). Entra numa área ao tocar; volta pela seta.
    const [mobileArea, setMobileArea] = useState<AreaId | null>(null);
    // Se a aba mudou por fora (ex.: "ver histórico por operador"), acompanha dentro da área.
    useEffect(() => { setMobileArea((m) => (m === null ? m : areaDaAba(corrigida))); }, [corrigida]);

    const [q, setQ] = useState('');
    const achados = buscarAjustes(q, BUSCAVEIS).filter((a) => a.id !== 'baixar_app' || podeBaixarApp()).filter((a) => areas.some((x) => x.abas.some((b) => b.id === a.aba))).slice(0, 6);
    const escolherAjuste = (aba: AbaId, id: string) => { setQ(''); setMobileArea(areaDaAba(aba)); onTab(aba, `aj-${id}`); };

    const caminho = (aba: AbaId, secao: string) => {
        const nomeAba = areas.flatMap((x) => x.abas).find((b) => b.id === aba)?.label;
        const nomeSecao = secao === 'aba' ? undefined : (ROTULO_SECAO[secao] ?? secao);
        return [rotuloArea(areaDaAba(aba)), nomeAba, nomeSecao].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' › ');
    };

    const Busca = (
        <div className="space-y-2">
            <label className="relative block">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ajuste…" aria-label="Buscar ajuste"
                    className="w-full h-10 max-sm:h-11 pl-9 pr-3 rounded-[12px] bg-[var(--surface)] text-[15px] max-sm:text-base text-[var(--text)] placeholder:text-[var(--text-muted)] shadow-[var(--shadow-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40" />
            </label>
            {q.trim() && (
                <ul className="bg-[var(--surface)] rounded-[14px] shadow-[var(--shadow-sm)] p-1" aria-label="Ajustes encontrados">
                    {achados.length === 0 && <li className="px-3 py-2 text-[13px] text-[var(--text-muted)]">Nenhum ajuste encontrado.</li>}
                    {achados.map((a) => (
                        <li key={a.id}>
                            <button type="button" onClick={() => escolherAjuste(a.aba, a.id)} className="w-full text-left px-3 py-2 max-sm:min-h-11 rounded-[10px] hover:bg-[var(--surface-2)] u-motion u-press-sm">
                                <span className="block text-[15px] text-[var(--text)]">{a.titulo}</span>
                                <span className="block text-[12px] text-[var(--text-muted)]">{caminho(a.aba, a.secao)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );

    const Pilulas = (alturaCls: string) => abas.length > 1 && (
        <div role="tablist" aria-label={rotuloArea(areaAtiva)} className="mb-5 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:-mx-4 max-md:px-4">
            {abas.map((b) => (
                <button key={b.id} role="tab" aria-selected={b.id === corrigida} onClick={() => onTab(b.id)}
                    className={`shrink-0 ${alturaCls} px-4 rounded-full text-[15px] font-medium whitespace-nowrap flex items-center gap-1.5 u-motion ${b.id === corrigida ? 'bg-[var(--brand-fill)] text-white font-semibold' : 'text-[var(--text)] bg-[var(--surface)] shadow-[var(--shadow-sm)]'}`}>
                    {b.sensitive && <Lock size={12} />}{b.label}
                </button>
            ))}
        </div>
    );

    const emHome = mobileArea === null;

    return (
        <div className="flex flex-col md:flex-row gap-6">
            {/* Computador: trilho de áreas */}
            <nav aria-label="Administração" className="w-full md:w-60 flex-shrink-0 space-y-3 max-md:hidden">
                {Busca}
                <div className="bg-[var(--surface)] rounded-[14px] shadow-[var(--shadow-sm)] p-1 space-y-0.5">
                    {areas.map((a) => {
                        const ativa = a.id === areaAtiva;
                        const st = status[a.id];
                        return (
                            <button key={a.id} type="button" aria-current={ativa ? 'page' : undefined} onClick={() => { if (!ativa) onTab(abaInicial(a.id, ctx) ?? corrigida); }}
                                className={`relative isolate w-full text-left px-3 py-2 rounded-[10px] u-motion u-press-sm flex items-start gap-2.5 ${ativa ? 'text-[var(--brand)]' : 'text-[var(--text)] hover:bg-[var(--surface-2)]'}`}>
                                {ativa && <motion.div layoutId="admin-area-ativa" className="absolute inset-0 rounded-[10px] bg-[var(--brand-soft)] -z-10" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
                                <span className="mt-0.5">{ICONE[a.id](18)}</span>
                                <span className="min-w-0">
                                    <span className="block text-[15px] font-semibold">{a.label}</span>
                                    <span className="block text-[12px] truncate" style={{ color: st ? TOM_COR[st.tom] : 'var(--text-muted)' }}>{st ? st.texto : a.descricao}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </nav>

            {/* Celular: home em cartões ou cabeçalho da área */}
            <div className="md:hidden">
                <AnimatePresence mode="wait" initial={false}>
                    {emHome ? (
                        <motion.div key="home" {...FADE} className="space-y-3">
                            {Busca}
                            <ul className="space-y-3">
                                {areas.map((a) => {
                                    const st = status[a.id];
                                    return (
                                        <li key={a.id}>
                                            <button type="button" onClick={() => { setMobileArea(a.id); onTab(abaInicial(a.id, ctx) ?? corrigida); }}
                                                className="w-full min-h-14 px-4 py-3 rounded-[16px] bg-[var(--surface)] shadow-[var(--shadow-sm)] flex items-center gap-3 text-left u-motion u-press">
                                                <span className="text-[var(--brand)]">{ICONE[a.id](22)}</span>
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-[17px] font-semibold text-[var(--text)]">{a.label}</span>
                                                    <span className="block text-[13px] truncate" style={{ color: st ? TOM_COR[st.tom] : 'var(--text-muted)' }}>{st ? st.texto : a.descricao}</span>
                                                </span>
                                                <ChevronRight size={18} className="text-[var(--text-muted)]" />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </motion.div>
                    ) : (
                        <motion.div key="area" {...FADE}>
                            <button type="button" onClick={() => setMobileArea(null)} className="mb-2 min-h-11 -ml-1 px-1 flex items-center gap-1 text-[15px] font-medium text-[var(--brand)] u-motion u-press-sm">
                                <ChevronLeft size={18} /> Administração
                            </button>
                            <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--text)] mb-3">{rotuloArea(mobileArea)}</h2>
                            {Pilulas('min-h-11')}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className={`flex-1 min-w-0 ${emHome ? 'max-md:hidden' : ''}`}>
                <div className="max-md:hidden">{Pilulas('h-9')}</div>
                {children}
            </div>
        </div>
    );
};
