import { SalesReportRow } from '@/lib/print';

// Separador ; (não ,): é o que o Excel em pt-BR espera por padrão, já que a
// vírgula já é o separador decimal nesse locale.
function escapeCsvField(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadSalesReportCsv(rows: SalesReportRow[], filename: string): void {
  const header = ['Data', 'Tipo', 'Cliente/Mesa', 'Itens', 'Total'];
  const lines = [
    header.join(';'),
    ...rows.map((r) =>
      [
        escapeCsvField(r.date),
        escapeCsvField(r.type),
        escapeCsvField(r.customer),
        String(r.items),
        r.total.toFixed(2).replace('.', ','),
      ].join(';')
    ),
  ];
  const csvContent = '﻿' + lines.join('\r\n'); // BOM pro Excel reconhecer UTF-8
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
