import React from 'react';
import { cn } from '@/lib/utils';

const statusColors = {
  // Recipe
  draft: 'bg-slate-100 text-slate-600',
  review: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-400',
  // Production
  menunggu_bahan: 'bg-amber-100 text-amber-700',
  siap_produksi: 'bg-blue-100 text-blue-700',
  sedang_diproses: 'bg-indigo-100 text-indigo-700',
  selesai_mixing: 'bg-cyan-100 text-cyan-700',
  siap_bottling: 'bg-violet-100 text-violet-700',
  dibatalkan: 'bg-red-100 text-red-600',
  // Bottling/Labeling/Excise
  selesai: 'bg-emerald-100 text-emerald-700',
  siap_labeling: 'bg-violet-100 text-violet-700',
  belum_cukai: 'bg-orange-100 text-orange-700',
  siap_jual: 'bg-emerald-100 text-emerald-700',
  diproses: 'bg-blue-100 text-blue-700',
  // Purchase status
  ordered: 'bg-indigo-100 text-indigo-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-cyan-100 text-cyan-700',
  // Sales
  posted: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-600',
  // Payment status
  belum_dibayar: 'bg-slate-100 text-slate-600',
  sebagian_dibayar: 'bg-amber-100 text-amber-700',
  lunas: 'bg-emerald-100 text-emerald-700',
  jatuh_tempo: 'bg-red-100 text-red-600',
};

const statusLabels = {
  draft: 'Draft',
  review: 'Review',
  approved: 'Approved',
  inactive: 'Inactive',
  menunggu_bahan: 'Menunggu Bahan',
  siap_produksi: 'Siap Produksi',
  sedang_diproses: 'Sedang Diproses',
  selesai_mixing: 'Selesai Mixing',
  siap_bottling: 'Siap Bottling',
  ordered: 'Ordered',
  partially_received: 'Diterima Sebagian',
  received: 'Diterima',
  dibatalkan: 'Dibatalkan',
  selesai: 'Selesai',
  siap_labeling: 'Siap Labeling',
  belum_cukai: 'Belum Cukai',
  siap_jual: 'Siap Jual',
  diproses: 'Diproses',
  posted: 'Posted',
  completed: 'Completed',
  cancelled: 'Cancelled',
  belum_dibayar: 'Belum Dibayar',
  sebagian_dibayar: 'Sebagian Dibayar',
  lunas: 'Lunas',
  jatuh_tempo: 'Jatuh Tempo',
};

export default function StatusBadge({ status, className }) {
  const color = statusColors[status] || 'bg-slate-100 text-slate-600';
  const label = statusLabels[status] || status;
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap', color, className)}>
      {label}
    </span>
  );
}