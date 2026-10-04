'use client';
import React from 'react';
import { useSetting } from './SettingsConfigContext';
import { SettingRow } from './SettingRow';

export const SecaoImpressao: React.FC = () => {
    const [largura, setLargura] = useSetting<number>('printer_paper_width_mm', 48, 'Largura do papel da impressora');
    return (
        <section id="sec-impressao" className="space-y-3 scroll-mt-24">
            <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Impressão</h3>
            <SettingRow id="aj-largura_papel" titulo="Largura do papel da impressora" descricao="Ajusta o ticket de cozinha/bar e o comprovante de mesa/balcão pro tamanho real da bobina térmica.">
                <select
                    value={largura}
                    onChange={(e) => setLargura(Number(e.target.value))}
                    aria-label="Largura do papel da impressora"
                    className="h-9 max-sm:h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] text-[15px] font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40"
                >
                    <option value={48}>48mm</option>
                    <option value={58}>58mm</option>
                    <option value={80}>80mm</option>
                </select>
            </SettingRow>
        </section>
    );
};
