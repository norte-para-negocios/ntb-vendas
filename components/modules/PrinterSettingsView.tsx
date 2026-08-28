'use client';

// Aba "Impressão" (2026-08-27, pedido direto do dono: teste na loja no
// dia seguinte com o sistema de impressão). Ver AGENTS.md, seção
// "Impressão" e migration 061.
//
// O QUE JÁ EXISTIA antes desta tela (não duplicado aqui): impressão
// automática + fila + retentativa + botão "Testar Impressão" já rodam em
// segundo plano pra lojas `direct_print` via `CaixaPrintStation.tsx` —
// mas sempre mandando pra "a impressora padrão do sistema operacional do
// aparelho do caixa" (`window.print()`), sem nenhuma tela de
// configuração e sem opção de impressora de REDE (IP).
//
// O QUE ESTA TELA ADICIONA: (1) cadastro de impressora — "impressora do
// sistema" (só documenta que window.print() já cobre isso, nenhuma config
// nova necessária), "rede" (IP+porta, ESC/POS puro, o caminho mais
// universal em impressora térmica) e "USB local" (nome do dispositivo já
// instalado no Windows/Linux do aparelho); (2) botão "Imprimir teste" por
// impressora cadastrada; (3) fila (`print_jobs`, migration 061) visível
// com status — histórico persistido no servidor, ao contrário do dedupe
// em localStorage do CaixaPrintStation, que só existe na memória de UM
// navegador.
//
// IMPORTANTE, documentado com transparência: impressoras 'network'/'usb'
// só imprimem de verdade com o agente local (`print-agent/`, fora do
// Next.js) rodando no computador da loja, consumindo esta mesma fila.
// Sem o agente rodando, o job fica 'pending' pra sempre — esta tela nunca
// finge que "enfileirou" é o mesmo que "imprimiu".

import React, { useEffect, useState, useCallback } from 'react';
import { Printer, Wifi, Usb, Monitor, Plus, Trash2, RotateCcw, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button, Input, Card, Badge } from '@/components/ui';
import { toast } from '@/components/Toast';
import {
  fetchPrinterConfigs, createPrinterConfig, updatePrinterConfig, deletePrinterConfig,
  enqueuePrintJob, fetchRecentPrintJobs, retryPrintJob,
} from '@/lib/api';
import { printGenericTestTicket, buildGenericTestTicketText } from '@/lib/print';
import { PrinterConfig, PrintJob, Store } from '@/types';

const CONNECTION_LABELS: Record<PrinterConfig['connection_type'], string> = {
  browser_default: 'Impressora do sistema (padrão do computador)',
  network: 'Impressora de rede (IP)',
  usb: 'Impressora USB local',
};

const DESTINATION_LABELS: Record<PrinterConfig['destination'], string> = {
  kitchen: 'Cozinha',
  bar: 'Bar',
  all: 'Cozinha e Bar',
};

const STATUS_BADGE: Record<PrintJob['status'], { label: string; className: string; icon: React.ReactNode }> = {
  pending: { label: 'Na fila', className: 'bg-[var(--warn)]/10 text-[var(--warn)]', icon: <Clock size={12} className="mr-1" /> },
  printing: { label: 'Imprimindo...', className: 'bg-[var(--info)]/10 text-[var(--info)]', icon: <Loader2 size={12} className="mr-1 animate-spin" /> },
  done: { label: 'Impresso', className: 'bg-[var(--ok)]/10 text-[var(--ok)]', icon: <CheckCircle2 size={12} className="mr-1" /> },
  error: { label: 'Falhou', className: 'bg-[var(--err)]/10 text-[var(--err)]', icon: <XCircle size={12} className="mr-1" /> },
};

const CONNECTION_ICON: Record<PrinterConfig['connection_type'], React.ReactNode> = {
  browser_default: <Monitor size={16} />,
  network: <Wifi size={16} />,
  usb: <Usb size={16} />,
};

const PrinterSettingsView: React.FC<{ store: Store }> = ({ store }) => {
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  // Largura de papel do teste — só afeta o ticket GENÉRICO desta tela
  // (buildGenericTestTicketText/printGenericTestTicket), nunca o
  // config.printer_paper_width_mm real da loja (usado nos tickets de
  // pedido de verdade). Pedido explícito do dono (2026-08-28): testar o
  // corte/quebra de linha em cada largura antes de decidir qual comprar.
  const [testPaperWidth, setTestPaperWidth] = useState<48 | 58 | 80>(48);

  const [name, setName] = useState('');
  const [connectionType, setConnectionType] = useState<PrinterConfig['connection_type']>('network');
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('9100');
  const [usbSystemName, setUsbSystemName] = useState('');
  const [destination, setDestination] = useState<PrinterConfig['destination']>('all');

  const load = useCallback(async () => {
    const [printerList, jobList] = await Promise.all([
      fetchPrinterConfigs(store.id),
      fetchRecentPrintJobs(store.id, 30),
    ]);
    setPrinters(printerList);
    setJobs(jobList);
    setIsLoading(false);
  }, [store.id]);

  useEffect(() => {
    load();
    // Backstop de 5s pra ver o status da fila avançar (pending -> done/error)
    // sem precisar recarregar a página manualmente — mesmo padrão de
    // polling já usado no CaixaPrintStation, só que mais simples (não
    // precisa de Realtime aqui, é uma tela de configuração, não operação).
    const intervalId = window.setInterval(load, 5000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  const resetForm = () => {
    setName('');
    setConnectionType('network');
    setIpAddress('');
    setPort('9100');
    setUsbSystemName('');
    setDestination('all');
    setShowAddForm(false);
  };

  const handleAddPrinter = async () => {
    if (!name.trim()) { toast.error('Dê um nome pra essa impressora (ex: "Cozinha").'); return; }
    if (connectionType === 'network' && !ipAddress.trim()) { toast.error('Informe o IP da impressora de rede.'); return; }
    if (connectionType === 'usb' && !usbSystemName.trim()) { toast.error('Informe o nome da impressora instalada no sistema.'); return; }
    setIsSaving(true);
    try {
      const result = await createPrinterConfig({
        storeId: store.id,
        name: name.trim(),
        connectionType,
        ipAddress: connectionType === 'network' ? ipAddress.trim() : null,
        port: connectionType === 'network' ? (parseInt(port, 10) || 9100) : undefined,
        usbSystemName: connectionType === 'usb' ? usbSystemName.trim() : null,
        destination,
      });
      if (!result.success) { toast.error(result.message || 'Erro ao salvar impressora.'); return; }
      toast.success('Impressora cadastrada.');
      resetForm();
      load();
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (printer: PrinterConfig) => {
    const result = await updatePrinterConfig(printer.id, { is_active: !printer.is_active });
    if (!result.success) { toast.error(result.message || 'Erro ao atualizar.'); return; }
    load();
  };

  const handleDelete = async (printer: PrinterConfig) => {
    if (!confirm(`Remover a impressora "${printer.name}"? A fila de jobs antigos dela continua no histórico.`)) return;
    const result = await deletePrinterConfig(printer.id);
    if (!result.success) { toast.error(result.message || 'Erro ao remover.'); return; }
    toast.success('Impressora removida.');
    load();
  };

  // Impressão de teste: pra 'browser_default' usa o MESMO caminho já
  // testado do CaixaPrintStation (window.print(), sem passar pela fila —
  // não tem agente nenhum pra consumir um job aqui, o navegador imprime
  // na hora). Pra 'network'/'usb', enfileira um print_job de verdade —
  // só imprime se o agente local estiver rodando e pegando a fila desta
  // loja, o que esta tela deixa claro no aviso abaixo do botão.
  // Ticket 100% genérico (buildGenericTestTicketText/printGenericTestTicket,
  // lib/print.ts) — sem dado de pedido/mesa/cliente real, só pra validar
  // que a impressora física recebe e corta o texto certo na largura
  // escolhida (testPaperWidth). Nunca usa printKitchenTicket/
  // buildKitchenTicketText (esses são o caminho de PEDIDO DE VERDADE).
  const handleTestPrint = async (printer: PrinterConfig) => {
    setTestingId(printer.id);
    try {
      if (printer.connection_type === 'browser_default') {
        const ok = await printGenericTestTicket(testPaperWidth, store.name);
        if (ok) toast.success('Ticket de teste enviado ao navegador. Confira a impressora.');
        else toast.error('Falha ao enviar o ticket de teste.');
        return;
      }
      const content = buildGenericTestTicketText(testPaperWidth, store.name);
      const result = await enqueuePrintJob({
        storeId: store.id,
        printerConfigId: printer.id,
        destination: printer.destination,
        title: `Teste (${testPaperWidth}mm) — ${printer.name}`,
        content,
      });
      if (result.success) toast.success('Job de teste enfileirado. Se o agente local estiver rodando, imprime em segundos.');
      else toast.error(result.message || 'Erro ao enfileirar o teste.');
      load();
    } finally {
      setTestingId(null);
    }
  };

  const handleRetryJob = async (job: PrintJob) => {
    const result = await retryPrintJob(job.id);
    if (!result.success) { toast.error(result.message || 'Erro ao reenviar.'); return; }
    toast.success('Reenviado pra fila.');
    load();
  };

  if (isLoading) {
    return <div className="text-center py-10 text-[var(--text-muted)] text-sm">Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--text)] flex items-center gap-2"><Printer size={18} /> Impressoras</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Cadastre as impressoras da loja e teste cada uma antes de abrir pro cliente.
          </p>
        </div>
        {!showAddForm && (
          <Button size="sm" variant="secondary" onClick={() => setShowAddForm(true)}>
            <Plus size={14} className="mr-1" /> Nova impressora
          </Button>
        )}
      </div>

      <Card className="p-3 flex items-center justify-between gap-3 flex-wrap bg-[var(--surface-2)]">
        <div>
          <p className="text-xs font-semibold text-[var(--text)]">Largura do papel do teste</p>
          <p className="text-[11px] text-[var(--text-muted)]">Só afeta o ticket genérico de "Imprimir teste" abaixo — não muda a configuração real da loja.</p>
        </div>
        <div className="flex gap-1.5">
          {([48, 58, 80] as const).map((mm) => (
            <button
              key={mm}
              type="button"
              onClick={() => setTestPaperWidth(mm)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border u-motion u-press-sm ${
                testPaperWidth === mm ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]'
              }`}
            >
              {mm}mm
            </button>
          ))}
        </div>
      </Card>

      {showAddForm && (
        <Card className="p-4 space-y-3">
          <Input label="Nome" placeholder="Ex: Cozinha, Bar, Balcão" value={name} onChange={(e) => setName(e.target.value)} />

          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-[var(--text-muted)]">Tipo de conexão</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(['browser_default', 'network', 'usb'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setConnectionType(type)}
                  className={`flex items-center gap-2 p-3 rounded-[var(--r-md)] border text-left text-sm u-motion u-press-sm ${
                    connectionType === type ? 'border-[var(--brand)] bg-[var(--brand)]/5 text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]'
                  }`}
                >
                  {CONNECTION_ICON[type]}
                  <span className="text-xs font-medium">{CONNECTION_LABELS[type]}</span>
                </button>
              ))}
            </div>
          </div>

          {connectionType === 'browser_default' && (
            <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-2)] rounded-[var(--r-md)] p-3">
              Não precisa de mais nada — configure essa impressora como padrão no Windows/Mac do computador do caixa. O sistema já imprime automaticamente nela (mesmo mecanismo de sempre).
            </p>
          )}

          {connectionType === 'network' && (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
              <Input label="IP da impressora" placeholder="Ex: 192.168.0.50" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} />
              <Input label="Porta" placeholder="9100" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          )}

          {connectionType === 'usb' && (
            <Input label="Nome da impressora no sistema" placeholder="Ex: EPSON TM-T20" value={usbSystemName} onChange={(e) => setUsbSystemName(e.target.value)} />
          )}

          {(connectionType === 'network' || connectionType === 'usb') && (
            <p className="text-xs text-[var(--warn)] bg-[var(--warn)]/10 rounded-[var(--r-md)] p-3">
              Precisa do agente local rodando no computador da loja pra imprimir de verdade (ver instruções entregues com o sistema). Sem o agente, os jobs ficam "na fila" e nunca saem do papel.
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-[var(--text-muted)]">Destino</label>
            <div className="flex gap-2">
              {(['kitchen', 'bar', 'all'] as const).map((dest) => (
                <button
                  key={dest}
                  type="button"
                  onClick={() => setDestination(dest)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border u-motion u-press-sm ${
                    destination === dest ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]'
                  }`}
                >
                  {DESTINATION_LABELS[dest]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleAddPrinter} isLoading={isSaving}>Salvar impressora</Button>
            <Button size="sm" variant="ghost" onClick={resetForm}>Cancelar</Button>
          </div>
        </Card>
      )}

      {printers.length === 0 && !showAddForm ? (
        <p className="text-sm text-[var(--text-muted)] text-center py-6">Nenhuma impressora cadastrada ainda.</p>
      ) : (
        <div className="space-y-2">
          {printers.map((printer) => (
            <Card key={printer.id} className={`p-4 flex items-center justify-between gap-3 ${!printer.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-[var(--text-muted)]">{CONNECTION_ICON[printer.connection_type]}</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)] truncate">{printer.name}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {CONNECTION_LABELS[printer.connection_type]}
                    {printer.connection_type === 'network' && ` — ${printer.ip_address}:${printer.port}`}
                    {printer.connection_type === 'usb' && ` — ${printer.usb_system_name}`}
                    {' · '}{DESTINATION_LABELS[printer.destination]}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="secondary" onClick={() => handleTestPrint(printer)} isLoading={testingId === printer.id}>
                  Imprimir teste
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleToggleActive(printer)} title={printer.is_active ? 'Desativar' : 'Ativar'}>
                  {printer.is_active ? 'Ativa' : 'Inativa'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(printer)}>
                  <Trash2 size={14} className="text-[var(--err)]" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div>
        <h3 className="text-base font-semibold text-[var(--text)] mb-1">Fila de impressão (últimos 30)</h3>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Jobs enviados pra impressoras de rede/USB. Atualiza sozinho a cada 5s.
        </p>
        {jobs.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Nenhum job na fila ainda.</p>
        ) : (
          <div className="space-y-1.5">
            {jobs.map((job) => {
              const statusInfo = STATUS_BADGE[job.status];
              return (
                <div key={job.id} className="flex items-center justify-between gap-3 bg-[var(--surface-2)] rounded-[var(--r-md)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text)] truncate">{job.title}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {new Date(job.created_at).toLocaleTimeString('pt-BR')}
                      {job.status === 'error' && job.error_message ? ` — ${job.error_message}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge color={statusInfo.className}>{statusInfo.icon}{statusInfo.label}</Badge>
                    {job.status === 'error' && (
                      <Button size="sm" variant="ghost" onClick={() => handleRetryJob(job)}>
                        <RotateCcw size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PrinterSettingsView;
