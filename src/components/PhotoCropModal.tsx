import React, { useCallback, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { RotateCcw, RotateCw, X, Check } from 'lucide-react';
import ModalPortal from './ModalPortal';

/** Crops and rotates an image on a canvas. `area` is in pixels of the rotated image, as react-easy-crop reports it. */
export async function cropAndRotate(file: File, area: Area, rotation: number, suffix = '_crop'): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    // createImageBitmap / <img> both apply the EXIF orientation in current browsers, same as the cropper preview.
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const rad = (rotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
    const bw = img.naturalWidth * cos + img.naturalHeight * sin;
    const bh = img.naturalWidth * sin + img.naturalHeight * cos;
    const rotated = document.createElement('canvas');
    rotated.width = Math.round(bw); rotated.height = Math.round(bh);
    const rctx = rotated.getContext('2d');
    if (!rctx) return file;
    rctx.translate(bw / 2, bh / 2);
    rctx.rotate(rad);
    rctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(area.width));
    out.height = Math.max(1, Math.round(area.height));
    const octx = out.getContext('2d');
    if (!octx) return file;
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(rotated, area.x, area.y, area.width, area.height, 0, 0, out.width, out.height);
    const blob: Blob | null = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + suffix + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Props {
  file: File;
  /** width / height; undefined = free crop. */
  aspect?: number;
  title: string;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}

/** Manual crop/rotate dialog. The caller keeps the original file; only the result is returned. */
export default function PhotoCropModal({ file, aspect, title, onCancel, onDone }: Props) {
  const [src] = useState(() => URL.createObjectURL(file));
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => () => URL.revokeObjectURL(src), [src]);
  const onCropComplete = useCallback((_a: Area, px: Area) => setArea(px), []);

  const apply = async () => {
    if (!area) return;
    setBusy(true);
    try { onDone(await cropAndRotate(file, area, rotation)); } finally { setBusy(false); }
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-3" dir="rtl">
        <div className="bg-white rounded-2xl w-full max-w-xl overflow-hidden shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-black text-sm text-slate-800">{title}</span>
            <button type="button" onClick={onCancel} aria-label="بستن"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
          <div className="relative w-full h-[60vh] max-h-[460px] bg-slate-900">
            <Cropper image={src} crop={crop} zoom={zoom} rotation={rotation} aspect={aspect ?? 4 / 3}
              restrictPosition={false} minZoom={0.5}
              onCropChange={setCrop} onZoomChange={setZoom} onRotationChange={setRotation} onCropComplete={onCropComplete} />
          </div>
          <div className="p-4 space-y-3 text-xs">
            <label className="flex items-center gap-3">
              <span className="w-14 font-bold text-slate-600">بزرگنمایی</span>
              <input type="range" min={0.5} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" />
            </label>
            <label className="flex items-center gap-3">
              <span className="w-14 font-bold text-slate-600">چرخش</span>
              <input type="range" min={-180} max={180} step={1} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="flex-1" />
              <span className="w-10 text-center">{rotation}°</span>
            </label>
            <div className="flex flex-wrap gap-2 justify-between">
              <div className="flex gap-2">
                <button type="button" onClick={() => setRotation((r) => ((r - 90 + 540) % 360) - 180)} className="px-3 py-2 border rounded-lg font-bold flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />۹۰°</button>
                <button type="button" onClick={() => setRotation((r) => ((r + 90 + 540) % 360) - 180)} className="px-3 py-2 border rounded-lg font-bold flex items-center gap-1"><RotateCw className="w-3.5 h-3.5" />۹۰°</button>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={onCancel} className="px-4 py-2 border rounded-lg font-bold">انصراف</button>
                <button type="button" disabled={!area || busy} onClick={() => void apply()} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg font-bold flex items-center gap-1"><Check className="w-4 h-4" />ذخیره برش</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
