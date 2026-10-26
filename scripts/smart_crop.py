"""
Smart crop and orientation helper using Pillow (PIL).
Handles EXIF transpose, 3:4 portrait ratio normalization, and national ID card cropping.
"""
import sys
import json
from PIL import Image, ImageOps

def orient_image(src_path: str, dst_path: str):
    img = Image.open(src_path)
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    img.save(dst_path, format="JPEG", quality=95)
    w, h = img.size
    return {"success": True, "width": w, "height": h}

def crop_box(src_path: str, dst_path: str, ymin: float, xmin: float, ymax: float, xmax: float, target_ratio: float = None):
    img = Image.open(src_path)
    w, h = img.size

    y1 = int(max(0, min(1000, ymin)) * h / 1000.0)
    x1 = int(max(0, min(1000, xmin)) * w / 1000.0)
    y2 = int(max(0, min(1000, ymax)) * h / 1000.0)
    x2 = int(max(0, min(1000, xmax)) * w / 1000.0)

    bw = max(10, x2 - x1)
    bh = max(10, y2 - y1)
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0

    if target_ratio and target_ratio > 0:
        box_ratio = bw / float(bh)
        if box_ratio > target_ratio:
            crop_h = bw / target_ratio
            crop_w = bw
        else:
            crop_w = bh * target_ratio
            crop_h = bh

        x1 = int(cx - crop_w / 2.0)
        y1 = int(cy - crop_h / 2.0)
        x2 = int(x1 + crop_w)
        y2 = int(y1 + crop_h)

        if x1 < 0:
            x2 = min(w, x2 - x1)
            x1 = 0
        if x2 > w:
            x1 = max(0, x1 - (x2 - w))
            x2 = w
        if y1 < 0:
            y2 = min(h, y2 - y1)
            y1 = 0
        if y2 > h:
            y1 = max(0, y1 - (y2 - h))
            y2 = h
    else:
        x1 = max(0, min(w - 1, x1))
        x2 = max(x1 + 1, min(w, x2))
        y1 = max(0, min(h - 1, y1))
        y2 = max(y1 + 1, min(h, y2))

    cropped = img.crop((x1, y1, x2, y2))
    if cropped.mode in ("RGBA", "P"):
        cropped = cropped.convert("RGB")
    cropped.save(dst_path, format="JPEG", quality=95)
    cw, ch = cropped.size
    return {"success": True, "cropped_width": cw, "cropped_height": ch, "x1": x1, "y1": y1, "x2": x2, "y2": y2}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Insufficient arguments"}))
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "orient":
        res = orient_image(sys.argv[2], sys.argv[3])
        print(json.dumps(res))
    elif cmd == "crop":
        target = float(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] != "none" else None
        res = crop_box(sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7]), target)
        print(json.dumps(res))
    else:
        print(json.dumps({"success": False, "error": f"Unknown command {cmd}"}))
        sys.exit(1)
