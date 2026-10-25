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
        penjualan: [],
        penerimaan: [],
        piutang: [],
        penyerahan: []
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
                table: CONFIG.TABLES.PERSEDIAAN
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
                table: CONFIG.TABLES.PERSEDIAAN
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
                table: CONFIG.TABLES.PERSEDIAAN
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
            this.loadPenjualan(),
            this.loadPenerimaan(),
            this.loadPiutang(),
            this.loadPenyerahan()
        ]);
        this.renderPenjualan();
        this.updateDashboard();
        this.fillSelects();
        this.renderLaporan();
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
            () => sb.from(CONFIG.TABLES.PERSEDIAAN)
              .select("*")
              .order("id_persediaan", { ascending: true }),
            "memuat persediaan"
        );
        if (data === null) {
            const tbody = document.getElementById("tabelPersediaan");
            if (tbody) {
                tbody.innerHTML = `
                    <tr><td colspan="7" class="empty-data">
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

    async simpanHargaPersediaan(id) {
        const input = document.querySelector(`input[data-role="harga-persediaan"][data-id="${id}"]`);
        if (!input) return;

        const harga = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(harga) || harga < 0) {
            alert("Harga tidak valid.");
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

        if (!nama_barang) return alert("Nama barang wajib diisi.");
        if (isNaN(stok) || stok < 0) return alert("Stok tidak valid.");
        if (!hargaInput || !Number.isFinite(harga) || harga < 0) {
            return alert("Harga per galon tidak valid.");
        }

        const existing = await Utils.guard(
            sb.from(CONFIG.TABLES.PERSEDIAAN)
              .select("id_persediaan, stok")
              .ilike("nama_barang", nama_barang)
              .limit(1),
            "cek persediaan yang sudah ada"
        );
        if (existing === null) return;

        const payloadBase = {
            satuan,
            updated_at: new Date().toISOString()
        };

        if (existing && existing.length > 0) {
            const item = existing[0];
            const stokBaru = Number(item.stok || 0) + stok;
            const payload = {
                ...payloadBase,
                stok: stokBaru,
                harga
            };

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

        const insertPayload = { nama_barang, stok, satuan, harga };

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
        const data = await Utils.fetchAll(
            () => sb.from(CONFIG.TABLES.PENJUALAN)
              .select(`
                id_penjualan,
                tanggal_penjualan,
                jumlah_galon,
                harga_per_galon,
                total_penjualan,
                status_pembayaran,
                jenis_pembayaran,
                status_penyerahan,
                id_pelanggan,
                id_persediaan,
                pelanggan ( nama_pelanggan ),
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
                    <td>${Utils.escape(p.persediaan?.nama_barang) || "-"}</td>
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
        const jenis_pembayaran = document.getElementById("jenisPembayaranPenjualan").value;

        if (!id_pelanggan) return alert("Pelanggan wajib dipilih dari Master Data.");
        if (!id_persediaan) return alert("Persediaan wajib dipilih.");
        if (!jumlah_galon || jumlah_galon <= 0)
            return alert("Jumlah galon tidak valid.");
        if (isNaN(harga_per_galon) || harga_per_galon < 0)
            return alert("Harga per galon tidak valid.");
        if (!["Tunai", "Kredit"].includes(jenis_pembayaran))
            return alert("Pilih jenis pembayaran tunai atau kredit.");

        const result = await Utils.guard(
            sb.from(CONFIG.TABLES.PENJUALAN).insert({
                id_pelanggan,
                id_persediaan,
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
        set("laporanTotalPenerimaan", Utils.rupiah(
            penerimaan.reduce((total, p) => total + Number(p.jumlah_diterima || 0), 0)
        ));
        set("laporanSaldoPiutang", Utils.rupiah(
            this.cache.penjualan.reduce((total, p) => total + Math.max(
                0, Number(p.total_penjualan || 0) - this.paidAmount(p.id_penjualan)
            ), 0)
        ));

        const salesBody = document.getElementById("tabelLaporanPenjualan");
        if (salesBody) {
            salesBody.innerHTML = penjualan.length
                ? penjualan.map(p => {
                    const dibayar = this.paidAmount(p.id_penjualan);
                    return `<tr>
                        <td>${Utils.tanggal(p.tanggal_penjualan)}</td>
                        <td>${Utils.escape(p.pelanggan?.nama_pelanggan) || "-"}</td>
                        <td>${Utils.escape(p.persediaan?.nama_barang) || "-"}</td>
                        <td>${Number(p.jumlah_galon || 0)}</td>
                        <td>${Utils.rupiah(p.total_penjualan)}</td>
                        <td>${Utils.rupiah(dibayar)}</td>
                        <td>${Utils.rupiah(Math.max(0, Number(p.total_penjualan || 0) - dibayar))}</td>
                    </tr>`;
                }).join("")
                : `<tr><td colspan="7" class="empty-data">Tidak ada penjualan pada periode ini</td></tr>`;
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
            inventoryBody.innerHTML = this.cache.persediaan.length
                ? this.cache.persediaan.map(item => `<tr>
                    <td>${Utils.escape(item.nama_barang)}</td>
                    <td>${Number(item.stok || 0)}</td>
                    <td>${Utils.escape(item.satuan)}</td>
                    <td>${Utils.rupiah(item.harga)}</td>
                </tr>`).join("")
                : `<tr><td colspan="4" class="empty-data">Belum ada data persediaan</td></tr>`;
        }
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