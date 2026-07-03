'use client';

import React, { useState, useEffect } from 'react';
import { Link2, Copy } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { Store } from '@/types';
import { toast } from '@/components/Toast';

export const MeuLinkView: React.FC<{ store: Store }> = ({ store }) => {
    const [url, setUrl] = useState('');

    useEffect(() => {
        if (!store.slug) return;
        setUrl(`${window.location.origin}/c/${store.slug}`);
    }, [store.slug]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success('Link copiado!');
        } catch (error) {
            console.error('Erro ao copiar link', error);
            toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
        }
    };

    if (!store.slug) {
        return (
            <Card className="p-6">
                <p className="text-sm text-[var(--err)]">
                    Link da loja não configurado corretamente. Contate o suporte.
                </p>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <Card className="p-6 space-y-4">
                <div>
                    <h3 className="font-bold text-lg text-[var(--text)]">{store.name}</h3>
                    <p className="text-sm text-[var(--text-muted)] mt-1">
                        Este é o link do cardápio digital da sua loja. Compartilhe com os clientes ou gere um QR Code pra colocar nas mesas.
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)]">
                    <Link2 size={16} className="text-[var(--text-muted)] flex-shrink-0 hidden sm:block" />
                    <input
                        readOnly
                        value={url}
                        onFocus={(e) => e.target.select()}
                        className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none min-w-0"
                    />
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                        <Copy size={14} /> Copiar Link
                    </Button>
                </div>
            </Card>
        </div>
    );
};
