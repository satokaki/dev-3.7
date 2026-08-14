# Troubleshooting — LAB PRO

Panduan diagnosis masalah umum. Untuk AI chatbot: identifikasi gejala → arahkan ke solusi/modul terkait.

---

## 1. Master Data

### Kategori tidak muncul di form tambah bahan
**Gejala:** Dropdown Kategori kosong / placeholder saja.
**Penyebab:** Kategori dengan `category_type` yang cocok belum dibuat, ATAU material_type yang dipilih tidak punya kategori bertipe sesuai.
**Solusi:**
1. Cek `material_type` bahan yang dipilih (mis. EXCISE).
2. Buka Master Kategori → buat kategori dengan `category_type` yang dipetakan (EXCISE → `cukai`).
3. Kembali ke Master Bahan → kategori akan muncul (dropdown Select standar).
Lihat pemetaan di [README §2.4](./README.md#24-kategoriacategory).

### Pita cukai tidak muncul di proses Cukai
**Gejala:** Dropdown "Pita Cukai" kosong, helper "Belum ada bahan tipe Pita Cukai".
**Penyebab:** Belum ada Material dengan `material_type = EXCISE`.
**Solusi:** Master Bahan → tambah bahan pita cukai, set `material_type = EXCISE` + kategori jenis `cukai`. Lakukan pembelian agar ada stok.
> Proses cukai tetap jalan tanpa pita, tapi biaya cukai tidak masuk HPP.

### Botol kosong tidak muncul di Botling
**Gejala:** Pilihan botol kosong.
**Penyebab:** Tidak ada Material `material_type = BOTTLE` dengan stok > 0.
**Solusi:** Master Bahan → daftar botol (BOTTLE) → pembelian → stok masuk.

### Mapping komponen produk belum lengkap
**Gejala:** HPP nol / komponen tidak terdeteksi otomatis.
**Solusi:** Product Mapping Manager → isi mapping bottle/box/label/excise untuk produk. Set `is_default = true` untuk default.

---

## 2. Produksi

### Produksi gagal posting: stok bahan kurang
**Gejala:** Toast "Stok tidak cukup" saat posting.
**Solusi:** Cek Kartu Stok untuk bahan terkait. Lakukan pembelian atau penyesuaian stok. Produksi memerlukan stok `available_quantity > 0`.

### Produksi gagal: gramasi tidak match
**Gejala:** Validasi gram aktual vs standar gagal.
**Solusi:** Konfirmasi/timbang ulang. Selisih wajar direkam sebagai waste. Jika standar resep salah, edit resep (versi baru) → re-approve.

### Output produksi salah status inventaris
**Gejala:** Premix keluar sebagai BULK (atau sebaliknya).
**Solusi:** Pastikan `production_type` sesuai resep:
- Resep PREMIX → produksi PREMIX → output Material PREMIX.
- Resep FINISHED_PRODUCT → produksi FINISHED_PRODUCT → output BULK.
Jangan campur. Lihat [README §4](./README.md#4-alur-produksi-lengkap).

### PRD-00004 tidak bisa diposting
**Gejala:** Legacy record produksi tertentu diblokir.
**Status:** Known issue — data legacy bermasalah (double-division gramasi). Sengaja diblokir agar tidak korupsi stok/HPP. Jangan paksa posting.

---

## 3. Botling / Labeling / Cukai

### Botling: stok BULK tidak ditemukan
**Gejala:** Tidak ada produk BULK bisa dipilih.
**Solusi:** Jalankan produksi FINISHED_PRODUCT dulu agar ada BULK. Cek Kartu Stok status `BULK`.

### Labeling: tidak ada produk READY_FOR_LABELING
**Solusi:** Jalankan Botling dulu. Labeling butuh output botling (READY_FOR_LABELING).

### Cukai: stok pita cukai tidak cukup
**Gejala:** Toast "Stok pita cukai tidak cukup".
**Solusi:** Pembelian pita cukai (Material EXCISE). Atau proses tanpa pita (biarkan kosong).

### Cukai: box tidak muncul saat toggle on
**Solusi:** Pastikan ada Material `material_type = PACKAGING` dengan stok > 0.

---

## 4. Inventaris & Stok

### Stok barang dobel / negatif
**Gejala:** Saldo tidak masuk akal.
**Kemungkinan:**
- Stok dobel karena status inventaris tertumpuk → pastikan tiap perpindahan stage memakai `inventory_status` berbeda (net-0 antar stage).
- Stok negatif → data legacy atau saldo awal salah.
**Solusi:** Modul Stock Adjustment (penyesuaian) → koreksi balance + catat alasan di notes. Buat audit log.

### Kartu stok tidak menampilkan pergerakan
**Solusi:** Cek `StockLedger` via Kartu Stok. Setiap konsumsi/output harus ada ledger entry. Jika hilang, kemungkinan posting terputus di tengah — hubungi admin.

### Batch traceability putus
**Gejala:** Komponen premix tidak telusuri ke bahan baku.
**Solusi:** Pastikan produksi premix membuat `PremixBatchComponent` dengan `source_batch_id`. Jika produksi lama tidak rekam, traceability terbatas.

---

## 5. Penjualan & Piutang

### Produk tidak bisa dijual
**Gejala:** Produk tidak muncul di pilihan penjualan.
**Solusi:** Produk harus `READY_FOR_SALE` (sudah lewat Cukai). Cek status inventaris.

### Piutang tidak terbuat
**Solusi:** Pastikan invoice dibuat via modul Penjualan (bukan input manual). Piutang otomatis dari `Sale`.

### Pelunasan tidak mengurangi piutang
**Solusi:** Pakai modul Pembayaran dengan alokasi (`PaymentAllocation`) ke invoice spesifik. Pembayaran tanpa alokasi tidak menutup invoice.

### Limit piutang terlampaui
**Gejala:** Peringatan limit kredit.
**Solusi:** Naikkan `credit_limit` di Master Customer, atau minta pelunasan dulu sebelum transaksi baru.

---

## 6. Pembelian & Hutang

### Pembelian tidak menambah stok
**Solusi:** Pastikan item diterima (status `diterima`). Penerimaan trigger `purchase_receipt` di ledger. Cek Kartu Stok.

### Hutang supplier tidak muncul
**Solusi:** Hutang (`SupplierPayable`) otomatis dari penerimaan pembelian. Jika tidak ada, kemungkinan penerimaan belum diposting.

---

## 7. HPP

### HPP nol / tidak lengkap
**Solusi:**
1. Cek mapping komponen (bottle/label/excise/box) di Product Mapping.
2. Pastikan tiap komponen punya `unit_cost` / `last_purchase_price` di Master Bahan.
3. Pastikan produksi sudah posting (bulk cost tercatat).

### HPP terlalu tinggi / rendah
**Solusi:** Cek `unit_cost` bahan (mungkin harga pembelian terakhir salah). Koreksi di Master Bahan atau pembelian baru.

---

## 8. Pengguna & Akses

### User baru tidak bisa login
**Solusi:** Pastikan sudah diundang admin & email terverifikasi. Email case-insensitive (trim+lowercase). Jika "User Not Registered" → admin undang ulang.

### User tidak bisa lihat resep tertentu
**Solusi:** Cek `visibility_type` resep:
- `ADMIN_ONLY` → hanya admin.
- `ROLE_RESTRICTED` → tambahkan role user ke `allowed_role_ids`.
- `is_hidden = true` → butuh permission `recipe.hidden.view`.

### Permission menu tidak muncul
**Solusi:** Admin atur permission per menu di modul Pengguna. User tanpa record User ikut permission `UserInvitation`.

### "User Not Registered" error
**Penyebab:** Akun auth ada tapi belum diundang/terdaftar di app.
**Solusi:** Admin undang email yang sama via modul Pengguna.

---

## 9. Sistem & Database

### Nomor dokumen dobel / error generate
**Solusi:** Nomor otomatis dari `DocumentSequence`. Jika dobel, hapus duplikat manual via Database (admin) atau kontak support. Jangan input manual.

### Backup gagal
**Solusi:** Modul Database → cek status backup (`COMPLETED`/`FAILED`). Backup pakai JSON export ke private storage. Jika file terlalu besar, kurangi scope (operational, bukan full).

### Restore gagal
**Solusi:** File harus hasil backup valid (divalidasi dulu via `databaseValidateRestoreFile`). Schema version harus cocok.

### Reset database tidak bisa di-undo
**Peringatan:** Reset hapus data transaksional permanen. **SELALU backup dulu.**

### App lambat / loading lama
**Solusi:** Cek jumlah record (Material/Product/Sale bisa besar). Filter di backend, jangan load semua. Hindari loop `list()` tanpa limit.

### Toast/error muncul terus
**Solusi:** Toast auto-dismiss (3–5 detik). Jika error persist, baca pesan → arahkan ke root cause (bukan sekadar refresh).

---

## 10. UI / Tampilan

### Layout overflow horizontal di mobile
**Solusi:** Aplikasi single-column di layar kecil. Jika tabel lebar, scroll horizontal di tabel (bukan halaman). Laporkan jika halaman ikut scroll.

### Dropdown muncul di posisi salah
**Solusi:** Kategori & field utama sudah pakai Select standar (posisi tepat). Jika SearchableSelect (picker bahan) melayang jauh di modal, ini batasan Popover dalam modal scrollable — tetap berfungsi, pilih item yang muncul.

### Field "Otomatis" tidak bisa diisi
**Status:** Benar — read-only, diisi backend. Jangan dipaksa isi.

### Input angka paksa 0 / tidak bisa kosong
**Solusi:** NumberInput boleh kosong (hapus isi). Jika paksa 0, berarti bukan NumberInput — laporkan.

---

## 11. Quick Diagnostic Checklist

Saat user laporkan masalah, AI chatbot jalankan urutan ini:

1. **Identifikasi modul** dari gejala (lihat [README §7](./README.md#7-daftar-modul--fungsi)).
2. **Cek status data** terkait (stok, status inventaris, mapping, approval resep).
3. **Cek klasifikasi** (Material vs Product, material_type, category_type).
4. **Baca pesan toast** — biasanya sudah menyebut akar masalah.
5. **Arahkan ke modul/solusi** di dokumen ini.
6. Jika data legacy/known issue (PRD-00004, gramasi lama) → jangan dipaksa, arahkan ke admin.

---

## Known Issues (Tetap Ada)

| Issue | Status | Tindakan |
|---|---|---|
| PRD-00004 diblokir posting | Known — data legacy | Jangan paksa posting |
| Gramasi legacy double-division | Mitigated — validasi baru | Pakai record baru |
| Stok dobel stage lama | Staged audit | Koreksi via Stock Adjustment |

---

Lihat juga: [README](./README.md) · [FAQ](./FAQ.md)