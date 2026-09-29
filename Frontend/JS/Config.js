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

    // Nama tabel
    TABLES: {
        PELANGGAN: "pelanggan",
        PERSEDIAAN: "persediaan",
        PENJUALAN: "penjualan",
        PENERIMAAN: "penerimaan_kas"
    },

    // Format
    LOCALE: "id-ID",
    CURRENCY: "IDR"
};

Object.freeze(CONFIG);
Object.freeze(CONFIG.TABLES);