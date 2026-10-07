'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui';
import { toast } from '@/components/Toast';
import { resolverUrlApi } from '@/lib/api';

// Administração > Configurações > Integrações (lojas em estoque próprio): estado da sincronização automática do catálogo
// com o Norte Estoque. Nada some em silêncio: o que não entrega aparece aqui como divergência.
type Estado = {
    ok: boolean; modo: string; ligada: boolean; pendentes: number; erros: number; ultimaEntrega: string | null;
    fila: { id: number; entidade: string; ref: string; status: string; tentativas: number; erro: string | null; updated_at: string }[];
    divergencias: { id: number; entidade: string; ref: string; tipo: string; detalhe: string | null; detectado_em: string }[];
};
const ROTULO: Record<string, string> = { erro_entrega: 'Falha de entrega', so_estoque: 'Só no Estoque', so_vendas: 'Só no Vendas', conflito: 'Conflito' };
const ENTIDADE: Record<string, string> = { produto: 'Produto', categoria: 'Categoria', grupo: 'Grupo' };

export function SincronizacaoCatalogo({ storeId }: { storeId: string }) {
    const [estado, setEstado] = useState<Estado | null>(null);
    const [sincronizando, setSincronizando] = useState(false);
    const carregar = useCallback(async () => {
        try {
            const res = await fetch(resolverUrlApi(`/api/integracao/catalogo-status?storeId=${encodeURIComponent(storeId)}`), { cache: 'no-store' });
            setEstado((await res.json()) as Estado);
        } catch { /* sem internet: mantém o último estado */ }
    }, [storeId]);
    useEffect(() => { void carregar(); const t = setInterval(() => void carregar(), 15000); return () => clearInterval(t); }, [carregar]);

    const sincronizar = async () => {
        setSincronizando(true);
        try {
            const res = await fetch(resolverUrlApi('/api/integracao/catalogo-status'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId }) });
            const j = await res.json();
            if (!j.ok) throw new Error(j.error || 'falha');
            toast.success('Sincronização feita.');
            await carregar();
        } catch (e: any) { toast.error('Não foi possível sincronizar agora: ' + e.message); }
        finally { setSincronizando(false); }
    };

    if (!estado || estado.modo !== 'proprio') return null;
    const itens = [...estado.divergencias.map((d) => ({ k: `d${d.id}`, titulo: `${ROTULO[d.tipo] ?? d.tipo} · ${ENTIDADE[d.entidade] ?? d.entidade}`, detalhe: d.detalhe, quando: d.detectado_em, erro: true })),
        ...estado.fila.filter((f) => f.status === 'pending').map((f) => ({ k: `f${f.id}`, titulo: `Aguardando · ${ENTIDADE[f.entidade] ?? f.entidade}`, detalhe: f.erro ? `${f.tentativas} tentativa(s) · ${f.erro}` : null, quando: f.updated_at, erro: false }))];
    return (
        <div className="space-y-3 rounded-[var(--r-lg)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-base font-semibold text-[var(--text)]">Catálogo sincronizado com o Estoque</h3>
                    <p className="text-sm text-[var(--text-muted)]">Produtos, variações e categorias seguem sozinhos entre o Vendas e o Estoque.</p>
                </div>
                <Button variant="outline" onClick={sincronizar} disabled={sincronizando}>{sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                    { l: 'Ligação', v: estado.ligada ? 'Conectada' : 'Aguardando' },
                    { l: 'Na fila', v: String(estado.pendentes) },
                    { l: 'Com falha', v: String(estado.erros) },
                    { l: 'Última entrega', v: estado.ultimaEntrega ? format(new Date(estado.ultimaEntrega), 'dd/MM HH:mm') : '—' },
                ].map((c) => (
                    <div key={c.l} className="rounded-[var(--r-md)] bg-[var(--surface-2)] p-3">
                        <p className="text-xs text-[var(--text-muted)]">{c.l}</p>
                        <p className="mt-0.5 text-base font-semibold text-[var(--text)]">{c.v}</p>
                    </div>
                ))}
            </div>
            {itens.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Nenhuma divergência. Os dois catálogos estão iguais.</p>
            ) : (
                <ul className="divide-y divide-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface-2)]">
                    {itens.map((i) => (
                        <li key={i.k} className="flex items-start gap-3 px-3 py-2">
                            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${i.erro ? 'bg-[var(--err)]' : 'bg-[var(--warn)]'}`} />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-[var(--text)]">{i.titulo}</p>
                                {i.detalhe && <p className="break-words text-xs text-[var(--text-muted)]">{i.detalhe}</p>}
                            </div>
                            <span className="shrink-0 text-xs text-[var(--text-muted)]">{format(new Date(i.quando), 'dd/MM HH:mm')}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
