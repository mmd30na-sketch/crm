#!/usr/bin/env python3
import json, re, subprocess, time
from pathlib import Path

OUT = Path(__file__).with_name("crawl-twice.json")
URLS = [
    "https://kermanshahcart.ir/",
    "https://www.kermanshahcart.ir/",
    "https://kermanshahcart.ir/articles",
    "https://kermanshahcart.ir/about",
    "https://kermanshahcart.ir/contact",
    "https://kermanshahcart.ir/faq",
    "https://kermanshahcart.ir/sitemap.xml",
    "https://kermanshahcart.ir/robots.txt",
    "https://kermanshahcart.ir/api/course-catalog",
    "https://kermanshahcart.ir/register",
    "https://kermanshahcart.ir/exams",
    "https://kermanshahcart.ir/exams/pkg_bari",
    "https://kermanshahcart.ir/exams/pkg_khatarnak",
    "https://kermanshahcart.ir/exams/pkg_masool_fani",
    "https://kermanshahcart.ir/exams/pkg_modir",
    "https://kermanshahcart.ir/exams/pkg_mosaferi",
    "https://kermanshahcart.ir/study",
    "https://kermanshahcart.ir/tracker",
    "https://kermanshahcart.ir/mock-exam",
    "https://kermanshahcart.ir/articles/estelam-kart-hooshmand",
    "https://kermanshahcart.ir/articles/kart-hooshmand-almosana",
    "https://kermanshahcart.ir/articles/madarek-kart-hooshmand-ranandegan",
    "https://kermanshahcart.ir/articles/tamdid-kart-hooshmand",
    "https://management.kermanshahcart.ir/",
]

def fetch(url: str) -> dict:
    body_path = "/tmp/kermanshah-crawl-body.bin"
    cmd = [
        "curl", "-sS", "-L", "--max-time", "25", "--compressed",
        "-x", "socks5h://127.0.0.1:1081",
        "-A", "Mozilla/5.0 HephaestusAudit",
        "-D", "-", "-o", body_path, "-w",
        "\n__META__ %{http_code} %{url_effective} %{size_download} %{time_total} %{content_type}\n",
        url,
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    raw = p.stdout or ""
    err = (p.stderr or "").strip()[:300]
    meta = {}
    m = re.search(r"__META__ (\d+) (\S+) (\d+) ([0-9.]+) (.*)", raw)
    if m:
        meta = {
            "status": int(m.group(1)),
            "final_url": m.group(2),
            "bytes": int(m.group(3)),
            "seconds": float(m.group(4)),
            "content_type": m.group(5).strip(),
        }
    body = b""
    try:
        body = Path(body_path).read_bytes()
    except OSError:
        pass
    text = body.decode("utf-8", "replace")
    title = ""
    tm = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
    if tm:
        title = re.sub(r"\s+", " ", tm.group(1)).strip()[:180]
    hrefs = []
    for h in re.findall(r"href=[\"']([^\"']+)[\"']", text):
        if h.startswith("data:") or h.startswith("#"):
            continue
        hrefs.append(h)
    hrefs = sorted(set(hrefs))[:40]
    return {
        "url": url,
        "ok_curl": p.returncode == 0,
        "curl_err": err,
        **meta,
        "title": title,
        "hrefs": hrefs,
        "empty": len(body) < 40,
    }

def main() -> None:
    passes = {}
    for n in (1, 2):
        rows = []
        for u in URLS:
            rows.append(fetch(u))
            time.sleep(0.15)
        passes[f"pass{n}"] = rows
    delta = []
    for a, b in zip(passes["pass1"], passes["pass2"]):
        if a.get("status") != b.get("status") or a.get("bytes") != b.get("bytes"):
            delta.append({
                "url": a["url"],
                "p1": {"status": a.get("status"), "bytes": a.get("bytes")},
                "p2": {"status": b.get("status"), "bytes": b.get("bytes")},
            })
    OUT.write_text(json.dumps({"passes": passes, "delta": delta}, ensure_ascii=False, indent=2))
    print("wrote", OUT, "delta", len(delta), "urls", len(URLS))

if __name__ == "__main__":
    main()
