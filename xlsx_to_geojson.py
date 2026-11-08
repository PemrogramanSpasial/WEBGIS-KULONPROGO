"""Konversi Database_Potensi_Wisata.xlsx (sheet pertama) -> data/wisata.geojson
Pakai:  python pipeline/xlsx_to_geojson.py Database_Potensi_Wisata.xlsx data/wisata.geojson
"""
import json, sys
import pandas as pd

src = sys.argv[1] if len(sys.argv) > 1 else "Database_Potensi_Wisata.xlsx"
dst = sys.argv[2] if len(sys.argv) > 2 else "data/wisata.geojson"

df = pd.read_excel(src, sheet_name=0).iloc[:, :25]
df = df.dropna(subset=["id_wisata", "latitude", "longitude"])

def num(v):
    return None if pd.isna(v) else (int(v) if float(v).is_integer() else float(v))

def txt(v):
    return None if pd.isna(v) else str(v).strip()

HARI = ["senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu"]
features = []
for _, r in df.iterrows():
    lat, lng = float(r.latitude), float(r.longitude)
    if not (-8.1 < lat < -7.5 and 109.7 < lng < 110.3):
        print(f"PERIKSA koordinat: {r.id_wisata} {r.nama_wisata} ({lat}, {lng})")
    features.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": {
            "id": txt(r.id_wisata),
            "nama": txt(r.nama_wisata),
            "kapanewon": txt(r.kapanewon),
            "kalurahan": txt(r.kalurahan),
            "kategori": txt(r.kategori),
            "deskripsi": txt(r.deskripsi),
            "rating": num(r.rating),
            "jumlah_ulasan": num(r.jumlah_ulasan),
            "harga_masuk": num(r.harga_masuk_asli_rp),
            "harga_paket": num(r.harga_paket_rp),
            "makan_min": num(r.makan_min_rp),
            "makan_max": num(r.makan_max_rp),
            "jam_buka": txt(r.jam_buka),
            "jam_tutup": txt(r.jam_tutup),
            "buka_24jam": None if pd.isna(r.buka_24jam) else bool(r.buka_24jam),
            "hari_buka": [h.capitalize() for h in HARI if r[h] == 1],
            "url_maps": txt(r.url_google_maps),
        },
    })

with open(dst, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False, indent=1)
print(f"{len(features)} wisata -> {dst}")
