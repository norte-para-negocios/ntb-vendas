'use client';
import React from 'react';
import { Monitor, Smartphone } from 'lucide-react';

// Download do app: só aparece na web (não no Electron/Capacitor). Links diretos pros feeds de atualização.
export const SecaoAplicativo: React.FC = () => {
    if (typeof window === 'undefined' || window.navigator.userAgent.includes('Electron') || (window as any).Capacitor) return null;
    return (
        <section id="sec-aplicativo" className="scroll-mt-24">
            <div id="aj-baixar_app">
                <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)] mb-1 ">Baixar o aplicativo</h3>
                <p className="text-[13px] text-[var(--text-muted)] mb-4">Instale ou atualize o Norte Vendas no computador ou no celular. Sempre a versão mais recente.</p>
                <div className="flex flex-wrap gap-3">
                    <a href="https://updates.norteparanegocios.com.br/ntb-vendas-desktop/Norte-Vendas-Setup.exe" download className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[var(--brand-fill)] text-white text-[15px] font-semibold hover:bg-[var(--brand-strong)] u-motion u-press-sm">
                        <Monitor size={18} />Baixar para Windows
                    </a>
                    <a href="https://updates.norteparanegocios.com.br/ntb-vendas-android/Norte-Vendas-latest.apk" download className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[var(--surface-2)] text-[var(--text)] text-[15px] font-semibold hover:bg-[var(--border)] u-motion u-press-sm">
                        <Smartphone size={18} />Baixar para Android
                    </a>
                </div>
            </div>
        </section>
    );
};
