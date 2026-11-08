// js/saw.js — SAW dengan bobot AHP untuk WebGIS Wisata Kulon Progo
// Bobot kriteria dari AHP; preferensi/filter diisi user lewat pertanyaan interaktif.

/* ========== 1. KRITERIA & AHP ========== */

export const CRITERIA = [
  { code: 'C1', name: 'Waktu tempuh',    type: 'cost',    key: 'waktu_tempuh' }, // menit (OSRM)
  { code: 'C2', name: 'Biaya kunjungan', type: 'cost',    key: 'biaya' },        // Rp/orang (tiket + makan)
  { code: 'C3', name: 'Rating',          type: 'benefit', key: 'rating' },       // skala 1-5
  { code: 'C4', name: 'Jumlah ulasan',   type: 'benefit', key: 'ulasan' },       // ulasan
];

// Matriks perbandingan berpasangan (geomean 5 responden)
export const AHP_MATRIX = [
  [1,    2,    2, 4],
  [1/2,  1,    4, 4],
  [1/2,  1/4,  1, 1],
  [1/4,  1/4,  1, 1],
];

const RI = { 1: 0, 2: 0, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41 };

/** Bobot AHP via geometric mean baris, dinormalisasi. */
export function ahpWeights(matrix = AHP_MATRIX) {
  const n = matrix.length;
  const gm = matrix.map(row => Math.pow(row.reduce((a, b) => a * b, 1), 1 / n));
  const sum = gm.reduce((a, b) => a + b, 0);
  return gm.map(g => g / sum);
}

/** Uji konsistensi AHP (CR <= 0.1 dianggap konsisten). */
export function ahpConsistency(matrix = AHP_MATRIX, w = ahpWeights(matrix)) {
  const n = matrix.length;
  const ratios = matrix.map((row, i) => row.reduce((s, v, j) => s + v * w[j], 0) / w[i]);
  const lambdaMax = ratios.reduce((a, b) => a + b, 0) / n;
  const CI = (lambdaMax - n) / (n - 1);
  const CR = RI[n] ? CI / RI[n] : 0;
  return { lambdaMax, CI, CR, consistent: CR <= 0.1 };
}

export const WEIGHTS = ahpWeights(); // [C1..C4] ≈ [0.4187, 0.3521, 0.1245, 0.1047]

/* ========== 2. PILIHAN PERTANYAAN INTERAKTIF ========== */

// Nilai pilihan di UI -> teks kolom `kategori` di database (null = Bebas)
export const KATEGORI = {
  alam:               'Wisata Alam',
  alam_buatan:        'Wisata Alam-Buatan',
  budaya_religi:      'Religi dan Budaya',   // di UI tertulis "Budaya dan Religi"
  agrowisata:         'Agrowisata',
  akomodasi_rekreasi: 'Akomodasi dan Rekreasi',
  bebas:              null,
};

export const CONFIG = {
  // Database belum punya durasi kunjungan -> pakai durasi minimal di lokasi (menit)
  durasiKunjungan: 60,
  // Waktu user dianggap termasuk perjalanan pulang-pergi
  roundTrip: true,
  // Estimasi makan dari rentang makan_min..makan_max: 'min' | 'mid' | 'max'
  makan: 'mid',
  osrmUrl: 'https://router.project-osrm.org',
  osrmChunk: 90,          // batas koordinat per request OSRM demo (100)
  fallbackSpeedKmh: 40,   // dipakai kalau OSRM gagal
};

/* ========== 3. DATA: GeoJSON -> alternatif ========== */

/** Biaya kunjungan per orang = tiket masuk + estimasi makan. (harga_paket tidak dipakai) */
export function hitungBiaya(p, cfg = CONFIG) {
  const tiket = p.harga_masuk ?? 0;
  const { makan_min: lo, makan_max: hi } = p;
  let makan = 0;
  if (lo != null && hi != null) makan = cfg.makan === 'min' ? lo : cfg.makan === 'max' ? hi : (lo + hi) / 2;
  else if (lo != null || hi != null) makan = lo ?? hi;
  return tiket + makan;
}

export function featureToAlt(f, cfg = CONFIG) {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  return {
    id: p.id, nama: p.nama, kategori: p.kategori, lat, lng,
    biaya: hitungBiaya(p, cfg),
    rating: p.rating,                 // bisa null (belum ada rating)
    ulasan: p.jumlah_ulasan ?? 0,
    durasi: cfg.durasiKunjungan,
    properties: p,
  };
}

/* ========== 4. WAKTU TEMPUH (OSRM) ========== */

function haversineKm(a, b) {
  const R = 6371, rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function osrmChunk(origin, dests, cfg) {
  const coords = [origin, ...dests].map(p => `${p.lng},${p.lat}`).join(';');
  const res = await fetch(`${cfg.osrmUrl}/table/v1/driving/${coords}?sources=0&annotations=duration`);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error(json.code);
  return json.durations[0].slice(1).map(s => (s == null ? null : s / 60));
}

/** Waktu tempuh (menit) dari origin ke tiap tujuan. origin/tujuan: {lat, lng} */
export async function getTravelMinutes(origin, dests, cfg = CONFIG) {
  const out = [];
  try {
    for (let i = 0; i < dests.length; i += cfg.osrmChunk) {
      out.push(...await osrmChunk(origin, dests.slice(i, i + cfg.osrmChunk), cfg));
    }
    return out;
  } catch (err) {
    console.warn('OSRM gagal, pakai estimasi jarak lurus:', err.message);
    return dests.map(d => (haversineKm(origin, d) / cfg.fallbackSpeedKmh) * 60 * 1.3);
  }
}

/* ========== 5. FILTER (jawaban user) ========== */
// null = "Tidak dibatasi" / "Bebas" -> filter dilewati

export function filterKategori(alts, kategori) {
  const target = KATEGORI[kategori] ?? null;
  return target ? alts.filter(a => a.kategori === target) : alts;
}
export function filterRating(alts, ratingMin) {
  return ratingMin == null ? alts : alts.filter(a => a.rating != null && a.rating >= ratingMin);
}
export function filterAnggaran(alts, anggaran) {
  return anggaran == null ? alts : alts.filter(a => a.biaya <= anggaran);
}
export function filterWaktu(alts, waktuJam, cfg = CONFIG) {
  if (waktuJam == null) return alts;
  return alts.filter(a =>
    a.waktu_tempuh * (cfg.roundTrip ? 2 : 1) + a.durasi <= waktuJam * 60);
}

/* ========== 6. SAW ========== */

/** Normalisasi: benefit = x/max, cost = min/x */
export function normalize(alts, criteria = CRITERIA) {
  const val = (a, c) => a[c.key] ?? 0; // rating kosong dianggap 0
  const stat = {};
  criteria.forEach(c => {
    const v = alts.map(a => val(a, c));
    stat[c.key] = { min: Math.min(...v), max: Math.max(...v) };
  });
  return alts.map(a => {
    const r = {};
    criteria.forEach(c => {
      const x = val(a, c), { min, max } = stat[c.key];
      if (c.type === 'benefit') r[c.key] = max === 0 ? 0 : x / max;
      else r[c.key] = x === 0 ? 1 : min / x; // cost; gratis (0) = nilai terbaik
    });
    return r;
  });
}

/** Skor SAW = Σ (bobot × nilai normalisasi), urut dari terbesar. */
export function sawRank(alts, weights = WEIGHTS, criteria = CRITERIA) {
  const R = normalize(alts, criteria);
  return alts
    .map((a, i) => ({
      ...a,
      normalisasi: R[i],
      skor: criteria.reduce((s, c, j) => s + weights[j] * R[i][c.key], 0),
    }))
    .sort((x, y) => y.skor - x.skor)
    .map((a, i) => ({ ...a, peringkat: i + 1 }));
}

/* ========== 7. PIPELINE UTAMA ========== */

/**
 * @param {Object} geojson  data/wisata.geojson
 * @param {Object} input    {
 *   lokasi:    {lat, lng},                      // dari GPS / klik peta / geocoding
 *   kategori:  'alam'|'alam_buatan'|'budaya_religi'|'agrowisata'|'akomodasi_rekreasi'|'bebas',
 *   waktuJam:  number | null,                   // null = tidak dibatasi
 *   anggaran:  number | null,                   // Rp/orang, null = tidak dibatasi
 *   ratingMin: 3 | 3.5 | 4 | 4.5 | null         // null = tidak dibatasi
 * }
 * @returns {Promise<Array>} wisata terurut menurut skor SAW (kosong jika tidak ada yang lolos)
 */
export async function rekomendasiWisata(geojson, input, cfg = CONFIG) {
  let alts = geojson.features.map(f => featureToAlt(f, cfg));

  // Filter yang tidak butuh OSRM dulu (hemat request)
  alts = filterKategori(alts, input.kategori);
  alts = filterRating(alts, input.ratingMin);
  alts = filterAnggaran(alts, input.anggaran);
  if (!alts.length) return [];

  // Waktu tempuh dari lokasi user, lalu filter waktu
  const minutes = await getTravelMinutes(input.lokasi, alts, cfg);
  alts = alts
    .map((a, i) => ({ ...a, waktu_tempuh: minutes[i] }))
    .filter(a => a.waktu_tempuh != null);
  alts = filterWaktu(alts, input.waktuJam, cfg);
  if (!alts.length) return [];

  return sawRank(alts);
}
