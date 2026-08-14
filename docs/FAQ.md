# FAQ — LAB PRO

Pertanyaan yang sering diajukan pengguna. Untuk AI chatbot, jawab dengan ringkas & arahkan ke modul yang relevan.

---

## Master Data

### Q: Pita cukai dimasukkan ke Master Bahan atau Master Barang?
**A:** **Master Bahan**, dengan `material_type = EXCISE`. Pita cukai adalah bahan baku yang berkontribusi ke HPP. Master Barang (Product) hanya untuk barang jadi yang dijual.

### Q: Botol kosong, label, sticker, box masuk mana?
**A:** Semua ke **Master Bahan**:
- Botol kosong → `material_type = BOTTLE`
- Label → `material_type = LABEL`
- Stiker/segel → `material_type = STICKER`
- Box/kemasan luar → `material_type = PACKAGING`

### Q: Produk jadi (e-liquid siap jual) masuk mana?
**A:** **Master Barang (Product)**, dengan `product_type = barang_siap_jual` (atau tipe staging lain sesuai posisi inventaris).

### Q: Kenapa kategori tidak muncul saat tambah bahan?
**A:** Kategori difilter dinamis sesuai `material_type`. Pastikan sudah membuat kategori di Master Kategori dengan `category_type` yang cocok (mis. untuk bahan EXCISE → buat kategori jenis `cukai`). Lihat tabel pemetaan di [README §2.4](./README.md#24-kategoriacategory).

### Q: Premix itu apa?
**A:** Bahan setengah jadi hasil mixing (resep `recipe_type = PREMIX`). Output-nya jadi Material baru (`material_type = PREMIX`) yang bisa dipakai sebagai ingredient resep lain.

### Q: Bisa hapus resep/bahan/kategori?
**A:** Resep: tidak dihapus, dinonaktifkan (`status = inactive`) agar history transaksi utuh. Bahan/kategori: soft-delete via `is_active = false`.

---

## Produksi

### Q: Beda produksi PREMIX vs FINISHED_PRODUCT?
**A:**
- **PREMIX** → menghasilkan bahan baru (Material PREMIX) untuk dipakai resep lain.
- **FINISHED_PRODUCT** → menghasilkan BULK (produk jadi belum dibotling).

### Q: Apa itu timbang gramasi?
**A:** Saat produksi, operator menimbang aktual tiap ingredient. Sistem membandingkan dengan standar resep. Selisih direkam sebagai waste.

### Q: Kenapa produksi gagal posting?
**A:** Kemungkinan: (1) stok bahan baku/premix kurang, (2) gram aktual tidak match standar & belum dikonfirmasi, (3) legacy record PRD-00004 sengaja diblokir (data lama bermasalah). Cek pesan toast.

### Q: Output produksi masuk ke status inventaris apa?
**A:** PREMIX → Material PREMIX. FINISHED_PRODUCT → Product `BULK`. Lihat [README §3](./README.md#3-status-inventaris-stockbalanceinventory_status).

---

## Botling, Labeling, Cukai

### Q: Urutan proses setelah produksi?
**A:** Botling → Labeling → Cukai → Jual. Lihat diagram alur [README §4](./README.md#4-alur-produksi-lengkap).

### Q: Di Botling, botol kosong diambil dari mana?
**A:** Dari stok Master Bahan `material_type = BOTTILE`. Sistem mengurangi stok botol otomatis sesuai jumlah botol.

### Q: Di Cukai, box wajib?
**A:** Tidak. Box (kemasan luar) opsional — toggle "Proses Lanjutan: Gunakan Box". Jika dipakai, pilih bahan `material_type = PACKAGING`.

### Q: Cukai tanpa pita cukai bisa?
**A:** Bisa. Jika belum ada bahan EXCISE, proses tetap jalan tanpa konsumsi stok pita. Tapi biaya cukai tidak masuk HPP.

---

## Inventaris & Stok

### Q: Kenapa satu barang punya beberapa baris stok?
**A:** Karena stok dipisah per `inventory_status` (RAW_MATERIAL, BULK, READY_FOR_LABELING, UNEXCISED, READY_FOR_SALE). Ini mencegah stok ganda & membedakan stage barang yang sama. Lihat [README §3](./README.md#3-status-inventaris-stockbalanceinventory_status).

### Q: Cara lacak asal bahan suatu batch produk?
**A:** Modul **Traceability** (`/traceability`). Menelusuri komponen premix → bahan baku → supplier.

### Q: Stok negatif bisa?
**A:** Tidak. Sistem memvalidasi sebelum konsumsi. Jika terjadi, kemungkinan data legacy atau saldo awal salah — lakukan Stock Adjustment.

---

## Penjualan & Piutang

### Q: Cara catat penjualan?
**A:** Modul Penjualan (`/sales`): pilih produk READY_FOR_SALE, customer, qty → buat invoice → otomatis jadi piutang.

### Q: Cara catat pelunasan piutang?
**A:** Modul Pembayaran (`/payments`): pilih invoice/customer → input diterima → alokasi ke invoice. Bisa pelunasan penuh/sebagian.

### Q: Limit piutang customer dicek?
**A:** Ya, ada `credit_limit` di Master Customer. Sistem memberi peringatan jika melebihi.

---

## Pembelian & Hutang

### Q: Pembelian bisa untuk bahan & barang?
**A:** Ya, picker pembelian mencakup Material & Product. Penerimaan menambah stok sesuai jenis.

### Q: Hutang supplier otomatis?
**A:** Ya, setiap penerimaan pembelian membuat `SupplierPayable`. Pelunasan di modul Pembayaran.

---

## HPP

### Q: HPP dihitung dari apa?
**A:** Akumulasi: bulk cost + botol + label + cukai + box (jika ada). Per unit produk. Lihat [README §6](./README.md#6-perhitungan-hpp).

### Q: Kenapa HPP satu produk nol?
**A:** Biasanya karena mapping komponen belum diisi (bottle/label/excise/box) atau stok terkait belum punya unit_cost. Lengkapi mapping di Product Mapping Manager.

---

## Pengguna & Akses

### Q: Cara tambah user?
**A:** Admin undang via modul Pengguna (`base44.users.inviteUser(email, role)`). User tidak bisa dibuat manual. Email harus trim + lowercase.

### Q: User baru belum punya hak akses?
**A:** User yang baru diundang & belum punya record User mengikuti permission dari `UserInvitation`. Setelah login pertama, permission bisa disesuaikan.

### Q: Resep tidak muncul untuk brewer?
**A:** Kemungkinan resep `visibility_type = ADMIN_ONLY` atau `is_hidden = true`, atau role user tidak ada di `allowed_role_ids`. Admin bisa atur.

---

## Sistem & Database

### Q: Nomor dokumen bisa diinput manual?
**A:** Tidak. Otomatis dari backend (`DocumentSequence`). Field "Otomatis" read-only.

### Q: Cara backup data?
**A:** Modul Database (`/database`, admin-only) → Backup. File JSON di private storage, download via link signed.

### Q: Reset database bisa di-undo?
**A:** Tidak. Backup dulu sebelum reset.

### Q: Kenapa notifikasi (toast) hilang sendiri?
**A:** Memang auto-dismiss: success/info 3 detik, warning 4 detik, error 5 detik.

### Q: Field angka tidak bisa dikosongkan?
**A:** Bisa. NumberInput dirancang boleh kosong (string state) — hapus isinya. Tidak akan dipaksa jadi 0.

---

## UI/UX

### Q: Di mobile layout berantakan / overflow?
**A:** Aplikasi single-column di layar kecil. Jika ada overflow horizontal, laporkan — kemungkinan tabel terlalu lebar (scroll horizontal tabel, bukan halaman).

### Q: Dropdown kategori muncul jauh dari fieldnya?
**A:** Sudah diperbaiki — kategori sekarang pakai Select standar (muncul tepat di bawah trigger). Pastikan kategori dengan `category_type` sesuai sudah dibuat.

---

Lihat juga: [README](./README.md) · [Troubleshooting](./TROUBLESHOOTING.md)