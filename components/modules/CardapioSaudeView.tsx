'use client';

// "Saúde do cardápio" (04/10/2026): mostra os achados de lib/cardapioIntegridade.ts para a loja.
// SOMENTE LEITURA: nunca altera produto. Pronta para encaixe em Administração > Cardápio.
// Uso: <CardapioSaudeView storeId={store.id} />

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { fetchMenu } from '@/lib/api';
import { auditarCardapio, type Achado } from '@/lib/cardapioIntegridade';

const TITULO: Record<Achado['severidade'], string> = { alta: 'Precisa corrigir', media: 'Vale conferir', baixa: 'Detalhe' };
const VARIANTE: Record<Achado['severidade'], 'critical' | 'warning' | 'default'> = { alta: 'critical', media: 'warning', baixa: 'default' };
const ORDEM: Achado['severidade'][] = ['alta', 'media', 'baixa'];

const CardapioSaudeView: React.FC<{ storeId: string }> = ({ storeId }) => {
    const [achados, setAchados] = useState<Achado[] | null>(null);
    const [erro, setErro] = useState(false);
    const [carregando, setCarregando] = useState(false);
    const [totais, setTotais] = useState<{ produtos: number; categorias: number } | null>(null);

    const carregar = useCallback(async () => {
        setCarregando(true);
        setErro(false);
        try {
            const m = await fetchMenu(storeId, false, true);
            if ((m as { error?: unknown }).error) throw new Error('menu');
            const produtos = m.products.map((p) => ({
                id: p.id, name: p.name, price: Number(p.price), category_id: p.category_id ?? null, available: p.available,
                order: p.order ?? null, omie_codigo: p.omie_codigo ?? null, fee_type: p.fee_type ?? null,
                grupos: (p.option_groups ?? []).map((g) => ({
                    name: g.name,
                    required: g.required,
                    opcoes: (g.options ?? []).filter((o) => o.available !== false).length,
                    temCodigoOmie: (g.options ?? []).some((o) => !!o.omie_codigo || Object.values(o.variants ?? {}).some((v) => !!v?.omie_codigo)),
                })),
            }));
            setAchados(auditarCardapio({ categorias: m.categories.map((c) => ({ id: c.id, name: c.name, order: c.order ?? null })), produtos }));
            setTotais({ produtos: produtos.filter((p) => p.available).length, categorias: m.categories.length });
        } catch (e) {
            console.error('Erro ao auditar o cardápio', e);
            setErro(true);
        } finally {
            setCarregando(false);
        }
    }, [storeId]);

    useEffect(() => { void carregar(); }, [carregar]);

    return (
        <section className="space-y-4" aria-labelledby="saude-cardapio-title">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h3 id="saude-cardapio-title" className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Saúde do cardápio</h3>
                    <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
                        Confere categorias, posição, preço, nomes repetidos, adicionais e código do estoque. Só mostra os problemas, não altera nada.
                    </p>
                </div>
                <Button variant="secondary" onClick={() => void carregar()} isLoading={carregando} className="max-sm:h-11">
                    <RefreshCw size={16} /> Conferir de novo
                </Button>
            </div>

            {erro && <p className="text-[14px] text-[var(--err)]" role="alert">Não foi possível ler o cardápio agora. Tente de novo.</p>}
            {!erro && achados === null && <p className="text-[14px] text-[var(--text-muted)]" role="status">Conferindo o cardápio...</p>}

            {achados && totais && (
                <>
                    <p className="text-[13px] text-[var(--text-muted)]">
                        <span className="num">{totais.produtos}</span> produtos ativos em <span className="num">{totais.categorias}</span> categorias.
                    </p>
                    {achados.length === 0 ? (
                        <p className="flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-4 py-3 text-[14px] text-[var(--text)]" role="status">
                            <CheckCircle2 size={18} className="text-[var(--ok)] shrink-0" aria-hidden="true" /> Nenhum problema encontrado.
                        </p>
                    ) : (
                        ORDEM.map((sev) => {
                            const lista = achados.filter((a) => a.severidade === sev);
                            if (!lista.length) return null;
                            return (
                                <div key={sev} className="rounded-[var(--r-lg)] bg-[var(--surface)] overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
                                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
                                        <Badge variant={VARIANTE[sev]}>{TITULO[sev]}</Badge>
                                        <span className="num text-[13px] text-[var(--text-muted)]">{lista.length}</span>
                                    </div>
                                    <ul className="divide-y divide-[var(--border)]">
                                        {lista.map((a, i) => (
                                            <li key={`${a.tipo}-${i}`} className="px-4 py-2.5 text-[14px] text-[var(--text)] break-words">{a.texto}</li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })
                    )}
                </>
            )}
        </section>
    );
};

export default CardapioSaudeView;
export { CardapioSaudeView };
