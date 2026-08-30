'use client';

// Extraído de MenuManagementView (StoreModule.tsx) em 2026-08-29 — pedido
// direto do dono: "Configurações Gerais" (taxa de serviço, largura de
// papel, avisos de mesa, capa, cor de destaque, identidade visual,
// sugestões de observação) estava na aba ERRADA (Cardápio), deveria estar
// em Administração desde sempre. Nenhuma lógica mudou aqui, só o lugar
// onde é montado — mesmo `updateStoreConfig`/`stores.config`, mesmas
// chaves, mesmo comportamento otimista com revert em erro.

import React, { useState, useEffect } from 'react';
import { AlertCircle, Upload, Image as ImageIcon, Plus, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { Store } from '@/types';
import { updateStoreConfig, updateStoreAccentColor, uploadStoreCover, updateStoreCoverUrl } from '@/lib/api';
import { THEME_PRESETS, resolveThemePreset, ThemePreset } from '@/lib/theme';
import { SERVICE_FEE_RATE, formatServiceFeeRate } from '@/lib/calc';
import { MENU_DARK_BG_HEX } from '@/lib/colorContrast';

// ACCENT_COLOR_DEFAULT não é exportado por `lib/colorContrast.ts` (só
// `MENU_DARK_BG_HEX` é) — em StoreModule.tsx era uma const local não
// exportada (`const ACCENT_COLOR_DEFAULT = '#484DB5';`), usada só dentro
// do bloco que virou este arquivo. Movida pra cá com o mesmo valor em vez
// de importada, pra não deixar uma const morta e não usada em
// StoreModule.tsx.
const ACCENT_COLOR_DEFAULT = '#484DB5';

const StoreSettingsView: React.FC<{ store: Store; onStoreUpdate?: (store: Store) => void }> = ({ store, onStoreUpdate }) => {
    const [serviceFeeEnabled, setServiceFeeEnabled] = useState(store.config?.charge_service_fee ?? false);
    const [currentStoreConfig, setCurrentStoreConfig] = useState(store.config);

    // Capa do cardápio (Task 1 do redesign iFood, migration 047,
    // `stores.cover_url`). Diferente dos toggles/config acima (que vivem em
    // `stores.config`, uma coluna jsonb), `cover_url` é coluna própria da
    // loja — não existe campo de logo equivalente aqui em StoreModule.tsx
    // (o upload de logo só existe hoje no Master Admin, `AdminModule.tsx`)
    // então este bloco replica o MESMO padrão visual de lá (preview em
    // caixa tracejada + botão "Escolher Imagem" + `uploadStoreCover`), só
    // com persistência própria (`updateStoreCoverUrl`) e um botão "Salvar
    // Capa" explícito, já que aqui não existe um "Salvar Loja" geral que
    // upload por trás — mesmo princípio de loading/erro dos outros
    // controles desta seção (estado otimista + toast de erro).
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(store.cover_url);
    const [isSavingCover, setIsSavingCover] = useState(false);

    // Vende mais II (migration 020) — "mais vendido" automatico. Mesma chave
    // jsonb de sempre (stores.config), so' com show_bestsellers nova; mesmo
    // padrao otimista do toggle de taxa de servico logo acima.
    const [showBestsellersEnabled, setShowBestsellersEnabled] = useState(store.config?.show_bestsellers ?? false);

    // Melhorias no fluxo de Caixa (2026-08-28), Task 4 — contagem cega no
    // fechamento de turno: mesmo padrão jsonb de sempre (stores.config).
    const [blindCountEnabled, setBlindCountEnabled] = useState(store.config?.cash_shift_blind_count ?? false);

    // Largura de papel da impressora térmica (achado real, reunião com o
    // Ramon, 2026-08-25) — mesmo padrão jsonb de sempre. undefined = 48mm
    // (comportamento atual, sem mudança pras 7 lojas reais que nunca
    // configuraram isso).
    const [paperWidthMm, setPaperWidthMm] = useState<48 | 58 | 80>(store.config?.printer_paper_width_mm ?? 48);

    // Avisos de tempo na Gestão de Mesas (pedido do dono, 2026-08-29) —
    // mesmo padrão jsonb de sempre (stores.config). 0/undefined = aviso
    // desligado (comportamento atual, sem mudança pras lojas que nunca
    // configurarem isso). Ver TablesView (tableAlertMinutesOccupied/
    // tableAlertMinutesNoOrder) pra onde isso é lido e o card ganha o
    // destaque visual.
    const [tableAlertOccupiedMin, setTableAlertOccupiedMin] = useState<number>(store.config?.table_alert_occupied_minutes ?? 0);
    const [tableAlertNoOrderMin, setTableAlertNoOrderMin] = useState<number>(store.config?.table_alert_no_order_minutes ?? 0);

    // Tolerância de fechamento de caixa (2026-08-30) — mesmo padrão jsonb de
    // sempre (stores.config). 0/undefined = trava desligada (comportamento
    // atual). Ver CaixaView em StoreModule.tsx pra onde isso é consumido.
    const [cashShiftMaxTolerance, setCashShiftMaxTolerance] = useState<number>(store.config?.cash_shift_max_tolerance ?? 0);

    // Alerta de auditoria em sangria grande (2026-08-30) — mesmo padrão jsonb
    // de sempre (stores.config). 0/undefined = alerta desligado. Ver
    // handleSubmitMovement em CaixaView (StoreModule.tsx) pra onde isso é
    // consumido.
    const [sangriaAlertThreshold, setSangriaAlertThreshold] = useState<number>(store.config?.cash_shift_sangria_alert_threshold ?? 0);

    // Sugestoes de observacao rapida (migration 019, cardapio que vende) —
    // mesmo padrao/coluna jsonb ja usado pela taxa de servico
    // (stores.config), so' com uma chave nova (note_suggestions). Vazio =
    // nenhum chip aparece pro cliente (comportamento atual do campo de
    // observacao continua igual).
    const [noteSuggestions, setNoteSuggestions] = useState<string[]>(store.config?.note_suggestions ?? []);
    const [newNoteSuggestion, setNewNoteSuggestion] = useState('');
    const [isSavingNoteSuggestions, setIsSavingNoteSuggestions] = useState(false);

    // Cor de destaque por loja (Task 6, stores.config.accent_color).
    // Rascunho local (accentColorDraft) segue o dedo no picker sem salvar a
    // cada pixel; só persiste ao clicar "Salvar Cor", que passa pela trava
    // de contraste em updateStoreAccentColor (lib/api.ts) — pode ser
    // recusado.
    const [accentColorDraft, setAccentColorDraft] = useState<string>(store.config?.accent_color || ACCENT_COLOR_DEFAULT);
    const [accentColorError, setAccentColorError] = useState<string | null>(null);
    const [isSavingAccentColor, setIsSavingAccentColor] = useState(false);

    // Fase 5, Task 18 (plano "Fora do Cardápio"): kit de identidade visual —
    // 4 presets fechados (fonte de destaque + textura do hero + emoji de
    // categoria, ver lib/theme.ts), reaproveitando `accent_color` já
    // existente pra cor (nunca reimplementa cor aqui).
    const [themePreset, setThemePreset] = useState<ThemePreset>(resolveThemePreset(store.config?.theme_preset));
    const [isSavingThemePreset, setIsSavingThemePreset] = useState(false);

    const handleSaveThemePreset = async (preset: ThemePreset) => {
        const previous = themePreset;
        setThemePreset(preset); // otimista, mesmo padrão de persistNoteSuggestions
        setIsSavingThemePreset(true);
        try {
            const newConfig = { ...currentStoreConfig, theme_preset: preset };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, config: newConfig });
            }
            toast.success(`Identidade visual "${THEME_PRESETS[preset].label}" aplicada!`);
        } catch (e) {
            console.error('Error updating theme preset', e);
            setThemePreset(previous);
            toast.error('Erro ao atualizar a identidade visual.');
        } finally {
            setIsSavingThemePreset(false);
        }
    };

    // A `store` recebida via prop ja e a fonte da verdade (StoreModule mantem
    // `user.store` atualizado via `onStoreUpdate` a cada mudanca real de
    // config) — nao ha motivo pra rebuscar do banco aqui (achado de
    // performance #9). So resincroniza o estado local se o proprio prop
    // `store` mudar (ex.: loja trocada/atualizada por outro componente).
    useEffect(() => {
        setCurrentStoreConfig(store.config);
        setServiceFeeEnabled(store.config?.charge_service_fee ?? false);
        setNoteSuggestions(store.config?.note_suggestions ?? []);
        setShowBestsellersEnabled(store.config?.show_bestsellers ?? false);
        setBlindCountEnabled(store.config?.cash_shift_blind_count ?? false);
        setPaperWidthMm(store.config?.printer_paper_width_mm ?? 48);
        setTableAlertOccupiedMin(store.config?.table_alert_occupied_minutes ?? 0);
        setTableAlertNoOrderMin(store.config?.table_alert_no_order_minutes ?? 0);
        setCashShiftMaxTolerance(store.config?.cash_shift_max_tolerance ?? 0);
        setSangriaAlertThreshold(store.config?.cash_shift_sangria_alert_threshold ?? 0);
        setCoverPreview(store.cover_url);
        setCoverFile(null);
        setAccentColorDraft(store.config?.accent_color || ACCENT_COLOR_DEFAULT);
        setAccentColorError(null);
    }, [store]);

    const handleCoverFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setCoverFile(file);
            setCoverPreview(URL.createObjectURL(file));
        }
    };

    const handleSaveCover = async () => {
        if (!coverFile) return;
        setIsSavingCover(true);
        try {
            const uploadedUrl = await uploadStoreCover(coverFile);
            const result = await updateStoreCoverUrl(store.id, uploadedUrl);
            if (!result.success) throw new Error(result.message || 'Erro ao salvar a capa.');
            setCoverFile(null);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, cover_url: uploadedUrl });
            }
            toast.success('Capa do cardápio atualizada!');
        } catch (e: any) {
            toast.error('Erro ao salvar capa: ' + e.message);
        } finally {
            setIsSavingCover(false);
        }
    };

    const handleToggleServiceFee = async () => {
        const newValue = !serviceFeeEnabled;
        setServiceFeeEnabled(newValue);
        try {
            const newConfig = {
                ...currentStoreConfig,
                charge_service_fee: newValue
            };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, config: newConfig });
            }
        } catch (e) {
            console.error("Error updating config", e);
            setServiceFeeEnabled(!newValue); // Revert on error
            toast.error("Erro ao atualizar configuração de taxa de serviço.");
        }
    };

    const handleToggleBlindCount = async () => {
        const newValue = !blindCountEnabled;
        setBlindCountEnabled(newValue);
        try {
            const newConfig = { ...currentStoreConfig, cash_shift_blind_count: newValue };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) onStoreUpdate({ ...store, config: newConfig });
        } catch (e) {
            console.error('Error updating blind count config', e);
            setBlindCountEnabled(!newValue);
            toast.error('Erro ao atualizar configuração de contagem cega.');
        }
    };

    const handleToggleBestsellers = async () => {
        const newValue = !showBestsellersEnabled;
        setShowBestsellersEnabled(newValue); // otimista, mesmo padrão do toggle de taxa de serviço acima
        try {
            const newConfig = { ...currentStoreConfig, show_bestsellers: newValue };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, config: newConfig });
            }
        } catch (e) {
            console.error("Error updating bestsellers config", e);
            setShowBestsellersEnabled(!newValue); // revert on error
            toast.error("Erro ao atualizar configuração de mais vendidos.");
        }
    };

    const handleChangePaperWidth = async (newValue: 48 | 58 | 80) => {
        const previous = paperWidthMm;
        setPaperWidthMm(newValue); // otimista, mesmo padrão do toggle de taxa de serviço acima
        try {
            const newConfig = { ...currentStoreConfig, printer_paper_width_mm: newValue };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, config: newConfig });
            }
        } catch (e) {
            console.error("Error updating printer paper width config", e);
            setPaperWidthMm(previous); // revert on error
            toast.error("Erro ao atualizar largura do papel da impressora.");
        }
    };

    const handleChangeTableAlert = async (field: 'table_alert_occupied_minutes' | 'table_alert_no_order_minutes', newValue: number) => {
        const setter = field === 'table_alert_occupied_minutes' ? setTableAlertOccupiedMin : setTableAlertNoOrderMin;
        const previous = field === 'table_alert_occupied_minutes' ? tableAlertOccupiedMin : tableAlertNoOrderMin;
        setter(newValue); // otimista, mesmo padrão dos outros campos desta seção
        try {
            const newConfig = { ...currentStoreConfig, [field]: newValue };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, config: newConfig });
            }
        } catch (e) {
            console.error('Error updating table alert config', e);
            setter(previous); // revert on error
            toast.error('Erro ao atualizar o aviso de mesa.');
        }
    };

    const handleChangeCashShiftTolerance = async (newValue: number) => {
        const previous = cashShiftMaxTolerance;
        setCashShiftMaxTolerance(newValue);
        try {
            const newConfig = { ...currentStoreConfig, cash_shift_max_tolerance: newValue };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) onStoreUpdate({ ...store, config: newConfig });
        } catch (e) {
            console.error('Error updating cash shift tolerance', e);
            setCashShiftMaxTolerance(previous);
            toast.error('Erro ao atualizar a tolerância de fechamento de caixa.');
        }
    };

    const handleChangeSangriaAlertThreshold = async (newValue: number) => {
        const previous = sangriaAlertThreshold;
        setSangriaAlertThreshold(newValue);
        try {
            const newConfig = { ...currentStoreConfig, cash_shift_sangria_alert_threshold: newValue };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) onStoreUpdate({ ...store, config: newConfig });
        } catch (e) {
            console.error('Error updating sangria alert threshold', e);
            setSangriaAlertThreshold(previous);
            toast.error('Erro ao atualizar o limiar de alerta de sangria.');
        }
    };

    // Cor de destaque (Task 6) — ao contrário dos toggles acima, NÃO é
    // otimista: a trava de contraste em updateStoreAccentColor (lib/api.ts)
    // pode recusar o salvamento, então só atualiza `currentStoreConfig`/
    // `onStoreUpdate` depois de confirmado. `hexColor=null` (botão "Restaurar
    // padrão") nunca é recusado — limpar a cor sempre volta pro WINE_GOLD
    // padrão de ClientModule.tsx.
    const handleSaveAccentColor = async (hexColor: string | null) => {
        setAccentColorError(null);
        setIsSavingAccentColor(true);
        try {
            const newConfig = await updateStoreAccentColor(store.id, currentStoreConfig, hexColor);
            setCurrentStoreConfig(newConfig);
            setAccentColorDraft(hexColor || ACCENT_COLOR_DEFAULT);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, config: newConfig });
            }
            toast.success(hexColor ? 'Cor de destaque atualizada!' : 'Cor de destaque restaurada para o padrão.');
        } catch (e: any) {
            const message = e?.message || 'Erro ao atualizar a cor de destaque.';
            setAccentColorError(message);
            toast.error(message);
        } finally {
            setIsSavingAccentColor(false);
        }
    };

    const persistNoteSuggestions = async (updated: string[]) => {
        const previous = noteSuggestions;
        setNoteSuggestions(updated); // otimista, mesmo padrão do toggle de taxa de serviço acima
        setIsSavingNoteSuggestions(true);
        try {
            const newConfig = { ...currentStoreConfig, note_suggestions: updated };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, config: newConfig });
            }
        } catch (e) {
            console.error("Error updating note suggestions", e);
            setNoteSuggestions(previous); // revert on error
            toast.error("Erro ao atualizar sugestões de observação.");
        } finally {
            setIsSavingNoteSuggestions(false);
        }
    };

    const handleAddNoteSuggestion = () => {
        const trimmed = newNoteSuggestion.trim();
        if (!trimmed) return;
        if (noteSuggestions.includes(trimmed)) {
            toast.error('Essa sugestão já existe.');
            return;
        }
        if (noteSuggestions.length >= 20) {
            toast.error('Limite de 20 sugestões atingido.');
            return;
        }
        setNewNoteSuggestion('');
        persistNoteSuggestions([...noteSuggestions, trimmed]);
    };

    const handleRemoveNoteSuggestion = (value: string) => {
        persistNoteSuggestions(noteSuggestions.filter(s => s !== value));
    };

    return (
        <section className="bg-[var(--surface)] p-6 rounded-xl border border-[var(--border)] shadow-sm">
            <h3 className="font-bold text-lg mb-4 text-[var(--text)]">Configurações Gerais</h3>

            {/* Capa do cardápio (Task 1, redesign iFood, migration 047) —
                mesmo padrão visual do upload de logo do Master Admin
                (AdminModule.tsx), que não existe replicado aqui. */}
            <div className="flex flex-col gap-2 mb-4 pb-4 border-b border-[var(--border)]">
                <label className="text-sm font-semibold text-[var(--text)]">Imagem de Capa do Cardápio</label>
                <div className="flex items-center gap-4">
                    <div className={`w-20 h-20 rounded-xl border-2 border-dashed border-[var(--border)] flex items-center justify-center overflow-hidden bg-[var(--surface-2)] ${coverPreview ? 'border-[var(--brand)]' : ''}`}>
                        {coverPreview ? (
                            <img src={coverPreview} alt="Capa Preview" className="w-full h-full object-cover" />
                        ) : (
                            <ImageIcon className="text-[var(--border)]" size={24} />
                        )}
                    </div>
                    <div className="flex-1">
                        <label className="cursor-pointer bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--text)] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 w-fit transition-colors shadow-sm">
                            <Upload size={16} /> Escolher Imagem
                            <input type="file" className="hidden" accept="image/*" onChange={handleCoverFileChange} />
                        </label>
                        <p className="text-xs text-[var(--text-muted)] mt-2">Imagem de fundo/hero do cardápio (paisagem, ideal 1200x600px)</p>
                    </div>
                    {coverFile && (
                        <Button onClick={handleSaveCover} isLoading={isSavingCover} aria-label="Salvar capa">
                            Salvar Capa
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                <div>
                    <h4 className="font-bold text-[var(--text)]">Cobrar Taxa de Serviço ({formatServiceFeeRate(store.config?.service_fee_rate ?? SERVICE_FEE_RATE)})</h4>
                    <p className="text-sm text-[var(--text-muted)]">Aplica {formatServiceFeeRate(store.config?.service_fee_rate ?? SERVICE_FEE_RATE)} de taxa opcional no total das comandas e pedidos.</p>
                </div>
                <button
                    onClick={handleToggleServiceFee}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${serviceFeeEnabled ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${serviceFeeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
            </div>

            {/* Melhorias no fluxo de Caixa (2026-08-28), Task 4 —
                contagem cega no fechamento de turno. */}
            <div className="mt-4 flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                <div>
                    <h4 className="font-bold text-[var(--text)]">Contagem cega no fechamento de caixa</h4>
                    <p className="text-sm text-[var(--text-muted)]">Quem fecha o caixa só vê o valor esperado DEPOIS de confirmar a contagem — evita ajustar a contagem pra bater. Quem tem a permissão &ldquo;Supervisiona caixa&rdquo; continua vendo antes.</p>
                </div>
                <button
                    onClick={handleToggleBlindCount}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${blindCountEnabled ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${blindCountEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
            </div>

            {/* Vende mais II (migration 020) — "mais vendido" automatico, calculado
                de venda real (get_bestseller_product_ids), nunca tag manual. */}
            <div className="mt-4 flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                <div>
                    <h4 className="font-bold text-[var(--text)]">🔥 Mostrar mais vendidos automaticamente no cardápio</h4>
                    <p className="text-sm text-[var(--text-muted)]">Calcula os produtos mais vendidos dos últimos 30 dias (por quantidade, sem expor valor de venda) e mostra um selo "Mais vendido" pro cliente no cardápio.</p>
                </div>
                <button
                    onClick={handleToggleBestsellers}
                    role="switch"
                    aria-checked={showBestsellersEnabled}
                    aria-label="Mostrar mais vendidos automaticamente no cardápio"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${showBestsellersEnabled ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showBestsellersEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
            </div>

            {/* Largura de papel da impressora térmica (achado real, reunião com o
                Ramon, 2026-08-25) — comanda saía cortada numa impressora maior que
                a antiga 48mm da loja. Afeta ticket de cozinha/bar e comprovante de
                mesa/balcão (lib/print.ts), nunca o relatório de vendas (A4). */}
            <div className="mt-4 flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                <div>
                    <h4 className="font-bold text-[var(--text)]">🖨️ Largura do papel da impressora</h4>
                    <p className="text-sm text-[var(--text-muted)]">Ajusta o ticket de cozinha/bar e o comprovante de mesa/balcão pro tamanho real da bobina térmica.</p>
                </div>
                <select
                    value={paperWidthMm}
                    onChange={e => handleChangePaperWidth(Number(e.target.value) as 48 | 58 | 80)}
                    aria-label="Largura do papel da impressora"
                    className="flex-shrink-0 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-bold"
                >
                    <option value={48}>48mm</option>
                    <option value={58}>58mm</option>
                    <option value={80}>80mm</option>
                </select>
            </div>

            {/* Avisos de tempo na Gestão de Mesas (pedido do dono, 2026-08-29) —
                0 = desligado. TablesView usa o item mais antigo/mais novo dos
                pedidos ativos da mesa como aproximação de "ocupada desde"/"último
                pedido em" (não existe timestamp de abertura de mesa dedicado). */}
            <div className="mt-4 flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] flex-wrap gap-3">
                <div>
                    <h4 className="font-bold text-[var(--text)]">⏱️ Avisos de tempo na Gestão de Mesas</h4>
                    <p className="text-sm text-[var(--text-muted)]">Destaca o card da mesa quando passar desse tempo. Deixe 0 pra desligar.</p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                        Ocupada há mais de
                        <input
                            type="number" min={0} step={5}
                            value={tableAlertOccupiedMin}
                            onChange={e => handleChangeTableAlert('table_alert_occupied_minutes', Math.max(0, Number(e.target.value) || 0))}
                            aria-label="Avisar quando mesa estiver ocupada há mais de X minutos"
                            className="w-16 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-bold text-center"
                        />
                        min
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                        Sem pedido novo há mais de
                        <input
                            type="number" min={0} step={5}
                            value={tableAlertNoOrderMin}
                            onChange={e => handleChangeTableAlert('table_alert_no_order_minutes', Math.max(0, Number(e.target.value) || 0))}
                            aria-label="Avisar quando mesa estiver sem pedido novo há mais de X minutos"
                            className="w-16 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-bold text-center"
                        />
                        min
                    </label>
                </div>
            </div>

            {/* Tolerância de fechamento de caixa (2026-08-30) — 0 = trava
                desligada. Diferença acima disso exige aprovação de supervisor
                (dono, ou quem tiver a permissão "Supervisiona Caixa") pra
                fechar o turno, ver CaixaView em StoreModule.tsx. */}
            <div className="mt-4 flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                <div>
                    <h4 className="font-bold text-[var(--text)]">🔒 Tolerância no fechamento de caixa</h4>
                    <p className="text-sm text-[var(--text-muted)]">Diferença acima deste valor exige aprovação de um supervisor (dono ou quem tiver a permissão "Supervisiona Caixa") pra fechar o turno. Deixe 0 pra desligar.</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] flex-shrink-0">
                    R$
                    <input
                        type="number" min={0} step={5}
                        value={cashShiftMaxTolerance}
                        onChange={e => handleChangeCashShiftTolerance(Math.max(0, Number(e.target.value) || 0))}
                        aria-label="Tolerância máxima de diferença de caixa em reais"
                        className="w-20 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-bold text-center"
                    />
                </label>
            </div>

            {/* Alerta de auditoria em sangria grande (2026-08-30) — 0 =
                alerta desligado. Sangria com valor igual ou maior que este
                limiar grava um evento em cash_shift_audit_events, ver
                handleSubmitMovement em CaixaView (StoreModule.tsx). */}
            <div className="mt-4 flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                <div>
                    <h4 className="font-bold text-[var(--text)]">🚨 Alertar sangria acima de</h4>
                    <p className="text-sm text-[var(--text-muted)]">Sangria com valor igual ou maior que este limiar gera um registro de auditoria. Deixe 0 pra desligar.</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] flex-shrink-0">
                    R$
                    <input
                        type="number" min={0} step={5}
                        value={sangriaAlertThreshold}
                        onChange={e => handleChangeSangriaAlertThreshold(Math.max(0, Number(e.target.value) || 0))}
                        aria-label="Alertar sangria acima deste valor em reais"
                        className="w-20 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-bold text-center"
                    />
                </label>
            </div>

            {/* Cor de destaque por loja (Task 6, stores.config.accent_color) —
                texto/preview corrigidos na Task 15 do plano "Fora do Cardápio"
                (2026-08-27): desde o redesign iFood (2026-08-21), preço e
                categoria ativa do cardápio do cliente pararam de usar essa cor
                (preço é --text/roxo de promoção, categoria ativa é vermelho
                iFood) — o texto antigo aqui ficou descrevendo um efeito que não
                existe mais. Hoje `accent_color` só aparece na TELA DE
                IDENTIFICAÇÃO do cliente (ícone/borda da logo + texto de apoio),
                ver LoginScreen em ClientModule.tsx. Preview ajustado pra mostrar
                isso, não mais um preço. */}
            <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <h4 className="font-bold text-[var(--text)]">Cor de destaque da tela de identificação</h4>
                <p className="text-sm text-[var(--text-muted)] mb-3">
                    Cor usada no ícone e no texto de apoio da tela onde o cliente se identifica antes de pedir
                    (&ldquo;Identifique-se para continuar seu pedido&rdquo;). Sem cor própria definida, o cardápio usa o
                    azul padrão da marca.
                </p>
                <div className="flex items-center gap-4 flex-wrap">
                    <input
                        type="color"
                        aria-label="Escolher cor de destaque"
                        value={accentColorDraft}
                        onChange={e => { setAccentColorDraft(e.target.value); setAccentColorError(null); }}
                        className="w-12 h-12 rounded-lg border border-[var(--border)] cursor-pointer p-0.5 bg-[var(--surface)]"
                    />
                    <div className="px-4 py-3 rounded-lg border border-[var(--border)]" style={{ background: MENU_DARK_BG_HEX }}>
                        <span className="text-[10px] uppercase tracking-wide text-white/40 block mb-1">Pré-visualização</span>
                        <span className="font-semibold text-sm" style={{ color: accentColorDraft }}>Identifique-se para continuar seu pedido</span>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={() => handleSaveAccentColor(accentColorDraft)} isLoading={isSavingAccentColor}>
                            Salvar Cor
                        </Button>
                        {!!store.config?.accent_color && (
                            <Button variant="outline" onClick={() => handleSaveAccentColor(null)} isLoading={isSavingAccentColor}>
                                Restaurar padrão
                            </Button>
                        )}
                    </div>
                </div>
                {accentColorError && (
                    <p className="text-xs text-[var(--err)] mt-2 flex items-center gap-1.5">
                        <AlertCircle size={13} className="flex-shrink-0" /> {accentColorError}
                    </p>
                )}
            </div>

            {/* Fase 5, Task 18 (plano "Fora do Cardápio"): kit de identidade
                visual — 4 presets fechados, cada um só troca fonte de
                destaque + textura do hero + emoji de categoria no cardápio
                do cliente (ver lib/theme.ts). Cor continua sendo só o
                seletor acima — nunca duplicado aqui. */}
            <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <h4 className="font-bold text-[var(--text)]">Identidade visual do cardápio</h4>
                <p className="text-sm text-[var(--text-muted)] mb-3">
                    Escolha um estilo pra tipografia e textura de fundo do cardápio do cliente. &ldquo;Clássico&rdquo; é o
                    visual atual, sem nenhuma mudança.
                </p>
                <div className="flex flex-wrap gap-2">
                    {(Object.entries(THEME_PRESETS) as [ThemePreset, typeof THEME_PRESETS[ThemePreset]][]).map(([key, preset]) => (
                        <button
                            key={key}
                            type="button"
                            disabled={isSavingThemePreset}
                            onClick={() => handleSaveThemePreset(key)}
                            className={`px-3 py-2 rounded-xl border text-sm font-semibold u-motion u-press-sm disabled:opacity-50 ${
                                themePreset === key
                                    ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]'
                                    : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)]'
                            }`}
                        >
                            {preset.categoryEmoji ? `${preset.categoryEmoji} ` : ''}{preset.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sugestoes de observacao rapida (migration 019) — chips de atalho
                pro campo de observacao do cliente, ver ProductModal em ClientModule.tsx */}
            <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <h4 className="font-bold text-[var(--text)]">Sugestões de observação rápida</h4>
                <p className="text-sm text-[var(--text-muted)] mb-3">
                    Chips de atalho que aparecem pro cliente no campo de observação do pedido (ex.: "Sem cebola",
                    "Bem passado", "Sem gelo"). Sem nenhuma sugestão cadastrada, o campo de observação continua
                    como é hoje.
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                    {noteSuggestions.length === 0 && (
                        <span className="text-xs text-[var(--text-muted)] italic">Nenhuma sugestão cadastrada.</span>
                    )}
                    {noteSuggestions.map(suggestion => (
                        <span
                            key={suggestion}
                            className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-xs font-medium text-[var(--text)]"
                        >
                            {suggestion}
                            <button
                                type="button"
                                onClick={() => handleRemoveNoteSuggestion(suggestion)}
                                aria-label={`Remover sugestão "${suggestion}"`}
                                className="text-[var(--text-muted)] hover:text-[var(--err)] u-motion"
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <Input
                        placeholder='Nova sugestão (ex: "Sem cebola")'
                        aria-label="Nova sugestão de observação"
                        value={newNoteSuggestion}
                        onChange={e => setNewNoteSuggestion(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNoteSuggestion(); } }}
                    />
                    <Button onClick={handleAddNoteSuggestion} isLoading={isSavingNoteSuggestions} aria-label="Adicionar sugestão">
                        <Plus size={20}/>
                    </Button>
                </div>
            </div>
        </section>
    );
};

export default StoreSettingsView;
