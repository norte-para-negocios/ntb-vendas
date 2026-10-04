'use client';
import React, { useEffect, useState } from 'react';
import { AlertCircle, Upload, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui';
import { toast } from '@/components/Toast';
import type { Store } from '@/types';
import { updateStoreAccentColor, uploadStoreCover, updateStoreCoverUrl } from '@/lib/api';
import { THEME_PRESETS, resolveThemePreset, type ThemePreset } from '@/lib/theme';
import { MENU_DARK_BG_HEX } from '@/lib/colorContrast';
import { useSettingsConfig } from './SettingsConfigContext';

const ACCENT_COLOR_DEFAULT = '#484DB5';

export const SecaoAparencia: React.FC<{ store: Store; onStoreUpdate?: (s: Store) => void }> = ({ store, onStoreUpdate }) => {
    const { config, salvar, aplicarConfig } = useSettingsConfig();

    // Capa: coluna própria (stores.cover_url), com botão "Salvar capa" explícito.
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(store.cover_url);
    const [isSavingCover, setIsSavingCover] = useState(false);
    useEffect(() => { setCoverPreview(store.cover_url); setCoverFile(null); }, [store.cover_url]);

    const onCover = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) { setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); }
    };
    const salvarCapa = async () => {
        if (!coverFile) return;
        setIsSavingCover(true);
        try {
            const uploadedUrl = await uploadStoreCover(coverFile);
            const result = await updateStoreCoverUrl(store.id, uploadedUrl);
            if (!result.success) throw new Error(result.message || 'Erro ao salvar a capa.');
            setCoverFile(null);
            onStoreUpdate?.({ ...store, cover_url: uploadedUrl });
            toast.success('Capa do cardápio atualizada!');
        } catch (e: any) {
            toast.error('Erro ao salvar capa: ' + e.message);
        } finally {
            setIsSavingCover(false);
        }
    };

    // Cor de destaque: NÃO é otimista (a trava de contraste pode recusar), por isso sem Desfazer.
    const salva = (config as { accent_color?: string | null } | undefined)?.accent_color;
    const [cor, setCor] = useState<string>(salva || ACCENT_COLOR_DEFAULT);
    const [erroCor, setErroCor] = useState<string | null>(null);
    const [salvandoCor, setSalvandoCor] = useState(false);
    useEffect(() => { setCor(salva || ACCENT_COLOR_DEFAULT); setErroCor(null); }, [salva]);
    const salvarCor = async (hex: string | null) => {
        setErroCor(null);
        setSalvandoCor(true);
        try {
            const novo = await updateStoreAccentColor(store.id, config as never, hex);
            aplicarConfig(novo as never);
            setCor(hex || ACCENT_COLOR_DEFAULT);
            toast.success(hex ? 'Cor de destaque atualizada!' : 'Cor de destaque restaurada para o padrão.');
        } catch (e: any) {
            const m = e?.message || 'Erro ao atualizar a cor de destaque.';
            setErroCor(m);
            toast.error(m);
        } finally {
            setSalvandoCor(false);
        }
    };

    // Identidade visual: 4 presets fechados (lib/theme.ts).
    const preset = resolveThemePreset((config as { theme_preset?: string } | undefined)?.theme_preset);
    const [otimista, setOtimista] = useState<ThemePreset | null>(null);
    const [salvandoPreset, setSalvandoPreset] = useState(false);
    const escolherPreset = async (p: ThemePreset) => {
        setOtimista(p);
        setSalvandoPreset(true);
        await salvar({ theme_preset: p }, 'Identidade visual', { mensagem: `Identidade visual "${THEME_PRESETS[p].label}" aplicada.` });
        setOtimista(null);
        setSalvandoPreset(false);
    };
    const presetAtual = otimista ?? preset;

    return (
        <section id="sec-aparencia" className="space-y-4 scroll-mt-24">
            <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Aparência do cardápio</h3>

            <div id="aj-capa_cardapio" className="flex flex-col gap-2 pb-4 border-b border-[var(--border)] scroll-mt-24">
                <label className="text-[15px] font-semibold text-[var(--text)]">Imagem de capa do cardápio</label>
                <div className="flex items-center gap-4 max-sm:flex-wrap">
                    <div className={`w-20 h-20 rounded-[14px] flex items-center justify-center overflow-hidden bg-[var(--surface-2)] ${coverPreview ? '' : 'border-2 border-dashed border-[var(--border)]'}`}>
                        {coverPreview ? <img src={coverPreview} alt="Capa Preview" className="w-full h-full object-cover" /> : <ImageIcon className="text-[var(--border)]" size={24} />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <label className="cursor-pointer bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--text)] h-[38px] max-sm:h-11 px-4 rounded-full text-[15px] font-semibold flex items-center gap-2 w-fit transition-colors">
                            <Upload size={16} /> Escolher imagem
                            <input type="file" className="hidden" accept="image/*" onChange={onCover} />
                        </label>
                        <p className="text-[13px] text-[var(--text-muted)] mt-2">Imagem de fundo/hero do cardápio (paisagem, ideal 1200x600px)</p>
                    </div>
                    {coverFile && <Button onClick={salvarCapa} isLoading={isSavingCover} aria-label="Salvar capa">Salvar Capa</Button>}
                </div>
            </div>

            <div id="aj-cor_destaque" className="pb-4 border-b border-[var(--border)] scroll-mt-24">
                <h4 className="font-semibold text-[15px] text-[var(--text)]">Cor de destaque da tela de identificação</h4>
                <p className="text-[13px] text-[var(--text-muted)] mb-3">
                    Cor usada no ícone e no texto de apoio da tela onde o cliente se identifica antes de pedir
                    (&ldquo;Identifique-se para continuar seu pedido&rdquo;). Sem cor própria definida, o cardápio usa o
                    azul padrão da marca.
                </p>
                <div className="flex items-center gap-4 flex-wrap">
                    <input type="color" aria-label="Escolher cor de destaque" value={cor}
                        onChange={(e) => { setCor(e.target.value); setErroCor(null); }}
                        className="w-12 h-12 rounded-lg border border-[var(--border)] cursor-pointer p-0.5 bg-[var(--surface)]" />
                    <div className="px-4 py-3 rounded-[14px] bg-[var(--surface-2)]" style={{ background: MENU_DARK_BG_HEX }}>
                        <span className="text-[12px] text-white/50 block mb-1">Pré-visualização</span>
                        <span className="font-semibold text-sm" style={{ color: cor }}>Identifique-se para continuar seu pedido</span>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={() => salvarCor(cor)} isLoading={salvandoCor}>Salvar Cor</Button>
                        {!!salva && <Button variant="outline" onClick={() => salvarCor(null)} isLoading={salvandoCor}>Restaurar padrão</Button>}
                    </div>
                </div>
                {erroCor && <p className="text-xs text-[var(--err)] mt-2 flex items-center gap-1.5"><AlertCircle size={13} className="flex-shrink-0" /> {erroCor}</p>}
            </div>

            <div id="aj-identidade_visual" className="scroll-mt-24">
                <h4 className="font-semibold text-[15px] text-[var(--text)]">Identidade visual do cardápio</h4>
                <p className="text-[13px] text-[var(--text-muted)] mb-3">
                    Escolha um estilo pra tipografia e textura de fundo do cardápio do cliente. &ldquo;Clássico&rdquo; é o
                    visual atual, sem nenhuma mudança.
                </p>
                <div className="flex flex-wrap gap-2">
                    {(Object.entries(THEME_PRESETS) as [ThemePreset, (typeof THEME_PRESETS)[ThemePreset]][]).map(([key, p]) => (
                        <button key={key} type="button" disabled={salvandoPreset} onClick={() => escolherPreset(key)}
                            className={`h-9 max-sm:h-11 px-3.5 rounded-full text-[13px] font-semibold u-motion u-press-sm disabled:opacity-50 ${presetAtual === key ? 'ring-2 ring-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'}`}>
                            {p.categoryEmoji ? `${p.categoryEmoji} ` : ''}{p.label}
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
};
