'use client';

// Permissões por função (04/10/2026): matriz Gerente/Caixa/Garçom x ações, salva em
// stores.config.role_permissions. Pronta para ser encaixada em Administração >
// Configurações (o plano da Administração em 5 áreas faz o encaixe).
// Uso: <RolePermissionsView store={store} loggedUser={user} onStoreUpdate={...} />

import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui';
import { toast } from '@/components/Toast';
import type { Store } from '@/types';
import { updateStoreConfig } from '@/lib/api';
import { ACTIONS, ROLE_KEYS, ROLE_TITLES, matrizEfetiva, alterarPermissaoEsparso, SEGUE_ABA, type ActionKey, type RoleKey } from '@/lib/rolePermissions';

const RolePermissionsView: React.FC<{
    store: Store;
    loggedUser: { role: string };
    onStoreUpdate?: (store: Store) => void;
}> = ({ store, loggedUser, onStoreUpdate }) => {
    // Só dono e conta universal editam; o gerente vê, desabilitado.
    const podeEditar = loggedUser.role === 'owner' || loggedUser.role === 'universal';
    const [matriz, setMatriz] = useState(() => matrizEfetiva(store.config?.role_permissions));
    const [salvando, setSalvando] = useState(false);
    const configRef = useRef(store.config);

    useEffect(() => {
        configRef.current = store.config;
        setMatriz(matrizEfetiva(store.config?.role_permissions));
    }, [store.config]);

    // `salvo` = o que vai em stores.config.role_permissions (undefined = remove a chave e volta ao padrão).
    const salvar = async (salvo: ReturnType<typeof alterarPermissaoEsparso>, mensagemErro: string) => {
        const anterior = matriz;
        const proximaMatriz = matrizEfetiva(salvo);
        setMatriz(proximaMatriz);
        setSalvando(true);
        const { role_permissions: _antiga, ...resto } = (configRef.current ?? {}) as any;
        const novaConfig = (salvo ? { ...resto, role_permissions: salvo } : resto) as Store['config'];
        try {
            await updateStoreConfig(store.id, novaConfig);
            configRef.current = novaConfig;
            onStoreUpdate?.({ ...store, config: novaConfig });
        } catch (e) {
            console.error('Erro ao salvar permissões por função', e);
            setMatriz(anterior);
            toast.error(mensagemErro);
        } finally {
            setSalvando(false);
        }
    };

    const alternar = (role: RoleKey, action: ActionKey) => {
        if (!podeEditar || salvando) return;
        void salvar(alterarPermissaoEsparso(configRef.current?.role_permissions, role, action, !matriz[role][action]), 'Não foi possível salvar a permissão.');
    };

    const voltarAoPadrao = () => {
        if (!podeEditar || salvando) return;
        void salvar(undefined, 'Não foi possível voltar ao padrão.');
    };

    return (
        <section className="space-y-4" aria-labelledby="role-perms-title">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h3 id="role-perms-title" className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Permissões por função</h3>
                    <p className="text-[13px] text-[var(--text-muted)] mt-0.5">Escolha o que cada função pode fazer nesta loja.</p>
                </div>
                <Button variant="secondary" onClick={voltarAoPadrao} disabled={!podeEditar || salvando} className="max-sm:h-11">
                    <RotateCcw size={16} /> Voltar ao padrão
                </Button>
            </div>

            <p className="flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] text-[var(--text-muted)]">
                <ShieldCheck size={16} className="shrink-0 text-[var(--brand)]" aria-hidden="true" />
                Dono e conta universal sempre podem tudo.
            </p>
            {!podeEditar && (
                <p className="text-[13px] text-[var(--text-muted)]" role="status">Só o dono altera estas permissões. Você pode consultar.</p>
            )}

            <div className="rounded-[var(--r-lg)] bg-[var(--surface)] overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div className="hidden md:grid grid-cols-[1fr_repeat(3,88px)] items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span>Ação</span>
                    {ROLE_KEYS.map((r) => <span key={r} className="text-center">{ROLE_TITLES[r]}</span>)}
                </div>
                <ul className="divide-y divide-[var(--border)]">
                    {ACTIONS.map((a) => (
                        <li key={a.key} className="px-4 py-3 md:grid md:grid-cols-[1fr_repeat(3,88px)] md:items-center md:gap-2">
                            <div className="min-w-0">
                                <p className="text-[15px] font-medium text-[var(--text)]">{a.label}</p>
                                <p className="text-[13px] text-[var(--text-muted)]">{a.desc}{SEGUE_ABA.includes(a.key) ? ' Sem ajuste, segue a aba Cardápio de cada pessoa.' : ''}</p>
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2 md:contents">
                                {ROLE_KEYS.map((r) => {
                                    const ligado = matriz[r][a.key];
                                    return (
                                        <div key={r} className="flex flex-col items-center gap-1 md:justify-self-center">
                                            <span className="text-[12px] text-[var(--text-muted)] md:hidden">{ROLE_TITLES[r]}</span>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={ligado}
                                                aria-label={`${ROLE_TITLES[r]}: ${a.label}`}
                                                disabled={!podeEditar || salvando}
                                                onClick={() => alternar(r, a.key)}
                                                className="relative grid min-h-11 min-w-11 place-items-center disabled:opacity-50"
                                            >
                                                <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${ligado ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}>
                                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ligado ? 'translate-x-6' : 'translate-x-1'}`} />
                                                </span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
            <p className="text-[12px] text-[var(--text-muted)]">
                Quem já tem uma permissão individual (trocas, supervisão de caixa) continua com ela. Sem nada salvo aqui, o cardápio, o esgotar produto e o preço por horário seguem a permissão de aba de cada usuário.
            </p>
        </section>
    );
};

export default RolePermissionsView;
export { RolePermissionsView };
