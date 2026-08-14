import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, ChevronsUpDown, Inbox } from 'lucide-react';

export default function DataTable({
  columns,
  data,
  loading,
  emptyMessage = 'Tidak ada data',
  onRowClick,
  pageSize = 10,
  searchable = true,
  searchPlaceholder = 'Cari...',
  searchKeys,
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);

  const filtered = useMemo(() => {
    let result = [...data];
    if (search && searchKeys) {
      const q = search.toLowerCase();
      result = result.filter(row =>
        searchKeys.some(key => {
          const val = key.split('.').reduce((obj, k) => obj?.[k], row);
          return String(val ?? '').toLowerCase().includes(q);
        })
      );
    }
    if (sortKey) {
      result.sort((a, b) => {
        const aVal = sortKey.split('.').reduce((obj, k) => obj?.[k], a);
        const bVal = sortKey.split('.').reduce((obj, k) => obj?.[k], b);
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === 'number') return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        return sortDir === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [data, search, searchKeys, sortKey, sortDir]);

  const pageCount = Math.ceil(filtered.length / rowsPerPage);
  const currentData = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      {searchable && (
        <div className="px-4 py-2.5 border-b border-border bg-muted/30">
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder={searchPlaceholder}
            className="w-full max-w-xs h-8 px-3 text-[12.5px] border border-border rounded-md outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap',
                    col.sortable && 'cursor-pointer hover:text-foreground select-none',
                    col.className
                  )}
                  style={col.width ? { width: col.width } : {}}
                  onClick={() => col.sortable && handleSort(col.sortKey || col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <span className="inline-flex flex-col">
                        {sortKey === (col.sortKey || col.key) ? (
                          sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 opacity-30" />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {columns.map((col, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <div className="h-3.5 bg-muted/60 rounded animate-pulse" style={{ width: '60%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : currentData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-12 text-center text-muted-foreground">
                  <Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <div className="text-[13px]">{emptyMessage}</div>
                </td>
              </tr>
            ) : (
              currentData.map((row, i) => (
                <tr
                  key={row.id || i}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    'border-b border-border/50 hover:bg-muted/30 transition-colors',
                    onRowClick && 'cursor-pointer'
                  )}
                >
                  {columns.map(col => (
                    <td key={col.key} className={cn('px-3 py-2.5 align-middle', col.className)}>
                      {col.render ? col.render(row) : (col.key.split('.').reduce((obj, k) => obj?.[k], row) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-border bg-muted/30 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Tampil</span>
            <select
              value={rowsPerPage}
              onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
              className="h-7 px-1.5 border border-border rounded bg-white text-[12px] outline-none focus:ring-1 focus:ring-ring cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-muted-foreground hidden sm:inline">
              {page * rowsPerPage + 1}–{Math.min((page + 1) * rowsPerPage, filtered.length)} dari {filtered.length}
            </span>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-2.5 py-1 border border-border rounded hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Sebelumnya
              </button>
              <span className="px-2.5 text-muted-foreground">Hal {page + 1}/{pageCount}</span>
              <button
                onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
                disabled={page >= pageCount - 1}
                className="px-2.5 py-1 border border-border rounded hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Berikutnya
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}