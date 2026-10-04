'use client';
import React from 'react';
import { useSetting } from './SettingsConfigContext';
import { SettingRow, Switch, NumberField } from './SettingRow';
import { SERVICE_FEE_RATE, formatServiceFeeRate } from '@/lib/calc';
import type { Store } from '@/types';

export const SecaoAtendimento: React.FC<{ store: Store }> = ({ store }) => {
    const [pedeSenha, setPedeSenha] = useSetting<boolean>('pedido_pede_senha', false, 'Pedir a senha de quem lança', (b) => b === true);
    const [taxa, setTaxa] = useSetting<boolean>('charge_service_fee', false, 'Taxa de serviço', (b) => (b ?? false) as boolean);
    const [ocupada, setOcupada] = useSetting<number>('table_alert_occupied_minutes', 0, 'Aviso de mesa ocupada');
    const [semPedido, setSemPedido] = useSetting<number>('table_alert_no_order_minutes', 0, 'Aviso de mesa sem pedido');
    const taxaFmt = formatServiceFeeRate(store.config?.service_fee_rate ?? SERVICE_FEE_RATE);
    return (
        <section id="sec-atendimento" className="space-y-3 scroll-mt-24">
            <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Atendimento</h3>
            <SettingRow
                id="aj-pedido_pede_senha"
                titulo="Pedir a senha de quem lança o pedido"
                descricao={pedeSenha
                    ? 'Ligado: a cada pedido de mesa, o garçom digita a própria senha e o pedido sai no nome dele, mesmo se o aparelho estiver logado com outra pessoa.'
                    : 'Desligado: o pedido sai no nome de quem está logado no aparelho.'}
            >
                <Switch ligado={pedeSenha} onChange={() => setPedeSenha(!pedeSenha)} rotulo="Pedir a senha de quem lança o pedido" />
            </SettingRow>
            <SettingRow id="aj-taxa_servico" titulo={`Cobrar taxa de serviço (${taxaFmt})`} descricao={`Aplica ${taxaFmt} de taxa opcional no total das comandas e pedidos.`}>
                <Switch ligado={taxa} onChange={() => setTaxa(!taxa)} rotulo="Cobrar taxa de serviço" />
            </SettingRow>
            <SettingRow id="aj-avisos_tempo" titulo="Avisos de tempo na gestão de mesas" descricao="Destaca o card da mesa quando passar desse tempo. Deixe 0 pra desligar.">
                <div className="flex items-center gap-4 flex-wrap max-sm:justify-end">
                    <NumberField valor={ocupada} onChange={setOcupada} prefixo="Ocupada há mais de" sufixo="min" largura="w-16" rotulo="Avisar quando mesa estiver ocupada há mais de X minutos" />
                    <NumberField valor={semPedido} onChange={setSemPedido} prefixo="Sem pedido novo há mais de" sufixo="min" largura="w-16" rotulo="Avisar quando mesa estiver sem pedido novo há mais de X minutos" />
                </div>
            </SettingRow>
        </section>
    );
};
