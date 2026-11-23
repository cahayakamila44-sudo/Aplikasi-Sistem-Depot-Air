// =====================================================
// APLIKASI UTAMA — Sistem Depot Air Minum
// Integrasi Supabase
// =====================================================

// ---------- Cek CDN Supabase ----------
if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error(
        "[FATAL] Supabase JS belum ter-load. " +
        "Pastikan <script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"> " +
        "ada SEBELUM config.js dan apps.js."
    );
    alert("Gagal memuat Supabase. Cek koneksi internet / urutan <script> di HTML.");
    throw new Error("Supabase CDN not loaded");
}

// Inisialisasi Supabase client
const sb = window.supabase.createClient(
    CONFIG.SUPABASE_URL,
    CONFIG.SUPABASE_KEY
);

// =====================================================
// UTIL
// =====================================================
const Utils = {
    rupiah(n) {
        return "Rp " + Number(n || 0).toLocaleString(CONFIG.LOCALE);
    },
    tanggal(iso) {
        if (!iso) return "-";
        try {
            return new Date(iso).toLocaleDateString(CONFIG.LOCALE);
        } catch {
            return iso;
        }
    },
    todayISO() {
        return new Date().toISOString().slice(0, 10);
    },
    async guard(promise, label = "Operasi") {
        try {
            const { data, error } = await promise;
            if (error) throw error;
            return data;
        } catch (err) {
            console.error(`[${label}]`, err);

            let msg = err.message || String(err);
            if (
                msg.includes("Stok tidak mencukupi") ||
                (msg.includes("Stok bahan") && msg.includes("tidak mencukupi"))
            ) {
                msg = "Stok tidak mencukupi untuk transaksi ini.";
            } else if (msg.includes("tidak ditemukan")) {
                msg = "Data yang dipilih tidak ditemukan.";
            } else if (msg.includes("duplicate key")) {
                msg = "Data sudah ada.";
            } else if (msg.includes("violates foreign key")) {
                msg = "Data masih dipakai di tabel lain, tidak bisa dihapus.";
            } else if (
                msg.includes("Failed to fetch") ||
                msg.includes("NetworkError")
            ) {
                msg = "Tidak dapat terhubung ke server. Cek koneksi internet.";
            } else if (
                msg.includes("JWT") ||
                msg.includes("apikey") ||
                msg.includes("Invalid API key")
            ) {
                msg = "API key Supabase tidak valid.";
            } else if (msg.includes("row-level security")) {
                msg = "Akses ditolak (RLS). Pastikan policy sudah dibuat.";
            }

            alert(`Gagal ${label.toLowerCase()}: ${msg}`);
            return null;
        }
    },
    async fetchAll(queryFactory, label) {
        const pageSize = 1000;
        const rows = [];
        let offset = 0;

        while (true) {
            const page = await this.guard(
                queryFactory().range(offset, offset + pageSize - 1),
                label
            );
            if (page === null) return null;

            rows.push(...page);
            if (page.length < pageSize) return rows;
            offset += pageSize;
        }
    },
    escape(str) {
        if (str == null) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
};

// =====================================================
// APP
// =====================================================
const App = {
    cache: {
        pelanggan: [],
        persediaan: [],
        bahanPersediaan: [],
        komposisiProduk: [],
        penjualan: [],
        penerimaan: [],
        piutang: [],
        penyerahan: []
    },
    profitChart: null,

    // ---------------------------------------------
    // INIT
    // ---------------------------------------------
    async init() {
        console.log("[App] init() mulai...");
        this.bindNav();
        this.bindForms();
        this.setDefaultDates();
        await this.ensureHybridSeed();
        this.setupRealtime();

        // Tampilkan dashboard dulu supaya UI responsif
        this.showPage("dashboard");

        console.log("[App] memuat data dari Supabase...");
        await this.refreshAll();
        console.log("[App] selesai. Data:", this.cache);
    },

    // ---------------------------------------------
    // NAV
    // ---------------------------------------------
    bindNav() {
        const buttons = document.querySelectorAll(".menu-button");
        console.log(`[App] bindNav: ${buttons.length} tombol menu ditemukan`);

        buttons.forEach(btn => {
            btn.addEventListener("click", () => {
                const page = btn.dataset.page;
                console.log(`[App] klik menu: ${page}`);
                this.showPage(page);
            });
        });
    },

    showPage(pageId) {
        document.querySelectorAll(".page").forEach(p => {
            p.classList.add("hidden");
        });

        const el = document.getElementById(pageId);
        if (el) {
            el.classList.remove("hidden");
        } else {
            console.warn(`[App] halaman #${pageId} tidak ditemukan`);
        }

        document.querySelectorAll(".menu-button").forEach(b =>
            b.classList.remove("active")
        );
        const active = document.querySelector(
            `.menu-button[data-page="${pageId}"]`
        );
        if (active) active.classList.add("active");
    },

    setDefaultDates() {
        const t = Utils.todayISO();
        ["tanggalPenjualan", "tanggalPenerimaan"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = t;
        });
        const start = document.getElementById("laporanMulai");
        const end = document.getElementById("laporanSampai");
        if (start) start.value = `${t.slice(0, 7)}-01`;
        if (end) end.value = t;
    },

    setupRealtime() {
        if (!window.supabase || typeof sb?.channel !== "function") {
            console.warn("[Realtime] Supabase client tidak tersedia.");
            return;
        }

        if (this.realtimeChannel) {
            this.realtimeChannel.unsubscribe();
        }

        const channel = sb.channel("persediaan-live");

        channel.on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: CONFIG.TABLES.PRODUK
            },
            async () => {
                console.log("[Realtime] INSERT persediaan terdeteksi");
                await this.loadPersediaan();
                this.fillSelects();
                this.updateDashboard();
                this.renderLaporan();
            }
        );

        channel.on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: CONFIG.TABLES.PRODUK
            },
            async () => {
                console.log("[Realtime] UPDATE persediaan terdeteksi");
                await this.loadPersediaan();
                this.fillSelects();
                this.updateDashboard();
                this.renderLaporan();
            }
        );

        channel.on(
            "postgres_changes",
            {
                event: "DELETE",
                schema: "public",
                table: CONFIG.TABLES.PRODUK
            },
            async () => {
                console.log("[Realtime] DELETE persediaan terdeteksi");
                await this.loadPersediaan();
                this.fillSelects();
                this.updateDashboard();
                this.renderLaporan();
            }
        );

        channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log("[Realtime] channel persediaan aktif");
            } else if (status === "CHANNEL_ERROR") {
                console.error("[Realtime] channel persediaan gagal terhubung");
            }
        });

        this.realtimeChannel = channel;

        if (this.bahanRealtimeChannel) {
            this.bahanRealtimeChannel.unsubscribe();
        }
        const bahanChannel = sb.channel("bahan-hpp-live");
        bahanChannel.on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: CONFIG.TABLES.BAHAN_PERSEDIAAN
            },
            async () => {
                await Promise.all([this.loadBahanPersediaan(), this.loadPersediaan()]);
                this.fillSelects();
                this.updateDashboard();
                this.renderLaporan();
            }
        );
        bahanChannel.on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: CONFIG.TABLES.KOMPOSISI_PRODUK
            },
            async () => {
                await Promise.all([this.loadKomposisiProduk(), this.loadPersediaan()]);
                this.fillSelects();
                this.renderLaporan();
            }
        );
        bahanChannel.subscribe(status => {
            if (status === "CHANNEL_ERROR") {
                console.error("[Realtime] channel bahan/HPP gagal terhubung");
            }
        });
        this.bahanRealtimeChannel = bahanChannel;

        if (this.penjualanRealtimeChannel) {
            this.penjualanRealtimeChannel.unsubscribe();
        }
        const penjualanChannel = sb.channel("penjualan-profit-live");
        penjualanChannel.on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: CONFIG.TABLES.PENJUALAN
            },
            async () => {
                await Promise.all([
                    this.loadPenjualan(),
                    this.loadPenerimaan(),
                    this.loadPiutang(),
                    this.loadPenyerahan()
                ]);
                this.updateDashboard();
                this.renderLaporan();
            }
        );
        penjualanChannel.subscribe(status => {
            if (status === "CHANNEL_ERROR") {
                console.error("[Realtime] channel penjualan gagal terhubung");
            }
        });
        this.penjualanRealtimeChannel = penjualanChannel;
    },

    // ---------------------------------------------
    // BIND FORMS
    // ---------------------------------------------
    bindForms() {
        const formPelanggan = document.getElementById("formPelanggan");
        if (formPelanggan) {
            formPelanggan.addEventListener("submit", async (e) => {
                e.preventDefault();
                await this.simpanPelanggan();
            });
        }

        document.getElementById("btnTambahItem")?.addEventListener("click", () => this.bukaFormItem());
        document.getElementById("btnBatalItem")?.addEventListener("click", () => this.tutupFormItem());
        document.getElementById("formItemPersediaan")?.addEventListener("submit", async event => {
            event.preventDefault();
            await this.simpanItemPersediaan();
        });
        document.getElementById("btnTambahProduk")?.addEventListener("click", () => this.bukaFormProduk());
        document.getElementById("btnBatalProduk")?.addEventListener("click", () => this.tutupFormProduk());
        document.getElementById("formProduk")?.addEventListener("submit", async event => {
            event.preventDefault();
            await this.simpanProduk();
        });

        document.getElementById("formKulakan")?.addEventListener("submit", async event => {
            event.preventDefault();
            await this.simpanKulakan();
        });

        document.getElementById("formKomposisi")?.addEventListener("submit", async event => {
            event.preventDefault();
            await this.simpanKomposisiProduk();
        });

        const formPenjualan = document.getElementById("formPenjualan");
        if (formPenjualan) {
            formPenjualan.addEventListener("submit", async (e) => {
                e.preventDefault();
                await this.simpanPenjualan();
            });
        }

        const formPenerimaan = document.getElementById("formPenerimaan");
        if (formPenerimaan) {
            formPenerimaan.addEventListener("submit", async (e) => {
                e.preventDefault();
                await this.simpanPenerimaan();
            });
        }

        document.getElementById("btnTerapkanLaporan")?.addEventListener("click", () => {
            this.renderLaporan();
        });
        document.getElementById("btnCetakLaporan")?.addEventListener("click", () => {
            window.print();
        });
    },

    // ---------------------------------------------
    // REFRESH SEMUA DATA
    // ---------------------------------------------
    async refreshAll() {
        await Promise.all([
            this.loadPelanggan(),
            this.loadPersediaan(),
            this.loadBahanPersediaan(),
            this.loadKomposisiProduk(),
            this.loadPenjualan(),
            this.loadPenerimaan(),
            this.loadPiutang(),
            this.loadPenyerahan()
        ]);
        this.renderPersediaan();
        this.renderKomposisiProduk();
        this.renderPenjualan();
        this.updateDashboard();
        this.fillSelects();
        this.renderLaporan();
    },

    async ensureHybridSeed() {
        const seedBahan = [
            { nama_bahan: "Air Baku", jenis_item: "bahan_isi_ulang", satuan: "Liter", stok_tersedia: 8000, harga_modal_satuan: 40 },
            { nama_bahan: "Tutup Galon Standar 19L", jenis_item: "bahan_isi_ulang", satuan: "Pcs", stok_tersedia: 1000, harga_modal_satuan: 150 },
            { nama_bahan: "Tutup Galon Ulir 15L", jenis_item: "bahan_isi_ulang", satuan: "Pcs", stok_tersedia: 500, harga_modal_satuan: 250 },
            { nama_bahan: "Tisu Galon", jenis_item: "bahan_isi_ulang", satuan: "Pcs", stok_tersedia: 1000, harga_modal_satuan: 100 },
            { nama_bahan: "Segel Plastik", jenis_item: "bahan_isi_ulang", satuan: "Pcs", stok_tersedia: 1000, harga_modal_satuan: 50 },
            { nama_bahan: "Galon Kosong Polos 19L", jenis_item: "bahan_isi_ulang", satuan: "Pcs", stok_tersedia: 50, harga_modal_satuan: 32000 },
            { nama_bahan: "Galon Aqua 19L (Isi Pabrik)", jenis_item: "produk_pabrikan", satuan: "Galon", stok_tersedia: 40, harga_modal_satuan: 18500 },
            { nama_bahan: "Galon Le Minerale 15L (Isi Pabrik)", jenis_item: "produk_pabrikan", satuan: "Galon", stok_tersedia: 40, harga_modal_satuan: 18000 },
            { nama_bahan: "Galon Vit 19L (Isi Pabrik)", jenis_item: "produk_pabrikan", satuan: "Galon", stok_tersedia: 30, harga_modal_satuan: 16500 }
        ];
        const seedProduk = [
            { nama_produk: "Isi Ulang Air Mineral 19L", jenis_produk: "isi_ulang", satuan: "Galon", harga_jual: 5000 },
            { nama_produk: "Isi Ulang Air RO 19L", jenis_produk: "isi_ulang", satuan: "Galon", harga_jual: 7000 },
            { nama_produk: "Isi Ulang Galon 15L", jenis_produk: "isi_ulang", satuan: "Galon", harga_jual: 5000 },
            { nama_produk: "Paket Galon Baru Polos 19L + Isi Mineral", jenis_produk: "isi_ulang", satuan: "Galon", harga_jual: 42000 },
            { nama_produk: "Galon Aqua 19L (Original Pabrik)", jenis_produk: "pabrikan", satuan: "Galon", harga_jual: 22000 },
            { nama_produk: "Galon Le Minerale 15L (Original Pabrik)", jenis_produk: "pabrikan", satuan: "Galon", harga_jual: 21500 },
            { nama_produk: "Galon Vit 19L (Original Pabrik)", jenis_produk: "pabrikan", satuan: "Galon", harga_jual: 19500 }
        ];
        const seedKomposisi = [
            ["Isi Ulang Air Mineral 19L", "Air Baku", 19],
            ["Isi Ulang Air Mineral 19L", "Tutup Galon Standar 19L", 1],
            ["Isi Ulang Air Mineral 19L", "Tisu Galon", 1],
            ["Isi Ulang Air Mineral 19L", "Segel Plastik", 1],
            ["Isi Ulang Air RO 19L", "Air Baku", 19],
            ["Isi Ulang Air RO 19L", "Tutup Galon Standar 19L", 1],
            ["Isi Ulang Air RO 19L", "Tisu Galon", 1],
            ["Isi Ulang Air RO 19L", "Segel Plastik", 1],
            ["Isi Ulang Galon 15L", "Air Baku", 15],
            ["Isi Ulang Galon 15L", "Tutup Galon Ulir 15L", 1],
            ["Isi Ulang Galon 15L", "Tisu Galon", 1],
            ["Isi Ulang Galon 15L", "Segel Plastik", 1],
            ["Paket Galon Baru Polos 19L + Isi Mineral", "Galon Kosong Polos 19L", 1],
            ["Paket Galon Baru Polos 19L + Isi Mineral", "Air Baku", 19],
            ["Paket Galon Baru Polos 19L + Isi Mineral", "Tutup Galon Standar 19L", 1],
            ["Paket Galon Baru Polos 19L + Isi Mineral", "Tisu Galon", 1],
            ["Paket Galon Baru Polos 19L + Isi Mineral", "Segel Plastik", 1],
            ["Galon Aqua 19L (Original Pabrik)", "Galon Aqua 19L (Isi Pabrik)", 1],
            ["Galon Le Minerale 15L (Original Pabrik)", "Galon Le Minerale 15L (Isi Pabrik)", 1],
            ["Galon Vit 19L (Original Pabrik)", "Galon Vit 19L (Isi Pabrik)", 1]
        ];

        const bahan = await Utils.guard(
            sb.from(CONFIG.TABLES.BAHAN_PERSEDIAAN).select("id, nama_bahan"),
            "memeriksa seed bahan persediaan"
        );
        if (bahan === null) return;
        const existingBahan = new Set(bahan.map(item => item.nama_bahan));
        const missingBahan = seedBahan.filter(item => !existingBahan.has(item.nama_bahan));
        if (missingBahan.length) {
            const inserted = await Utils.guard(
                sb.from(CONFIG.TABLES.BAHAN_PERSEDIAAN)
                  .upsert(missingBahan, { onConflict: "nama_bahan", ignoreDuplicates: true }),
                "menginisialisasi bahan persediaan"
            );
            if (inserted === null) return;
        }

        const produk = await Utils.guard(
            sb.from(CONFIG.TABLES.PRODUK).select("id, nama_produk"),
            "memeriksa seed produk"
        );
        if (produk === null) return;
        const existingProduk = new Set(produk.map(item => item.nama_produk));
        const missingProduk = seedProduk.filter(item => !existingProduk.has(item.nama_produk));
        if (missingProduk.length) {
            const inserted = await Utils.guard(
                sb.from(CONFIG.TABLES.PRODUK)
                  .upsert(missingProduk, { onConflict: "nama_produk", ignoreDuplicates: true }),
                "menginisialisasi produk"
            );
            if (inserted === null) return;
        }

        const [allProduk, allBahan, komposisi] = await Promise.all([
            Utils.fetchAll(
                () => sb.from(CONFIG.TABLES.PRODUK).select("id, nama_produk"),
                "memuat produk untuk seed komposisi"
            ),
            Utils.fetchAll(
                () => sb.from(CONFIG.TABLES.BAHAN_PERSEDIAAN).select("id, nama_bahan"),
                "memuat bahan untuk seed komposisi"
            ),
            Utils.fetchAll(
                () => sb.from(CONFIG.TABLES.KOMPOSISI_PRODUK).select("produk_id, bahan_id"),
                "memeriksa seed komposisi"
            )
        ]);
        if (allProduk === null || allBahan === null || komposisi === null) return;
        const produkId = new Map(allProduk.map(item => [item.nama_produk, item.id]));
        const bahanId = new Map(allBahan.map(item => [item.nama_bahan, item.id]));
        const existingKomposisi = new Set(
            komposisi.map(item => `${item.produk_id}:${item.bahan_id}`)
        );
        const missingKomposisi = seedKomposisi.reduce((items, [namaProduk, namaBahan, jumlah]) => {
            const pId = produkId.get(namaProduk);
            const bId = bahanId.get(namaBahan);
            if (pId && bId && !existingKomposisi.has(`${pId}:${bId}`)) {
                items.push({ produk_id: pId, bahan_id: bId, jumlah_pakai: jumlah });
            }
            return items;
        }, []);
        if (missingKomposisi.length) {
            await Utils.guard(
                sb.from(CONFIG.TABLES.KOMPOSISI_PRODUK)
                  .upsert(missingKomposisi, {
                      onConflict: "produk_id,bahan_id",
                      ignoreDuplicates: true
                  }),
                "menginisialisasi komposisi produk"
            );
        }
    },

    // =============================================
    // PELANGGAN
    // =============================================
    async loadPelanggan() {
        console.log("[App] loadPelanggan() ...");
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.TABLES.PELANGGAN)
              .select("*")
              .order("id_pelanggan", { ascending: true }),
            "memuat pelanggan"
        );
        if (data === null) {
            // tampilkan pesan error di tabel
            const tbody = document.getElementById("tabelPelanggan");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="5" class="empty-data">
                        <i class="fa-solid fa-triangle-exclamation"></i><br>
                        Gagal memuat data. Cek Console (F12).
                    </td></tr>`;
            }
            return;
        }
        this.cache.pelanggan = data || [];
        console.log(`[App] pelanggan: ${this.cache.pelanggan.length} baris`);
        this.renderPelanggan();
    },

    renderPelanggan() {
        const tbody = document.getElementById("tabelPelanggan");
        if (!tbody) return;

        if (!this.cache.pelanggan.length) {
            tbody.innerHTML = `
                <tr><td colspan="5" class="empty-data">
                    <i class="fa-solid fa-users"></i><br>
                    Belum ada data pelanggan
                </td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.pelanggan.map(p => `
            <tr>
                <td>${p.id_pelanggan}</td>
                <td>${Utils.escape(p.nama_pelanggan)}</td>
                <td>${Utils.escape(p.no_hp) || "-"}</td>
                <td>${Utils.escape(p.alamat) || "-"}</td>
                <td>
                    <button class="btn-delete"
                        onclick="App.hapusPelanggan(${p.id_pelanggan})">
                        <i class="fa-solid fa-trash"></i> Hapus
                    </button>
                </td>
            </tr>
        `).join("");
    },

    async simpanPelanggan() {
        const nama = document.getElementById("namaPelanggan").value.trim();
        const no_hp = document.getElementById("noHp").value.trim();
        const alamat = document.getElementById("alamat").value.trim();
        if (!nama) return alert("Nama pelanggan wajib diisi.");

        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PELANGGAN)
              .insert({ nama_pelanggan: nama, no_hp, alamat })
              .select(),
            "menyimpan pelanggan"
        );
        if (!result) return;

        document.getElementById("formPelanggan").reset();
        await this.loadPelanggan();
        this.fillSelects();
        this.updateDashboard();
        this.renderLaporan();
        alert("Pelanggan berhasil disimpan.");
    },

    async hapusPelanggan(id) {
        if (!confirm("Hapus pelanggan ini?")) return;
        const ok = await Utils.guard(
            sb.from(CONFIG.TABLES.PELANGGAN)
              .delete().eq("id_pelanggan", id),
            "menghapus pelanggan"
        );
        if (ok === null) return;
        await this.loadPelanggan();
        this.fillSelects();
        this.updateDashboard();
    },

    // =============================================
    // PERSEDIAAN
    // =============================================
    async loadPersediaan() {
        console.log("[App] loadPersediaan() ...");
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.TABLES.PRODUK)
              .select("*")
              .order("id", { ascending: true }),
            "memuat produk"
        );
        if (data === null) {
            const tbody = document.getElementById("tabelProduk");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="7" class="empty-data">
                        <i class="fa-solid fa-triangle-exclamation"></i><br>
                        Gagal memuat produk. Pastikan skema Supabase telah diterapkan.
                    </td></tr>`;
            }
            return;
        }
        this.cache.persediaan = data || [];
        console.log(`[App] persediaan: ${this.cache.persediaan.length} baris`);
        this.renderPersediaan();
        this.renderKomposisiProduk();
    },

    renderPersediaan() {
        const tbody = document.getElementById("tabelProduk");
        if (!tbody) return;

        if (!this.cache.persediaan.length) {
            tbody.innerHTML = `
                <tr><td colspan="7" class="empty-data">
                    <i class="fa-solid fa-box-open"></i><br>
                    Belum ada produk
                </td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.persediaan.map((p, i) => {
            const recipe = this.cache.komposisiProduk.filter(
                item => Number(item.produk_id) === Number(p.id)
            );
            const stockByMaterial = new Map(
                this.cache.bahanPersediaan.map(item => [Number(item.id), Number(item.stok_tersedia || 0)])
            );
            const available = recipe.length
                ? Math.floor(Math.min(...recipe.map(item =>
                    stockByMaterial.get(Number(item.bahan_id)) / Number(item.jumlah_pakai)
                )))
                : null;
            return `
                <tr>
                    <td>${i + 1}</td>
                    <td><span class="inventory-badge ${p.jenis_produk === "pabrikan" ? "badge-factory" : "badge-refill"}">${p.jenis_produk === "pabrikan" ? "Produk Jadi Pabrikan" : "Isi Ulang"}</span></td>
                    <td>${Utils.escape(p.nama_produk)}</td>
                    <td>${available === null ? "Komposisi belum diatur" : `${available} ${Utils.escape(p.satuan)}`}</td>
                    <td>${Utils.rupiah(p.harga_jual)}</td>
                    <td>${Utils.rupiah(p.hpp_per_unit)}</td>
                    <td>
                        <button class="btn-secondary" onclick="App.editProduk(${p.id})">
                            <i class="fa-solid fa-pen"></i> Edit
                        </button>
                        <button class="btn-delete" onclick="App.hapusProduk(${p.id})">
                            <i class="fa-solid fa-trash"></i> Hapus
                        </button>
                    </td>
                </tr>`;
        }).join("");
    },

    async loadBahanPersediaan() {
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.TABLES.BAHAN_PERSEDIAAN)
              .select("*")
              .order("id", { ascending: true }),
            "memuat bahan persediaan"
        );
        if (data === null) {
            const tbody = document.getElementById("tabelPersediaan");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="8" class="empty-data">
                        <i class="fa-solid fa-triangle-exclamation"></i><br>
                        Gagal memuat bahan. Cek Console (F12).
                    </td></tr>`;
            }
            return;
        }
        this.cache.bahanPersediaan = data;
        this.renderBahanPersediaan();
        this.renderPersediaan();
        this.renderKomposisiProduk();
        this.fillSelects();
    },

    renderBahanPersediaan() {
        const tbody = document.getElementById("tabelPersediaan");
        if (!tbody) return;
        if (!this.cache.bahanPersediaan.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty-data">Belum ada data bahan</td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.bahanPersediaan.map((bahan, index) => {
            const stok = Number(bahan.stok_tersedia || 0);
            const kelas = stok === 0 ? "stok-habis" : (stok <= 10 ? "stok-sedikit" : "stok-normal");
            const stokText = stok.toLocaleString(CONFIG.LOCALE, { maximumFractionDigits: 4 });
            return `<tr>
                <td>${index + 1}</td>
                <td><span class="inventory-badge ${bahan.jenis_item === "produk_pabrikan" ? "badge-factory" : "badge-refill"}">${bahan.jenis_item === "produk_pabrikan" ? "Produk Jadi Pabrikan" : "Bahan Isi Ulang"}</span></td>
                <td>${Utils.escape(bahan.nama_bahan)}</td>
                <td><span class="${kelas}">${stokText}</span></td>
                <td>${Utils.escape(bahan.satuan)}</td>
                <td>${Utils.rupiah(bahan.harga_modal_satuan)}</td>
                <td>${Utils.tanggal(bahan.updated_at)}</td>
                <td class="action-cell">
                    <button class="btn-secondary" onclick="App.editItemPersediaan(${bahan.id})">
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button class="btn-primary" onclick="App.bukaRestock(${bahan.id})">
                        <i class="fa-solid fa-truck-ramp-box"></i> Restock (+)
                    </button>
                    <button class="btn-delete" onclick="App.hapusItemPersediaan(${bahan.id})">
                        <i class="fa-solid fa-trash"></i> Hapus
                    </button>
                </td>
            </tr>`;
        }).join("");
    },

    async simpanKulakan() {
        const bahanId = Number(document.getElementById("bahanKulakan").value);
        const jumlah = Number(document.getElementById("jumlahKulakan").value);
        const hargaSatuan = Number(document.getElementById("hargaKulakan").value);
        if (!Number.isInteger(bahanId) || bahanId <= 0) return alert("Pilih bahan persediaan.");
        if (!Number.isFinite(jumlah) || jumlah <= 0) return alert("Jumlah stok masuk tidak valid.");
        if (!Number.isFinite(hargaSatuan) || hargaSatuan < 0) return alert("Harga modal satuan tidak valid.");

        const result = await Utils.guard(
            sb.rpc("fn_catat_kulakan", {
                p_bahan_id: bahanId,
                p_jumlah: jumlah,
                p_harga_satuan: hargaSatuan
            }),
            "mencatat stok masuk bahan"
        );
        if (result === null) return;

        document.getElementById("formKulakan").reset();
        await Promise.all([this.loadBahanPersediaan(), this.loadPersediaan()]);
        this.updateDashboard();
        this.renderLaporan();
        alert("Stok masuk berhasil dicatat. Harga modal rata-rata dan HPP produk telah diperbarui.");
    },

    async loadKomposisiProduk() {
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.TABLES.KOMPOSISI_PRODUK)
              .select("*")
              .order("produk_id", { ascending: true })
              .order("bahan_id", { ascending: true }),
            "memuat komposisi produk"
        );
        if (data === null) return;
        this.cache.komposisiProduk = data;
        this.renderPersediaan();
        this.renderKomposisiProduk();
    },

    renderKomposisiProduk() {
        const tbody = document.getElementById("tabelKomposisi");
        if (!tbody) return;
        if (!this.cache.komposisiProduk.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-data">Belum ada komposisi produk</td></tr>`;
            return;
        }

        const produkById = new Map(
            this.cache.persediaan.map(item => [Number(item.id), item])
        );
        const bahanById = new Map(
            this.cache.bahanPersediaan.map(item => [Number(item.id), item])
        );
        tbody.innerHTML = this.cache.komposisiProduk.map(item => {
            const produk = produkById.get(Number(item.produk_id));
            const bahan = bahanById.get(Number(item.bahan_id));
            const jumlah = Number(item.jumlah_pakai).toLocaleString(CONFIG.LOCALE, {
                maximumFractionDigits: 4
            });
            return `<tr>
                <td>${Utils.escape(produk?.nama_produk) || "Produk tidak ditemukan"}</td>
                <td>${Utils.escape(bahan?.nama_bahan) || "Bahan tidak ditemukan"}</td>
                <td>${jumlah} ${Utils.escape(bahan?.satuan || "")}</td>
                <td>${Utils.rupiah(produk?.hpp_per_unit)}</td>
                <td>
                    <button class="btn-delete" onclick="App.hapusKomposisiProduk(${item.produk_id}, ${item.bahan_id})">
                        <i class="fa-solid fa-trash"></i> Hapus
                    </button>
                </td>
            </tr>`;
        }).join("");
    },

    async simpanKomposisiProduk() {
        const produkId = Number(document.getElementById("produkKomposisi").value);
        const bahanId = Number(document.getElementById("bahanKomposisi").value);
        const jumlahPakai = Number(document.getElementById("jumlahPakai").value);
        if (!Number.isInteger(produkId) || produkId <= 0) return alert("Pilih produk.");
        if (!Number.isInteger(bahanId) || bahanId <= 0) return alert("Pilih bahan persediaan.");
        if (!Number.isFinite(jumlahPakai) || jumlahPakai <= 0) {
            return alert("Jumlah bahan yang dipakai per unit produk harus lebih besar dari nol.");
        }

        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.KOMPOSISI_PRODUK)
              .upsert(
                  { produk_id: produkId, bahan_id: bahanId, jumlah_pakai: jumlahPakai },
                  { onConflict: "produk_id,bahan_id" }
              )
              .select(),
            "menyimpan komposisi produk"
        );
        if (result === null) return;

        document.getElementById("formKomposisi").reset();
        await Promise.all([this.loadKomposisiProduk(), this.loadPersediaan()]);
        this.renderLaporan();
        alert("Komposisi produk berhasil disimpan dan HPP per unit diperbarui.");
    },

    async hapusKomposisiProduk(produkId, bahanId) {
        if (!confirm("Hapus bahan ini dari komposisi produk?")) return;
        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.KOMPOSISI_PRODUK)
              .delete()
              .eq("produk_id", produkId)
              .eq("bahan_id", bahanId)
              .select("produk_id"),
            "menghapus komposisi produk"
        );
        if (result === null) return;
        if (!result.length) {
            alert("Komposisi tidak terhapus. Periksa izin akses dan data yang dipilih.");
            return;
        }
        await Promise.all([this.loadKomposisiProduk(), this.loadPersediaan()]);
        this.renderLaporan();
    },

    bukaFormItem(item = null) {
        const card = document.getElementById("itemPersediaanFormCard");
        document.getElementById("formItemPersediaan").reset();
        document.getElementById("itemPersediaanId").value = item?.id || "";
        document.getElementById("itemPersediaanFormTitle").textContent =
            item ? "Edit Item Persediaan" : "Tambah Item Persediaan";
        document.getElementById("jenisItem").value = item?.jenis_item || "bahan_isi_ulang";
        document.getElementById("namaItem").value = item?.nama_bahan || "";
        document.getElementById("stokItem").value = item?.stok_tersedia ?? "";
        document.getElementById("satuanItem").value = item?.satuan || "";
        document.getElementById("hargaModalItem").value = item?.harga_modal_satuan ?? "";
        card.classList.remove("hidden");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
    },

    tutupFormItem() {
        document.getElementById("itemPersediaanFormCard")?.classList.add("hidden");
    },

    editItemPersediaan(id) {
        const item = this.cache.bahanPersediaan.find(row => Number(row.id) === Number(id));
        if (item) this.bukaFormItem(item);
    },

    async simpanItemPersediaan() {
        const id = Number(document.getElementById("itemPersediaanId").value) || null;
        const payload = {
            jenis_item: document.getElementById("jenisItem").value,
            nama_bahan: document.getElementById("namaItem").value.trim(),
            stok_tersedia: Number(document.getElementById("stokItem").value),
            satuan: document.getElementById("satuanItem").value.trim(),
            harga_modal_satuan: Number(document.getElementById("hargaModalItem").value)
        };
        if (!payload.nama_bahan || !payload.satuan) return alert("Nama dan satuan item wajib diisi.");
        if (!["bahan_isi_ulang", "produk_pabrikan"].includes(payload.jenis_item)) return alert("Kategori item tidak valid.");
        if (!Number.isFinite(payload.stok_tersedia) || payload.stok_tersedia < 0) return alert("Stok tidak valid.");
        if (!Number.isFinite(payload.harga_modal_satuan) || payload.harga_modal_satuan < 0) return alert("Harga modal tidak valid.");

        const query = id
            ? sb.from(CONFIG.TABLES.BAHAN_PERSEDIAAN).update(payload).eq("id", id).select("id")
            : sb.from(CONFIG.TABLES.BAHAN_PERSEDIAAN).insert(payload).select("id");
        const result = await Utils.guard(query, id ? "memperbarui item persediaan" : "menambahkan item persediaan");
        if (result === null) return;
        if (!result.length) return alert("Item tidak tersimpan. Periksa izin akses dan RLS Supabase.");
        this.tutupFormItem();
        await Promise.all([this.loadBahanPersediaan(), this.loadPersediaan(), this.loadKomposisiProduk()]);
        this.fillSelects();
        this.updateDashboard();
        alert("Item persediaan berhasil disimpan.");
    },

    bukaRestock(id) {
        const select = document.getElementById("bahanKulakan");
        if (select) {
            select.value = String(id);
            document.getElementById("formKulakan").scrollIntoView({ behavior: "smooth", block: "center" });
            document.getElementById("jumlahKulakan").focus();
        }
    },

    async hapusItemPersediaan(id) {
        if (!confirm("Hapus item persediaan ini? Item yang masih dipakai komposisi/transaksi tidak dapat dihapus.")) return;
        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.BAHAN_PERSEDIAAN).delete().eq("id", id).select("id"),
            "menghapus item persediaan"
        );
        if (result === null) return;
        if (!result.length) return alert("Item tidak terhapus. Item mungkin masih digunakan dalam komposisi produk.");
        await Promise.all([this.loadBahanPersediaan(), this.loadKomposisiProduk()]);
        this.fillSelects();
        this.updateDashboard();
    },

    bukaFormProduk(produk = null) {
        document.getElementById("formProduk").reset();
        document.getElementById("produkId").value = produk?.id || "";
        document.getElementById("produkFormTitle").textContent = produk ? "Edit Produk" : "Tambah Produk";
        document.getElementById("namaProduk").value = produk?.nama_produk || "";
        document.getElementById("jenisProduk").value = produk?.jenis_produk || "isi_ulang";
        document.getElementById("satuanProduk").value = produk?.satuan || "Galon";
        document.getElementById("hargaJualProduk").value = produk?.harga_jual ?? "";
        document.getElementById("produkFormCard").classList.remove("hidden");
        document.getElementById("produkFormCard").scrollIntoView({ behavior: "smooth", block: "center" });
    },

    tutupFormProduk() {
        document.getElementById("produkFormCard")?.classList.add("hidden");
    },

    editProduk(id) {
        const produk = this.cache.persediaan.find(row => Number(row.id) === Number(id));
        if (produk) this.bukaFormProduk(produk);
    },

    async simpanProduk() {
        const id = Number(document.getElementById("produkId").value) || null;
        const payload = {
            nama_produk: document.getElementById("namaProduk").value.trim(),
            jenis_produk: document.getElementById("jenisProduk").value,
            satuan: document.getElementById("satuanProduk").value.trim(),
            harga_jual: Number(document.getElementById("hargaJualProduk").value)
        };
        if (!payload.nama_produk || !payload.satuan) return alert("Nama dan satuan produk wajib diisi.");
        if (!["isi_ulang", "pabrikan"].includes(payload.jenis_produk)) return alert("Kategori produk tidak valid.");
        if (!Number.isFinite(payload.harga_jual) || payload.harga_jual < 0) return alert("Harga jual tidak valid.");
        const query = id
            ? sb.from(CONFIG.TABLES.PRODUK).update(payload).eq("id", id).select("id")
            : sb.from(CONFIG.TABLES.PRODUK).insert(payload).select("id");
        const result = await Utils.guard(query, id ? "memperbarui produk" : "menambahkan produk");
        if (result === null) return;
        if (!result.length) return alert("Produk tidak tersimpan. Periksa izin akses dan RLS Supabase.");
        this.tutupFormProduk();
        await this.loadPersediaan();
        this.fillSelects();
        alert("Produk berhasil disimpan.");
    },

    async hapusProduk(id) {
        if (!confirm("Hapus produk ini? Produk yang sudah memiliki transaksi tidak dapat dihapus.")) return;
        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PRODUK).delete().eq("id", id).select("id"),
            "menghapus produk"
        );
        if (result === null) return;
        if (!result.length) return alert("Produk tidak terhapus. Produk mungkin sudah digunakan transaksi atau komposisi.");
        await Promise.all([this.loadPersediaan(), this.loadKomposisiProduk()]);
        this.fillSelects();
    },

    // =============================================
    // PENJUALAN
    // =============================================
    async loadPenjualan() {
        console.log("[App] loadPenjualan() ...");
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.TABLES.PENJUALAN)
              .select(`
                id_penjualan,
                tanggal_penjualan,
                jumlah_galon,
                harga_per_galon,
                total_penjualan,
                total_hpp,
                laba,
                status_pembayaran,
                jenis_pembayaran,
                status_penyerahan,
                id_pelanggan,
                id_persediaan,
                produk_id,
                pelanggan ( nama_pelanggan ),
                produk ( nama_produk ),
                persediaan ( nama_barang )
              `)
              .order("id_penjualan", { ascending: true }),
            "memuat penjualan"
        );
        if (data === null) {
            const tbody = document.getElementById("tabelPenjualan");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="10" class="empty-data">
                        <i class="fa-solid fa-triangle-exclamation"></i><br>
                        Gagal memuat data. Cek Console (F12).
                    </td></tr>`;
            }
            return;
        }
        this.cache.penjualan = data || [];
        console.log(`[App] penjualan: ${this.cache.penjualan.length} baris`);
        this.renderPenjualan();
    },

    renderPenjualan() {
        const tbody = document.getElementById("tabelPenjualan");
        if (!tbody) return;

        if (!this.cache.penjualan.length) {
            tbody.innerHTML = `
                <tr><td colspan="10" class="empty-data">
                    <i class="fa-solid fa-cart-shopping"></i><br>
                    Belum ada data penjualan
                </td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.penjualan.map(p => {
            const paid = this.paidAmount(p.id_penjualan);
            const balance = Math.max(0, Number(p.total_penjualan || 0) - paid);
            const status = balance === 0 ? "Lunas" : (paid > 0 ? "Sebagian" : "Belum Lunas");
            const statusCls = balance === 0 ? "status-lunas" : "status-belum";
            return `
                <tr>
                    <td>${p.id_penjualan}</td>
                    <td>${Utils.tanggal(p.tanggal_penjualan)}</td>
                    <td>${Utils.escape(p.pelanggan?.nama_pelanggan) || "-"}</td>
                    <td>${Utils.escape(p.produk?.nama_produk || p.persediaan?.nama_barang) || "-"}</td>
                    <td>${p.jumlah_galon}</td>
                    <td>${Utils.rupiah(p.harga_per_galon)}</td>
                    <td>${Utils.rupiah(p.total_penjualan)}</td>
                    <td>${Utils.escape(p.jenis_pembayaran || "Kredit")}</td>
                    <td><span class="status ${statusCls}">
                        ${status}
                    </span></td>
                    <td>
                        <button class="btn-delete"
                            onclick="App.hapusPenjualan(${p.id_penjualan})">
                            <i class="fa-solid fa-trash"></i> Hapus
                        </button>
                    </td>
                </tr>`;
        }).join("");
    },

    renderPenyerahan() {
        const tbody = document.getElementById("tabelPenyerahan");
        if (!tbody) return;
        if (!this.cache.penyerahan.length) {
            tbody.innerHTML = `<tr><td colspan="9" class="empty-data">Belum ada data penjualan</td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.penyerahan.map((sale, index) => {
            const isPaid = Number(sale.sisa_piutang || 0) <= 0;
            const isDelivered = sale.status_penyerahan === "Sudah Sampai";
            const paymentStatus = sale.status_pembayaran;
            const paymentClass = isPaid ? "status-lunas" : "status-belum";
            const deliveryStatus = isDelivered
                ? (isPaid ? "Sudah Sampai" : "Sudah Sampai — Harus Lunas")
                : "Belum Diserahkan";
            const deliveryClass = isDelivered && isPaid ? "status-lunas" : "status-belum";
            const action = isDelivered
                ? "Tercatat"
                : `<button class="btn-primary btn-delivery"
                    onclick="App.tandaiBarangSampai(${sale.id_penjualan})">
                    <i class="fa-solid fa-truck"></i>
                    ${isPaid ? "Tandai Sudah Sampai" : "Sudah Sampai — Harus Lunas"}
                </button>`;

            return `<tr>
                <td>${index + 1}</td>
                <td>${Utils.tanggal(sale.tanggal_penjualan)}</td>
                <td>${Utils.escape(sale.nama_pelanggan) || "-"}</td>
                <td>${Utils.escape(sale.nama_barang) || "-"}</td>
                <td>${sale.jumlah_galon}</td>
                <td>${Utils.rupiah(sale.total_penjualan)}</td>
                <td><span class="status ${paymentClass}">${paymentStatus}</span></td>
                <td><span class="status ${deliveryClass}">${deliveryStatus}</span></td>
                <td>${action}</td>
            </tr>`;
        }).join("");
    },

    async loadPenyerahan() {
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.VIEWS.PENYERAHAN)
              .select("*")
              .order("id_penjualan", { ascending: false }),
            "memuat penyerahan barang"
        );
        if (data === null) return;
        this.cache.penyerahan = data;
        this.renderPenyerahan();
    },

    async tandaiBarangSampai(idPenjualan) {
        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PENJUALAN)
              .update({ status_penyerahan: "Sudah Sampai" })
              .eq("id_penjualan", idPenjualan)
              .eq("status_penyerahan", "Belum Diserahkan")
              .select("id_penjualan"),
            "mencatat penyerahan barang"
        );
        if (result === null) return;
        if (!result.length) {
            alert("Penyerahan ini sudah dicatat atau transaksi tidak ditemukan.");
            return;
        }

        await this.loadPenjualan();
        await this.loadPenyerahan();
        const sale = this.cache.penyerahan.find(
            item => Number(item.id_penjualan) === Number(idPenjualan)
        );
        if (sale && Number(sale.sisa_piutang || 0) > 0) {
            alert("Barang sudah dicatat sampai. Transaksi masih belum lunas dan harus ditagih.");
        }
    },

    async simpanPenjualan() {
        const id_pelanggan = parseInt(
            document.getElementById("pelangganPenjualan").value, 10
        );
        const produk_id = parseInt(
            document.getElementById("persediaanPenjualan").value, 10
        );
        const tanggal_penjualan =
            document.getElementById("tanggalPenjualan").value;
        const jumlah_galon = parseInt(
            document.getElementById("jumlahGalon").value, 10
        );
        const harga_per_galon = parseFloat(
            document.getElementById("hargaPerGalon").value
        );
        const jenis_pembayaran = document.getElementById("jenisPembayaranPenjualan").value;

        if (!id_pelanggan) return alert("Pelanggan wajib dipilih dari Master Data.");
        if (!produk_id) return alert("Produk wajib dipilih.");
        if (!jumlah_galon || jumlah_galon <= 0)
            return alert("Jumlah galon tidak valid.");
        if (isNaN(harga_per_galon) || harga_per_galon < 0)
            return alert("Harga per galon tidak valid.");
        if (!["Tunai", "Kredit"].includes(jenis_pembayaran))
            return alert("Pilih jenis pembayaran tunai atau kredit.");

        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PENJUALAN).insert({
                id_pelanggan,
                produk_id,
                tanggal_penjualan,
                jumlah_galon,
                harga_per_galon,
                jenis_pembayaran
            }).select(),
            "menyimpan penjualan"
        );
        if (!result) return;

        document.getElementById("formPenjualan").reset();
        this.setDefaultDates();

        await this.loadPenjualan();
        await this.loadPenerimaan();
        await this.loadPersediaan();
        await this.loadBahanPersediaan();
        await Promise.all([this.loadPiutang(), this.loadPenyerahan()]);
        this.fillSelects();
        this.updateDashboard();
        this.renderLaporan();
        alert("Penjualan berhasil disimpan.");
    },

    async hapusPenjualan(id) {
        if (!confirm("Hapus transaksi penjualan ini?")) return;
        const ok = await Utils.guard(
            sb.from(CONFIG.TABLES.PENJUALAN)
              .delete().eq("id_penjualan", id),
            "menghapus penjualan"
        );
        if (ok === null) return;
        await this.loadPenjualan();
        await Promise.all([this.loadPiutang(), this.loadPenyerahan()]);
        await this.loadPersediaan();
        await this.loadBahanPersediaan();
        this.fillSelects();
        this.updateDashboard();
        this.renderLaporan();
    },

    // =============================================
    // PENERIMAAN KAS
    // =============================================
    async loadPenerimaan() {
        console.log("[App] loadPenerimaan() ...");
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.TABLES.PENERIMAAN)
              .select(`
                id_penerimaan,
                id_penjualan,
                tanggal_penerimaan,
                jumlah_diterima,
                metode_pembayaran,
                penjualan ( pelanggan ( nama_pelanggan ) )
              `)
              .order("id_penerimaan", { ascending: true }),
            "memuat penerimaan"
        );
        if (data === null) {
            const tbody = document.getElementById("tabelPenerimaan");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="7" class="empty-data">
                        <i class="fa-solid fa-triangle-exclamation"></i><br>
                        Gagal memuat data. Cek Console (F12).
                    </td></tr>`;
            }
            return;
        }
        this.cache.penerimaan = data || [];
        console.log(`[App] penerimaan: ${this.cache.penerimaan.length} baris`);
        this.renderPenerimaan();
        this.renderPenjualan();
    },

    renderPenerimaan() {
        const tbody = document.getElementById("tabelPenerimaan");
        if (!tbody) return;

        if (!this.cache.penerimaan.length) {
            tbody.innerHTML = `
                <tr><td colspan="7" class="empty-data">
                    <i class="fa-solid fa-money-bill-wave"></i><br>
                    Belum ada data penerimaan kas
                </td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.penerimaan.map(p => `
            <tr>
                <td>${p.id_penerimaan}</td>
                <td>${Utils.tanggal(p.tanggal_penerimaan)}</td>
                <td>#${p.id_penjualan}</td>
                <td>${Utils.escape(p.penjualan?.pelanggan?.nama_pelanggan) || "-"}</td>
                <td>${Utils.rupiah(p.jumlah_diterima)}</td>
                <td>${Utils.escape(p.metode_pembayaran)}</td>
                <td>
                    <button class="btn-delete"
                        onclick="App.hapusPenerimaan(${p.id_penerimaan})">
                        <i class="fa-solid fa-trash"></i> Hapus
                    </button>
                </td>
            </tr>
        `).join("");
    },

    async simpanPenerimaan() {
        const id_penjualan = parseInt(
            document.getElementById("penjualanPenerimaan").value, 10
        );
        const tanggal_penerimaan =
            document.getElementById("tanggalPenerimaan").value;
        const jumlah_diterima = parseFloat(
            document.getElementById("jumlahDiterima").value
        );
        const metode_pembayaran =
            document.getElementById("metodePembayaran").value;

        if (!id_penjualan) return alert("Transaksi penjualan wajib dipilih.");
        if (!Number.isFinite(jumlah_diterima) || jumlah_diterima <= 0)
            return alert("Jumlah diterima tidak valid.");
        if (!["Tunai", "Transfer", "QRIS"].includes(metode_pembayaran))
            return alert("Pilih metode pembayaran Tunai, Transfer, atau QRIS.");
        const piutang = this.cache.piutang.find(
            row => Number(row.id_penjualan) === id_penjualan
        );
        const sisa = Number(piutang?.sisa_piutang || 0);
        if (!piutang) {
            return alert("Piutang tidak ditemukan atau sudah lunas. Muat ulang data lalu coba lagi.");
        }
        if (jumlah_diterima > sisa) {
            return alert(`Pembayaran tidak boleh melebihi sisa piutang ${Utils.rupiah(sisa)}.`);
        }

        const result = await Utils.guard(
            sb.rpc("fn_catat_penerimaan", {
                p_id_penjualan: id_penjualan,
                p_tanggal_penerimaan: tanggal_penerimaan,
                p_jumlah_diterima: jumlah_diterima,
                p_metode_pembayaran: metode_pembayaran
            }),
            "menyimpan penerimaan"
        );
        if (result === null) return;

        document.getElementById("formPenerimaan").reset();
        this.setDefaultDates();

        await this.loadPenerimaan();
        await this.loadPenjualan();
        await Promise.all([this.loadPiutang(), this.loadPenyerahan()]);
        this.fillSelects();
        this.updateDashboard();
        this.renderLaporan();
        alert("Penerimaan kas berhasil disimpan.");
    },

    async hapusPenerimaan(id) {
        if (!confirm("Hapus data penerimaan ini?")) return;
        const ok = await Utils.guard(
            sb.from(CONFIG.TABLES.PENERIMAAN)
              .delete().eq("id_penerimaan", id),
            "menghapus penerimaan"
        );
        if (ok === null) return;
        await this.loadPenerimaan();
        await this.loadPenjualan();
        await Promise.all([this.loadPiutang(), this.loadPenyerahan()]);
        this.fillSelects();
        this.updateDashboard();
        this.renderLaporan();
    },

    paidAmount(idPenjualan) {
        return this.cache.penerimaan
            .filter(p => Number(p.id_penjualan) === Number(idPenjualan))
            .reduce((total, p) => total + Number(p.jumlah_diterima || 0), 0);
    },

    // =============================================
    // PIUTANG
    // =============================================
    async loadPiutang() {
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.VIEWS.PIUTANG)
              .select("*")
              .order("tanggal_penjualan", { ascending: false })
              .order("id_penjualan", { ascending: false }),
            "memuat piutang"
        );
        if (data === null) return;
        this.cache.piutang = data;
        this.renderPiutang();
    },

    renderPiutang() {
        const tbody = document.getElementById("tabelPiutang");
        const set = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };

        set("totalSaldoPiutang", Utils.rupiah(
            this.cache.piutang.reduce((total, row) => total + Number(row.sisa_piutang || 0), 0)
        ));
        set("jumlahPiutang", this.cache.piutang.length);
        if (!tbody) return;
        if (!this.cache.piutang.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-data">Tidak ada piutang yang belum lunas</td></tr>`;
            return;
        }

        const today = new Date();
        const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        tbody.innerHTML = this.cache.piutang.map((row, index) => {
            const saleDate = new Date(`${row.tanggal_penjualan}T00:00:00`);
            const ageDays = Math.max(0, Math.floor(
                (todayUtc - Date.UTC(saleDate.getFullYear(), saleDate.getMonth(), saleDate.getDate())) / 86400000
            ));
            const ageBucket = ageDays <= 30 ? "0–30 hari" : (ageDays <= 60 ? "31–60 hari" : ">60 hari");
            return `<tr>
                <td>${index + 1}</td>
                <td>${Utils.escape(row.nama_pelanggan) || "-"}</td>
                <td>${Utils.tanggal(row.tanggal_penjualan)}</td>
                <td>${ageDays} hari (${ageBucket})</td>
                <td>${Utils.rupiah(row.total_penjualan)}</td>
                <td>${Utils.rupiah(row.total_dibayar)}</td>
                <td>${Utils.rupiah(row.sisa_piutang)}</td>
            </tr>`;
        }).join("");
    },

    // =============================================
    // LAPORAN
    // =============================================
    renderLaporan() {
        const mulai = document.getElementById("laporanMulai")?.value || "";
        const sampai = document.getElementById("laporanSampai")?.value || "";
        if (mulai && sampai && mulai > sampai) {
            alert("Tanggal awal laporan tidak boleh melewati tanggal akhir.");
            return;
        }
        const inRange = date => (!mulai || date >= mulai) && (!sampai || date <= sampai);
        const penjualan = this.cache.penjualan.filter(p => inRange(p.tanggal_penjualan));
        const penerimaan = this.cache.penerimaan.filter(p => inRange(p.tanggal_penerimaan));
        const set = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };
        set("laporanTotalPenjualan", Utils.rupiah(
            penjualan.reduce((total, p) => total + Number(p.total_penjualan || 0), 0)
        ));
        set("laporanTotalHpp", Utils.rupiah(
            penjualan.reduce((total, p) => total + this.hppForSale(p), 0)
        ));
        set("laporanLaba", Utils.rupiah(
            penjualan.reduce((total, p) => total + this.labaForSale(p), 0)
        ));
        set("laporanTotalPenerimaan", Utils.rupiah(
            penerimaan.reduce((total, p) => total + Number(p.jumlah_diterima || 0), 0)
        ));
        set("laporanSaldoPiutang", Utils.rupiah(
            penjualan.reduce((total, p) => total + Math.max(
                0, Number(p.total_penjualan || 0) - this.paidAmount(p.id_penjualan)
            ), 0)
        ));

        const salesBody = document.getElementById("tabelLaporanPenjualan");
        const salesFooter = document.getElementById("tfootLaporanPenjualan");
        const hppKnownSales = penjualan.filter(p => p.total_hpp != null);
        const legacySalesCount = penjualan.length - hppKnownSales.length;
        const totalSales = penjualan.reduce(
            (total, p) => total + Number(p.total_penjualan || 0), 0
        );
        const totalHpp = hppKnownSales.reduce(
            (total, p) => total + this.hppForSale(p), 0
        );
        const totalLaba = hppKnownSales.reduce(
            (total, p) => total + this.labaForSale(p), 0
        );
        const totalPaid = penjualan.reduce(
            (total, p) => total + this.paidAmount(p.id_penjualan), 0
        );
        const totalBalance = penjualan.reduce(
            (total, p) => total + Math.max(
                0, Number(p.total_penjualan || 0) - this.paidAmount(p.id_penjualan)
            ), 0
        );
        const dataNote = document.getElementById("laporanDataHppNote");
        if (dataNote) {
            dataNote.textContent = legacySalesCount
                ? `${legacySalesCount} transaksi lama belum memiliki snapshot HPP; subtotal HPP dan laba penjualan hanya mencakup transaksi dengan HPP tercatat.`
                : "HPP dan laba penjualan dihitung dari transaksi dengan snapshot biaya yang tercatat.";
        }
        if (salesBody) {
            salesBody.innerHTML = penjualan.length
                ? penjualan.map(p => {
                    const dibayar = this.paidAmount(p.id_penjualan);
                    return `<tr>
                        <td>${Utils.tanggal(p.tanggal_penjualan)}</td>
                        <td>${Utils.escape(p.pelanggan?.nama_pelanggan) || "-"}</td>
                        <td>${Utils.escape(p.produk?.nama_produk || p.persediaan?.nama_barang) || "-"}</td>
                        <td>${Number(p.jumlah_galon || 0)}</td>
                        <td>${Utils.rupiah(p.total_penjualan)}</td>
                        <td>${p.total_hpp == null ? "—" : Utils.rupiah(this.hppForSale(p))}</td>
                        <td>${p.total_hpp == null ? "—" : Utils.rupiah(this.labaForSale(p))}</td>
                        <td>${Utils.rupiah(dibayar)}</td>
                        <td>${Utils.rupiah(Math.max(0, Number(p.total_penjualan || 0) - dibayar))}</td>
                    </tr>`;
                }).join("")
                : `<tr><td colspan="9" class="empty-data">Tidak ada penjualan pada periode ini</td></tr>`;
        }
        if (salesFooter) {
            salesFooter.innerHTML = penjualan.length
                ? `<tr>
                    <td colspan="4">Total periode</td>
                    <td>${Utils.rupiah(totalSales)}</td>
                    <td>${Utils.rupiah(totalHpp)}</td>
                    <td>${Utils.rupiah(totalLaba)}</td>
                    <td>${Utils.rupiah(totalPaid)}</td>
                    <td>${Utils.rupiah(totalBalance)}</td>
                </tr>`
                : "";
        }

        const receiptsBody = document.getElementById("tabelLaporanPenerimaan");
        if (receiptsBody) {
            receiptsBody.innerHTML = penerimaan.length
                ? penerimaan.map(p => `<tr>
                    <td>${Utils.tanggal(p.tanggal_penerimaan)}</td>
                    <td>#${p.id_penjualan}</td>
                    <td>${Utils.escape(p.penjualan?.pelanggan?.nama_pelanggan) || "-"}</td>
                    <td>${Utils.rupiah(p.jumlah_diterima)}</td>
                    <td>${Utils.escape(p.metode_pembayaran)}</td>
                </tr>`).join("")
                : `<tr><td colspan="5" class="empty-data">Tidak ada penerimaan kas pada periode ini</td></tr>`;
        }

        const inventoryBody = document.getElementById("tabelLaporanPersediaan");
        if (inventoryBody) {
            inventoryBody.innerHTML = this.cache.bahanPersediaan.length
                ? this.cache.bahanPersediaan.map(item => `<tr>
                    <td>${Utils.escape(item.nama_bahan)}</td>
                    <td>${Number(item.stok_tersedia || 0)}</td>
                    <td>${Utils.escape(item.satuan)}</td>
                    <td>${Utils.rupiah(item.harga_modal_satuan)}</td>
                </tr>`).join("")
                : `<tr><td colspan="4" class="empty-data">Belum ada data persediaan</td></tr>`;
        }
    },

    hppForSale(sale) {
        return sale.total_hpp == null ? 0 : Number(sale.total_hpp);
    },

    labaForSale(sale) {
        if (sale.total_hpp == null) return 0;
        return sale.laba == null
            ? Number(sale.total_penjualan || 0) - this.hppForSale(sale)
            : Number(sale.laba);
    },

    // =============================================
    // SELECT OPTIONS
    // =============================================
    fillSelects() {
        const selPel = document.getElementById("pelangganPenjualan");
        if (selPel) {
            const cur = selPel.value;
            selPel.innerHTML = `<option value="">Pilih pelanggan</option>` +
                this.cache.pelanggan.map(p =>
                    `<option value="${p.id_pelanggan}">
                            ${Utils.escape(p.nama_pelanggan)}
                    </option>`).join("");
            selPel.value = cur;
        }

        const selPer = document.getElementById("persediaanPenjualan");
        if (selPer) {
            const cur = selPer.value;
            selPer.innerHTML = `<option value="">Pilih Produk</option>` +
                this.cache.persediaan.map(p =>
                    `<option value="${p.id}">
                        ${Utils.escape(p.nama_produk)} (HPP: ${Utils.rupiah(p.hpp_per_unit)})
                    </option>`).join("");
            selPer.value = cur;
        }

        const selProdukKomposisi = document.getElementById("produkKomposisi");
        if (selProdukKomposisi) {
            const cur = selProdukKomposisi.value;
            selProdukKomposisi.innerHTML = `<option value="">Pilih produk</option>` +
                this.cache.persediaan.map(item =>
                    `<option value="${item.id}">${Utils.escape(item.nama_produk)}</option>`
                ).join("");
            selProdukKomposisi.value = cur;
        }

        ["bahanKulakan", "bahanKomposisi"].forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            const current = select.value;
            select.innerHTML = `<option value="">Pilih bahan persediaan</option>` +
                this.cache.bahanPersediaan.map(item =>
                    `<option value="${item.id}">${Utils.escape(item.nama_bahan)} (${Utils.escape(item.satuan)})</option>`
                ).join("");
            select.value = current;
        });

        const selPen = document.getElementById("penjualanPenerimaan");
        if (selPen) {
            const cur = selPen.value;
            selPen.innerHTML = `<option value="">Pilih Transaksi</option>` +
                this.cache.piutang.map(row =>
                    `<option value="${row.id_penjualan}">
                        #${row.id_penjualan} —
                        ${Utils.escape(row.nama_pelanggan) || "-"} —
                            Sisa ${Utils.rupiah(row.sisa_piutang)}
                    </option>`).join("");
            selPen.value = cur;
        }

        this.bindInventoryDependents();
    },

    bindInventoryDependents() {
        const selectPersediaan = document.getElementById("persediaanPenjualan");
        const hargaInput = document.getElementById("hargaPerGalon");
        const jumlahInput = document.getElementById("jumlahGalon");

        if (selectPersediaan && hargaInput) {
            selectPersediaan.onchange = () => {
                const selectedId = Number(selectPersediaan.value);
                const item = this.cache.persediaan.find(p => Number(p.id) === selectedId);
                if (item) {
                    hargaInput.value = Number(item.harga_jual || 0);
                    if (jumlahInput && !jumlahInput.value) {
                        jumlahInput.value = 1;
                    }
                } else {
                    hargaInput.value = "";
                }
            };
        }

        const penjualanSelect = document.getElementById("penjualanPenerimaan");
        const jumlahDiterimaInput = document.getElementById("jumlahDiterima");

        if (penjualanSelect && jumlahDiterimaInput) {
            penjualanSelect.onchange = () => {
                const selectedId = Number(penjualanSelect.value);
                const item = this.cache.piutang.find(
                    row => Number(row.id_penjualan) === selectedId
                );
                if (item) {
                    const sisa = Number(item.sisa_piutang || 0);
                    jumlahDiterimaInput.value = sisa;
                    jumlahDiterimaInput.max = sisa;
                } else {
                    jumlahDiterimaInput.value = "";
                    jumlahDiterimaInput.removeAttribute("max");
                }
            };
        }
    },

    // =============================================
    // DASHBOARD
    // =============================================
    updateDashboard() {
        const totalPelanggan = this.cache.pelanggan.length;
        const totalTransaksi = this.cache.penjualan.length;
        const totalPenjualan = this.cache.penjualan.reduce(
            (a, p) => a + Number(p.total_penjualan || 0), 0
        );
        const totalPenerimaan = this.cache.penerimaan.reduce(
            (a, p) => a + Number(p.jumlah_diterima || 0), 0
        );
        const totalPersediaan = this.cache.bahanPersediaan
            .filter(item => item.jenis_item === "produk_pabrikan")
            .reduce((total, item) => total + Number(item.stok_tersedia || 0), 0);
        const penjualanDenganHpp = this.cache.penjualan.filter(p => p.total_hpp != null);
        const totalHpp = penjualanDenganHpp.reduce(
            (total, sale) => total + this.hppForSale(sale), 0
        );
        const laba = penjualanDenganHpp.reduce(
            (total, sale) => total + this.labaForSale(sale), 0
        );

        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        set("totalPelanggan", totalPelanggan);
        set("totalTransaksi", totalTransaksi);
        set("totalPenjualan", Utils.rupiah(totalPenjualan));
        set("totalPenerimaan", Utils.rupiah(totalPenerimaan));
        set("totalPersediaan", totalPersediaan);
        set("totalHppDashboard", Utils.rupiah(totalHpp));
        set("labaDashboard", Utils.rupiah(laba));
        this.renderProfitChart(penjualanDenganHpp, totalHpp, laba);
    },

    renderProfitChart(penjualanDenganHpp, totalHpp, laba) {
        const canvas = document.getElementById("dashboardProfitChart");
        const note = document.getElementById("dashboardChartNote");
        if (!canvas) return;
        if (typeof Chart === "undefined") {
            if (note) note.textContent = "Grafik tidak tersedia. Periksa koneksi untuk memuat Chart.js.";
            return;
        }

        const omittedTransactions = this.cache.penjualan.length - penjualanDenganHpp.length;
        if (note) {
            if (laba < 0) {
                note.textContent = "Laba penjualan negatif; nilai ditampilkan pada kartu KPI karena diagram pie tidak dapat mewakili nilai negatif.";
            } else if (omittedTransactions) {
                note.textContent = `${omittedTransactions} transaksi lama tanpa snapshot HPP tidak disertakan dalam grafik.`;
            } else {
                note.textContent = penjualanDenganHpp.length
                    ? "Grafik menggunakan HPP dan laba penjualan dari seluruh transaksi yang tercatat."
                    : "Belum ada transaksi dengan snapshot HPP untuk ditampilkan.";
            }
        }

        const chartData = [totalHpp, Math.max(laba, 0)];
        const chartLabels = ["HPP", "Laba Penjualan"];
        if (!this.profitChart) {
            this.profitChart = new Chart(canvas, {
                type: "pie",
                data: {
                    labels: chartLabels,
                    datasets: [{
                        data: chartData,
                        backgroundColor: ["#63a9cf", "#57b894"],
                        borderColor: ["#f9fcfe", "#f9fcfe"],
                        borderWidth: 3,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: "bottom",
                            labels: {
                                color: "#426c82",
                                padding: 18,
                                usePointStyle: true,
                                pointStyle: "circle"
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: context => {
                                    const total = context.dataset.data.reduce(
                                        (sum, value) => sum + Number(value || 0), 0
                                    );
                                    const value = Number(context.raw || 0);
                                    const percent = total > 0 ? value / total * 100 : 0;
                                    return ` ${context.label}: ${Utils.rupiah(value)} (${percent.toFixed(1)}%)`;
                                }
                            }
                        }
                    }
                }
            });
            return;
        }

        this.profitChart.data.labels = chartLabels;
        this.profitChart.data.datasets[0].data = chartData;
        this.profitChart.update();
    }
};

// Ekspos App ke window agar tombol hapus (onclick) bisa akses
window.App = App;

const Auth = {
    isAuthenticated: false,
    appInitialized: false,

    bind() {
        const loginForm = document.getElementById("loginForm");
        const loginMessage = document.getElementById("loginMessage");
        const submitButton = document.getElementById("loginSubmit");
        const passwordInput = document.getElementById("loginPassword");

        loginForm?.addEventListener("submit", async event => {
            event.preventDefault();
            loginMessage.textContent = "";

            const username = document.getElementById("loginUsername").value.trim();
            const password = passwordInput.value;
            if (username.toLocaleLowerCase("id-ID") !== CONFIG.AUTH_USERNAME.toLocaleLowerCase("id-ID")) {
                loginMessage.textContent = "Username atau password tidak sesuai.";
                return;
            }

            submitButton.disabled = true;
            submitButton.querySelector("span").textContent = "Sedang masuk...";
            try {
                const { error } = await sb.auth.signInWithPassword({
                    email: CONFIG.AUTH_EMAIL,
                    password
                });
                if (error) {
                    console.warn("[Auth] Login gagal:", error.message);
                    loginMessage.textContent = "Username atau password tidak sesuai.";
                }
            } catch (error) {
                console.error("[Auth] Tidak dapat menghubungi layanan login:", error);
                loginMessage.textContent = "Tidak dapat terhubung ke layanan login.";
            } finally {
                submitButton.disabled = false;
                submitButton.querySelector("span").textContent = "Masuk ke Aplikasi";
            }

        });

        document.getElementById("togglePassword")?.addEventListener("click", event => {
            const button = event.currentTarget;
            const showing = passwordInput.type === "password";
            passwordInput.type = showing ? "text" : "password";
            button.setAttribute("aria-pressed", String(showing));
            button.setAttribute(
                "aria-label",
                showing ? "Sembunyikan password" : "Tampilkan password"
            );
            button.innerHTML = `<i class="fa-regular fa-eye${showing ? "-slash" : ""}" aria-hidden="true"></i>`;
        });

        document.getElementById("logoutButton")?.addEventListener("click", async event => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                const { error } = await sb.auth.signOut();
                if (error) throw error;
            } catch (error) {
                console.error("[Auth] Gagal keluar:", error);
                alert("Gagal keluar dari aplikasi. Silakan coba kembali.");
            } finally {
                button.disabled = false;
            }
        });

        sb.auth.onAuthStateChange((_event, session) => {
            window.setTimeout(() => {
                this.applySession(session).catch(error => {
                    console.error("[Auth] Gagal menerapkan sesi:", error);
                    loginMessage.textContent = "Gagal membuka aplikasi. Muat ulang halaman.";
                });
            }, 0);
        });

        sb.auth.getSession().then(({ data, error }) => {
            if (error) {
                console.error("[Auth] Gagal memeriksa sesi:", error);
                loginMessage.textContent = "Sesi tidak dapat diperiksa. Muat ulang halaman.";
                return;
            }
            this.applySession(data.session);
        }).catch(error => {
            console.error("[Auth] Gagal memeriksa sesi:", error);
            loginMessage.textContent = "Tidak dapat terhubung ke layanan login.";
        });
    },

    async applySession(session) {
        const loginScreen = document.getElementById("loginScreen");
        const appShell = document.getElementById("appShell");

        if (!session) {
            loginScreen.classList.remove("hidden");
            appShell.classList.add("hidden");

            if (this.isAuthenticated) {
                this.isAuthenticated = false;
                if (App.realtimeChannel) {
                    await App.realtimeChannel.unsubscribe();
                    App.realtimeChannel = null;
                }
                if (App.bahanRealtimeChannel) {
                    await App.bahanRealtimeChannel.unsubscribe();
                    App.bahanRealtimeChannel = null;
                }
                if (App.penjualanRealtimeChannel) {
                    await App.penjualanRealtimeChannel.unsubscribe();
                    App.penjualanRealtimeChannel = null;
                }
                Object.keys(App.cache).forEach(key => {
                    App.cache[key] = [];
                });
            }
            return;
        }

        loginScreen.classList.add("hidden");
        appShell.classList.remove("hidden");
        document.getElementById("loginPassword").value = "";
        if (this.isAuthenticated) return;

        this.isAuthenticated = true;
        if (!this.appInitialized) {
            this.appInitialized = true;
            await App.init();
        } else {
            App.setupRealtime();
            await App.refreshAll();
        }
    }
};

// =====================================================
// BOOT
// =====================================================
document.addEventListener("DOMContentLoaded", () => {
    Auth.bind();
    document.getElementById("loginUsername").value = CONFIG.AUTH_USERNAME;
});