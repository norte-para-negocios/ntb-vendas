'use client';

// Configurações em seções (04/10/2026). Antes era uma fila única de 14 ajustes com um handler por
// ajuste; agora cada seção mora em components/modules/settings/ e todas salvam pelo mesmo contexto
// (SettingsConfigContext: salvar na hora, volta se falhar, "Desfazer"). Mesmas chaves de stores.config.
import React from 'react';
import type { Store } from '@/types';
import { SettingsConfigProvider } from './settings/SettingsConfigContext';
import { SecaoAtendimento } from './settings/SecaoAtendimento';
import { SecaoPedidoCliente } from './settings/SecaoPedidoCliente';
import { SecaoNotificacoes } from './settings/SecaoNotificacoes';
import { SecaoImpressao } from './settings/SecaoImpressao';
import { SecaoAparencia } from './settings/SecaoAparencia';
import { SecaoAplicativo } from './settings/SecaoAplicativo';

export const SETTINGS_SECOES = [
    { id: 'atendimento', label: 'Atendimento' },
    { id: 'pedido_cliente', label: 'Pedido do cliente' },
    { id: 'notificacoes', label: 'Notificações' },
    { id: 'impressao', label: 'Impressão' },
    { id: 'aparencia', label: 'Aparência do cardápio' },
    { id: 'aplicativo', label: 'Aplicativo' },
] as const;

const irPara = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const StoreSettingsView: React.FC<{ store: Store; onStoreUpdate?: (store: Store) => void }> = ({ store, onStoreUpdate }) => (
    <SettingsConfigProvider store={store} onStoreUpdate={onStoreUpdate}>
        <div className="lg:grid lg:grid-cols-[180px_1fr] lg:gap-6">
            <nav aria-label="Seções de configurações" className="max-lg:hidden sticky top-4 self-start space-y-0.5">
                {SETTINGS_SECOES.map((s) => (
                    <a key={s.id} href={`#sec-${s.id}`} onClick={(e) => irPara(e, s.id)} className="block px-3 h-9 leading-9 rounded-[10px] text-[15px] text-[var(--text)] hover:bg-[var(--surface-2)] u-motion">{s.label}</a>
                ))}
            </nav>
            <div className="min-w-0 space-y-8 bg-[var(--surface)] p-6 max-sm:p-4 rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]">
                <SecaoAtendimento store={store} />
                <SecaoPedidoCliente />
                <SecaoNotificacoes />
                <SecaoImpressao />
                <SecaoAparencia store={store} onStoreUpdate={onStoreUpdate} />
                <SecaoAplicativo />
            </div>
        </div>
    </SettingsConfigProvider>
);

export default StoreSettingsView;
