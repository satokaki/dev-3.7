import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Wallet,
  TrendingDown,
  CalendarDays,
  FileText,
  Search,
  ReceiptText,
  AlertTriangle,
  X,
  Loader2,
  RefreshCw,
  Database,
  Pencil,
  Trash2,
  Save,
  Ban,
} from "lucide-react";

const COST_TYPES = [
  {
    value: "COST",
    label: "Biaya",
    title: "Biaya Operasional",
  },
  {
    value: "LOSS",
    label: "Loss",
    title: "Loss / Kerugian",
  },
];

const COST_CATEGORIES = [
  { value: "UTILITY", label: "Listrik & Air" },
  { value: "MAINTENANCE", label: "Pemeliharaan" },
  { value: "LABOR", label: "Tenaga Kerja" },
  { value: "TRANSPORT", label: "Transportasi" },
  { value: "RENT", label: "Sewa" },
  { value: "SUPPLIES", label: "Perlengkapan" },
  { value: "ADMINISTRATION", label: "Administrasi" },
  { value: "OTHER", label: "Lainnya" },
];

const LOSS_CATEGORIES = [
  { value: "PRODUCTION_LOSS", label: "Loss Produksi" },
  { value: "INVENTORY_LOSS", label: "Selisih / Loss Inventaris" },
  { value: "DAMAGE", label: "Barang Rusak" },
  { value: "EXPIRED", label: "Expired" },
  { value: "MISSING", label: "Barang Hilang" },
  { value: "OTHER", label: "Lainnya" },
];

const ALL_CATEGORIES = [
  ...COST_CATEGORIES,
  ...LOSS_CATEGORIES,
];

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatNumber(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDisplayDate(value) {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function generateOperationalCostCode() {
  const now = new Date();

  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  const timePart = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const random = Math.floor(
    100 + Math.random() * 900
  );

  return `OC-${datePart}-${timePart}-${random}`;
}

function mapOperationalCost(row) {
  return {
    id: row.id,
    code: row.code || "",
    costDate: row.cost_date || "",
    costType: row.cost_type || "COST",
    category: row.category || "OTHER",
    description: row.description || "",
    amount: Number(row.amount || 0),
    notes: row.notes || "",
    status: row.status || "ACTIVE",
    sourceType: row.source_type || "MANUAL",
    sourceId: row.source_id || "",
  };
}

export default function OperationalCost() {
  const { toast } = useToast();

  const today =
    new Date().toISOString().split("T")[0];

  const emptyForm = {
    costDate: today,
    costType: "COST",
    category: "UTILITY",
    description: "",
    amount: "",
    notes: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState([]);

  const [filters, setFilters] = useState({
    search: "",
    type: "ALL",
  });

  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] =
    useState(null);
  const [loadError, setLoadError] = useState("");

  const availableCategories =
    form.costType === "LOSS"
      ? LOSS_CATEGORIES
      : COST_CATEGORIES;

  const loadOperationalCosts = async () => {
    setLoading(true);
    setLoadError("");

    try {
      const rows =
        await base44.entities.OperationalCost.list(
          "-cost_date",
          1000
        );

      const mapped = (rows || [])
        .map(mapOperationalCost)
        .filter(
          item =>
            String(item.status || "")
              .toUpperCase() !== "VOID"
        );

      setItems(mapped);
    } catch (error) {
      console.error(
        "OperationalCost load error:",
        error
      );

      setLoadError(
        "Data Cost & Loss gagal dimuat."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOperationalCosts();
  }, []);

  const totalCost = useMemo(
    () =>
      items
        .filter(item => item.costType === "COST")
        .reduce(
          (sum, item) =>
            sum + Number(item.amount || 0),
          0
        ),
    [items]
  );

  const totalLoss = useMemo(
    () =>
      items
        .filter(item => item.costType === "LOSS")
        .reduce(
          (sum, item) =>
            sum + Number(item.amount || 0),
          0
        ),
    [items]
  );

  const totalOperational =
    totalCost + totalLoss;

  const filteredItems = useMemo(() => {
    const keyword =
      filters.search.trim().toLowerCase();

    return items.filter(item => {
      const matchesType =
        filters.type === "ALL" ||
        item.costType === filters.type;

      const categoryLabel =
        ALL_CATEGORIES.find(
          category =>
            category.value === item.category
        )?.label || item.category;

      const matchesSearch =
        !keyword ||
        (item.code || "")
          .toLowerCase()
          .includes(keyword) ||
        (item.description || "")
          .toLowerCase()
          .includes(keyword) ||
        (item.notes || "")
          .toLowerCase()
          .includes(keyword) ||
        categoryLabel
          .toLowerCase()
          .includes(keyword);

      return matchesType && matchesSearch;
    });
  }, [items, filters]);

  const resetForm = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      costDate:
        new Date().toISOString().split("T")[0],
    });
  };

  const handleTypeChange = type => {
    const categories =
      type === "LOSS"
        ? LOSS_CATEGORIES
        : COST_CATEGORIES;

    setForm(current => ({
      ...current,
      costType: type,
      category: categories[0].value,
    }));
  };

  const handleAmountChange = event => {
    const raw =
      event.target.value.replace(/\D/g, "");

    setForm(current => ({
      ...current,
      amount: raw,
    }));
  };

  const handleEdit = item => {
    setEditing(item);

    setForm({
      costDate: item.costDate,
      costType: item.costType,
      category: item.category,
      description: item.description,
      amount: String(item.amount || ""),
      notes: item.notes || "",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleSubmit = async () => {
    if (saving) return;

    if (!form.costDate) {
      toast({
        variant: "destructive",
        title: "Tanggal wajib diisi",
      });
      return;
    }

    if (!form.description.trim()) {
      toast({
        variant: "destructive",
        title: "Keterangan wajib diisi",
      });
      return;
    }

    if (
      !form.amount ||
      Number(form.amount) <= 0
    ) {
      toast({
        variant: "destructive",
        title: "Jumlah harus lebih dari 0",
      });
      return;
    }

    setSaving(true);

    try {
      const payload = {
        cost_date: form.costDate,
        cost_type: form.costType,
        category: form.category,
        description: form.description.trim(),
        amount: Number(form.amount),
        notes: form.notes.trim(),
        status: "ACTIVE",
        source_type:
          editing?.sourceType || "MANUAL",
        source_id:
          editing?.sourceId || "",
      };

      if (editing) {
        await base44.entities.OperationalCost.update(
          editing.id,
          payload
        );

        toast({
          title: "Transaksi diperbarui",
          description:
            "Perubahan langsung digunakan pada laporan laba rugi.",
        });
      } else {
        await base44.entities.OperationalCost.create({
          ...payload,
          code:
            generateOperationalCostCode(),
        });

        toast({
          title: "Transaksi tersimpan",
          description:
            "Cost & Loss berhasil disimpan ke database.",
        });
      }

      resetForm();
      await loadOperationalCosts();
    } catch (error) {
      console.error(
        "OperationalCost save error:",
        error
      );

      toast({
        variant: "destructive",
        title: editing
          ? "Gagal memperbarui transaksi"
          : "Gagal menyimpan transaksi",
        description:
          error?.message ||
          "Terjadi kesalahan saat menyimpan.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async item => {
    const confirmed = window.confirm(
      `Hapus transaksi "${item.description}"?\n\n` +
        "Data akan dinonaktifkan (VOID), bukan dihapus permanen."
    );

    if (!confirmed) return;

    setActionLoading(item.id);

    try {
      await base44.entities.OperationalCost.update(
        item.id,
        {
          status: "VOID",
        }
      );

      if (editing?.id === item.id) {
        resetForm();
      }

      setItems(current =>
        current.filter(row => row.id !== item.id)
      );

      toast({
        title: "Transaksi dihapus",
        description:
          "Record disimpan sebagai VOID dan tidak dihitung pada laba rugi.",
      });
    } catch (error) {
      console.error(
        "OperationalCost void error:",
        error
      );

      toast({
        variant: "destructive",
        title: "Gagal menghapus transaksi",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const getTypeLabel = value =>
    COST_TYPES.find(
      item => item.value === value
    )?.title || value;

  const getCategoryLabel = value =>
    ALL_CATEGORIES.find(
      item => item.value === value
    )?.label || value;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Cost & Loss"
        subtitle="Catat biaya dan kerugian operasional dengan sederhana"
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">
                Biaya Operasional
              </p>

              <p className="text-2xl font-bold mt-2 tabular-nums">
                {formatCurrency(totalCost)}
              </p>

              <p className="text-xs text-slate-400 mt-2">
                Pengeluaran operasional
              </p>
            </div>

            <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-indigo-600" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">
                Loss / Kerugian
              </p>

              <p className="text-2xl font-bold mt-2 tabular-nums">
                {formatCurrency(totalLoss)}
              </p>

              <p className="text-xs text-slate-400 mt-2">
                Kerugian di luar biaya normal
              </p>
            </div>

            <div className="w-11 h-11 rounded-xl bg-rose-50 flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-rose-600" />
            </div>
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-1 bg-slate-900 rounded-2xl p-5 text-white shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-300">
                Total Cost & Loss
              </p>

              <p className="text-2xl font-bold mt-2 tabular-nums">
                {formatCurrency(totalOperational)}
              </p>

              <p className="text-xs text-slate-400 mt-2">
                Total pengurang laba
              </p>
            </div>

            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
              <ReceiptText className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[380px_minmax(0,1fr)] gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm h-fit">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="font-semibold text-lg">
                {editing
                  ? "Edit Transaksi"
                  : "Tambah Transaksi"}
              </h2>

              <p className="text-sm text-slate-500 mt-1">
                {editing
                  ? `Mengubah ${editing.code || "transaksi"}`
                  : "Catat biaya atau kerugian operasional."}
              </p>
            </div>

            {editing && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={resetForm}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="space-y-5">
            <div>
              <Label className="mb-2 block">
                Jenis
              </Label>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    handleTypeChange("COST")
                  }
                  className={`text-left rounded-xl border p-3 transition ${
                    form.costType === "COST"
                      ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Wallet className="w-4 h-4 mb-2 text-indigo-600" />
                  <span className="font-semibold text-sm">
                    Biaya
                  </span>
                  <p className="text-xs text-slate-500 mt-1">
                    Pengeluaran usaha
                  </p>
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    handleTypeChange("LOSS")
                  }
                  className={`text-left rounded-xl border p-3 transition ${
                    form.costType === "LOSS"
                      ? "border-rose-500 bg-rose-50 ring-1 ring-rose-500"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <TrendingDown className="w-4 h-4 mb-2 text-rose-600" />
                  <span className="font-semibold text-sm">
                    Loss
                  </span>
                  <p className="text-xs text-slate-500 mt-1">
                    Rusak, hilang, expired
                  </p>
                </button>
              </div>
            </div>

            <div>
              <Label>Tanggal</Label>
              <Input
                type="date"
                value={form.costDate}
                disabled={saving}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    costDate:
                      event.target.value,
                  }))
                }
                className="mt-1.5"
              />
            </div>

            <div>
              <Label>Kategori</Label>

              <Select
                value={form.category}
                disabled={saving}
                onValueChange={value =>
                  setForm(current => ({
                    ...current,
                    category: value,
                  }))
                }
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {availableCategories.map(
                    item => (
                      <SelectItem
                        key={item.value}
                        value={item.value}
                      >
                        {item.label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Keterangan</Label>

              <Textarea
                value={form.description}
                disabled={saving}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    description:
                      event.target.value,
                  }))
                }
                rows={3}
                className="mt-1.5 resize-none"
              />
            </div>

            <div>
              <Label>Jumlah</Label>

              <div className="mt-1.5 flex border border-slate-200 rounded-lg overflow-hidden">
                <span className="px-3 flex items-center border-r text-sm text-slate-500">
                  Rp
                </span>

                <input
                  type="text"
                  inputMode="numeric"
                  value={formatNumber(
                    form.amount
                  )}
                  disabled={saving}
                  onChange={handleAmountChange}
                  className="w-full px-3 py-2 outline-none font-semibold tabular-nums"
                />
              </div>
            </div>

            <div>
              <Label>
                Catatan{" "}
                <span className="text-slate-400 font-normal">
                  (opsional)
                </span>
              </Label>

              <Textarea
                value={form.notes}
                disabled={saving}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    notes:
                      event.target.value,
                  }))
                }
                rows={2}
                className="mt-1.5 resize-none"
              />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="w-full gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Menyimpan...
                </>
              ) : editing ? (
                <>
                  <Save className="w-4 h-4" />
                  Simpan Perubahan
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Simpan{" "}
                  {form.costType === "COST"
                    ? "Biaya"
                    : "Loss"}
                </>
              )}
            </Button>

            {editing && (
              <Button
                type="button"
                variant="outline"
                onClick={resetForm}
                disabled={saving}
                className="w-full gap-2"
              >
                <Ban className="w-4 h-4" />
                Batal Edit
              </Button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm min-w-0">
          <div className="px-5 sm:px-6 py-5 border-b">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
              <div>
                <h2 className="font-semibold text-lg">
                  Riwayat Cost & Loss
                </h2>

                <p className="text-sm text-slate-500 mt-1">
                  {loading
                    ? "Memuat data..."
                    : `${items.length} transaksi aktif`}
                </p>
              </div>

              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

                  <Input
                    value={filters.search}
                    onChange={event =>
                      setFilters(current => ({
                        ...current,
                        search:
                          event.target.value,
                      }))
                    }
                    placeholder="Cari transaksi..."
                    className="pl-9"
                  />
                </div>

                <Select
                  value={filters.type}
                  onValueChange={value =>
                    setFilters(current => ({
                      ...current,
                      type: value,
                    }))
                  }
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="ALL">
                      Semua
                    </SelectItem>
                    <SelectItem value="COST">
                      Biaya
                    </SelectItem>
                    <SelectItem value="LOSS">
                      Loss
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="icon"
                  onClick={
                    loadOperationalCosts
                  }
                  disabled={loading}
                >
                  <RefreshCw
                    className={`w-4 h-4 ${
                      loading
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                </Button>
              </div>
            </div>
          </div>

          {loadError ? (
            <div className="py-16 text-center">
              <AlertTriangle className="w-8 h-8 mx-auto text-rose-500" />
              <p className="mt-3">
                {loadError}
              </p>
            </div>
          ) : loading ? (
            <div className="py-20 text-center">
              <Loader2 className="w-7 h-7 animate-spin mx-auto text-slate-400" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-20 text-center">
              <FileText className="w-8 h-8 mx-auto text-slate-300" />
              <p className="mt-3 text-slate-500">
                Belum ada transaksi
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr className="text-left text-slate-500">
                    <th className="px-4 py-3">
                      Tanggal
                    </th>
                    <th className="px-4 py-3">
                      Jenis
                    </th>
                    <th className="px-4 py-3">
                      Kategori
                    </th>
                    <th className="px-4 py-3">
                      Keterangan
                    </th>
                    <th className="px-4 py-3 text-right">
                      Jumlah
                    </th>
                    <th className="px-4 py-3 text-center">
                      Aksi
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {filteredItems.map(item => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="w-4 h-4 text-slate-400" />
                          {formatDisplayDate(
                            item.costDate
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                            item.costType ===
                            "COST"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {getTypeLabel(
                            item.costType
                          )}
                        </span>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        {getCategoryLabel(
                          item.category
                        )}
                      </td>

                      <td className="px-4 py-3 min-w-[220px]">
                        <p className="font-medium">
                          {item.description}
                        </p>

                        {item.code && (
                          <p className="text-[11px] text-slate-400 font-mono mt-1">
                            {item.code}
                          </p>
                        )}

                        {item.notes && (
                          <p className="text-xs text-slate-400 mt-1">
                            {item.notes}
                          </p>
                        )}
                      </td>

                      <td
                        className={`px-4 py-3 text-right font-bold tabular-nums ${
                          item.costType ===
                          "LOSS"
                            ? "text-rose-600"
                            : ""
                        }`}
                      >
                        {formatCurrency(
                          item.amount
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() =>
                              handleEdit(item)
                            }
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>

                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            disabled={
                              actionLoading ===
                              item.id
                            }
                            className="h-8 w-8 text-red-600 hover:text-red-700"
                            onClick={() =>
                              handleVoid(item)
                            }
                          >
                            {actionLoading ===
                            item.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex gap-3">
          <Database className="w-5 h-5 text-emerald-600 shrink-0" />

          <p className="text-sm text-emerald-800">
            <strong>
              Cost & Loss Database Active
            </strong>
            {" — "}
            transaksi ACTIVE otomatis menjadi
            pengurang pada laporan laba rugi.
            Transaksi VOID tidak dihitung.
          </p>
        </div>
      </div>
    </div>
  );
}