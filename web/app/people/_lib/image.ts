/**
 * Client-side photo helpers: read a File or a <video> frame, crop a circle
 * with zoom/offset and export a small JPEG (default 512px) before upload.
 */

export const PHOTO_SIZE = 512;

export interface CropState {
  /** 1 = the shorter side fills the circle; larger zooms in. */
  zoom: number;
  /** Offset of the image centre from the circle centre, in output pixels. */
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_CROP: CropState = { zoom: 1, offsetX: 0, offsetY: 0 };

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read this image."));
    image.src = src;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}

/** Grab the current frame of a playing <video> as a JPEG data URL. */
export function captureFrame(video: HTMLVideoElement, mirrored: boolean): string {
  const canvas = document.createElement("canvas");
  const width = video.videoWidth || 720;
  const height = video.videoHeight || 960;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * Geometry shared by the on-screen preview and the export: where to draw the
 * image so that `crop` is applied inside a square of `size` px.
 */
export function cropGeometry(
  imageWidth: number,
  imageHeight: number,
  crop: CropState,
  size: number,
): { x: number; y: number; width: number; height: number } {
  const base = size / Math.min(imageWidth, imageHeight);
  const scale = base * Math.max(1, crop.zoom);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const maxX = Math.max(0, (width - size) / 2);
  const maxY = Math.max(0, (height - size) / 2);
  const offsetX = Math.min(maxX, Math.max(-maxX, crop.offsetX));
  const offsetY = Math.min(maxY, Math.max(-maxY, crop.offsetY));
  return {
    x: (size - width) / 2 + offsetX,
    y: (size - height) / 2 + offsetY,
    width,
    height,
  };
}

/** Circle-crop `src` with `crop`, resized to `size` px, as a JPEG data URL. */
export async function cropToCircle(
  src: string,
  crop: CropState,
  size = PHOTO_SIZE,
  quality = 0.86,
): Promise<string> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.save();
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  const g = cropGeometry(image.naturalWidth, image.naturalHeight, crop, size);
  context.drawImage(image, g.x, g.y, g.width, g.height);
  context.restore();
  return canvas.toDataURL("image/jpeg", quality);
}

/** Downscale any image so its longer side is at most `max` px (JPEG). */
export async function shrinkImage(src: string, max = 1600): Promise<string> {
  const image = await loadImage(src);
  const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1) return src;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) return src;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Approximate byte size of a data: URL payload. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const payload = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.floor((payload.length * 3) / 4);
}

/** True when getUserMedia can be used here (HTTPS or localhost). */
export function cameraAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}
