# 💧 Sistem Depot Air Minum

Sistem Depot Air Minum adalah aplikasi berbasis web untuk membantu pengelolaan **penjualan, penerimaan kas, piutang, penyerahan barang, pelanggan, katalog produk, serta bahan persediaan dan perhitungan Harga Pokok Penjualan (HPP)** pada usaha depot air minum.

Aplikasi menggunakan **HTML, CSS, dan JavaScript** pada frontend serta **Supabase PostgreSQL** (termasuk **Supabase Auth**, **Realtime**, **Database Triggers**, **Views**, dan **RPC**) sebagai backend.

🔗 **Demo:**
[https://cahayakamila44-sudo.github.io/Aplikasi-Sistem-Depot-Air/](https://cahayakamila44-sudo.github.io/Aplikasi-Sistem-Depot-Air/)

Username: cahayakamila77

Password: 654321

---

## Teknologi

| **Bagian**      | **Teknologi**                                                      |
| --------------- | ------------------------------------------------------------------ |
| Frontend        | HTML, CSS, JavaScript murni (tanpa framework)                      |
| Backend         | [Supabase](https://supabase.com/) (PostgreSQL, Auth, Realtime)     |
| Koneksi         | `supabase-js` v2 melalui CDN                                       |
| Konfigurasi     | `config.js` untuk konfigurasi koneksi Supabase & autentikasi       |
| Logika Aplikasi | `apps.js` untuk menjalankan fungsi utama sistem                    |
| Tampilan        | CSS custom dan ikon [Font Awesome](https://fontawesome.com/) 6.5.2 |
| Hosting         | [GitHub Pages](https://pages.github.com/)                          |

---

## Fitur

| **Menu / Modul**      | **Isi & Fungsi Utama**                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**         | Ringkasan total pelanggan, total transaksi, total penjualan, total penerimaan kas, sisa piutang, laba transaksi, serta pemantauan stok bahan/produk secara *realtime*               |
| **Penjualan**         | Form transaksi penjualan (Tunai/Kredit), pemilihan produk (`isi_ulang` / `pabrikan`), perhitungan otomatis total penjualan, `total_hpp`, `laba`, status pembayaran, dan penyerahan  |
| **Penerimaan Kas**    | Pencatatan pembayaran tunai otomatis maupun cicilan/pelunasan piutang melalui fungsi atomik `fn_catat_penerimaan` (Tunai, Transfer, QRIS) dengan sinkronisasi status otomatis       |
| **Piutang**           | Pemantauan daftar transaksi `Belum Lunas`, total tagihan, total dibayar, dan `sisa_piutang` melalui database view `v_piutang`                                                       |
| **Penyerahan Barang** | Pelacakan status distribusi barang (`Belum Diserahkan` / `Sudah Sampai`) beserta status pelunasannya melalui database view `v_penyerahan_barang`                                   |
| **Persediaan & HPP**  | Pengelolaan **Bahan Persediaan** (stok masuk/kulakan rata-rata tertimbang via `fn_catat_kulakan`), **Katalog Produk**, dan **Komposisi Resep** dengan pembaruan HPP otomatis        |

---

### Alur Penjualan & Perhitungan HPP

Proses transaksi penjualan dimulai dari ketersediaan bahan baku/produk pabrikan yang dirangkai dalam komposisi produk, kemudian dicatat pada transaksi penjualan hingga pelunasan kas dan penyerahan barang.
