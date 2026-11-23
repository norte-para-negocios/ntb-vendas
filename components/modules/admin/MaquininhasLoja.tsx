'use client';
import React, { useState } from 'react';
import type { Store } from '@/types';
import { MAQUININHA_LABELS } from '@/lib/labels';
import { updateStoreMaquininhas } from '@/lib/api';
import { toast } from '@/components/Toast';
import { SettingRow } from '../settings/SettingRow';

// Maquininhas de cartão da loja (stores.maquininhas, migration 195). Com 1 maquininha o caixa já a recebe marcada; com 2 ou
// mais o caixa escolhe em cada pagamento de cartão; com nenhuma a tela de pagamento não muda.
const MaquininhasLoja: React.FC<{ store: Store; onStoreUpdate?: (s: Store) => void }> = ({ store, onStoreUpdate }) => {
    const [lista, setLista] = useState<string[]>(store.maquininhas ?? []);
    const [salvando, setSalvando] = useState(false);

    const alternar = async (id: string) => {
        if (salvando) return;
        const anterior = lista;
        const nova = anterior.includes(id) ? anterior.filter((m) => m !== id) : [...anterior, id];
        setLista(nova);
        setSalvando(true);
        const r = await updateStoreMaquininhas(store.id, nova);
        setSalvando(false);
        if (!r.success) {
            setLista(anterior);
            toast.error(r.message || 'Não foi possível salvar as maquininhas.');
            return;
        }
        onStoreUpdate?.({ ...store, maquininhas: nova });
    };

    return (
        <section id="sec-maquininhas" className="space-y-3 scroll-mt-24 bg-[var(--surface)] p-6 max-sm:p-4 rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]">
            <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Maquininhas de cartão</h3>
            <SettingRow
                id="aj-maquininhas"
                titulo="Maquininhas da loja"
                descricao="Marque as maquininhas que a loja usa. Com mais de uma, o caixa escolhe a maquininha em cada pagamento de cartão (junto com a bandeira); com uma só, ela já vem marcada. Sem nenhuma, nada muda no caixa."
            >
                <div className="flex flex-wrap gap-2 max-sm:justify-end" role="group" aria-label="Maquininhas da loja">
                    {Object.entries(MAQUININHA_LABELS).map(([id, label]) => {
                        const ligado = lista.includes(id);
                        return (
                            <button
                                key={id}
                                type="button"
                                aria-pressed={ligado}
                                disabled={salvando}
                                onClick={() => alternar(id)}
                                className={`h-9 max-sm:h-11 px-4 rounded-full text-[13px] font-semibold u-motion u-press-sm disabled:opacity-60 ${ligado ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--border)]'}`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            </SettingRow>
        </section>
    );
};

export default MaquininhasLoja;
