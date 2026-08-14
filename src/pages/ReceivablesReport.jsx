import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download } from 'lucide-react';
import PdfButton from '@/components/PdfButton';
import { exportReportToPDF } from '@/lib/pdfExport';
import { useAuth } from '@/lib/AuthContext';
import { formatCurrency as fmtMoney } from '@/lib/format';

const agingBuckets = (days) => {
  if (days < 0) return 'belum_jatuh_tempo';
  if (days <= 7) return '1-7';
  if (days <= 14) return '8-14';
  if (days <= 30) return '15-30';
  if (days <= 60) return '31-60';
  return '60+';
};
const bucketLabel = { belum_jatuh_tempo: 'Belum Jatuh Tempo', '1-7': '1–7 hari', '8-14': '8–14 hari', '15-30': '15–30 hari', '31-60': '31–60 hari', '60+': '> 60 hari' };

export default function ReceivablesReport() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ customer_id: '', payment_status: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [items, custs] = await Promise.all([
        base44.entities.Sale.list('-created_date', 500),
        base44.entities.Customer.list(),
      ]);
      setData(items.filter(s => s.transaction_status === 'posted' && s.remaining_receivable > 0));
      setCustomers(custs);
    } catch { toast({ variant: 'destructive', title: 'Gagal memuat data' }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = data.filter(s => {
    if (filters.customer_id && s.customer_id !== filters.customer_id) return false;
    if (filters.payment_status && s.payment_status !== filters.payment_status) return false;
    return true;
  }).map(s => {
    const overdue = s.due_date ? Math.floor((new Date(today) - new Date(s.due_date)) / 86400000) : 0;
    return { ...s, overdue_days: overdue, aging_bucket: agingBuckets(overdue) };
  });

  const totalPiutang = filtered.reduce((s, r) => s + (r.remaining_receivable || 0), 0);
  const belumJatuhTempo = filtered.filter(r => r.overdue_days < 0).reduce((s, r) => s + r.remaining_receivable, 0);
  const jatuhTempo = filtered.filter(r => r.overdue_days >= 0).reduce((s, r) => s + r.remaining_receivable, 0);
  const topCustomers = Object.values(filtered.reduce((acc, r) => { acc[r.customer_name] = (acc[r.customer_name] || 0) + r.remaining_receivable; return acc; }, {})).sort((a, b) => b - a).slice(0, 5);

  const exportCSV = () => {
    const headers = ['Customer', 'Invoice', 'Tanggal', 'Nilai', 'Pembayaran', 'Sisa Piutang', 'Jatuh Tempo', 'Hari Telat', 'Umur Piutang', 'Status'];
    const rows = filtered.map(r => [r.customer_name, r.invoice_number, r.transaction_date, r.total, r.total_payment, r.remaining_receivable, r.due_date, r.overdue_days, bucketLabel[r.aging_bucket], r.payment_status]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `laporan-piutang-${Date.now()}.csv`; a.click();
    toast({ title: 'Laporan diexport' });
  };

  const exportPDF = () => exportReportToPDF({
    title: 'Laporan Piutang',
    subtitle: `${filtered.length} invoice · Total Piutang ${fmtMoney(totalPiutang)}`,
    meta: { company: 'LAB PRO', printedBy: user?.full_name },
    columns: [
      { key: 'customer_name', header: 'Customer' },
      { key: 'invoice_number', header: 'Invoice' },
      { key: 'transaction_date', header: 'Tanggal' },
      { key: 'total', header: 'Nilai', align: 'right' },
      { key: 'total_payment', header: 'Pembayaran', align: 'right' },
      { key: 'remaining_receivable', header: 'Sisa Piutang', align: 'right' },
      { key: 'due_date', header: 'Jatuh Tempo' },
      { key: 'overdue_days', header: 'Hari Telat', align: 'right' },
      { key: 'aging_bucket', header: 'Umur Piutang' },
      { key: 'payment_status', header: 'Status' },
    ],
    rows: filtered.map(r => ({
      customer_name: r.customer_name, invoice_number: r.invoice_number, transaction_date: r.transaction_date,
      total: fmtMoney(r.total), total_payment: fmtMoney(r.total_payment), remaining_receivable: fmtMoney(r.remaining_receivable),
      due_date: r.due_date || '-', overdue_days: r.overdue_days, aging_bucket: bucketLabel[r.aging_bucket], payment_status: r.payment_status,
    })),
    fileName: `laporan-piutang-${Date.now()}.pdf`,
  });

  const columns = [
    { key: 'customer_name', header: 'Customer', sortable: true, className: 'font-medium' },
    { key: 'invoice_number', header: 'Invoice', className: 'font-mono' },
    { key: 'transaction_date', header: 'Tanggal', sortable: true },
    { key: 'total', header: 'Nilai', render: (row) => <span className="tabular-nums">{fmtMoney(row.total)}</span> },
    { key: 'total_payment', header: 'Pembayaran', render: (row) => <span className="tabular-nums">{fmtMoney(row.total_payment)}</span> },
    { key: 'remaining_receivable', header: 'Sisa Piutang', render: (row) => <span className="text-red-600 tabular-nums font-semibold">{fmtMoney(row.remaining_receivable)}</span> },
    { key: 'due_date', header: 'Jatuh Tempo', render: (row) => row.due_date || '—' },
    { key: 'overdue_days', header: 'Hari Telat', render: (row) => row.overdue_days > 0 ? <span className="text-red-600">{row.overdue_days} hari</span> : <span className="text-emerald-600">—</span> },
    { key: 'aging_bucket', header: 'Umur Piutang', render: (row) => <span className="text-[11px] px-2 py-0.5 bg-muted rounded">{bucketLabel[row.aging_bucket]}</span> },
    { key: 'payment_status', header: 'Status', render: (row) => <StatusBadge status={row.payment_status} /> },
  ];

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Laporan Piutang" description="Laporan piutang dengan aging analysis"
        actions={<div className="flex items-center gap-2"><Button onClick={exportCSV} size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" /> Export CSV</Button><PdfButton onExport={exportPDF} /></div>} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Total Piutang</div><div className="text-base font-bold mt-1 tabular-nums text-red-600">{fmtMoney(totalPiutang)}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Belum Jatuh Tempo</div><div className="text-base font-bold mt-1 tabular-nums text-emerald-600">{fmtMoney(belumJatuhTempo)}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Jatuh Tempo</div><div className="text-base font-bold mt-1 tabular-nums text-red-600">{fmtMoney(jatuhTempo)}</div></div>
        <div className="bg-white border border-border rounded-lg p-3"><div className="text-[11px] text-muted-foreground uppercase">Jumlah Invoice</div><div className="text-base font-bold mt-1 tabular-nums">{filtered.length}</div></div>
      </div>

      <div className="bg-white border border-border rounded-lg p-3 mb-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div>
          <Label className="text-[11px] mb-1">Customer</Label>
          <Select value={filters.customer_id} onValueChange={v => setFilters({ ...filters, customer_id: v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] mb-1">Status</Label>
          <Select value={filters.payment_status} onValueChange={v => setFilters({ ...filters, payment_status: v })}>
            <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Semua" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="belum_dibayar">Belum Dibayar</SelectItem>
              <SelectItem value="sebagian_dibayar">Sebagian Dibayar</SelectItem>
              <SelectItem value="jatuh_tempo">Jatuh Tempo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="Tidak ada piutang" searchKeys={['customer_name', 'invoice_number']} searchPlaceholder="Cari piutang..." />
    </div>
  );
}