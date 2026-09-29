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
            if (msg.includes("Stok tidak mencukupi")) {
                msg = "Stok tidak mencukupi untuk transaksi ini.";
            } else if (msg.includes("tidak ditemukan")) {
                msg = "Data persediaan tidak ditemukan.";
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
        penjualan: [],
        penerimaan: []
    },

    // ---------------------------------------------
    // INIT
    // ---------------------------------------------
    async init() {
        console.log("[App] init() mulai...");
        this.bindNav();
        this.bindForms();
        this.setDefaultDates();
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
                table: CONFIG.TABLES.PERSEDIAAN
            },
            async () => {
                console.log("[Realtime] INSERT persediaan terdeteksi");
                await this.loadPersediaan();
                this.fillSelects();
                this.updateDashboard();
            }
        );

        channel.on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: CONFIG.TABLES.PERSEDIAAN
            },
            async () => {
                console.log("[Realtime] UPDATE persediaan terdeteksi");
                await this.loadPersediaan();
                this.fillSelects();
                this.updateDashboard();
            }
        );

        channel.on(
            "postgres_changes",
            {
                event: "DELETE",
                schema: "public",
                table: CONFIG.TABLES.PERSEDIAAN
            },
            async () => {
                console.log("[Realtime] DELETE persediaan terdeteksi");
                await this.loadPersediaan();
                this.fillSelects();
                this.updateDashboard();
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
    },

    // ---------------------------------------------
    // BIND FORMS
    // ---------------------------------------------
    bindForms() {
        const formPersediaan = document.getElementById("formPersediaan");
        if (formPersediaan) {
            formPersediaan.addEventListener("submit", async (e) => {
                e.preventDefault();
                await this.simpanPersediaan();
            });
        }

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
    },

    // ---------------------------------------------
    // REFRESH SEMUA DATA
    // ---------------------------------------------
    async refreshAll() {
        await Promise.all([
            this.loadPelanggan(),
            this.loadPersediaan(),
            this.loadPenjualan(),
            this.loadPenerimaan()
        ]);
        this.updateDashboard();
        this.fillSelects();
    },

    // =============================================
    // PELANGGAN
    // =============================================
    async loadPelanggan() {
        console.log("[App] loadPelanggan() ...");
        const data = await Utils.guard(
            sb.from(CONFIG.TABLES.PELANGGAN)
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

        tbody.innerHTML = this.cache.pelanggan.map((p, i) => `
            <tr>
                <td>${i + 1}</td>
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
        const data = await Utils.guard(
            sb.from(CONFIG.TABLES.PERSEDIAAN)
              .select("*")
              .order("id_persediaan", { ascending: true }),
            "memuat persediaan"
        );
        if (data === null) {
            const tbody = document.getElementById("tabelPersediaan");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="6" class="empty-data">
                        <i class="fa-solid fa-triangle-exclamation"></i><br>
                        Gagal memuat data. Cek Console (F12).
                    </td></tr>`;
            }
            return;
        }
        this.cache.persediaan = data || [];
        console.log(`[App] persediaan: ${this.cache.persediaan.length} baris`);
        this.renderPersediaan();
    },

    renderPersediaan() {
        const tbody = document.getElementById("tabelPersediaan");
        if (!tbody) return;

        if (!this.cache.persediaan.length) {
            tbody.innerHTML = `
                <tr><td colspan="7" class="empty-data">
                    <i class="fa-solid fa-box-open"></i><br>
                    Belum ada data persediaan
                </td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.persediaan.map((p, i) => {
            let kelas = "stok-normal";
            if (p.stok === 0) kelas = "stok-habis";
            else if (p.stok <= 10) kelas = "stok-sedikit";

            const hargaSaatIni = Number(p.harga || 0);

            return `
                <tr>
                    <td>${i + 1}</td>
                    <td>${Utils.escape(p.nama_barang)}</td>
                    <td><span class="${kelas}">${p.stok}</span></td>
                    <td>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input
                                type="number"
                                min="0"
                                value="${hargaSaatIni}"
                                data-id="${p.id_persediaan}"
                                data-role="harga-persediaan"
                                style="width:110px; padding:6px 8px; border:1px solid #d9d9d9; border-radius:8px;"
                            >
                            <button
                                type="button"
                                class="btn-primary"
                                style="padding:6px 10px; font-size:12px;"
                                onclick="App.simpanHargaPersediaan(${p.id_persediaan})"
                            >
                                Simpan
                            </button>
                        </div>
                    </td>
                    <td>${Utils.escape(p.satuan)}</td>
                    <td>${Utils.tanggal(p.updated_at)}</td>
                    <td>
                        <button class="btn-delete"
                            onclick="App.hapusPersediaan(${p.id_persediaan})">
                            <i class="fa-solid fa-trash"></i> Hapus
                        </button>
                    </td>
                </tr>`;
        }).join("");
    },

    async hasPersediaanHargaColumn() {
        try {
            const { error } = await sb
                .from(CONFIG.TABLES.PERSEDIAAN)
                .select("harga")
                .limit(1);

            return !error;
        } catch {
            return false;
        }
    },

    async simpanHargaPersediaan(id) {
        const input = document.querySelector(`input[data-role="harga-persediaan"][data-id="${id}"]`);
        if (!input) return;

        const harga = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(harga) || harga < 0) {
            alert("Harga tidak valid.");
            return;
        }

        const hasHarga = await this.hasPersediaanHargaColumn();
        if (!hasHarga) {
            alert("Kolom harga belum tersedia di tabel persediaan. Jalankan SQL untuk menambah kolom harga.");
            return;
        }

        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PERSEDIAAN)
              .update({
                  harga,
                  updated_at: new Date().toISOString()
              })
              .eq("id_persediaan", id)
              .select("id_persediaan"),
            "update harga persediaan"
        );

        if (!result) return;
        if (result.length === 0) {
            alert("Harga tidak tersimpan. Periksa izin update (RLS) dan ID persediaan.");
            return;
        }

        await this.loadPersediaan();
        this.fillSelects();
        this.updateDashboard();
        alert("Harga persediaan berhasil diperbarui.");
    },

    async simpanPersediaan() {
        const nama_barang = document.getElementById("namaBarang").value.trim();
        const stok = parseInt(document.getElementById("stok").value, 10);
        const hargaInput = document.getElementById("hargaPersediaan");
        const harga = hargaInput ? parseFloat(hargaInput.value) : NaN;
        const satuan = document.getElementById("satuan").value.trim() || "Galon";
        const hasHarga = await this.hasPersediaanHargaColumn();

        if (!nama_barang) return alert("Nama barang wajib diisi.");
        if (isNaN(stok) || stok < 0) return alert("Stok tidak valid.");
        if (hasHarga && hargaInput && (isNaN(harga) || harga < 0)) {
            return alert("Harga per galon tidak valid.");
        }

        const existing = await Utils.guard(
            sb.from(CONFIG.TABLES.PERSEDIAAN)
              .select("id_persediaan, stok")
              .ilike("nama_barang", nama_barang)
              .limit(1),
            "cek persediaan yang sudah ada"
        );

        const payloadBase = {
            satuan,
            updated_at: new Date().toISOString()
        };

        if (existing && existing.length > 0) {
            const item = existing[0];
            const stokBaru = Number(item.stok || 0) + stok;
            const payload = {
                ...payloadBase,
                stok: stokBaru
            };

            if (hasHarga && hargaInput) {
                payload.harga = harga;
            }

            const result = await Utils.guard(
                sb.from(CONFIG.TABLES.PERSEDIAAN)
                  .update(payload)
                  .eq("id_persediaan", item.id_persediaan)
                  .select(),
                "menambah stok persediaan"
            );

            if (!result) return;

            document.getElementById("formPersediaan").reset();
            document.getElementById("satuan").value = "Galon";
            await this.loadPersediaan();
            this.fillSelects();
            this.updateDashboard();
            alert(`Stok berhasil ditambah. Total stok ${nama_barang}: ${stokBaru}.`);
            return;
        }

        const insertPayload = { nama_barang, stok, satuan };
        if (hasHarga && hargaInput) {
            insertPayload.harga = harga;
        }

        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PERSEDIAAN)
              .insert(insertPayload)
              .select(),
            "menyimpan persediaan baru"
        );

        if (!result) return;

        document.getElementById("formPersediaan").reset();
        document.getElementById("satuan").value = "Galon";
        await this.loadPersediaan();
        this.fillSelects();
        this.updateDashboard();
        alert("Persediaan baru berhasil ditambahkan.");
    },

    async hapusPersediaan(id) {
        if (!confirm("Hapus persediaan ini?")) return;
        const ok = await Utils.guard(
            sb.from(CONFIG.TABLES.PERSEDIAAN)
              .delete().eq("id_persediaan", id),
            "menghapus persediaan"
        );
        if (ok === null) return;
        await this.loadPersediaan();
        this.fillSelects();
        this.updateDashboard();
    },

    // =============================================
    // PENJUALAN
    // =============================================
    async loadPenjualan() {
        console.log("[App] loadPenjualan() ...");
        const data = await Utils.guard(
            sb.from(CONFIG.TABLES.PENJUALAN)
              .select(`
                id_penjualan,
                tanggal_penjualan,
                jumlah_galon,
                harga_per_galon,
                total_penjualan,
                status_pembayaran,
                id_pelanggan,
                id_persediaan,
                pelanggan ( nama_pelanggan ),
                persediaan ( nama_barang )
              `)
              .order("id_penjualan", { ascending: false }),
            "memuat penjualan"
        );
        if (data === null) {
            const tbody = document.getElementById("tabelPenjualan");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="9" class="empty-data">
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
                <tr><td colspan="9" class="empty-data">
                    <i class="fa-solid fa-cart-shopping"></i><br>
                    Belum ada data penjualan
                </td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.penjualan.map((p, i) => {
            const lunas = p.status_pembayaran === "Lunas";
            const statusCls = lunas ? "status-lunas" : "status-belum";
            return `
                <tr>
                    <td>${i + 1}</td>
                    <td>${Utils.tanggal(p.tanggal_penjualan)}</td>
                    <td>${Utils.escape(p.pelanggan?.nama_pelanggan) || "-"}</td>
                    <td>${Utils.escape(p.persediaan?.nama_barang) || "-"}</td>
                    <td>${p.jumlah_galon}</td>
                    <td>${Utils.rupiah(p.harga_per_galon)}</td>
                    <td>${Utils.rupiah(p.total_penjualan)}</td>
                    <td><span class="status ${statusCls}">
                        ${p.status_pembayaran}
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

    async simpanPenjualan() {
        const nama = document.getElementById("namaPelangganPenjualan").value.trim();
        const no_hp = document.getElementById("noHpPenjualan").value.trim();
        const alamat = document.getElementById("alamatPenjualan").value.trim();
        const id_persediaan = parseInt(
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

        if (!nama) return alert("Nama pelanggan wajib diisi.");
        if (!id_persediaan) return alert("Persediaan wajib dipilih.");
        if (!jumlah_galon || jumlah_galon <= 0)
            return alert("Jumlah galon tidak valid.");
        if (isNaN(harga_per_galon) || harga_per_galon < 0)
            return alert("Harga per galon tidak valid.");

        const pelangganInsert = await Utils.guard(
            sb.from(CONFIG.TABLES.PELANGGAN)
              .insert({ nama_pelanggan: nama, no_hp, alamat })
              .select(),
            "menyimpan pelanggan dari penjualan"
        );

        if (!pelangganInsert || !pelangganInsert.length) return;

        const id_pelanggan = pelangganInsert[0].id_pelanggan;

        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PENJUALAN).insert({
                id_pelanggan,
                id_persediaan,
                tanggal_penjualan,
                jumlah_galon,
                harga_per_galon,
                status_pembayaran: "Belum Lunas"
            }).select(),
            "menyimpan penjualan"
        );
        if (!result) return;

        document.getElementById("formPenjualan").reset();
        document.getElementById("namaPelangganPenjualan").value = "";
        document.getElementById("noHpPenjualan").value = "";
        document.getElementById("alamatPenjualan").value = "";
        this.setDefaultDates();

        await this.loadPenjualan();
        await this.loadPersediaan();
        this.fillSelects();
        this.updateDashboard();
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
        await this.loadPersediaan();
        this.fillSelects();
        this.updateDashboard();
    },

    // =============================================
    // PENERIMAAN KAS
    // =============================================
    async loadPenerimaan() {
        console.log("[App] loadPenerimaan() ...");
        const data = await Utils.guard(
            sb.from(CONFIG.TABLES.PENERIMAAN)
              .select(`
                id_penerimaan,
                id_penjualan,
                tanggal_penerimaan,
                jumlah_diterima,
                metode_pembayaran
              `)
              .order("id_penerimaan", { ascending: false }),
            "memuat penerimaan"
        );
        if (data === null) {
            const tbody = document.getElementById("tabelPenerimaan");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="6" class="empty-data">
                        <i class="fa-solid fa-triangle-exclamation"></i><br>
                        Gagal memuat data. Cek Console (F12).
                    </td></tr>`;
            }
            return;
        }
        this.cache.penerimaan = data || [];
        console.log(`[App] penerimaan: ${this.cache.penerimaan.length} baris`);
        this.renderPenerimaan();
    },

    renderPenerimaan() {
        const tbody = document.getElementById("tabelPenerimaan");
        if (!tbody) return;

        if (!this.cache.penerimaan.length) {
            tbody.innerHTML = `
                <tr><td colspan="6" class="empty-data">
                    <i class="fa-solid fa-money-bill-wave"></i><br>
                    Belum ada data penerimaan kas
                </td></tr>`;
            return;
        }

        tbody.innerHTML = this.cache.penerimaan.map((p, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${Utils.tanggal(p.tanggal_penerimaan)}</td>
                <td>#${p.id_penjualan}</td>
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
        if (isNaN(jumlah_diterima) || jumlah_diterima <= 0)
            return alert("Jumlah diterima tidak valid.");
        if (!metode_pembayaran) return alert("Metode pembayaran wajib dipilih.");

        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PENERIMAAN).insert({
                id_penjualan,
                tanggal_penerimaan,
                jumlah_diterima,
                metode_pembayaran
            }).select(),
            "menyimpan penerimaan"
        );
        if (!result) return;

        document.getElementById("formPenerimaan").reset();
        this.setDefaultDates();

        await Utils.guard(
            sb.from(CONFIG.TABLES.PENJUALAN)
              .update({ status_pembayaran: "Lunas" })
              .eq("id_penjualan", id_penjualan),
            "update status penjualan"
        );

        await this.loadPenerimaan();
        await this.loadPenjualan();
        this.fillSelects();
        this.updateDashboard();
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
        this.updateDashboard();
    },

    // =============================================
    // SELECT OPTIONS
    // =============================================
    fillSelects() {
        const selPer = document.getElementById("persediaanPenjualan");
        if (selPer) {
            const cur = selPer.value;
            selPer.innerHTML = `<option value="">Pilih Persediaan</option>` +
                this.cache.persediaan.map(p =>
                    `<option value="${p.id_persediaan}">
                        ${Utils.escape(p.nama_barang)} (stok: ${p.stok})
                    </option>`).join("");
            selPer.value = cur;
        }

        const selPen = document.getElementById("penjualanPenerimaan");
        if (selPen) {
            const cur = selPen.value;
            const belumLunas = this.cache.penjualan.filter(
                p => p.status_pembayaran === "Belum Lunas"
            );
            selPen.innerHTML = `<option value="">Pilih Transaksi</option>` +
                belumLunas.map(p =>
                    `<option value="${p.id_penjualan}">
                        #${p.id_penjualan} —
                        ${Utils.escape(p.pelanggan?.nama_pelanggan) || "-"} —
                        ${Utils.rupiah(p.total_penjualan)}
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
                const item = this.cache.persediaan.find(p => Number(p.id_persediaan) === selectedId);
                if (item) {
                    hargaInput.value = Number(item.harga || 0);
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
                const item = this.cache.penjualan.find(p => Number(p.id_penjualan) === selectedId);
                if (item) {
                    const total = Number(item.total_penjualan || 0);
                    jumlahDiterimaInput.value = total;
                } else {
                    jumlahDiterimaInput.value = "";
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
        const totalPersediaan = this.cache.persediaan.reduce(
            (a, p) => a + Number(p.stok || 0), 0
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
    }
};

// Ekspos App ke window agar tombol hapus (onclick) bisa akses
window.App = App;

// =====================================================
// BOOT
// =====================================================
document.addEventListener("DOMContentLoaded", () => {
    App.init().catch(err => {
        console.error("[FATAL] Gagal init:", err);
        alert("Terjadi kesalahan fatal. Cek Console (F12).");
    });
});