'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Store as StoreIcon, Users, Plus, Save, Calendar, CheckCircle, XCircle, AlertCircle, LayoutGrid, Coffee, Lock, User, RefreshCw, Trash2, Edit2, Upload, Image, Copy, ArrowRight, FileText } from 'lucide-react';
import { Button, Card, Input, Modal, Badge } from '@/components/ui';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { createStore, updateStore, deleteStore, duplicateStore, authenticateAdmin, updateAdminPassword, fetchAllStores, fetchTables, createStoreUser, updateStoreUser, deleteStoreUser, fetchStoreUsers, uploadStoreLogo, uploadStoreCertificate, saveStoreCertificateMetadata, saveStoreCertificateSecret, fetchStoreCertificateStatus, authenticateUniversalUser, updateUniversalUserPassword, fetchStoreFiscalConfig, updateStoreFiscalConfig, UpdateStoreFiscalConfigParams, fetchNtbEstoqueIntegracaoStatus, saveNtbEstoqueIntegracaoConfig, NtbEstoqueIntegracaoStatus, criarLojaNoEstoque } from '@/lib/api';
import { differenceInDays, format, parseISO } from 'date-fns';
import { Store, StoreUser, StoreFiscalCertificateStatus } from '@/types';
import { toast } from '@/components/Toast';
import { confirm } from '@/components/ConfirmDialog';
import { Skeleton, stagger } from '@/components/Skeleton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getRoleLabel } from '@/lib/labels';

// Admin Login Component
const AdminLogin: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Password Change State
    const [needsChange, setNeedsChange] = useState(false);
    const [userId, setUserId] = useState('');
    const [isUniversalChange, setIsUniversalChange] = useState(false);
    const [newPass, setNewPass] = useState('');
    const [confirmPass, setConfirmPass] = useState('');

    const handleLogin = async () => {
        setError('');
        setIsLoading(true);
        try {
            const result = await authenticateAdmin(username, password);
            if (result.success) {
                if (result.mustChangePass) {
                    setNeedsChange(true);
                    setUserId(result.userId || '');
                    setIsUniversalChange(false);
                } else {
                    onLogin();
                }
                setIsLoading(false);
                return;
            }

            // Não bateu num system_admin: tenta a conta universal (o mesmo
            // email que acessa o painel do Lojista também entra aqui). O
            // campo "Usuário" aceita o e-mail universal.
            const universalResult = await authenticateUniversalUser(username, password);
            if (universalResult.success && universalResult.user) {
                if (universalResult.mustChangePass) {
                    setNeedsChange(true);
                    setUserId(universalResult.user.id);
                    setIsUniversalChange(true);
                } else {
                    onLogin();
                }
            } else {
                setError('Usuário ou senha incorretos.');
            }
        } catch (e) {
            setError('Erro de conexão. Verifique o banco de dados.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleChangePassword = async () => {
        if (newPass.length < 6) return setError('A senha deve ter no mínimo 6 caracteres.');
        if (newPass !== confirmPass) return setError('As senhas não coincidem.');

        setIsLoading(true);
        try {
            if (isUniversalChange) {
                await updateUniversalUserPassword(userId, newPass);
            } else {
                await updateAdminPassword(userId, newPass);
            }
            toast.success('Senha alterada com sucesso! Faça login novamente.');
            setNeedsChange(false);
            setPassword('');
        } catch (e) {
            setError('Erro ao atualizar senha.');
        } finally {
            setIsLoading(false);
        }
    };

    if (needsChange) {
        return (
            <AuthBackdrop>
                <Card className="u-grow-in w-full max-w-md p-8" style={{ boxShadow: '0 30px 60px -18px rgba(30,27,75,0.5)' }}>
                    <div className="text-center mb-6">
                        <div className="bg-[var(--warn)]/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-[var(--warn)]">
                            <Lock size={32} />
                        </div>
                        <h2 className="text-2xl font-bold text-[var(--text)]">Redefinição Obrigatória</h2>
                        <p className="text-[var(--text-muted)] text-sm mt-1">Por segurança, altere sua senha provisória.</p>
                    </div>

                    <div className="space-y-4">
                        <Input label="Nova Senha" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
                        <Input label="Confirmar Nova Senha" type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} />

                        {error && <p className="text-[var(--err)] text-sm text-center font-medium">{error}</p>}

                        <Button className="w-full" onClick={handleChangePassword} isLoading={isLoading}>
                            Atualizar Senha
                        </Button>
                    </div>
                </Card>
            </AuthBackdrop>
        );
    }

    return (
        <AuthBackdrop>
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-[1.4rem] flex items-center justify-center mx-auto mb-5 text-white bg-white/12 backdrop-blur-sm border border-white/25" style={{ boxShadow: '0 20px 40px -12px rgba(0,0,0,0.35)', animation: '3s ease-in-out infinite icon-float' }}>
                        <Lock size={26} />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Painel Master</h1>
                    <p className="text-white/75 text-sm mt-1.5">Acesso restrito da Norte Para Negócios</p>
                </div>
                <Card className="u-grow-in p-8" style={{ boxShadow: '0 30px 60px -18px rgba(30,27,75,0.5)' }}>
                    <div className="space-y-4">
                        <div className="relative">
                            <User className="absolute left-3 top-9 text-[var(--text-muted)]" size={18} />
                            <Input label="Usuário ou e-mail" className="pl-10" placeholder="admin ou seu@email.com" value={username} onChange={e => setUsername(e.target.value)} />
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-3 top-9 text-[var(--text-muted)]" size={18} />
                            <Input label="Senha" type="password" className="pl-10" placeholder="••••••" value={password} onChange={e => setPassword(e.target.value)} />
                        </div>

                        {error && (
                            <div className="bg-[var(--err)]/10 text-[var(--err)] p-3 rounded text-sm flex items-center gap-2">
                                <AlertCircle size={16} /> {error}
                            </div>
                        )}

                        <Button className="w-full h-12 text-lg group" onClick={handleLogin} isLoading={isLoading}>
                            Entrar
                            {!isLoading && <ArrowRight size={18} className="u-motion group-hover:translate-x-1" />}
                        </Button>
                    </div>
                </Card>
            </div>
        </AuthBackdrop>
    );
};

// Main Admin Dashboard
export const AdminModule: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [view, setView] = useState<'stores' | 'users'>('stores');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Data State
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<(StoreUser & { store: Store })[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);

  // Guards síncronos contra duplo-submit (setIsLoading só reflete no DOM no
  // próximo render; um duplo clique bem rápido pode passar por essa janela)
  const isSavingStoreRef = useRef(false);
  const isSavingUserRef = useRef(false);

  // Store Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [slug, setSlug] = useState('');
  const [contractType, setContractType] = useState<'balcao' | 'balcao_mesas'>('balcao');
  const [tableCount, setTableCount] = useState<number>(10);
  const [periodMonths, setPeriodMonths] = useState<number>(12);
  const [isActive, setIsActive] = useState(true);
  const [serviceFeeRatePercent, setServiceFeeRatePercent] = useState<number>(10);
  // Emite nota fiscal? — toggle simples que mapeia pro modelo_emissao_automatica
  // já existente em store_fiscal_config (nfce quando ligado, nenhuma quando desligado).
  const [emiteNotaFiscal, setEmiteNotaFiscal] = useState(false);

  // Logo Upload State
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Certificado Digital Fiscal State
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const [certExpiresAt, setCertExpiresAt] = useState('');
  const [certStatus, setCertStatus] = useState<StoreFiscalCertificateStatus | null>(null);
  const [isSavingCert, setIsSavingCert] = useState(false);

  // Configuração do Emissor Fiscal State (store_fiscal_config, migration 024)
  // — campos numéricos ficam como string pra bind de <input> controlado,
  // convertidos com Number(...) só na hora de montar o payload de save.
  // CSC/CSCID nunca voltam do banco (write-only), sempre começam vazios.
  const [fiscalAmbiente, setFiscalAmbiente] = useState<'homologacao' | 'producao'>('homologacao');
  // Achado ao reorganizar a tela (2026-08-16): essa seção detalhada nunca
  // teve seletor de tipo — só o toggle rápido "Emite nota fiscal?" (acima,
  // emiteNotaFiscal) decide nfce/nenhuma na criação. Editando uma loja com
  // modelo 'nfe', essa seção mostrava NF-e E NFC-e juntos sem nenhum jeito
  // de escolher qual configurar — mesma reorganização feita em StoreModule.tsx.
  const [fiscalModeloEmissaoAutomatica, setFiscalModeloEmissaoAutomatica] = useState<'nenhuma' | 'nfce' | 'nfe'>('nenhuma');
  const [fiscalNfeSerie, setFiscalNfeSerie] = useState('');
  const [fiscalNfceSerie, setFiscalNfceSerie] = useState('');
  const [fiscalCteSerie, setFiscalCteSerie] = useState('');
  const [fiscalMdfeSerie, setFiscalMdfeSerie] = useState('');
  const [fiscalNfeUltimoNumero, setFiscalNfeUltimoNumero] = useState('');
  const [fiscalNfceUltimoNumero, setFiscalNfceUltimoNumero] = useState('');
  const [fiscalCteUltimoNumero, setFiscalCteUltimoNumero] = useState('');
  const [fiscalMdfeUltimoNumero, setFiscalMdfeUltimoNumero] = useState('');
  const [fiscalInscricaoMunicipal, setFiscalInscricaoMunicipal] = useState('');
  const [fiscalTelefone, setFiscalTelefone] = useState('');
  const [fiscalCasasDecimais, setFiscalCasasDecimais] = useState('2');
  const [fiscalCnpjAutorizado, setFiscalCnpjAutorizado] = useState('');
  const [fiscalObservacaoNfe, setFiscalObservacaoNfe] = useState('');
  const [fiscalObservacaoPedido, setFiscalObservacaoPedido] = useState('');
  const [fiscalCscHomologacao, setFiscalCscHomologacao] = useState('');
  const [fiscalCscidHomologacao, setFiscalCscidHomologacao] = useState('');
  const [fiscalCscProducao, setFiscalCscProducao] = useState('');
  const [fiscalCscidProducao, setFiscalCscidProducao] = useState('');
  // Identificação da empresa
  const [fiscalRazaoSocial, setFiscalRazaoSocial] = useState('');
  const [fiscalNomeFantasia, setFiscalNomeFantasia] = useState('');
  const [fiscalTipoPessoa, setFiscalTipoPessoa] = useState<'juridica' | 'fisica'>('juridica');
  const [fiscalInscricaoEstadual, setFiscalInscricaoEstadual] = useState('');
  const [fiscalEnderecoLogradouro, setFiscalEnderecoLogradouro] = useState('');
  const [fiscalEnderecoNumero, setFiscalEnderecoNumero] = useState('');
  const [fiscalEnderecoComplemento, setFiscalEnderecoComplemento] = useState('');
  const [fiscalEnderecoBairro, setFiscalEnderecoBairro] = useState('');
  const [fiscalEnderecoCidade, setFiscalEnderecoCidade] = useState('');
  const [fiscalEnderecoUf, setFiscalEnderecoUf] = useState('');
  const [fiscalEnderecoCep, setFiscalEnderecoCep] = useState('');
  // Padrões de impostos
  const [fiscalCstCsosnPadrao, setFiscalCstCsosnPadrao] = useState('');
  const [fiscalCstPisPadrao, setFiscalCstPisPadrao] = useState('');
  const [fiscalCstCofinsPadrao, setFiscalCstCofinsPadrao] = useState('');
  const [fiscalCstIpiPadrao, setFiscalCstIpiPadrao] = useState('');
  const [fiscalFretePadrao, setFiscalFretePadrao] = useState('');
  const [fiscalTipoPagamentoPadrao, setFiscalTipoPagamentoPadrao] = useState('');
  const [fiscalNaturezaOperacaoPadrao, setFiscalNaturezaOperacaoPadrao] = useState('');
  const [isSavingFiscalConfig, setIsSavingFiscalConfig] = useState(false);

  // Integração ntb-vendas -> ntb-estoque (Ordem de Produção automática, ver
  // a mesma seção em StoreModule.tsx/MenuManagementView — duplicado de
  // propósito aqui pro Master Admin poder configurar sem precisar entrar no
  // painel do lojista, mesmo princípio já usado pra Config. Fiscal acima).
  const [ntbEstoqueStatus, setNtbEstoqueStatus] = useState<NtbEstoqueIntegracaoStatus>({ configurado: false, ativo: false });
  const [ntbEstoqueUrlInput, setNtbEstoqueUrlInput] = useState('');
  const [ntbEstoqueApiKeyInput, setNtbEstoqueApiKeyInput] = useState('');
  const [isSavingNtbEstoque, setIsSavingNtbEstoque] = useState(false);

  // Criar no NTB Estoque também, já na criação da loja — checkbox só
  // aparece em "Nova Loja" (não em "Editar Loja", que já tem a seção
  // completa de integração acima). Pedido explícito do usuário
  // (2026-08-16): um clique só, sem mexer em chave nenhuma.
  const [criarNoEstoqueTambem, setCriarNoEstoqueTambem] = useState(false);

  // User Form State
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userStoreId, setUserStoreId] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadStores = async () => {
      setIsLoadingList(true);
      const data = await fetchAllStores();
      setStores(data);
      setIsLoadingList(false);
  };

  const loadUsers = async () => {
      setIsLoadingList(true);
      const data = await fetchStoreUsers();
      setUsers(data);
      setIsLoadingList(false);
  };

  useEffect(() => {
      if (isAuthenticated) {
          if (view === 'stores') loadStores();
          if (view === 'users') loadUsers();
      }
  }, [isAuthenticated, view]);

  if (!isAuthenticated) {
      return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
  }

  const resetForm = () => {
      setEditingId(null);
      setName('');
      setCnpj('');
      setSlug('');
      setContractType('balcao');
      setTableCount(10);
      setPeriodMonths(12);
      setIsActive(true);
      setServiceFeeRatePercent(10);
      setEmiteNotaFiscal(false);
      setLogoFile(null);
      setLogoPreview(null);
      setErrorMsg(null);

      setCertFile(null);
      setCertPassword('');
      setCertExpiresAt('');
      setCertStatus(null);

      resetFiscalConfigForm();

      setNtbEstoqueStatus({ configurado: false, ativo: false });
      setNtbEstoqueUrlInput('');
      setNtbEstoqueApiKeyInput('');
      setCriarNoEstoqueTambem(false);
  };

  const resetFiscalConfigForm = () => {
      setFiscalAmbiente('homologacao');
      setFiscalModeloEmissaoAutomatica('nenhuma');
      setFiscalNfeSerie('');
      setFiscalNfceSerie('');
      setFiscalCteSerie('');
      setFiscalMdfeSerie('');
      setFiscalNfeUltimoNumero('');
      setFiscalNfceUltimoNumero('');
      setFiscalCteUltimoNumero('');
      setFiscalMdfeUltimoNumero('');
      setFiscalInscricaoMunicipal('');
      setFiscalTelefone('');
      setFiscalCasasDecimais('2');
      setFiscalCnpjAutorizado('');
      setFiscalObservacaoNfe('');
      setFiscalObservacaoPedido('');
      // CSC/CSCID nunca vêm do banco (write-only) — sempre resetam vazios.
      setFiscalCscHomologacao('');
      setFiscalCscidHomologacao('');
      setFiscalCscProducao('');
      setFiscalCscidProducao('');
      setFiscalRazaoSocial('');
      setFiscalNomeFantasia('');
      setFiscalTipoPessoa('juridica');
      setFiscalInscricaoEstadual('');
      setFiscalEnderecoLogradouro('');
      setFiscalEnderecoNumero('');
      setFiscalEnderecoComplemento('');
      setFiscalEnderecoBairro('');
      setFiscalEnderecoCidade('');
      setFiscalEnderecoUf('');
      setFiscalEnderecoCep('');
      setFiscalCstCsosnPadrao('');
      setFiscalCstPisPadrao('');
      setFiscalCstCofinsPadrao('');
      setFiscalCstIpiPadrao('');
      setFiscalFretePadrao('');
      setFiscalTipoPagamentoPadrao('');
      setFiscalNaturezaOperacaoPadrao('');
  };

  const resetUserForm = () => {
      setEditingUserId(null);
      setUserName('');
      setUserEmail('');
      setUserPassword('');
      setUserStoreId('');
      setErrorMsg(null);
  };

  // --- STORE ACTIONS ---

  const handleEditStore = async (store: Store) => {
      setEditingId(store.id);
      setName(store.name);
      setCnpj(store.cnpj || '');
      setSlug(store.slug);
      setContractType(store.contract_type);

      // Fetch current tables to set correct count
      const tables = await fetchTables(store.id);
      setTableCount(tables.length || 0);

      setPeriodMonths(store.contract_period_months || 12);
      setIsActive(store.is_active);
      setServiceFeeRatePercent(store.config?.service_fee_rate != null ? store.config.service_fee_rate * 100 : 10);
      setLogoPreview(store.logo_url);
      setLogoFile(null);
      setErrorMsg(null);

      setCertFile(null);
      setCertPassword('');
      setCertExpiresAt('');
      setCertStatus(await fetchStoreCertificateStatus(store.id));

      setNtbEstoqueUrlInput('');
      setNtbEstoqueApiKeyInput('');
      setNtbEstoqueStatus(await fetchNtbEstoqueIntegracaoStatus(store.id));

      const fiscalConfig = await fetchStoreFiscalConfig(store.id);
      setEmiteNotaFiscal(!!fiscalConfig && fiscalConfig.modelo_emissao_automatica !== 'nenhuma');
      if (fiscalConfig) {
          setFiscalAmbiente(fiscalConfig.ambiente);
          setFiscalModeloEmissaoAutomatica(fiscalConfig.modelo_emissao_automatica || 'nenhuma');
          setFiscalNfeSerie(fiscalConfig.nfe_serie != null ? String(fiscalConfig.nfe_serie) : '');
          setFiscalNfceSerie(fiscalConfig.nfce_serie != null ? String(fiscalConfig.nfce_serie) : '');
          setFiscalCteSerie(fiscalConfig.cte_serie != null ? String(fiscalConfig.cte_serie) : '');
          setFiscalMdfeSerie(fiscalConfig.mdfe_serie != null ? String(fiscalConfig.mdfe_serie) : '');
          setFiscalNfeUltimoNumero(String(fiscalConfig.nfe_ultimo_numero ?? 0));
          setFiscalNfceUltimoNumero(String(fiscalConfig.nfce_ultimo_numero ?? 0));
          setFiscalCteUltimoNumero(String(fiscalConfig.cte_ultimo_numero ?? 0));
          setFiscalMdfeUltimoNumero(String(fiscalConfig.mdfe_ultimo_numero ?? 0));
          setFiscalInscricaoMunicipal(fiscalConfig.inscricao_municipal || '');
          setFiscalTelefone(fiscalConfig.telefone || '');
          setFiscalCasasDecimais(String(fiscalConfig.casas_decimais ?? 2));
          setFiscalCnpjAutorizado(fiscalConfig.cnpj_autorizado || '');
          setFiscalObservacaoNfe(fiscalConfig.observacao_nfe || '');
          setFiscalObservacaoPedido(fiscalConfig.observacao_pedido || '');
          // CSC/CSCID nunca vêm do banco (write-only) — sempre resetam vazios.
          setFiscalCscHomologacao('');
          setFiscalCscidHomologacao('');
          setFiscalCscProducao('');
          setFiscalCscidProducao('');
          setFiscalRazaoSocial(fiscalConfig.razao_social || '');
          setFiscalNomeFantasia(fiscalConfig.nome_fantasia || '');
          setFiscalTipoPessoa(fiscalConfig.tipo_pessoa || 'juridica');
          setFiscalInscricaoEstadual(fiscalConfig.inscricao_estadual || '');
          setFiscalEnderecoLogradouro(fiscalConfig.endereco_logradouro || '');
          setFiscalEnderecoNumero(fiscalConfig.endereco_numero || '');
          setFiscalEnderecoComplemento(fiscalConfig.endereco_complemento || '');
          setFiscalEnderecoBairro(fiscalConfig.endereco_bairro || '');
          setFiscalEnderecoCidade(fiscalConfig.endereco_cidade || '');
          setFiscalEnderecoUf(fiscalConfig.endereco_uf || '');
          setFiscalEnderecoCep(fiscalConfig.endereco_cep || '');
          setFiscalCstCsosnPadrao(fiscalConfig.cst_csosn_padrao || '');
          setFiscalCstPisPadrao(fiscalConfig.cst_pis_padrao || '');
          setFiscalCstCofinsPadrao(fiscalConfig.cst_cofins_padrao || '');
          setFiscalCstIpiPadrao(fiscalConfig.cst_ipi_padrao || '');
          setFiscalFretePadrao(fiscalConfig.frete_padrao || '');
          setFiscalTipoPagamentoPadrao(fiscalConfig.tipo_pagamento_padrao || '');
          setFiscalNaturezaOperacaoPadrao(fiscalConfig.natureza_operacao_padrao || '');
      } else {
          // Loja nunca configurou nada — volta pros defaults (ambiente
          // homologação, números vazios/zero), mesma lógica de resetFiscalConfigForm.
          resetFiscalConfigForm();
      }

      setIsModalOpen(true);
  };

  const handleDeleteStore = async (id: string, storeName: string) => {
      if(await confirm({ message: `Tem certeza que deseja excluir a loja "${storeName}"? Ela será desativada e some da listagem, mas os dados (pedidos, mesas, cardápio) continuam guardados.`, variant: 'danger', confirmLabel: 'Excluir' })) {
          setIsLoadingList(true);
          const result = await deleteStore(id);
          if (result.success) {
              await loadStores();
          } else {
              toast.error('Erro ao excluir: ' + result.message);
          }
          setIsLoadingList(false);
      }
  };

  const handleDuplicateStore = async (id: string, storeName: string) => {
      if(await confirm(`Deseja duplicar a loja "${storeName}"? Isso criará uma nova loja com o mesmo cardápio e configurações.`)) {
          setIsLoadingList(true);
          const result = await duplicateStore(id);
          if (result.success) {
              await loadStores();
              toast.success('Loja duplicada com sucesso!');
          } else {
              toast.error('Erro ao duplicar: ' + result.message);
          }
          setIsLoadingList(false);
      }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          setLogoFile(file);
          setLogoPreview(URL.createObjectURL(file));
      }
  };

  const handleCertFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) setCertFile(file);
  };

  const handleSaveCertificate = async () => {
      if (!editingId) return; // só disponível editando loja existente
      if (!certFile && !certPassword && !certExpiresAt) {
          return toast.error('Escolha um arquivo, senha ou validade pra salvar.');
      }
      setIsSavingCert(true);
      try {
          if (certFile) {
              const uploadResult = await uploadStoreCertificate(editingId, certFile);
              if (!uploadResult.success) throw new Error(uploadResult.message);

              const metaResult = await saveStoreCertificateMetadata(editingId, certFile.name, certExpiresAt || null);
              if (!metaResult.success) throw new Error(metaResult.message);
          } else if (certExpiresAt) {
              // Só atualizando a validade, sem trocar o arquivo
              const metaResult = await saveStoreCertificateMetadata(editingId, certStatus?.original_filename || 'certificado.pfx', certExpiresAt);
              if (!metaResult.success) throw new Error(metaResult.message);
          }

          if (certPassword) {
              const secretResult = await saveStoreCertificateSecret(editingId, certPassword);
              if (!secretResult.success) throw new Error(secretResult.message);
          }

          toast.success('Certificado atualizado com sucesso!');
          setCertFile(null);
          setCertPassword('');
          setCertStatus(await fetchStoreCertificateStatus(editingId));
      } catch (e: any) {
          toast.error('Erro ao salvar certificado: ' + e.message);
      } finally {
          setIsSavingCert(false);
      }
  };

  const handleSaveFiscalConfig = async () => {
      if (!editingId) return; // só disponível editando loja existente
      setIsSavingFiscalConfig(true);
      try {
          // Só entram no payload os campos preenchidos — string vazia vira
          // undefined, não é enviada (mesmo princípio "não mexer no que não
          // foi preenchido" já usado em handleSaveCertificate/saveStoreCertificateSecret).
          const params: UpdateStoreFiscalConfigParams = { ambiente: fiscalAmbiente, modeloEmissaoAutomatica: fiscalModeloEmissaoAutomatica };
          if (fiscalNfeSerie) params.nfeSerie = Number(fiscalNfeSerie);
          if (fiscalNfceSerie) params.nfceSerie = Number(fiscalNfceSerie);
          if (fiscalCteSerie) params.cteSerie = Number(fiscalCteSerie);
          if (fiscalMdfeSerie) params.mdfeSerie = Number(fiscalMdfeSerie);
          if (fiscalNfeUltimoNumero) params.nfeUltimoNumero = Number(fiscalNfeUltimoNumero);
          if (fiscalNfceUltimoNumero) params.nfceUltimoNumero = Number(fiscalNfceUltimoNumero);
          if (fiscalCteUltimoNumero) params.cteUltimoNumero = Number(fiscalCteUltimoNumero);
          if (fiscalMdfeUltimoNumero) params.mdfeUltimoNumero = Number(fiscalMdfeUltimoNumero);
          if (fiscalInscricaoMunicipal) params.inscricaoMunicipal = fiscalInscricaoMunicipal;
          if (fiscalTelefone) params.telefone = fiscalTelefone;
          if (fiscalCasasDecimais) params.casasDecimais = Number(fiscalCasasDecimais);
          if (fiscalCnpjAutorizado) params.cnpjAutorizado = fiscalCnpjAutorizado;
          if (fiscalObservacaoNfe) params.observacaoNfe = fiscalObservacaoNfe;
          if (fiscalObservacaoPedido) params.observacaoPedido = fiscalObservacaoPedido;
          if (fiscalCscHomologacao) params.cscHomologacao = fiscalCscHomologacao;
          if (fiscalCscidHomologacao) params.cscidHomologacao = fiscalCscidHomologacao;
          if (fiscalCscProducao) params.cscProducao = fiscalCscProducao;
          if (fiscalCscidProducao) params.cscidProducao = fiscalCscidProducao;
          if (fiscalRazaoSocial) params.razaoSocial = fiscalRazaoSocial;
          if (fiscalNomeFantasia) params.nomeFantasia = fiscalNomeFantasia;
          if (fiscalTipoPessoa) params.tipoPessoa = fiscalTipoPessoa;
          if (fiscalInscricaoEstadual) params.inscricaoEstadual = fiscalInscricaoEstadual;
          if (fiscalEnderecoLogradouro) params.enderecoLogradouro = fiscalEnderecoLogradouro;
          if (fiscalEnderecoNumero) params.enderecoNumero = fiscalEnderecoNumero;
          if (fiscalEnderecoComplemento) params.enderecoComplemento = fiscalEnderecoComplemento;
          if (fiscalEnderecoBairro) params.enderecoBairro = fiscalEnderecoBairro;
          if (fiscalEnderecoCidade) params.enderecoCidade = fiscalEnderecoCidade;
          if (fiscalEnderecoUf) params.enderecoUf = fiscalEnderecoUf;
          if (fiscalEnderecoCep) params.enderecoCep = fiscalEnderecoCep;
          if (fiscalCstCsosnPadrao) params.cstCsosnPadrao = fiscalCstCsosnPadrao;
          if (fiscalCstPisPadrao) params.cstPisPadrao = fiscalCstPisPadrao;
          if (fiscalCstCofinsPadrao) params.cstCofinsPadrao = fiscalCstCofinsPadrao;
          if (fiscalCstIpiPadrao) params.cstIpiPadrao = fiscalCstIpiPadrao;
          if (fiscalFretePadrao) params.fretePadrao = fiscalFretePadrao;
          if (fiscalTipoPagamentoPadrao) params.tipoPagamentoPadrao = fiscalTipoPagamentoPadrao;
          if (fiscalNaturezaOperacaoPadrao) params.naturezaOperacaoPadrao = fiscalNaturezaOperacaoPadrao;

          const result = await updateStoreFiscalConfig(editingId, params);
          if (!result.success) throw new Error(result.message);

          toast.success('Configuração fiscal salva com sucesso!');
          // Limpa só os campos de CSC (senão o usuário vê a "senha" na tela
          // depois de salvar — mesmo tratamento que certPassword recebe em
          // handleSaveCertificate).
          setFiscalCscHomologacao('');
          setFiscalCscidHomologacao('');
          setFiscalCscProducao('');
          setFiscalCscidProducao('');
      } catch (e: any) {
          toast.error('Erro ao salvar configuração fiscal: ' + e.message);
      } finally {
          setIsSavingFiscalConfig(false);
      }
  };

  const handleSaveNtbEstoqueIntegracaoAdmin = async () => {
      if (!editingId) return; // só disponível editando loja existente
      if (!ntbEstoqueUrlInput && !ntbEstoqueApiKeyInput) {
          return toast.error('Preencha a URL e a chave de API do NTB Estoque.');
      }
      setIsSavingNtbEstoque(true);
      try {
          const result = await saveNtbEstoqueIntegracaoConfig(editingId, { url: ntbEstoqueUrlInput, apiKey: ntbEstoqueApiKeyInput, ativo: true });
          if (!result.success) throw new Error(result.message);
          toast.success('Integração com o NTB Estoque configurada!');
          setNtbEstoqueUrlInput('');
          setNtbEstoqueApiKeyInput('');
          setNtbEstoqueStatus(await fetchNtbEstoqueIntegracaoStatus(editingId));
      } catch (e: any) {
          toast.error('Erro ao configurar integração: ' + e.message);
      } finally {
          setIsSavingNtbEstoque(false);
      }
  };

  const handleToggleNtbEstoqueAtivoAdmin = async (ativo: boolean) => {
      if (!editingId) return;
      const result = await saveNtbEstoqueIntegracaoConfig(editingId, { ativo });
      if (!result.success) return toast.error('Erro ao atualizar: ' + result.message);
      setNtbEstoqueStatus((prev) => ({ ...prev, ativo }));
      toast.success(ativo ? 'Ordem de Produção automática ativada.' : 'Ordem de Produção automática desativada.');
  };

  const certBadge = () => {
      if (!certStatus) return <Badge color="bg-[var(--surface-2)] text-[var(--text-muted)]">Nenhum certificado cadastrado</Badge>;
      if (!certStatus.expires_at) return <Badge color="bg-[var(--info)]/10 text-[var(--info)]">Cadastrado (sem validade informada)</Badge>;
      const days = differenceInDays(parseISO(certStatus.expires_at), new Date());
      const label = `Válido até ${format(parseISO(certStatus.expires_at), 'dd/MM/yyyy')}`;
      if (days < 0) return <Badge color="bg-[var(--err)]/10 text-[var(--err)]"><AlertCircle size={12} className="mr-1"/> Vencido ({label})</Badge>;
      if (days <= 30) return <Badge color="bg-[var(--warn)]/10 text-[var(--warn)]"><AlertCircle size={12} className="mr-1"/> Vence em breve ({label})</Badge>;
      return <Badge color="bg-[var(--ok)]/10 text-[var(--ok)]"><CheckCircle size={12} className="mr-1"/> {label}</Badge>;
  };

  const handleSaveStore = async () => {
      setErrorMsg(null);
      const trimmedName = name.trim();
      const trimmedSlug = slug.trim();
      if(!trimmedName) return setErrorMsg('O nome da loja é obrigatório.');
      if(!trimmedSlug) return setErrorMsg('O slug (URL) é obrigatório.');
      if(contractType === 'balcao_mesas' && tableCount < 1) return setErrorMsg('Defina pelo menos 1 mesa.');
      if (isSavingStoreRef.current) return;
      isSavingStoreRef.current = true;

      setIsLoading(true);

      let finalLogoUrl = logoPreview;

      try {
          // Upload Logo if new file selected
          if (logoFile) {
              finalLogoUrl = await uploadStoreLogo(logoFile);
          }

          const params = {
              name: trimmedName,
              cnpj,
              slug: trimmedSlug,
              contractType,
              tableCount,
              periodMonths,
              isActive,
              logoUrl: finalLogoUrl,
              serviceFeeRate: serviceFeeRatePercent / 100,
          };

          let result;
          let storeId = editingId;
          if (editingId) {
              result = await updateStore(editingId, params);
          } else {
              result = await createStore(params);
              storeId = result.success ? (result.storeId || null) : null;
          }

          if(result.success) {
              if (storeId) {
                  const fiscalResult = await updateStoreFiscalConfig(storeId, { modeloEmissaoAutomatica: emiteNotaFiscal ? 'nfce' : 'nenhuma' });
                  if (!fiscalResult.success) {
                      toast.error('Loja salva, mas houve um erro ao salvar a opção de nota fiscal: ' + fiscalResult.message);
                  }
              }
              if (!editingId && storeId && criarNoEstoqueTambem) {
                  const estoqueResult = await criarLojaNoEstoque(storeId, trimmedName, cnpj);
                  if (!estoqueResult.success) {
                      toast.error('Loja criada aqui, mas falhou criar no NTB Estoque: ' + estoqueResult.message);
                  } else {
                      toast.success('Loja criada no NTB Estoque também!');
                  }
              }
              toast.success(editingId ? 'Loja atualizada com sucesso!' : 'Loja criada com sucesso!');
              setIsModalOpen(false);
              resetForm();
              loadStores();
          } else {
              setErrorMsg(result.message || 'Erro ao salvar loja.');
          }
      } catch (e: any) {
          setErrorMsg('Erro no upload ou salvamento: ' + e.message);
      } finally {
          setIsLoading(false);
          isSavingStoreRef.current = false;
      }
  };

  // --- USER ACTIONS ---

  const handleEditUser = (user: StoreUser & { store: Store }) => {
      setEditingUserId(user.id);
      setUserName(user.name);
      setUserEmail(user.email);
      setUserStoreId(user.store_id);
      setUserPassword(''); // Password not edited here
      setErrorMsg(null);
      loadStores(); // Ensure we have stores list
      setIsUserModalOpen(true);
  };

  const handleDeleteUser = async (user: StoreUser) => {
      if(await confirm({ message: `Excluir o acesso de ${user.name}?`, variant: 'danger', confirmLabel: 'Excluir' })) {
          setIsLoadingList(true);
          const result = await deleteStoreUser(user.id);
          if(result.success) {
              loadUsers();
          } else {
              toast.error('Erro ao excluir usuário: ' + result.message);
          }
          setIsLoadingList(false);
      }
  };

  const handleResetUserPassword = async (user: StoreUser) => {
      const newPass = window.prompt(`Digite a nova senha provisória para ${user.name}:`);
      if (newPass) {
          if (newPass.length < 4) return toast.error("A senha deve ter pelo menos 4 caracteres.");

          setIsLoadingList(true);
          const result = await updateStoreUser(user.id, {
              password: newPass,
              must_change_password: true
          });

          if (result.success) {
              toast.success(`Senha redefinida com sucesso! O usuário deverá trocá-la no próximo login.`);
              loadUsers();
          } else {
              toast.error("Erro ao redefinir senha.");
          }
          setIsLoadingList(false);
      }
  };

  const handleSaveUser = async () => {
      setErrorMsg(null);
      const trimmedUserName = userName.trim();
      const trimmedUserEmail = userEmail.trim();
      if (!trimmedUserName || !trimmedUserEmail || !userStoreId) {
          return setErrorMsg('Preencha os campos obrigatórios.');
      }

      // If creating, password is mandatory
      if (!editingUserId && !userPassword) {
          return setErrorMsg('Defina uma senha provisória.');
      }

      if (isSavingUserRef.current) return;
      isSavingUserRef.current = true;
      setIsLoading(true);

      try {
          let result;
          if (editingUserId) {
              result = await updateStoreUser(editingUserId, {
                  name: trimmedUserName,
                  email: trimmedUserEmail,
                  store_id: userStoreId
              });
          } else {
              result = await createStoreUser(userStoreId, trimmedUserName, trimmedUserEmail, userPassword);
          }

          if(result.success) {
              toast.success(editingUserId ? 'Usuário atualizado!' : 'Usuário criado com sucesso!');
              setIsUserModalOpen(false);
              resetUserForm();
              loadUsers();
          } else {
              setErrorMsg(result.message || 'Erro ao salvar usuário.');
          }
      } finally {
          setIsLoading(false);
          isSavingUserRef.current = false;
      }
  };

  const generateSlug = (text: string) => {
      return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      setName(newName);
      // Only auto-generate slug on create mode and if slug is empty or matches previous generation
      if (!editingId && (!slug || slug === generateSlug(name))) setSlug(generateSlug(newName));
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[var(--ink)] text-white p-6 hidden md:flex md:flex-col">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Master Admin</h1>
          <ThemeToggle variant="sidebar" />
        </div>
        <nav className="space-y-2">
          <button onClick={() => setView('stores')} className={`flex items-center gap-3 w-full p-3 rounded-lg u-motion u-press-sm ${view === 'stores' ? 'bg-[var(--brand)] text-white shadow-lg shadow-[var(--brand)]/30' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}>
            <StoreIcon size={20} /> Lojas
          </button>
          <button onClick={() => setView('users')} className={`flex items-center gap-3 w-full p-3 rounded-lg u-motion u-press-sm ${view === 'users' ? 'bg-[var(--brand)] text-white shadow-lg shadow-[var(--brand)]/30' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}>
            <Users size={20} /> Usuários (Lojistas)
          </button>
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold text-[var(--text)]">
                {view === 'stores' ? 'Gestão de Lojas' : 'Gestão de Lojistas'}
            </h2>
            <p className="text-[var(--text-muted)] mt-1">Gerencie os {view === 'stores' ? 'estabelecimentos' : 'acessos dos clientes'} da plataforma.</p>
          </div>
          <Button onClick={() => {
              if(view === 'stores') { resetForm(); setIsModalOpen(true); }
              else { resetUserForm(); setIsUserModalOpen(true); loadStores(); } // Load stores to populate dropdown
          }}>
            <Plus size={18} className="mr-2" /> Novo {view === 'stores' ? 'Cadastro' : 'Usuário'}
          </Button>
        </div>

        {/* --- STORES VIEW --- */}
        {view === 'stores' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {/* Add Button Card */}
             <div onClick={() => { resetForm(); setIsModalOpen(true); }} className="border-2 border-dashed border-[var(--border)] rounded-xl flex flex-col items-center justify-center p-8 text-[var(--text-muted)] cursor-pointer hover:border-[var(--brand)] hover:text-[var(--brand)] hover:bg-[var(--brand)]/5 transition-all group min-h-[220px]">
                <div className="bg-[var(--surface-2)] p-4 rounded-full mb-3 group-hover:bg-[var(--surface)] group-hover:shadow-md transition-all">
                    <Plus size={32} />
                </div>
                <p className="font-semibold">Adicionar Nova Loja</p>
             </div>

             {/* Stores List */}
             {isLoadingList && stores.length === 0 && Array.from({ length: 3 }).map((_, i) => (
                 <Card key={i} className="u-stagger flex flex-col gap-4 p-5 pl-6" style={stagger(i * 30)}>
                     <div className="flex items-start justify-between">
                         <div className="flex gap-3">
                             <Skeleton className="w-12 h-12 rounded-lg" />
                             <div className="space-y-2">
                                 <Skeleton className="h-4 w-32" />
                                 <Skeleton className="h-3 w-24" />
                             </div>
                         </div>
                     </div>
                     <div className="grid grid-cols-2 gap-2">
                         <Skeleton className="h-12 w-full" />
                         <Skeleton className="h-12 w-full" />
                     </div>
                 </Card>
             ))}

             {stores.map((store, storeIdx) => (
                 <Card key={store.id} accentColor="var(--brand)" className="u-stagger flex flex-col gap-4 p-5 pl-6 group" style={stagger(Math.min(storeIdx, 10) * 30)}>
                    <div className="flex items-start justify-between">
                        <div className="flex gap-3">
                            {store.logo_url && <img src={store.logo_url} alt="Logo" className="w-12 h-12 rounded-lg object-cover border border-[var(--border)]" />}
                            <div>
                                <h3 className="font-bold text-lg text-[var(--text)]">{store.name}</h3>
                                <p className="text-sm text-[var(--text-muted)]">{store.cnpj || 'CNPJ não informado'}</p>
                            </div>
                        </div>
                        <Badge color={store.is_active ? "bg-[var(--ok)]/10 text-[var(--ok)]" : "bg-[var(--err)]/10 text-[var(--err)]"}>
                            {store.is_active ? 'ATIVO' : 'INATIVO'}
                        </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                        <div className="bg-[var(--surface-2)] p-2 rounded border border-[var(--border)]">
                            <span className="block text-xs text-[var(--text-muted)] uppercase font-bold">Contrato</span>
                            <div className="flex items-center gap-1 text-[var(--text)] font-medium">
                                <LayoutGrid size={14} className="text-[var(--brand)]"/> {store.contract_type === 'balcao_mesas' ? 'Balcão + Mesas' : 'Apenas Balcão'}
                            </div>
                        </div>
                        <div className="bg-[var(--surface-2)] p-2 rounded border border-[var(--border)]">
                            <span className="block text-xs text-[var(--text-muted)] uppercase font-bold">Slug</span>
                            <div className="flex items-center gap-1 text-[var(--text)] font-medium">
                                <span className="truncate">/{store.slug}</span>
                            </div>
                        </div>
                    </div>
                    <div className="mt-auto pt-4 flex gap-2 border-t border-[var(--border)]">
                        <a href={`/c/${store.slug}`} target="_blank" rel="noreferrer" className="flex-1 text-center py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--brand)]/5 rounded-lg border border-[var(--brand)]/20 transition-colors">
                            Ver Cardápio
                        </a>
                        <button
                            onClick={() => handleDuplicateStore(store.id, store.name)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--info)] u-motion u-press"
                            title="Duplicar"
                        >
                            <Copy size={18} />
                        </button>
                        <button
                            onClick={() => handleEditStore(store)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--text)] u-motion u-press"
                            title="Editar"
                        >
                            <Edit2 size={18} />
                        </button>
                        <button
                            onClick={() => handleDeleteStore(store.id, store.name)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--err)] u-motion u-press"
                            title="Excluir"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                 </Card>
             ))}

             {stores.length === 0 && !isLoadingList && (
                 <div className="col-span-full text-center py-10 text-[var(--text-muted)]">Nenhuma loja encontrada. Crie a primeira!</div>
             )}
          </div>
        )}

        {/* --- USERS VIEW --- */}
        {view === 'users' && (
            <div className="space-y-4">
                {users.length === 0 && !isLoadingList ? (
                     <Card className="flex flex-col items-center justify-center py-20 px-6 text-[var(--text-muted)]">
                        <Users size={48} className="mb-4 opacity-20" />
                        <p>Nenhum usuário cadastrado. Adicione um gestor para uma loja.</p>
                     </Card>
                ) : (
                    <div className="bg-[var(--surface)] rounded-xl shadow-sm border border-[var(--border)] overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] text-xs uppercase font-bold">
                                <tr>
                                    <th className="p-4">Nome do Responsável</th>
                                    <th className="p-4">Email de Acesso</th>
                                    <th className="p-4">Loja Vinculada</th>
                                    <th className="p-4">Função</th>
                                    <th className="p-4 text-center">Status Senha</th>
                                    <th className="p-4 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {isLoadingList && users.length === 0 && Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="u-stagger" style={stagger(i * 30)}>
                                        <td className="p-4"><Skeleton className="h-4 w-28" /></td>
                                        <td className="p-4"><Skeleton className="h-4 w-40" /></td>
                                        <td className="p-4"><Skeleton className="h-5 w-24 rounded-full" /></td>
                                        <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                                        <td className="p-4 flex justify-center"><Skeleton className="h-5 w-20 rounded-full" /></td>
                                        <td className="p-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                                    </tr>
                                ))}
                                {users.map((user, userIdx) => (
                                    <tr key={user.id} className="u-stagger hover:bg-[var(--surface-2)]" style={stagger(Math.min(userIdx, 10) * 30)}>
                                        <td className="p-4 font-medium text-[var(--text)]">{user.name}</td>
                                        <td className="p-4 text-[var(--text-muted)]">{user.email}</td>
                                        <td className="p-4">
                                            <Badge color="bg-[var(--brand)]/10 text-[var(--brand)]">{user.store?.name || 'Loja Desconhecida'}</Badge>
                                        </td>
                                        <td className="p-4 text-sm capitalize">{getRoleLabel(user.role)}</td>
                                        <td className="p-4 text-center">
                                            {user.must_change_password ?
                                                <Badge color="bg-[var(--warn)]/10 text-[var(--warn)]">Provisória</Badge> :
                                                <Badge color="bg-[var(--ok)]/10 text-[var(--ok)]">Definida</Badge>
                                            }
                                        </td>
                                        <td className="p-4 flex justify-end gap-2">
                                            <button
                                                onClick={() => handleResetUserPassword(user)}
                                                className="p-2 text-[var(--text-muted)] hover:text-[var(--warn)] hover:bg-[var(--warn)]/10 rounded-lg u-motion u-press"
                                                title="Resetar Senha"
                                            >
                                                <RefreshCw size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleEditUser(user)}
                                                className="p-2 text-[var(--text-muted)] hover:text-[var(--brand)] hover:bg-[var(--brand)]/5 rounded-lg u-motion u-press"
                                                title="Editar"
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteUser(user)}
                                                className="p-2 text-[var(--text-muted)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 rounded-lg u-motion u-press"
                                                title="Excluir"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        )}
      </main>

      {/* MODAL: NOVA/EDITAR LOJA */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? "Editar Loja" : "Nova Loja"}>
          <div className="space-y-6">
              {/* Form Content */}
              <div className="flex items-center justify-between bg-[var(--surface-2)] p-4 rounded-xl border border-[var(--border)] shadow-sm">
                  <div>
                      <span className="block font-bold text-[var(--text)]">Status do Contrato</span>
                      <span className="text-xs text-[var(--text-muted)]">Define se a loja está acessível</span>
                  </div>
                  <button onClick={() => setIsActive(!isActive)} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold u-motion u-press-sm shadow-sm ${isActive ? 'bg-[var(--ok)] text-white shadow-[var(--ok)]/20' : 'bg-[var(--err)] text-white shadow-[var(--err)]/20'}`}>
                      {isActive ? <CheckCircle size={16}/> : <XCircle size={16}/>} {isActive ? 'LOJA ATIVA' : 'BLOQUEADA'}
                  </button>
              </div>

              {/* Logo Upload */}
              <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-[var(--text)]">Logotipo da Loja</label>
                  <div className="flex items-center gap-4">
                      <div className={`w-20 h-20 rounded-xl border-2 border-dashed border-[var(--border)] flex items-center justify-center overflow-hidden bg-[var(--surface-2)] ${logoPreview ? 'border-[var(--brand)]' : ''}`}>
                          {logoPreview ? (
                              <img src={logoPreview} alt="Logo Preview" className="w-full h-full object-cover" />
                          ) : (
                              <Image className="text-[var(--border)]" size={24} />
                          )}
                      </div>
                      <div className="flex-1">
                          <label className="cursor-pointer bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--text)] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 w-fit transition-colors shadow-sm">
                              <Upload size={16} /> Escolher Imagem
                              <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                          </label>
                          <p className="text-xs text-[var(--text-muted)] mt-2">Recomendado: 500x500px (PNG ou JPG)</p>
                      </div>
                  </div>
              </div>

              <div className="space-y-4">
                <Input label="Nome do Estabelecimento" placeholder="Ex: Hamburgueria Top" value={name} onChange={handleNameChange} />
                <div className="grid grid-cols-2 gap-4">
                     <Input label="CNPJ" placeholder="00.000.000/0000-00" value={cnpj} onChange={e => setCnpj(e.target.value)} />
                     <Input type="number" label="Meses de Contrato" value={periodMonths} onChange={e => setPeriodMonths(parseInt(e.target.value))} />
                </div>
                <Input type="number" label="Taxa de Serviço (%)" value={serviceFeeRatePercent} onChange={e => setServiceFeeRatePercent(Number(e.target.value) || 0)} min="0" max="100" step="0.1" />
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-[var(--text)]">Link de Acesso (Slug)</label>
                    <div className="flex items-center group">
                        <span className="bg-[var(--surface-2)] border border-r-0 border-[var(--border)] rounded-l-lg px-3 py-2 text-sm text-[var(--text-muted)]">site.com/c/</span>
                        <input className="w-full rounded-r-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-[var(--brand)]/30 outline-none" placeholder="minha-loja" value={slug} onChange={e => setSlug(generateSlug(e.target.value))} />
                    </div>
                </div>
              </div>

              {/* Toggle simples de emissão fiscal — mapeia pro
                  store_fiscal_config.modelo_emissao_automatica já existente
                  (nfce quando ligado, nenhuma quando desligado). Disponível
                  já na criação, não só editando (config detalhada continua
                  só em "Editar Loja", ver seção abaixo). */}
              <div className="flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]">
                  <div>
                      <h4 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><FileText size={14}/> Emite nota fiscal?</h4>
                      <p className="text-xs text-[var(--text-muted)]">Se ligado, a loja emite NFC-e automaticamente ao fechar mesa/balcão.</p>
                  </div>
                  <button
                      type="button"
                      role="switch"
                      aria-checked={emiteNotaFiscal}
                      aria-label="Emite nota fiscal?"
                      onClick={() => setEmiteNotaFiscal(prev => !prev)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors ${emiteNotaFiscal ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                  >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${emiteNotaFiscal ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
              </div>

              {/* Criar no NTB Estoque também — só em "Nova Loja" (loja já
                  existente usa a seção completa de integração em "Editar
                  Loja", mais abaixo). Cria a loja lá, gera a chave, e já
                  salva a integração aqui, tudo automático. */}
              {!editingId && (
                  <div className="flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]">
                      <div>
                          <h4 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><ArrowRight size={14}/> Criar no NTB Estoque também?</h4>
                          <p className="text-xs text-[var(--text-muted)]">Cria a loja correspondente lá e já liga a integração — sem precisar mexer em chave nenhuma.</p>
                      </div>
                      <button
                          type="button"
                          role="switch"
                          aria-checked={criarNoEstoqueTambem}
                          aria-label="Criar no NTB Estoque também?"
                          onClick={() => setCriarNoEstoqueTambem(prev => !prev)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors ${criarNoEstoqueTambem ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                      >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${criarNoEstoqueTambem ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                  </div>
              )}

              <hr className="border-[var(--border)]" />

              {editingId && (
                  <>
                      <div className="space-y-3">
                          <div className="flex items-center justify-between">
                              <label className="text-sm font-semibold text-[var(--text)] flex items-center gap-2"><Lock size={14}/> Certificado Digital (fiscal)</label>
                              {certBadge()}
                          </div>
                          <label className="cursor-pointer bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--text)] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 w-fit transition-colors shadow-sm">
                              <Upload size={16} /> {certFile ? certFile.name : 'Escolher arquivo (.pfx/.p12)'}
                              <input type="file" className="hidden" accept=".pfx,.p12" onChange={handleCertFileChange} />
                          </label>
                          <div className="grid grid-cols-2 gap-4">
                              <Input type="date" label="Validade do certificado" value={certExpiresAt} onChange={e => setCertExpiresAt(e.target.value)} />
                              <Input type="password" label="Senha do certificado" placeholder="Deixe em branco pra manter a atual" value={certPassword} onChange={e => setCertPassword(e.target.value)} />
                          </div>
                          <Button variant="secondary" className="w-full" onClick={handleSaveCertificate} isLoading={isSavingCert}>
                              Salvar Certificado
                          </Button>
                      </div>
                      <hr className="border-[var(--border)]" />

                      {/* Configuração do Emissor Fiscal (store_fiscal_config, migration 024) —
                          só armazenamento/configuração, sem lógica de emissão real ainda
                          (ver AGENTS.md, seção "Configuração do emissor fiscal"). */}
                      <div className="space-y-4">
                          <label className="text-sm font-semibold text-[var(--text)] flex items-center gap-2"><FileText size={14}/> Configuração do Emissor</label>

                          <div className="bg-[var(--warn)]/10 p-4 rounded-xl border border-[var(--warn)]/20 flex gap-3">
                              <AlertCircle className="text-[var(--warn)] flex-shrink-0" size={20} />
                              <p className="text-sm text-[var(--warn)]">
                                  ⚠️ Sempre configure e teste em Homologação primeiro. Nunca emita nota fiscal real durante testes.
                              </p>
                          </div>

                          <div className="space-y-3">
                              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Identificação da empresa</p>
                              <div className="grid grid-cols-2 gap-4">
                                  <Input label="Razão Social" placeholder="Opcional" value={fiscalRazaoSocial} onChange={e => setFiscalRazaoSocial(e.target.value)} />
                                  <Input label="Nome Fantasia" placeholder="Opcional" value={fiscalNomeFantasia} onChange={e => setFiscalNomeFantasia(e.target.value)} />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div className="flex flex-col gap-1.5">
                                      <label className="text-sm font-semibold text-[var(--text)]">Tipo</label>
                                      <select
                                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                                        value={fiscalTipoPessoa}
                                        onChange={e => setFiscalTipoPessoa(e.target.value as 'juridica' | 'fisica')}
                                      >
                                          <option value="juridica">Jurídica</option>
                                          <option value="fisica">Física</option>
                                      </select>
                                  </div>
                                  <Input label="Inscrição Estadual" placeholder="Opcional" value={fiscalInscricaoEstadual} onChange={e => setFiscalInscricaoEstadual(e.target.value)} />
                              </div>

                              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Endereço</p>
                              <div className="grid grid-cols-2 gap-4">
                                  <Input label="Logradouro" placeholder="Opcional" value={fiscalEnderecoLogradouro} onChange={e => setFiscalEnderecoLogradouro(e.target.value)} />
                                  <Input label="Número" placeholder="Opcional" value={fiscalEnderecoNumero} onChange={e => setFiscalEnderecoNumero(e.target.value)} />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <Input label="Complemento" placeholder="Opcional" value={fiscalEnderecoComplemento} onChange={e => setFiscalEnderecoComplemento(e.target.value)} />
                                  <Input label="Bairro" placeholder="Opcional" value={fiscalEnderecoBairro} onChange={e => setFiscalEnderecoBairro(e.target.value)} />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <Input label="Cidade" placeholder="Opcional" value={fiscalEnderecoCidade} onChange={e => setFiscalEnderecoCidade(e.target.value)} />
                                  <Input label="UF" placeholder="Ex: BA" maxLength={2} value={fiscalEnderecoUf} onChange={e => setFiscalEnderecoUf(e.target.value.toUpperCase())} />
                              </div>
                              <Input label="CEP" placeholder="Opcional" value={fiscalEnderecoCep} onChange={e => setFiscalEnderecoCep(e.target.value)} />
                          </div>

                          <div className="space-y-3">
                              <div>
                                  <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Padrões de impostos</p>
                                  <p className="text-xs text-[var(--text-muted)]">Códigos conforme tabela da contabilidade/SEFAZ.</p>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <Input label="CST/CSOSN Padrão" placeholder="Opcional" value={fiscalCstCsosnPadrao} onChange={e => setFiscalCstCsosnPadrao(e.target.value)} />
                                  <Input label="CST/PIS Padrão" placeholder="Opcional" value={fiscalCstPisPadrao} onChange={e => setFiscalCstPisPadrao(e.target.value)} />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <Input label="CST/COFINS Padrão" placeholder="Opcional" value={fiscalCstCofinsPadrao} onChange={e => setFiscalCstCofinsPadrao(e.target.value)} />
                                  <Input label="CST/IPI Padrão" placeholder="Opcional" value={fiscalCstIpiPadrao} onChange={e => setFiscalCstIpiPadrao(e.target.value)} />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <Input label="Frete Padrão" placeholder="Opcional" value={fiscalFretePadrao} onChange={e => setFiscalFretePadrao(e.target.value)} />
                                  <Input label="Tipo de Pagamento Padrão" placeholder="Opcional" value={fiscalTipoPagamentoPadrao} onChange={e => setFiscalTipoPagamentoPadrao(e.target.value)} />
                              </div>
                              <Input label="Natureza de Operação Padrão" placeholder="Opcional" value={fiscalNaturezaOperacaoPadrao} onChange={e => setFiscalNaturezaOperacaoPadrao(e.target.value)} />
                          </div>

                          <div className="flex flex-col gap-1.5">
                              <label className="text-sm font-semibold text-[var(--text)]">Ambiente</label>
                              <select
                                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                                value={fiscalAmbiente}
                                onChange={e => setFiscalAmbiente(e.target.value as 'homologacao' | 'producao')}
                              >
                                  <option value="homologacao">Homologação</option>
                                  <option value="producao">Produção</option>
                              </select>
                          </div>

                          <div className="flex flex-col gap-1.5">
                              <label className="text-sm font-semibold text-[var(--text)]">Modelo de emissão automática</label>
                              <select
                                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                                value={fiscalModeloEmissaoAutomatica}
                                onChange={e => setFiscalModeloEmissaoAutomatica(e.target.value as 'nenhuma' | 'nfce' | 'nfe')}
                              >
                                  <option value="nenhuma">Nenhuma (não emite automaticamente)</option>
                                  <option value="nfce">NFC-e (cupom fiscal)</option>
                                  <option value="nfe">NF-e (com destinatário)</option>
                              </select>
                          </div>

                          {/* Reorganizado (2026-08-16, pedido explícito do usuário): antes
                              NF-e e NFC-e apareciam sempre lado a lado, misturados com CSC
                              (que só existe pra NFC-e) mesmo quando a loja usa só um dos dois
                              — ou nenhum. Agora só aparece o bloco do tipo escolhido acima em
                              "Modelo de emissão automática". */}
                          {fiscalModeloEmissaoAutomatica === 'nfe' && (
                              <div className="space-y-4 p-4 bg-[var(--surface-2)]/50 rounded-xl border border-[var(--border)]">
                                  <p className="text-xs font-semibold text-[var(--brand)] uppercase tracking-wide">NF-e (com destinatário)</p>
                                  <div className="grid grid-cols-2 gap-4">
                                      <Input type="number" label="Série" value={fiscalNfeSerie} onChange={e => setFiscalNfeSerie(e.target.value)} />
                                      <Input type="number" label="Último número emitido" value={fiscalNfeUltimoNumero} onChange={e => setFiscalNfeUltimoNumero(e.target.value)} />
                                  </div>
                                  <p className="text-xs text-[var(--text-muted)] -mt-2">Deixe 0 se nunca emitiu.</p>
                                  <div className="flex flex-col gap-1.5">
                                      <label className="text-sm font-semibold text-[var(--text)]">Observação padrão — NF-e</label>
                                      <textarea
                                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                                        rows={2}
                                        value={fiscalObservacaoNfe}
                                        onChange={e => setFiscalObservacaoNfe(e.target.value)}
                                      />
                                  </div>
                              </div>
                          )}

                          {fiscalModeloEmissaoAutomatica === 'nfce' && (
                              <div className="space-y-4 p-4 bg-[var(--surface-2)]/50 rounded-xl border border-[var(--border)]">
                                  <p className="text-xs font-semibold text-[var(--brand)] uppercase tracking-wide">NFC-e (cupom fiscal)</p>
                                  <div className="grid grid-cols-2 gap-4">
                                      <Input type="number" label="Série" value={fiscalNfceSerie} onChange={e => setFiscalNfceSerie(e.target.value)} />
                                      <Input type="number" label="Último número emitido" value={fiscalNfceUltimoNumero} onChange={e => setFiscalNfceUltimoNumero(e.target.value)} />
                                  </div>
                                  <p className="text-xs text-[var(--text-muted)] -mt-2">Deixe 0 se nunca emitiu.</p>
                                  <p className="text-xs text-[var(--text-muted)]">CSC (Código de Segurança do Contribuinte) — só existe pra NFC-e, cada ambiente tem o seu.</p>
                                  <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-2">
                                          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">CSC — Homologação</p>
                                          <Input type="password" label="CSC" placeholder="Deixe em branco pra manter o atual" value={fiscalCscHomologacao} onChange={e => setFiscalCscHomologacao(e.target.value)} />
                                          <Input type="password" label="CSCID" placeholder="Deixe em branco pra manter o atual" value={fiscalCscidHomologacao} onChange={e => setFiscalCscidHomologacao(e.target.value)} />
                                      </div>
                                      <div className="space-y-2">
                                          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">CSC — Produção</p>
                                          <Input type="password" label="CSC" placeholder="Deixe em branco pra manter o atual" value={fiscalCscProducao} onChange={e => setFiscalCscProducao(e.target.value)} />
                                          <Input type="password" label="CSCID" placeholder="Deixe em branco pra manter o atual" value={fiscalCscidProducao} onChange={e => setFiscalCscidProducao(e.target.value)} />
                                      </div>
                                  </div>
                              </div>
                          )}

                          {fiscalModeloEmissaoAutomatica === 'nenhuma' && (
                              <p className="text-xs text-[var(--text-muted)] italic">Escolha NFC-e ou NF-e acima pra configurar série, numeração e (se for NFC-e) o CSC.</p>
                          )}

                          <details className="border border-[var(--border)] rounded-lg p-3">
                              <summary className="text-sm font-medium text-[var(--text-muted)] cursor-pointer select-none">Outros documentos — CT-e / MDF-e (avançado)</summary>
                              <div className="grid grid-cols-2 gap-4 mt-3">
                                  <div className="space-y-2">
                                      <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">CT-e</p>
                                      <Input type="number" label="Série" value={fiscalCteSerie} onChange={e => setFiscalCteSerie(e.target.value)} />
                                      <Input type="number" label="Último número emitido" value={fiscalCteUltimoNumero} onChange={e => setFiscalCteUltimoNumero(e.target.value)} />
                                      <p className="text-xs text-[var(--text-muted)]">Deixe 0 se nunca emitiu.</p>
                                  </div>
                                  <div className="space-y-2">
                                      <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">MDF-e</p>
                                      <Input type="number" label="Série" value={fiscalMdfeSerie} onChange={e => setFiscalMdfeSerie(e.target.value)} />
                                      <Input type="number" label="Último número emitido" value={fiscalMdfeUltimoNumero} onChange={e => setFiscalMdfeUltimoNumero(e.target.value)} />
                                      <p className="text-xs text-[var(--text-muted)]">Deixe 0 se nunca emitiu.</p>
                                  </div>
                              </div>
                          </details>

                          <div className="pt-4 border-t border-[var(--border)] space-y-4">
                              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Dados gerais</p>
                              <Input label="Inscrição municipal" placeholder="Opcional" value={fiscalInscricaoMunicipal} onChange={e => setFiscalInscricaoMunicipal(e.target.value)} />
                              <Input label="Telefone" placeholder="Ex: (71) 99999-9999" value={fiscalTelefone} onChange={e => setFiscalTelefone(e.target.value)} />
                              <div className="grid grid-cols-2 gap-4">
                                  <Input type="number" label="Casas decimais" value={fiscalCasasDecimais} onChange={e => setFiscalCasasDecimais(e.target.value)} />
                                  <Input label="CNPJ Autorizado" placeholder="Opcional" value={fiscalCnpjAutorizado} onChange={e => setFiscalCnpjAutorizado(e.target.value)} />
                              </div>
                              <div className="flex flex-col gap-1.5">
                                  <label className="text-sm font-semibold text-[var(--text)]">Observação padrão — Pedido/Orçamento</label>
                                  <textarea
                                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                                    rows={2}
                                    value={fiscalObservacaoPedido}
                                    onChange={e => setFiscalObservacaoPedido(e.target.value)}
                                  />
                              </div>
                          </div>

                          <Button variant="secondary" className="w-full" onClick={handleSaveFiscalConfig} isLoading={isSavingFiscalConfig}>
                              Salvar Configuração Fiscal
                          </Button>
                      </div>
                      <hr className="border-[var(--border)]" />

                      {/* Integração com o NTB Estoque (Ordem de Produção automática) —
                          pedido explícito do usuário (2026-08-16): poder escolher/configurar
                          a integração já na tela de criação/edição de loja do Master Admin,
                          sem precisar entrar no painel do lojista. */}
                      <div className="space-y-4">
                          <div>
                              <h4 className="font-bold text-sm text-[var(--text)]">Integração com o NTB Estoque</h4>
                              <p className="text-xs text-[var(--text-muted)]">Cada venda fechada cria automaticamente uma Ordem de Produção no NTB Estoque, consumindo os ingredientes da receita.</p>
                          </div>

                          <div className="flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]">
                              <div>
                                  <h4 className="font-bold text-sm text-[var(--text)]">Ordem de Produção automática</h4>
                                  <p className="text-xs text-[var(--text-muted)]">
                                      {ntbEstoqueStatus.configurado
                                          ? (ntbEstoqueStatus.ativo ? 'Ativa — toda venda dispara uma ordem de produção.' : 'Configurada, mas desativada — nenhuma ordem é disparada.')
                                          : 'Ainda não configurada — preencha a URL e a chave de API abaixo.'}
                                  </p>
                              </div>
                              <button
                                  type="button"
                                  role="switch"
                                  aria-checked={ntbEstoqueStatus.ativo}
                                  aria-label="Ordem de Produção automática"
                                  onClick={() => handleToggleNtbEstoqueAtivoAdmin(!ntbEstoqueStatus.ativo)}
                                  disabled={!ntbEstoqueStatus.configurado}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${ntbEstoqueStatus.ativo ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                              >
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ntbEstoqueStatus.ativo ? 'translate-x-6' : 'translate-x-1'}`} />
                              </button>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                              <Input
                                  label="URL do NTB Estoque"
                                  placeholder="https://app-estoque.norteparanegocios.com.br"
                                  value={ntbEstoqueUrlInput}
                                  onChange={e => setNtbEstoqueUrlInput(e.target.value)}
                              />
                              <Input
                                  label="Chave de API"
                                  type="password"
                                  placeholder={ntbEstoqueStatus.configurado ? '••••••••  (preencher só pra trocar)' : 'Chave de integração da loja no NTB Estoque'}
                                  value={ntbEstoqueApiKeyInput}
                                  onChange={e => setNtbEstoqueApiKeyInput(e.target.value)}
                              />
                          </div>
                          <p className="text-xs text-[var(--text-muted)]">A chave é gerada na tela "Lojas" do NTB Estoque (seção "Integração com NTB Vendas"). Ela nunca é exibida de volta depois de salva aqui — deixe em branco se não quiser trocá-la.</p>

                          <Button variant="secondary" className="w-full" onClick={handleSaveNtbEstoqueIntegracaoAdmin} isLoading={isSavingNtbEstoque}>
                              Salvar Integração com o NTB Estoque
                          </Button>
                      </div>
                      <hr className="border-[var(--border)]" />
                  </>
              )}
              <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                      <button className={`flex flex-col items-center justify-center p-3 gap-2 rounded-xl border-2 u-motion u-press-sm ${contractType === 'balcao' ? 'border-[var(--brand)] bg-[var(--brand)]/5 text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`} onClick={() => setContractType('balcao')}>
                          <Coffee size={24} /> <span className="font-bold text-sm">Apenas Balcão</span>
                      </button>
                      <button className={`flex flex-col items-center justify-center p-3 gap-2 rounded-xl border-2 u-motion u-press-sm ${contractType === 'balcao_mesas' ? 'border-[var(--brand)] bg-[var(--brand)]/5 text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`} onClick={() => setContractType('balcao_mesas')}>
                          <LayoutGrid size={24} /> <span className="font-bold text-sm">Balcão + Mesas</span>
                      </button>
                  </div>
                  {contractType === 'balcao_mesas' && (
                      <div className="bg-[var(--info)]/10 p-4 rounded-xl border border-[var(--info)]/20">
                        <div className="flex justify-between items-center mb-2"><label className="text-sm font-bold text-[var(--info)]">Mesas: {tableCount}</label></div>
                        <input type="range" min="1" max="100" value={tableCount} onChange={e => setTableCount(parseInt(e.target.value))} className="w-full h-2 bg-[var(--info)]/30 rounded-lg appearance-none cursor-pointer accent-[var(--info)]"/>
                        {editingId && <p className="text-xs text-[var(--info)] mt-2">Nota: Reduzir mesas não apaga as existentes automaticamente.</p>}
                      </div>
                  )}
              </div>
              {errorMsg && <div className="bg-[var(--err)]/10 text-[var(--err)] p-3 rounded-lg text-sm flex items-start gap-2"><AlertCircle size={18} /><span>{errorMsg}</span></div>}
              <Button className="w-full h-12 text-lg shadow-lg shadow-primary/20" onClick={handleSaveStore} isLoading={isLoading}>
                  <Save className="mr-2" size={20} /> {editingId ? 'Atualizar Loja' : 'Salvar e Ativar Loja'}
              </Button>
          </div>
      </Modal>

      {/* MODAL: NOVO/EDITAR USUÁRIO */}
      <Modal isOpen={isUserModalOpen} onClose={() => setIsUserModalOpen(false)} title={editingUserId ? "Editar Acesso" : "Novo Acesso Lojista"}>
          <div className="space-y-6">
              <div className="bg-[var(--warn)]/10 p-4 rounded-xl border border-[var(--warn)]/20 flex gap-3">
                  <Lock className="text-[var(--warn)] flex-shrink-0" size={20} />
                  <p className="text-sm text-[var(--warn)]">
                      {editingUserId
                          ? "A senha não pode ser alterada aqui. Utilize o botão de Reset de Senha na tabela."
                          : "O usuário precisará redefinir a senha provisória no primeiro acesso ao painel da loja."
                      }
                  </p>
              </div>

              <div className="space-y-4">
                  <Input label="Nome do Responsável" placeholder="Ex: João Silva" value={userName} onChange={e => setUserName(e.target.value)} />
                  <Input label="E-mail de Acesso" type="email" placeholder="joao@loja.com" value={userEmail} onChange={e => setUserEmail(e.target.value)} />

                  {!editingUserId && (
                      <Input label="Senha Provisória" placeholder="Ex: loja123" value={userPassword} onChange={e => setUserPassword(e.target.value)} />
                  )}

                  <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-[var(--text)]">Vincular à Loja</label>
                      <select
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                        value={userStoreId}
                        onChange={e => setUserStoreId(e.target.value)}
                      >
                          <option value="">Selecione uma loja...</option>
                          {stores.map(s => (
                              <option key={s.id} value={s.id}>{s.name} (/{s.slug})</option>
                          ))}
                      </select>
                  </div>
              </div>

              {errorMsg && <div className="bg-[var(--err)]/10 text-[var(--err)] p-3 rounded-lg text-sm flex items-start gap-2"><AlertCircle size={18} /><span>{errorMsg}</span></div>}

              <Button className="w-full h-12 text-lg" onClick={handleSaveUser} isLoading={isLoading}>
                  {editingUserId ? 'Salvar Alterações' : 'Criar Usuário'}
              </Button>
          </div>
      </Modal>
    </div>
  );
};
