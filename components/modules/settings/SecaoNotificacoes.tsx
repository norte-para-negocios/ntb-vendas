'use client';
import React from 'react';
import { TIPOS, resolverPrefs, tiposAplicaveis, type TipoNotificacao } from '@/lib/notificacoes';
import { useSettingsConfig } from './SettingsConfigContext';
import { Switch } from './SettingRow';

// Central de notificações (04/10/2026): preferências em stores.config.notifications (ausente = tudo ligado).
export const SecaoNotificacoes: React.FC = () => {
    const { config, salvar } = useSettingsConfig();
    const prefs = resolverPrefs(config as never);
    const aplicaveis = tiposAplicaveis({ config: config as never });
    // O patch é calculado só quando a gravação chega na vez da fila, com o config já atualizado:
    // dois toques seguidos em tipos diferentes não se apagam.
    const gravar = (patch: { som?: boolean; tipo?: [TipoNotificacao, boolean] }) =>
        salvar((atualCfg) => {
            const atual = resolverPrefs(atualCfg as never);
            return {
                notifications: {
                    som: patch.som ?? atual.som,
                    tipos: patch.tipo ? { ...atual.tipos, [patch.tipo[0]]: patch.tipo[1] } : atual.tipos,
                },
            };
        }, 'Notificações');
    return (
        <section id="sec-notificacoes" className="space-y-3 scroll-mt-24">
            <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Notificações</h3>
            <div id="aj-notificacoes" className="p-4 bg-[var(--surface-2)] rounded-[14px] scroll-mt-24">
                <p className="text-[13px] text-[var(--text-muted)] mb-2">Cada pessoa vê só os avisos da sua função. Desligue aqui o que a loja não quer receber.</p>
                <div className="divide-y divide-[var(--border)]">
                    <div className="flex items-center justify-between gap-4 py-3">
                        <p className="text-[14px] font-medium text-[var(--text)]">Tocar som nos avisos</p>
                        <Switch ligado={prefs.som} onChange={() => gravar({ som: !prefs.som })} rotulo="Tocar som nos avisos" />
                    </div>
                    {TIPOS.filter((t) => aplicaveis.has(t.tipo)).map((t) => (
                        <div key={t.tipo} className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0">
                                <p className="text-[14px] font-medium text-[var(--text)]">{t.label}</p>
                                <p className="text-[13px] text-[var(--text-muted)]">{t.desc}</p>
                            </div>
                            <Switch ligado={prefs.tipos[t.tipo]} onChange={() => gravar({ tipo: [t.tipo, !prefs.tipos[t.tipo]] })} rotulo={t.label} />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};
