import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ahpWeights, ahpConsistency, sawRank, hitungBiaya, rekomendasiWisata, filterWaktu,
} from '../js/saw.js';

// --- AHP
const w = ahpWeights();
[0.4187, 0.3521, 0.1245, 0.1047].forEach((e, i) => assert.ok(Math.abs(w[i] - e) < 1e-4, `bobot C${i + 1}`));
const cr = ahpConsistency();
assert.ok(Math.abs(cr.CR - 0.068) < 1e-3 && cr.consistent, 'CR ~ 6.8%');

// --- biaya
assert.equal(hitungBiaya({ harga_masuk: 10000, makan_min: 25000, makan_max: 100000 }), 10000 + 62500);
assert.equal(hitungBiaya({ harga_masuk: 5000 }), 5000);
assert.equal(hitungBiaya({ harga_masuk: 0, makan_min: 5000, makan_max: null }), 5000);

// --- SAW skor valid & terurut; rating kosong tidak bikin NaN
const alts = [
  { nama: 'A', waktu_tempuh: 30, biaya: 20000, rating: 4.5, ulasan: 1000 },
  { nama: 'B', waktu_tempuh: 60, biaya: 10000, rating: 4.0, ulasan: 3000 },
  { nama: 'C', waktu_tempuh: 20, biaya: 0,     rating: null, ulasan: 0 },
];
const r = sawRank(alts);
assert.ok(r.every(x => Number.isFinite(x.skor) && x.skor > 0 && x.skor <= 1));
assert.ok(r[0].skor >= r[1].skor && r[1].skor >= r[2].skor);

// --- filter waktu: 2*60 + 60 = 180 menit <= 3 jam
assert.equal(filterWaktu([{ waktu_tempuh: 60, durasi: 60 }], 3).length, 1);
assert.equal(filterWaktu([{ waktu_tempuh: 61, durasi: 60 }], 3).length, 0);

// --- end-to-end dgn data asli (OSRM dimatikan -> fallback jarak lurus)
globalThis.fetch = async () => { throw new Error('offline'); };
const origWarn = console.warn; console.warn = () => {};
const geo = JSON.parse(readFileSync(new URL('../data/wisata.geojson', import.meta.url)));
const wates = { lat: -7.8575, lng: 110.1597 };

const bebas = await rekomendasiWisata(geo, { lokasi: wates, kategori: 'bebas', waktuJam: null, anggaran: null, ratingMin: null });
assert.equal(bebas.length, geo.features.length, 'semua bebas -> semua wisata lolos');

const input = { lokasi: wates, kategori: 'alam', waktuJam: 4, anggaran: 50000, ratingMin: 4 };
const hasil = await rekomendasiWisata(geo, input);
assert.ok(hasil.length > 0);
assert.ok(hasil.every(h => h.kategori === 'Wisata Alam' && h.rating >= 4 && h.biaya <= 50000));
assert.ok(hasil.every(h => h.waktu_tempuh * 2 + 60 <= 240));
assert.ok(hasil.every((h, i) => i === 0 || hasil[i - 1].skor >= h.skor));

const kosong = await rekomendasiWisata(geo, { ...input, anggaran: -1 });
assert.deepEqual(kosong, []);

console.warn = origWarn;
console.log(`Semua test lolos. Top 3 (alam, 4 jam, <=50rb, >=4.0):`);
hasil.slice(0, 3).forEach(h => console.log(`  #${h.peringkat} ${h.nama} skor=${h.skor.toFixed(4)} (~${Math.round(h.waktu_tempuh)} mnt, Rp${h.biaya})`));
