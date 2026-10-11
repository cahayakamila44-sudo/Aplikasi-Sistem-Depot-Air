# 💧 Sistem Depot Air Minum

Sistem Depot Air Minum adalah aplikasi berbasis web untuk membantu pengelolaan **penjualan, penerimaan kas, pelanggan, dan persediaan** pada usaha depot air minum.

Aplikasi menggunakan **HTML, CSS, dan JavaScript** pada frontend serta **Supabase PostgreSQL** sebagai database.

🔗 **Demo:**
[https://cahayakamila44-sudo.github.io/Aplikasi-Sistem-Depot-Air/](https://cahayakamila44-sudo.github.io/Aplikasi-Sistem-Depot-Air/)

## Teknologi

| **Bagian**      | **Teknologi**                                                      |
| --------------- | ------------------------------------------------------------------ |
| Frontend        | HTML, CSS, JavaScript murni (tanpa framework)                      |
| Backend         | [Supabase](https://supabase.com/) (PostgreSQL)                     |
| Koneksi         | `supabase-js` v2 melalui CDN                                       |
| Konfigurasi     | `config.js` untuk konfigurasi koneksi Supabase                     |
| Logika Aplikasi | `apps.js` untuk menjalankan fungsi utama sistem                    |
| Tampilan        | CSS custom dan ikon [Font Awesome](https://fontawesome.com/) 6.5.2 |
| Hosting         | [GitHub Pages](https://pages.github.com/)                          |

## Fitur

| **Menu**           | **Isi**                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**      | Total pelanggan, total transaksi, total penjualan, total penerimaan kas, dan total stok galon                                          |
| **Penjualan**      | Form transaksi penjualan, data pelanggan, pemilihan barang, jumlah galon, harga per galon, total transaksi, status, dan data penjualan |
| **Penerimaan Kas** | Pencatatan pembayaran berdasarkan transaksi penjualan, tanggal penerimaan, jumlah diterima, serta metode pembayaran                    |
| **Persediaan**     | Pengelolaan nama barang, stok, harga per galon, satuan, tanggal pembaruan, dan data persediaan                                         |

### Alur Penjualan

Proses transaksi penjualan dimulai dengan memilih barang dari persediaan dan memasukkan data pelanggan.

```
Persediaan
    │
    ▼
Pelanggan
    │
    ▼
Penjualan
    │
    ▼
Penerimaan Kas
```

Data penjualan meliputi:

- Nama pelanggan
- Nomor HP
- Alamat
- Barang/persediaan
- Tanggal penjualan
- Jumlah galon
- Harga per galon
- Total transaksi
- Status transaksi

Harga per galon ditampilkan berdasarkan barang/persediaan yang dipilih.

## Penerimaan Kas

Penerimaan kas dicatat berdasarkan transaksi penjualan yang telah dibuat.

| **Data**            | **Keterangan**                              |
| ------------------- | ------------------------------------------- |
| Transaksi Penjualan | Transaksi yang menjadi dasar penerimaan kas |
| Tanggal Penerimaan  | Tanggal pembayaran diterima                 |
| Jumlah Diterima     | Nominal pembayaran dari transaksi           |
| Metode Pembayaran   | Tunai, Transfer, atau QRIS                  |

### Metode Pembayaran

```
                 ┌──▶ Tunai
Penjualan ──▶ Pembayaran ──▶ Transfer
                 └──▶ QRIS
```

Jumlah pembayaran pada form penerimaan kas berasal dari transaksi penjualan yang dipilih.

## Persediaan

Persediaan digunakan untuk menyimpan informasi barang yang tersedia pada depot air minum.

| **Data**            | **Keterangan**                                |
| ------------------- | --------------------------------------------- |
| Nama Barang         | Nama barang yang tersedia                     |
| Stok                | Jumlah persediaan yang tersedia               |
| Harga/Galon         | Harga barang per galon                        |
| Satuan              | Satuan barang, misalnya `Galon`               |
| Terakhir Diperbarui | Informasi waktu terakhir perubahan persediaan |

Contoh barang:

```
Nama Barang      : Air Galon Isi Ulang
Stok             : 50
Harga per Galon  : Rp5.000
Satuan           : Galon
```

## Alur Sistem

```
             ┌─────────────────┐
             │   PERSEDIAAN    │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │    PENJUALAN    │
             │                 │
             │ • Pelanggan     │
             │ • Barang        │
             │ • Jumlah Galon  │
             │ • Harga         │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │ PENERIMAAN KAS  │
             │                 │
             │ • Tunai         │
             │ • Transfer      │
             │ • QRIS          │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │    DASHBOARD    │
             └─────────────────┘
```

## ERD

Secara konseptual, hubungan data utama dalam Sistem Depot Air Minum dapat digambarkan sebagai berikut:

```
┌─────────────────────────┐
│        PELANGGAN        │
├─────────────────────────┤
│ PK  id_pelanggan        │
│     nama_pelanggan      │
│     no_hp               │
│     alamat              │
│     created_at          │
└────────────┬────────────┘
             │
             │ 1
             │
             │ N
             ▼
┌─────────────────────────┐
│        PENJUALAN        │
├─────────────────────────┤
│ PK  id_penjualan        │
│ FK  id_pelanggan        │
│ FK  id_persediaan       │
│     tanggal_penjualan   │
│     jumlah_galon        │
│     harga_per_galon     │
│     total_penjualan     │
│     status_pembayaran   │
│     created_at          │
└───────────┬─────────────┘
            │
            │ 1
            │
            │ N
            ▼
┌─────────────────────────┐
│     PENERIMAAN_KAS      │
├─────────────────────────┤
│ PK  id_penerimaan       │
│ FK  id_penjualan        │
│     tanggal_penerimaan  │
│     jumlah_diterima     │
│     metode_pembayaran   │
│     created_at          │
└─────────────────────────┘


┌─────────────────────────┐
│       PERSEDIAAN        │
├─────────────────────────┤
│ PK  id_persediaan       │
│     nama_barang         │
│     stok                │
│     harga               │
│     satuan              │
│     updated_at          │
└────────────┬────────────┘
             │
             │ 1
             │
             │ N
             ▼
       ┌─────────────┐
       │  PENJUALAN  │
       └─────────────┘
```

Relasi antar entitas:

- **Pelanggan → Penjualan (1:N)**: satu pelanggan dapat memiliki banyak transaksi penjualan.
- **Persediaan → Penjualan (1:N)**: satu jenis persediaan dapat digunakan dalam banyak transaksi penjualan.
- **Penjualan → Penerimaan Kas (1:N)**: satu transaksi penjualan dapat memiliki data penerimaan kas.

## Struktur Folder

```
Aplikasi-Sistem-Depot-Air/
│
├── backend/
│   └── Database
│
├── frontend/
│   ├── html/
│   │   └── index.html
│   │
│   ├── css/
│   │   └── style.css
│   │
│   └── js/
│       ├── config.js
│       └── apps.js
│
├── index.html
└── README.md
```

### Fungsi File

| **File**     | **Fungsi**                                                                      |
| ------------ | ------------------------------------------------------------------------------- |
| `Database`   | Tempat menyimpan data secara terstruktur & terorganisir                         |
| `index.html` | Halaman utama aplikasi Sistem Depot Air Minum                                   |
| `style.css`  | Mengatur desain dan tampilan aplikasi                                           |
| `config.js`  | Mengatur konfigurasi koneksi dengan Supabase                                    |
| `apps.js`    | Menangani logika aplikasi, transaksi, persediaan, penerimaan kas, dan dashboard |
| `README.md`  | Dokumentasi aplikasi                                                            |

> Struktur folder backend di atas perlu disesuaikan dengan file SQL yang benar-benar ada pada repository.

## Cara Menjalankan

### 1. Siapkan Database di Supabase

1. Buat akun atau login di [Supabase](https://supabase.com/).
2. Buat project baru.
3. Buka **SQL Editor**.
4. Jalankan SQL database Sistem Depot Air Minum yang digunakan oleh project.
5. Pastikan tabel yang diperlukan berhasil dibuat.

### 2. Hubungkan Frontend

Buka:

**Supabase → Project Settings → API**

Kemudian salin:

- **Project URL**
- **anon / publishable key**

Masukkan konfigurasi tersebut ke file:

```
frontend/js/config.js
```

Contoh:

```
const SUPABASE_URL = "https://project-id.supabase.co";
const SUPABASE_ANON_KEY = "anon-key";

const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);
```

> ⚠️ Jangan memasukkan `service_role` atau secret key ke dalam frontend maupun repository publik. Gunakan **anon/publishable key** untuk aplikasi client-side.

### 3. Jalankan Aplikasi

Cara termudah menggunakan **Visual Studio Code**:

1. Buka folder project di VS Code.
2. Install ekstensi **Live Server**.
3. Buka `index.html`.
4. Klik kanan.
5. Pilih **Open with Live Server**.

Aplikasi kemudian dapat dibuka melalui browser.

## GitHub Pages

Project ini juga dapat dijalankan menggunakan GitHub Pages.

Demo aplikasi:

```
https://cahayakamila44-sudo.github.io/Aplikasi-Sistem-Depot-Air/
```

Repository:

```
https://github.com/cahayakamila44-sudo/Aplikasi-Sistem-Depot-Air
```

## Keamanan

- Gunakan hanya **anon/publishable key** Supabase pada frontend.
- Jangan menyimpan `service_role` atau secret key di repository GitHub.
- Konfigurasi database harus menggunakan pengaturan keamanan Supabase yang sesuai.
- Validasi data sebaiknya tidak hanya dilakukan pada browser, tetapi juga pada sisi database.
- Untuk penggunaan produksi, autentikasi pengguna dan **Row Level Security (RLS)** sebaiknya diaktifkan.

## Keterbatasan

- Sistem masih berupa aplikasi sederhana untuk pengelolaan penjualan dan penerimaan kas depot air minum.
- Sistem belum memiliki fitur login pengguna pada antarmuka yang tersedia.
- Menu utama masih terbatas pada Dashboard, Penjualan, Penerimaan Kas, dan Persediaan.
- Sistem belum menampilkan jurnal umum, buku besar, maupun laporan keuangan lengkap.
- Keamanan database bergantung pada konfigurasi policy dan RLS yang diterapkan pada Supabase.
- Untuk jumlah data yang semakin besar, sistem masih dapat dikembangkan dengan pagination, pencarian, filter, dan laporan yang lebih lengkap.

## Pengembangan Selanjutnya

Beberapa fitur yang dapat ditambahkan pada pengembangan berikutnya:

- Login dan autentikasi pengguna
- Manajemen pelanggan
- Laporan penjualan per periode
- Laporan penerimaan kas
- Pencarian dan filter transaksi
- Notifikasi stok minimum
- Riwayat perubahan persediaan
- Jurnal umum otomatis
- Buku besar
- Laporan laba rugi
- Cetak atau ekspor laporan
- Dashboard dengan grafik penjualan

## Tentang Project

**Sistem Depot Air Minum – Sistem Penjualan & Penerimaan Kas**

Project ini dibuat untuk menerapkan konsep sistem informasi dalam proses pencatatan transaksi penjualan, penerimaan kas, dan pengelolaan persediaan pada usaha depot air minum.

**Pengembang:** Cahaya Kamila
