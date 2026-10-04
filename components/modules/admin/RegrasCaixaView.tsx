'use client';
import React from 'react';
import type { Store } from '@/types';
import { SettingsConfigProvider, useSetting } from '../settings/SettingsConfigContext';
import { SettingRow, Switch, NumberField } from '../settings/SettingRow';

const Regras: React.FC = () => {
    const [cega, setCega] = useSetting<boolean>('cash_shift_blind_count', false, 'Contagem cega', (b) => (b ?? false) as boolean);
    const [tolerancia, setTolerancia] = useSetting<number>('cash_shift_max_tolerance', 0, 'Tolerância de fechamento');
    const [sangria, setSangria] = useSetting<number>('cash_shift_sangria_alert_threshold', 0, 'Alerta de sangria');
    return (
        <section id="sec-regras" className="space-y-3 scroll-mt-24 bg-[var(--surface)] p-6 max-sm:p-4 rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]">
            <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Regras do caixa</h3>
            <SettingRow id="aj-contagem_cega" titulo="Contagem cega no fechamento de caixa" descricao={'Quem fecha o caixa só vê o valor esperado DEPOIS de confirmar a contagem — evita ajustar a contagem pra bater. Quem tem a permissão “Supervisiona caixa” continua vendo antes.'}>
                <Switch ligado={cega} onChange={() => setCega(!cega)} rotulo="Contagem cega no fechamento de caixa" />
            </SettingRow>
            <SettingRow id="aj-tolerancia_caixa" titulo="Tolerância no fechamento de caixa" descricao={'Diferença acima deste valor exige aprovação de um supervisor (dono ou quem tiver a permissão "Supervisiona Caixa") pra fechar o turno. Deixe 0 pra desligar.'}>
                <NumberField valor={tolerancia} onChange={setTolerancia} prefixo="R$" rotulo="Tolerância máxima de diferença de caixa em reais" />
            </SettingRow>
            <SettingRow id="aj-alerta_sangria" titulo="Alertar sangria acima de" descricao="Sangria com valor igual ou maior que este limiar gera um registro de auditoria. Deixe 0 pra desligar.">
                <NumberField valor={sangria} onChange={setSangria} prefixo="R$" rotulo="Alertar sangria acima deste valor em reais" />
            </SettingRow>
        </section>
    );
};

const RegrasCaixaView: React.FC<{ store: Store; onStoreUpdate?: (s: Store) => void }> = ({ store, onStoreUpdate }) => (
    <SettingsConfigProvider store={store} onStoreUpdate={onStoreUpdate}><Regras /></SettingsConfigProvider>
);
export default RegrasCaixaView;
export { RegrasCaixaView };
