// js/app.js — menghubungkan pertanyaan interaktif -> SAW -> peta Leaflet
//
// ID elemen yang dipakai di index.html:
//   #map                       <div> peta Leaflet
//   #btn-gps                   tombol "Gunakan Lokasi Saya"
//   #btn-peta                  tombol "Pilih pada Peta"
//   #btn-teks + #lokasi-teks   tombol + input "Masukkan Lokasi"
//   #lokasi-status             teks status lokasi terpilih
//   #kategori                  <select> value: alam | alam_buatan | budaya_religi | agrowisata | akomodasi_rekreasi | bebas
//   #waktu + #waktu-bebas      input number (jam) + checkbox "Tidak dibatasi"
//   #anggaran + #anggaran-bebas input number (Rp/orang) + checkbox "Tidak dibatasi"
//   #rating                    <select> value: 3 | 3.5 | 4 | 4.5 | "" (Tidak dibatasi)
//   #btn-cari                  tombol "Cari Rekomendasi"
//   #hasil                     <div>/<ol> daftar hasil
import { rekomendasiWisata } from './saw.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupiah = n => 'Rp' + Math.round(n).toLocaleString('id-ID');
const TOP_N = 10;

const map = L.map('map').setView([-7.86, 110.15], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
}).addTo(map);

const layerHasil = L.layerGroup().addTo(map);
let lokasi = null, markerUser = null, geojsonCache = null, pilihPeta = false;

/* ---------- Pertanyaan 1: Lokasi ---------- */
function setLokasi(lat, lng, label) {
  lokasi = { lat, lng };
  if (markerUser) map.removeLayer(markerUser);
  markerUser = L.circleMarker([lat, lng], { radius: 8, color: '#1d4ed8', fillOpacity: 0.9 })
    .addTo(map).bindPopup('Titik awal perjalanan');
  map.setView([lat, lng], 12);
  $('lokasi-status').textContent = `Lokasi: ${label} (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
}

$('btn-gps').onclick = () => {
  if (!navigator.geolocation) return alert('Browser tidak mendukung geolokasi.');
  navigator.geolocation.getCurrentPosition(
    p => setLokasi(p.coords.latitude, p.coords.longitude, 'GPS'),
    () => alert('Gagal mengambil lokasi. Izinkan akses lokasi atau pilih cara lain.'),
    { enableHighAccuracy: true, timeout: 10000 });
};

$('btn-peta').onclick = () => {
  pilihPeta = true;
  $('lokasi-status').textContent = 'Klik pada peta untuk menentukan titik awal…';
  map.getContainer().style.cursor = 'crosshair';
};
map.on('click', e => {
  if (!pilihPeta) return;
  pilihPeta = false;
  map.getContainer().style.cursor = '';
  setLokasi(e.latlng.lat, e.latlng.lng, 'titik di peta');
});

$('btn-teks').onclick = async () => {
  const q = $('lokasi-teks').value.trim();
  if (!q) return alert('Ketik nama tempat/alamat dulu.');
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id' +
      '&viewbox=109.7,-7.5,110.4,-8.1&q=' + encodeURIComponent(q);
    const [hit] = await (await fetch(url)).json();
    if (!hit) return alert('Lokasi tidak ditemukan. Coba nama yang lebih spesifik.');
    setLokasi(+hit.lat, +hit.lon, hit.display_name.split(',').slice(0, 2).join(','));
  } catch { alert('Gagal mencari lokasi. Cek koneksi internet.'); }
};

/* ---------- Pertanyaan 2-5: baca jawaban ---------- */
function bacaInput() {
  const num = (id, bebasId) => ($(bebasId).checked || $(id).value === '') ? null : Number($(id).value);
  return {
    lokasi,
    kategori: $('kategori').value,                                 // 'bebas' = tidak dibatasi
    waktuJam: num('waktu', 'waktu-bebas'),
    anggaran: num('anggaran', 'anggaran-bebas'),
    ratingMin: $('rating').value === '' ? null : Number($('rating').value),
  };
}

// Nonaktifkan input angka kalau "Tidak dibatasi" dicentang
for (const k of ['waktu', 'anggaran']) {
  $(`${k}-bebas`).onchange = () => { $(k).disabled = $(`${k}-bebas`).checked; };
}

/* ---------- Cari & tampilkan hasil ---------- */
$('btn-cari').onclick = async () => {
  if (!lokasi) return alert('Tentukan lokasi awal dulu (GPS, peta, atau ketik lokasi).');
  const input = bacaInput();
  $('btn-cari').disabled = true;
  $('hasil').textContent = 'Menghitung rekomendasi…';
  try {
    geojsonCache ??= await (await fetch('wisata.geojson')).json();
    const hasil = (await rekomendasiWisata(geojsonCache, input)).slice(0, TOP_N);
    tampilkan(hasil);
  } catch (err) {
    console.error(err);
    $('hasil').textContent = 'Terjadi kesalahan saat menghitung. Coba lagi.';
  } finally { $('btn-cari').disabled = false; }
};

function tampilkan(hasil) {
  layerHasil.clearLayers();
  const box = $('hasil');
  if (!hasil.length) {
    box.textContent = 'Tidak ada wisata yang cocok. Coba longgarkan waktu, anggaran, atau rating.';
    return;
  }
  box.innerHTML = '';
  const ol = document.createElement('ol');
  box.appendChild(ol);
  const bounds = [[lokasi.lat, lokasi.lng]];

  hasil.forEach(w => {
    const p = w.properties;
    const info = `<b>#${w.peringkat} ${esc(w.nama)}</b><br>${esc(w.kategori)} · ${esc(p.kapanewon)}<br>` +
      `Skor SAW: <b>${w.skor.toFixed(3)}</b><br>` +
      `⏱ ±${Math.round(w.waktu_tempuh)} menit · 💰 ${rupiah(w.biaya)}/orang<br>` +
      `⭐ ${w.rating ?? '-'} (${w.ulasan} ulasan)` +
      (p.url_maps ? `<br><a href="${esc(p.url_maps)}" target="_blank" rel="noopener">Buka di Google Maps</a>` : '');

    const marker = L.marker([w.lat, w.lng], {
      icon: L.divIcon({ className: '', iconSize: [28, 28],
        html: `<div style="background:#dc2626;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700">${w.peringkat}</div>` }),
    }).addTo(layerHasil).bindPopup(info);
    bounds.push([w.lat, w.lng]);

    const li = document.createElement('li');
    li.innerHTML = `<b>${esc(w.nama)}</b> — skor ${w.skor.toFixed(3)}<br>` +
      `<small>±${Math.round(w.waktu_tempuh)} mnt · ${rupiah(w.biaya)} · ⭐ ${w.rating ?? '-'}</small>`;
    li.style.cursor = 'pointer';
    li.onclick = () => { map.setView([w.lat, w.lng], 14); marker.openPopup(); };
    ol.appendChild(li);
  });
  map.fitBounds(bounds, { padding: [40, 40] });
}
