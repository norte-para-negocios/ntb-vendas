'use client';

import React, { useState, useEffect } from 'react';
import { Store as StoreIcon, Users, Plus, Save, Calendar, CheckCircle, XCircle, AlertCircle, LayoutGrid, Coffee, Lock, User, RefreshCw, Trash2, Edit2, Upload, Image, Copy } from 'lucide-react';
import { Button, Card, Input, Modal, Badge } from '@/components/ui';
import { createStore, updateStore, deleteStore, duplicateStore, authenticateAdmin, updateAdminPassword, fetchAllStores, fetchTables, createStoreUser, updateStoreUser, deleteStoreUser, fetchStoreUsers, uploadStoreLogo } from '@/lib/api';
import { Store, StoreUser } from '@/types';

// Admin Login Component
const AdminLogin: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Password Change State
    const [needsChange, setNeedsChange] = useState(false);
    const [userId, setUserId] = useState('');
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
            await updateAdminPassword(userId, newPass);
            alert('Senha alterada com sucesso! Faça login novamente.');
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
            <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
                <Card className="w-full max-w-md p-8 animate-fade-in">
                    <div className="text-center mb-6">
                        <div className="bg-yellow-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-yellow-600">
                            <Lock size={32} />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800">Redefinição Obrigatória</h2>
                        <p className="text-gray-500 text-sm mt-1">Por segurança, altere sua senha provisória.</p>
                    </div>

                    <div className="space-y-4">
                        <Input label="Nova Senha" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
                        <Input label="Confirmar Nova Senha" type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} />

                        {error && <p className="text-red-500 text-sm text-center font-medium">{error}</p>}

                        <Button className="w-full" onClick={handleChangePassword} isLoading={isLoading}>
                            Atualizar Senha
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
            <Card className="w-full max-w-sm p-8 animate-slide-up">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-primary mb-2">Painel Admin</h1>
                    <p className="text-gray-400">Acesso Restrito</p>
                </div>

                <div className="space-y-4">
                    <div className="relative">
                        <User className="absolute left-3 top-9 text-gray-400" size={18} />
                        <Input label="Usuário" className="pl-10" placeholder="Ex: andrey" value={username} onChange={e => setUsername(e.target.value)} />
                    </div>
                    <div className="relative">
                        <Lock className="absolute left-3 top-9 text-gray-400" size={18} />
                        <Input label="Senha" type="password" className="pl-10" placeholder="••••••" value={password} onChange={e => setPassword(e.target.value)} />
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded text-sm flex items-center gap-2">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <Button className="w-full h-12 text-lg shadow-lg shadow-primary/20" onClick={handleLogin} isLoading={isLoading}>
                        Entrar
                    </Button>
                </div>
            </Card>
        </div>
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

  // Store Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [slug, setSlug] = useState('');
  const [contractType, setContractType] = useState<'balcao' | 'balcao_mesas'>('balcao');
  const [tableCount, setTableCount] = useState<number>(10);
  const [periodMonths, setPeriodMonths] = useState<number>(12);
  const [isActive, setIsActive] = useState(true);

  // Logo Upload State
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

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
      setLogoFile(null);
      setLogoPreview(null);
      setErrorMsg(null);
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
      setLogoPreview(store.logo_url);
      setLogoFile(null);
      setErrorMsg(null);
      setIsModalOpen(true);
  };

  const handleDeleteStore = async (id: string, storeName: string) => {
      if(window.confirm(`Tem certeza que deseja excluir a loja "${storeName}"? Todos os dados (pedidos, mesas, cardápio) serão perdidos.`)) {
          setIsLoadingList(true);
          const result = await deleteStore(id);
          if (result.success) {
              await loadStores();
          } else {
              alert('Erro ao excluir: ' + result.message);
          }
          setIsLoadingList(false);
      }
  };

  const handleDuplicateStore = async (id: string, storeName: string) => {
      if(window.confirm(`Deseja duplicar a loja "${storeName}"? Isso criará uma nova loja com o mesmo cardápio e configurações.`)) {
          setIsLoadingList(true);
          const result = await duplicateStore(id);
          if (result.success) {
              await loadStores();
              alert('Loja duplicada com sucesso!');
          } else {
              alert('Erro ao duplicar: ' + result.message);
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

  const handleSaveStore = async () => {
      setErrorMsg(null);
      if(!name) return setErrorMsg('O nome da loja é obrigatório.');
      if(!slug) return setErrorMsg('O slug (URL) é obrigatório.');
      if(contractType === 'balcao_mesas' && tableCount < 1) return setErrorMsg('Defina pelo menos 1 mesa.');

      setIsLoading(true);

      let finalLogoUrl = logoPreview;

      try {
          // Upload Logo if new file selected
          if (logoFile) {
              finalLogoUrl = await uploadStoreLogo(logoFile);
          }

          const params = {
              name,
              cnpj,
              slug,
              contractType,
              tableCount,
              periodMonths,
              isActive,
              logoUrl: finalLogoUrl
          };

          let result;
          if (editingId) {
              result = await updateStore(editingId, params);
          } else {
              result = await createStore(params);
          }

          if(result.success) {
              alert(editingId ? 'Loja atualizada com sucesso!' : 'Loja criada com sucesso!');
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
      if(window.confirm(`Excluir o acesso de ${user.name}?`)) {
          setIsLoadingList(true);
          const result = await deleteStoreUser(user.id);
          if(result.success) {
              loadUsers();
          } else {
              alert('Erro ao excluir usuário: ' + result.message);
          }
          setIsLoadingList(false);
      }
  };

  const handleResetUserPassword = async (user: StoreUser) => {
      const newPass = window.prompt(`Digite a nova senha provisória para ${user.name}:`);
      if (newPass) {
          if (newPass.length < 4) return alert("A senha deve ter pelo menos 4 caracteres.");

          setIsLoadingList(true);
          const result = await updateStoreUser(user.id, {
              password: newPass,
              must_change_password: true
          });

          if (result.success) {
              alert(`Senha redefinida com sucesso! O usuário deverá trocá-la no próximo login.`);
              loadUsers();
          } else {
              alert("Erro ao redefinir senha.");
          }
          setIsLoadingList(false);
      }
  };

  const handleSaveUser = async () => {
      setErrorMsg(null);
      if (!userName || !userEmail || !userStoreId) {
          return setErrorMsg('Preencha os campos obrigatórios.');
      }

      // If creating, password is mandatory
      if (!editingUserId && !userPassword) {
          return setErrorMsg('Defina uma senha provisória.');
      }

      setIsLoading(true);

      let result;
      if (editingUserId) {
          result = await updateStoreUser(editingUserId, {
              name: userName,
              email: userEmail,
              store_id: userStoreId
          });
      } else {
          result = await createStoreUser(userStoreId, userName, userEmail, userPassword);
      }

      if(result.success) {
          alert(editingUserId ? 'Usuário atualizado!' : 'Usuário criado com sucesso!');
          setIsUserModalOpen(false);
          resetUserForm();
          loadUsers();
      } else {
          setErrorMsg(result.message || 'Erro ao salvar usuário.');
      }
      setIsLoading(false);
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
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white p-6 hidden md:block">
        <h1 className="text-2xl font-bold mb-8 text-primary-light">Master Admin</h1>
        <nav className="space-y-2">
          <button onClick={() => setView('stores')} className={`flex items-center gap-3 w-full p-3 rounded-lg transition-colors ${view === 'stores' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'text-gray-400 hover:bg-slate-800 hover:text-white'}`}>
            <StoreIcon size={20} /> Lojas
          </button>
          <button onClick={() => setView('users')} className={`flex items-center gap-3 w-full p-3 rounded-lg transition-colors ${view === 'users' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'text-gray-400 hover:bg-slate-800 hover:text-white'}`}>
            <Users size={20} /> Usuários (Lojistas)
          </button>
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold text-slate-800">
                {view === 'stores' ? 'Gestão de Lojas' : 'Gestão de Lojistas'}
            </h2>
            <p className="text-gray-500 mt-1">Gerencie os {view === 'stores' ? 'estabelecimentos' : 'acessos dos clientes'} da plataforma.</p>
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
             <div onClick={() => { resetForm(); setIsModalOpen(true); }} className="border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center p-8 text-gray-400 cursor-pointer hover:border-primary hover:text-primary hover:bg-primary/5 transition-all group min-h-[220px]">
                <div className="bg-gray-100 p-4 rounded-full mb-3 group-hover:bg-white group-hover:shadow-md transition-all">
                    <Plus size={32} />
                </div>
                <p className="font-semibold">Adicionar Nova Loja</p>
             </div>

             {/* Stores List */}
             {stores.map(store => (
                 <Card key={store.id} className="flex flex-col gap-4 border-l-4 border-l-primary relative overflow-hidden group">
                    <div className="flex items-start justify-between">
                        <div className="flex gap-3">
                            {store.logo_url && <img src={store.logo_url} alt="Logo" className="w-12 h-12 rounded-lg object-cover border border-gray-100" />}
                            <div>
                                <h3 className="font-bold text-lg text-slate-800">{store.name}</h3>
                                <p className="text-sm text-gray-500">{store.cnpj || 'CNPJ não informado'}</p>
                            </div>
                        </div>
                        <Badge color={store.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                            {store.is_active ? 'ATIVO' : 'INATIVO'}
                        </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                        <div className="bg-gray-50 p-2 rounded border border-gray-100">
                            <span className="block text-xs text-gray-400 uppercase font-bold">Contrato</span>
                            <div className="flex items-center gap-1 text-slate-700 font-medium">
                                <LayoutGrid size={14} className="text-primary"/> {store.contract_type === 'balcao_mesas' ? 'Balcão + Mesas' : 'Apenas Balcão'}
                            </div>
                        </div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-100">
                            <span className="block text-xs text-gray-400 uppercase font-bold">Slug</span>
                            <div className="flex items-center gap-1 text-slate-700 font-medium">
                                <span className="truncate">/{store.slug}</span>
                            </div>
                        </div>
                    </div>
                    <div className="mt-auto pt-4 flex gap-2 border-t border-gray-100">
                        <a href={`#/c/${store.slug}`} target="_blank" rel="noreferrer" className="flex-1 text-center py-2 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg border border-primary/20 transition-colors">
                            Ver Cardápio
                        </a>
                        <button
                            onClick={() => handleDuplicateStore(store.id, store.name)}
                            className="px-3 text-gray-400 hover:text-blue-500 transition-colors"
                            title="Duplicar"
                        >
                            <Copy size={18} />
                        </button>
                        <button
                            onClick={() => handleEditStore(store)}
                            className="px-3 text-gray-400 hover:text-slate-800 transition-colors"
                            title="Editar"
                        >
                            <Edit2 size={18} />
                        </button>
                        <button
                            onClick={() => handleDeleteStore(store.id, store.name)}
                            className="px-3 text-gray-400 hover:text-red-500 transition-colors"
                            title="Excluir"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                 </Card>
             ))}

             {stores.length === 0 && !isLoadingList && (
                 <div className="col-span-full text-center py-10 text-gray-500">Nenhuma loja encontrada. Crie a primeira!</div>
             )}
          </div>
        )}

        {/* --- USERS VIEW --- */}
        {view === 'users' && (
            <div className="space-y-4">
                {users.length === 0 && !isLoadingList ? (
                     <Card className="flex flex-col items-center justify-center py-20 text-gray-400">
                        <Users size={48} className="mb-4 opacity-20" />
                        <p>Nenhum usuário cadastrado. Adicione um gestor para uma loja.</p>
                     </Card>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-bold">
                                <tr>
                                    <th className="p-4">Nome do Responsável</th>
                                    <th className="p-4">Email de Acesso</th>
                                    <th className="p-4">Loja Vinculada</th>
                                    <th className="p-4">Função</th>
                                    <th className="p-4 text-center">Status Senha</th>
                                    <th className="p-4 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {users.map(user => (
                                    <tr key={user.id} className="hover:bg-gray-50">
                                        <td className="p-4 font-medium text-slate-800">{user.name}</td>
                                        <td className="p-4 text-gray-600">{user.email}</td>
                                        <td className="p-4">
                                            <Badge color="bg-primary/10 text-primary">{user.store?.name || 'Loja Desconhecida'}</Badge>
                                        </td>
                                        <td className="p-4 text-sm capitalize">{user.role === 'owner' ? 'Dono / Gerente' : user.role}</td>
                                        <td className="p-4 text-center">
                                            {user.must_change_password ?
                                                <Badge color="bg-yellow-100 text-yellow-700">Provisória</Badge> :
                                                <Badge color="bg-green-100 text-green-700">Definida</Badge>
                                            }
                                        </td>
                                        <td className="p-4 flex justify-end gap-2">
                                            <button
                                                onClick={() => handleResetUserPassword(user)}
                                                className="p-2 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                                                title="Resetar Senha"
                                            >
                                                <RefreshCw size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleEditUser(user)}
                                                className="p-2 text-gray-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                                                title="Editar"
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteUser(user)}
                                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
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
              <div className="flex items-center justify-between bg-gradient-to-r from-gray-50 to-white p-4 rounded-xl border border-gray-200 shadow-sm">
                  <div>
                      <span className="block font-bold text-slate-800">Status do Contrato</span>
                      <span className="text-xs text-gray-500">Define se a loja está acessível</span>
                  </div>
                  <button onClick={() => setIsActive(!isActive)} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all shadow-sm ${isActive ? 'bg-green-500 text-white shadow-green-200' : 'bg-red-500 text-white shadow-red-200'}`}>
                      {isActive ? <CheckCircle size={16}/> : <XCircle size={16}/>} {isActive ? 'LOJA ATIVA' : 'BLOQUEADA'}
                  </button>
              </div>

              {/* Logo Upload */}
              <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-700">Logotipo da Loja</label>
                  <div className="flex items-center gap-4">
                      <div className={`w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50 ${logoPreview ? 'border-primary' : ''}`}>
                          {logoPreview ? (
                              <img src={logoPreview} alt="Logo Preview" className="w-full h-full object-cover" />
                          ) : (
                              <Image className="text-gray-300" size={24} />
                          )}
                      </div>
                      <div className="flex-1">
                          <label className="cursor-pointer bg-white border border-gray-300 hover:bg-gray-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 w-fit transition-colors shadow-sm">
                              <Upload size={16} /> Escolher Imagem
                              <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                          </label>
                          <p className="text-xs text-gray-400 mt-2">Recomendado: 500x500px (PNG ou JPG)</p>
                      </div>
                  </div>
              </div>

              <div className="space-y-4">
                <Input label="Nome do Estabelecimento" placeholder="Ex: Hamburgueria Top" value={name} onChange={handleNameChange} />
                <div className="grid grid-cols-2 gap-4">
                     <Input label="CNPJ" placeholder="00.000.000/0000-00" value={cnpj} onChange={e => setCnpj(e.target.value)} />
                     <Input type="number" label="Meses de Contrato" value={periodMonths} onChange={e => setPeriodMonths(parseInt(e.target.value))} />
                </div>
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-slate-700">Link de Acesso (Slug)</label>
                    <div className="flex items-center group">
                        <span className="bg-gray-100 border border-r-0 border-gray-300 rounded-l-lg px-3 py-2 text-sm text-gray-500">site.com/#/c/</span>
                        <input className="w-full rounded-r-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-primary/50 outline-none" placeholder="minha-loja" value={slug} onChange={e => setSlug(generateSlug(e.target.value))} />
                    </div>
                </div>
              </div>
              <hr className="border-gray-100" />
              <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                      <button className={`flex flex-col items-center justify-center p-3 gap-2 rounded-xl border-2 transition-all ${contractType === 'balcao' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-100 text-gray-500'}`} onClick={() => setContractType('balcao')}>
                          <Coffee size={24} /> <span className="font-bold text-sm">Apenas Balcão</span>
                      </button>
                      <button className={`flex flex-col items-center justify-center p-3 gap-2 rounded-xl border-2 transition-all ${contractType === 'balcao_mesas' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-100 text-gray-500'}`} onClick={() => setContractType('balcao_mesas')}>
                          <LayoutGrid size={24} /> <span className="font-bold text-sm">Balcão + Mesas</span>
                      </button>
                  </div>
                  {contractType === 'balcao_mesas' && (
                      <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                        <div className="flex justify-between items-center mb-2"><label className="text-sm font-bold text-blue-800">Mesas: {tableCount}</label></div>
                        <input type="range" min="1" max="100" value={tableCount} onChange={e => setTableCount(parseInt(e.target.value))} className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-600"/>
                        {editingId && <p className="text-xs text-blue-600 mt-2">Nota: Reduzir mesas não apaga as existentes automaticamente.</p>}
                      </div>
                  )}
              </div>
              {errorMsg && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2"><AlertCircle size={18} /><span>{errorMsg}</span></div>}
              <Button className="w-full h-12 text-lg shadow-lg shadow-primary/20" onClick={handleSaveStore} isLoading={isLoading}>
                  <Save className="mr-2" size={20} /> {editingId ? 'Atualizar Loja' : 'Salvar e Ativar Loja'}
              </Button>
          </div>
      </Modal>

      {/* MODAL: NOVO/EDITAR USUÁRIO */}
      <Modal isOpen={isUserModalOpen} onClose={() => setIsUserModalOpen(false)} title={editingUserId ? "Editar Acesso" : "Novo Acesso Lojista"}>
          <div className="space-y-6">
              <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100 flex gap-3">
                  <Lock className="text-yellow-600 flex-shrink-0" size={20} />
                  <p className="text-sm text-yellow-800">
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
                      <label className="text-sm font-semibold text-slate-700">Vincular à Loja</label>
                      <select
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
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

              {errorMsg && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2"><AlertCircle size={18} /><span>{errorMsg}</span></div>}

              <Button className="w-full h-12 text-lg" onClick={handleSaveUser} isLoading={isLoading}>
                  {editingUserId ? 'Salvar Alterações' : 'Criar Usuário'}
              </Button>
          </div>
      </Modal>
    </div>
  );
};
