'use client';
import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { useSetting } from './SettingsConfigContext';
import { SettingRow, Switch } from './SettingRow';

export const SecaoPedidoCliente: React.FC = () => {
    const [pedidoCliente, setPedidoCliente] = useSetting<boolean>('client_ordering', true, 'Pedido do cliente', (b) => b !== false);
    const [maisVendidos, setMaisVendidos] = useSetting<boolean>('show_bestsellers', false, 'Mais vendidos', (b) => (b ?? false) as boolean);
    const [sugestoes, setSugestoes] = useSetting<string[]>('note_suggestions', [], 'Sugestões de observação', (b) => (Array.isArray(b) ? (b as string[]) : []));
    const [nova, setNova] = useState('');
    const [salvando, setSalvando] = useState(false);

    const persistir = async (lista: string[]) => { setSalvando(true); try { await setSugestoes(lista); } finally { setSalvando(false); } };
    const adicionar = () => {
        const t = nova.trim();
        if (!t) return;
        if (sugestoes.includes(t)) { toast.error('Essa sugestão já existe.'); return; }
        if (sugestoes.length >= 20) { toast.error('Limite de 20 sugestões atingido.'); return; }
        setNova('');
        persistir([...sugestoes, t]);
    };

    return (
        <section id="sec-pedido_cliente" className="space-y-3 scroll-mt-24">
            <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Pedido do cliente</h3>
            <p className="text-[13px] font-semibold text-[var(--text-muted)]">Cardápio do cliente (QR da mesa)</p>
            <SettingRow
                id="aj-client_ordering"
                titulo="Clientes podem fazer pedido pelo celular"
                descricao={pedidoCliente
                    ? 'Ligado: o cliente entra na mesa com o PIN, monta o carrinho, envia pedidos e pede a conta pelo celular.'
                    : 'Desligado: o cardápio vira só consulta. O cliente vê pratos, fotos e preços, mas não entra na mesa, não pede e não vê PIN — o pedido fica com o garçom.'}
            >
                <Switch ligado={pedidoCliente} onChange={() => setPedidoCliente(!pedidoCliente)} rotulo="Clientes podem fazer pedido pelo celular" />
            </SettingRow>
            <SettingRow id="aj-mais_vendidos" titulo="Mostrar mais vendidos automaticamente no cardápio" descricao={'Calcula os produtos mais vendidos dos últimos 30 dias (por quantidade, sem expor valor de venda) e mostra um selo "Mais vendido" pro cliente no cardápio.'}>
                <Switch ligado={maisVendidos} onChange={() => setMaisVendidos(!maisVendidos)} rotulo="Mostrar mais vendidos automaticamente no cardápio" />
            </SettingRow>
            <div id="aj-observacoes_rapidas" className="pt-4 border-t border-[var(--border)] scroll-mt-24">
                <h4 className="font-semibold text-[15px] text-[var(--text)]">Sugestões de observação rápida</h4>
                <p className="text-[13px] text-[var(--text-muted)] mb-3">
                    Chips de atalho que aparecem pro cliente no campo de observação do pedido (ex.: &quot;Sem cebola&quot;,
                    &quot;Bem passado&quot;, &quot;Sem gelo&quot;). Sem nenhuma sugestão cadastrada, o campo de observação continua
                    como é hoje.
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                    {sugestoes.length === 0 && <span className="text-[13px] text-[var(--text-muted)]">Nenhuma sugestão cadastrada.</span>}
                    {sugestoes.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-[var(--surface-2)] text-[13px] font-medium text-[var(--text)]">
                            {s}
                            <button type="button" onClick={() => persistir(sugestoes.filter((x) => x !== s))} aria-label={`Remover sugestão "${s}"`} className="text-[var(--text-muted)] hover:text-[var(--err)] u-motion max-sm:min-h-11 max-sm:min-w-9 flex items-center justify-center">
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <Input
                        placeholder='Nova sugestão (ex: "Sem cebola")'
                        aria-label="Nova sugestão de observação"
                        value={nova}
                        onChange={(e) => setNova(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }}
                    />
                    <Button onClick={adicionar} isLoading={salvando} aria-label="Adicionar sugestão" className="max-sm:min-h-11"><Plus size={20} /></Button>
                </div>
            </div>
        </section>
    );
};
