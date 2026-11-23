// =====================================================
// KONFIGURASI SUPABASE
// Sistem Depot Air Minum
// =====================================================

const CONFIG = {
    APP_NAME: "Sistem Depot Air Minum",
    APP_VERSION: "1.0.0",

    // Kredensial Supabase
    SUPABASE_URL: "https://vdrrgtodlstctzehypkr.supabase.co",
    SUPABASE_KEY: "sb_publishable_uelKq0PUFkBAIDWS2cIJzQ__SZBUOFZ",

    // Username is mapped to this Supabase Auth account; passwords stay in Auth.
    AUTH_USERNAME: "Cahayakamila77",
    AUTH_EMAIL: "cahmil500@gmail.com",

    // Nama tabel
    TABLES: {
        PELANGGAN: "pelanggan",
        PERSEDIAAN: "persediaan",
        PRODUK: "produk",
        BAHAN_PERSEDIAAN: "bahan_persediaan",
        KOMPOSISI_PRODUK: "komposisi_produk",
        PENJUALAN: "penjualan",
        PENERIMAAN: "penerimaan_kas"
    },
    VIEWS: {
        PIUTANG: "v_piutang",
        PENYERAHAN: "v_penyerahan_barang"
    },

    // Format
    LOCALE: "id-ID",
    CURRENCY: "IDR"
};

Object.freeze(CONFIG);
Object.freeze(CONFIG.TABLES);
Object.freeze(CONFIG.VIEWS);