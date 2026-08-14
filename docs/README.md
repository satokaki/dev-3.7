# LAB PRO — Panduan Operasi Aplikasi

> Dokumen ini adalah **knowledge base** untuk AI chatbot & panduan operasi bagi pengguna aplikasi LAB PRO.
> Aplikasi manajemen siklus produksi e-liquid: resep → produksi (premix/bulk) → botling → labeling → cukai → penjualan, plus inventaris, pembelian, piutang, dan HPP.

---

## 1. Gambaran Umum

LAB PRO mengelola siklus hidup lengkap produksi e-liquid:

- **Formulasi Resep** (premix & produk jadi)
- **Produksi** (mixing premix / bulk)
- **Pengemasan** (botling → labeling → cukai)
- **Inventaris** multi-status (bahan baku, bulk, siap labeling, belum cukai, siap jual)
- **Pembelian** (penerimaan barang, hutang supplier)
- **Penjualan** (invoice, piutang, pelunasan)
- **HPP** (perhitungan biaya per unit: bulk + botol + label + cukai + box)
- **Master Data** (merk, kategori, supplier, customer, bahan, barang, gudang)
- **Pengguna & Hak Akses** (undangan, role, permission granular)
- **Backup/Restore Database**

---

## 2. Klasifikasi Data (SANGAT PENTING)

### 2.1 Master Bahan (Material) vs Master Barang (Product)

| Aspek | Material (Master Bahan) | Product (Master Barang) |
|---|---|---|
| Definisi | Semua item yang **menyumbang HPP** | **Barang jadi** saja |
| Contoh | Essence, nicotine, PG, VG, botol kosong, label, sticker, pita cukai, box/kemasan, premix | E-liquid siap jual (per varian/ukuran) |
| Field kunci | `material_type` | `product_type` |

**Aturan emas:** Jika sebuah item berkontribusi ke biaya produksi (HPP), daftarkan sebagai **Material**. Product hanya untuk barang jadi yang dijual ke customer.

### 2.2 material_type (Material)

Enum `material_type` di Master Bahan:

| Nilai | Kegunaan |
|---|---|
| `RAW_MATERIAL` | Bahan baku umum (essence, PG, VG, nicotine, dll) |
| `PREMIX` | Bahan setengah jadi hasil mixing premix |
| `PACKAGING` | Kemasan luar (box, dus) |
| `LABEL` | Label produk |
| `STICKER` | Stiker/segel |
| `BOTTLE` | Botol kosong |
| `CONSUMABLE` | Bahan habis pakai non-produksi |
| `EXCISE` | **Pita cukai** (bahan baku untuk proses cukai) |
| `FINISHED_GOOD` | Barang jadi (jarang dipakai di Material) |

### 2.3 product_type (Product)

Enum `product_type` di Master Barang:

`bahan_baku`, `kemasan`, `botol_kosong`, `label`, `bulk_hasil_mixing`, `barang_siap_bottling`, `barang_siap_labeling`, `barang_belum_cukai`, `barang_siap_jual`, `barang_pendukung`

### 2.4 Kategori (Category)

Enum `category_type`: `bahan`, `barang`, `kemasan`, `label`, `cukai`, `produk_jadi`.

**Filter dinamis:** Saat menambah Material, daftar kategori yang muncul otomatis difilter sesuai `material_type` yang dipilih (mis. material_type=EXCISE → hanya kategori jenis `cukai`). Pastikan kategori sudah dibuat di Master Kategori dengan `category_type` yang sesuai sebelum menambah bahan.

Pemetaan material_type → category_type:
- `RAW_MATERIAL` / `PREMIX` / `CONSUMABLE` / `FINISHED_GOOD` → `bahan`
- `PACKAGING` → `kemasan`
- `LABEL` / `STICKER` → `label`
- `BOTTLE` → `kemasan` (atau sesuai operasi)
- `EXCISE` → `cukai`

---

## 3. Status Inventaris (StockBalance.inventory_status)

Setiap barang bisa berada di beberapa "stage" yang berbeda — stok dipisah per status agar tidak menumpuk di satu baris.

| Status | Arti | Asal |
|---|---|---|
| `RAW_MATERIAL` | Bahan baku siap pakai | Penerimaan pembelian |
| `BULK` | Hasil mixing (produk jadi belum dibotling) | Produksi FINISHED_PRODUCT |
| `READY_FOR_LABELING` | Botol berisi, belum dilabel | Proses Botling |
| `UNEXCISED` | Sudah dilabel, belum dicukai | Proses Labeling |
| `READY_FOR_SALE` | Sudah dicukai, siap jual | Proses Cukai |
| `QUARANTINE` | Karantina (QC hold) | Penyesuaian manual |
| `REJECTED` | Ditolak | Penyesuaian manual |

> Konsumsi bahan (Material) di proses produksi pakai `inventory_status = ''` (mengikuti balance hasil pembelian).

---

## 4. Alur Produksi Lengkap

```
Resep (PREMIX)                         Resep (FINISHED_PRODUCT)
     │                                       │
     ▼                                       ▼
 Produksi PREMIX                        Produksi FINISHED_PRODUCT
     │                                       │
     ▼                                       ▼
 Material PREMIX (stok)                 BULK (stok)
                                             │
                                             ▼
                                       Proses Botling  ←── botol kosong (Material BOTTLE)
                                             │
                                             ▼
                                       READY_FOR_LABELING
                                             │
                                             ▼
                                       Proses Labeling ←── label/sticker (Material LABEL/STICKER)
                                             │
                                             ▼
                                       UNEXCISED
                                             │
                                             ▼
                                       Proses Cukai  ←── pita cukai (Material EXCISE) + optional box (Material PACKAGING)
                                             │
                                             ▼
                                       READY_FOR_SALE
                                             │
                                             ▼
                                       Penjualan → Invoice → Piutang → Pelunasan
```

### 4.1 Produksi PREMIX
- Resep `recipe_type = PREMIX` menghasilkan **bahan baru** (Material dengan material_type=PREMIX).
- Wajib pilih `output_material_id` (bahan premix yang dihasilkan).
- Output masuk stok sebagai Material PREMIX.
- Premix ini bisa dipakai sebagai ingredient di resep lain.

### 4.2 Produksi FINISHED_PRODUCT
- Resep `recipe_type = FINISHED_PRODUCT` menghasilkan **BULK**.
- Output masuk stok Product dengan inventory_status `BULK`.
- Bahan baku & premix dikonsumsi dari stok.

### 4.3 Timbang Gramasi
- Saat proses produksi, operator menimbang aktual tiap ingredient.
- Sistem memvalidasi gram aktual vs standar resep.
- Selisih = waste (bisa direkam).

---

## 5. Penomoran Dokumen (Otomatis)

Dibangkitkan backend via `DocumentSequence` — field "Otomatis" read-only di UI.

| Prefix | Entitas | Format contoh |
|---|---|---|
| `PRD-` | ProductionOrder | PRD-YYYYMM-00001 |
| `BATCH-` | Batch produksi | BATCH-MMM-YYYYMMDD-001 |
| `EXC-` | ExciseOrder | EXC-... |
| `BTL-` | BottlingOrder | BTL-... |
| `LBL-` | LabelingOrder | LBL-... |
| `SLS-` | Sale | SLS-... |
| `PUR-` | Purchase | PUR-... |
| `CUS-` | Customer | CUS-YYYY-00001 |
| `BRG-` | Product | BRG-KAT-00001 |
| `BKP-` | DatabaseBackup | BKP-YYYYMMDD-00001 |

> Jangan input manual nomor dokumen — biarkan sistem generate. Jika gagal, cek tidak ada nomor yang dobel di database.

---

## 6. Perhitungan HPP

HPP per unit produk = akumulasi biaya tiap stage:

1. **Bulk cost** — biaya bahan baku + premix per ml (dari produksi)
2. **Botol cost** — biaya botol kosong per unit
3. **Label cost** — biaya label/stiker per unit
4. **Cukai cost** — biaya pita cukai per unit
5. **Box cost** — biaya kemasan luar per unit (opsional)

Setiap stage menelusuri biaya ke stok terkini (last_purchase_price / unit_cost). Lihat modul **HPP** untuk laporan rincian per produk.

---

## 7. Daftar Modul & Fungsi

| Modul | Path | Fungsi |
|---|---|---|
| Dashboard | `/` | KPI ringkasan operasi |
| Resep | `/recipes` | CRUD resep, ingredient, visibility, approval |
| Produksi | `/production` | Buat batch, timbang, posting stok |
| Botling | `/bottling` | BULK → botol berisi |
| Labeling | `/labeling` | Botol → dilabel (UNEXCISED) |
| Cukai | `/excise` | UNEXCISED → siap jual (pita cukai + box) |
| Penjualan | `/sales` | Invoice, piutang |
| Pembelian | `/purchases` | Penerimaan barang, hutang supplier |
| Pembayaran | `/payments` | Pelunasan piutang/hutang, alokasi |
| Kartu Stok | `/stock-card` | Balance & ledger per item/status |
| Laporan Penjualan | `/reports/sales` | |
| Laporan Piutang | `/reports/receivables` | |
| Laporan Inventaris | `/reports/inventory` | Ringkasan stok + estimasi nilai (admin) |
| Laporan Laba Rugi | `/reports/profit-loss` | Pendapatan vs HPP, laba kotor (admin) |
| Traceability | `/traceability` | Lacak batch bahan → produk jadi |
| HPP | `/hpp` | Rincian biaya per unit |
| Master Merk | `/master/brands` | |
| Master Kategori | `/master/categories` | |
| Master Supplier | `/master/suppliers` | |
| Master Customer | `/master/customers` | |
| Master Bahan | `/master/materials` | Material (bahan HPP) |
| Master Barang | `/master/products` | Product (barang jadi) |
| Master Gudang | `/master/warehouses` | |
| Pengguna | `/users` | Undang, role, permission |
| Pengaturan | `/settings` | Konfigurasi app |
| Database | `/database` | Backup, restore, reset |

---

## 8. Resep — Visibility & Approval

- `status`: `draft` → `review` → `approved` → `inactive`
- `visibility_type`:
  - `PUBLIC_INTERNAL` — semua user berizin (`recipe.view`) bisa lihat
  - `ADMIN_ONLY` — hanya admin (di-enforce RLS backend)
  - `ROLE_RESTRICTED` — role terpilih (`allowed_role_ids`)
- `is_hidden` — sembunyikan dari Brewer/non-admin di UI
- `allow_production_without_formula_view` — user boleh produksi tanpa lihat persentase formula (mode produksi terbatas)
- Soft-delete: resep dinonaktifkan (`inactive`), bukan dihapus, agar history transaksi utuh.
- `calculation_basis`: `W_W` (gram/total gram), `W_V` (gram/total volume), `V_V` (ml/total ml)

---

## 9. Pengguna, Role & Permission

- **Role:** `admin` | `user`
- User tidak bisa dibuat manual — hanya via **undangan** (admin mengundang email).
- Email di-normalisasi (trim + lowercase) sebelum lookup/undangan.
- Permission **granular per menu** (bukan grup role tetap).
- User yang belum punya record User (baru diundang) mengikuti permission dari `UserInvitation`.
- Login pertama mengikat `auth_user_id` ke undangan.

### 9.1 Row-Level Security (RLS)
- `Recipe`: read sesuai `visibility_type` (admin bypass).
- `DatabaseBackup`, `UserInvitation`: admin-only (read/create/update/delete).

---

## 10. Konvensi UI

- **NumberInput** — field numerik boleh kosong (tidak dipaksa 0). Ketik untuk isi, hapus untuk kosong.
- **Toast** — notifikasi auto-dismiss: success/info 3 detik, warning 4 detik, error 5 detik. Ada progress bar.
- **Field "Otomatis"** — read-only, diisi backend (penomoran dokumen).
- **Picker** — pencarian bahan/produk pakai search text; Enter tidak men-submit form.
- **Layout mobile** — single-column stack di layar kecil (hindari overflow horizontal).
- **Email** — selalu trim + lowercase.
- **Filter kategori** — dinamis sesuai material_type yang dipilih.

---

## 11. Database Management

Di modul `/database` (admin-only):
- **Backup** — ekspor JSON (operational / full). File di private storage, download via signed URL.
- **Restore** — dari file JSON hasil backup (divalidasi dulu).
- **Reset** — hapus data transaksional (hati-hati, tidak bisa undo).

> Backup disarankan rutin sebelum operasi besar. File backup tidak disimpan inline di entity (terlalu besar) — pakai `file_uri` + signed URL.

---

## 12. Quick Start Operasi (Urutan Setup Awal)

1. Master Gudang → buat gudang per jenis (bahan, bulk, siap labeling, belum cukai, jadi).
2. Master Merk → daftarkan merk produk.
3. Master Kategori → buat kategori per `category_type` (bahan, kemasan, label, cukai, produk_jadi).
4. Master Supplier & Customer.
5. Master Bahan → daftarkan semua bahan HPP (essence, PG/VG, nicotine, botol, label, pita cukai, box) dengan `material_type` & kategori sesuai.
6. Master Barang → daftarkan produk jadi (e-liquid per varian/ukuran).
7. Mapping komponen produk (bottle/box/label/excise) di Product Mapping.
8. Resep → buat resep premix & finished product, approve.
9. Produksi → jalankan batch.
10. Lanjut botling → labeling → cukai → jual.

---

Lihat juga: [FAQ](./FAQ.md) · [Troubleshooting](./TROUBLESHOOTING.md)