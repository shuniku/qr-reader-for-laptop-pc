// カメラ映像および静止画像から jsQR でQRコードを検出する。

const VIDEO_DECODE_MAX_SIDE = 640;   // 映像は縮小してから解析し、フレーム落ちを防ぐ
const IMAGE_DECODE_MAX_SIDE = 1600;
// 画像ファイルは 1 回の解析で失敗することがあるため、倍率を変えて再試行する
const IMAGE_RETRY_SCALES = [1, 0.6, 1.6, 0.35, 2.4];

function decodeImageData(imageData, inversionAttempts) {
  return window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts });
}

export class Scanner {
  constructor({ video, overlay, onResult, onStatus }) {
    this.video = video;
    this.overlay = overlay;
    this.onResult = onResult;
    this.onStatus = onStatus ?? (() => {});
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.rafId = null;
    this.paused = false;
    this.lastHit = { text: null, at: 0 };
  }

  get running() {
    return this.stream !== null;
  }

  async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput');
  }

  async start(deviceId) {
    this.stop();
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    await this.video.play();
    this.paused = false;
    this.onStatus({ running: true });
    this.loop();
    return this.stream.getVideoTracks()[0]?.getSettings()?.deviceId ?? deviceId ?? null;
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.clearOverlay();
    this.onStatus({ running: false });
  }

  pause() { this.paused = true; this.clearOverlay(); }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    // 直前に読んだコードがまだ写り込んでいても即座に再検出しないよう、抑制時間を計り直す
    this.lastHit = { ...this.lastHit, at: Date.now() };
  }

  clearOverlay() {
    const context = this.overlay.getContext('2d');
    context.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  loop() {
    this.rafId = requestAnimationFrame(() => this.loop());
    if (this.paused || this.video.readyState !== this.video.HAVE_ENOUGH_DATA) return;

    const { videoWidth, videoHeight } = this.video;
    if (!videoWidth || !videoHeight) return;

    const scale = Math.min(1, VIDEO_DECODE_MAX_SIDE / Math.max(videoWidth, videoHeight));
    const width = Math.round(videoWidth * scale);
    const height = Math.round(videoHeight * scale);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.drawImage(this.video, 0, 0, width, height);

    let code = null;
    try {
      code = decodeImageData(this.context.getImageData(0, 0, width, height), 'attemptBoth');
    } catch {
      return; // 稀に発生する getImageData 失敗は次フレームで回復する
    }
    if (!code || !code.data) {
      this.clearOverlay();
      return;
    }

    this.drawMarker(code.location, width, height);

    const now = Date.now();
    if (code.data === this.lastHit.text && now - this.lastHit.at < 2500) return;
    this.lastHit = { text: code.data, at: now };
    this.onResult({ text: code.data, source: 'camera' });
  }

  drawMarker(location, decodeWidth, decodeHeight) {
    const rect = this.video.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);
    if (this.overlay.width !== pixelWidth || this.overlay.height !== pixelHeight) {
      this.overlay.width = pixelWidth;
      this.overlay.height = pixelHeight;
    }

    const context = this.overlay.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    // 解析用キャンバス座標 → 表示中の映像のピクセル座標
    context.scale((pixelWidth / decodeWidth), (pixelHeight / decodeHeight));

    const corners = [
      location.topLeftCorner, location.topRightCorner,
      location.bottomRightCorner, location.bottomLeftCorner,
    ];
    context.beginPath();
    corners.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.lineWidth = 4 * (decodeWidth / pixelWidth) * dpr;
    context.strokeStyle = '#4ade80';
    context.fillStyle = 'rgba(74, 222, 128, 0.18)';
    context.fill();
    context.stroke();
  }
}

/** 画像（dataURL）からQRコードを読み取る。倍率を変えながら再試行する。 */
export async function decodeImageFile(dataUrl) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const baseScale = Math.min(1, IMAGE_DECODE_MAX_SIDE / Math.max(image.width, image.height));

  for (const retryScale of IMAGE_RETRY_SCALES) {
    const width = Math.max(1, Math.round(image.width * baseScale * retryScale));
    const height = Math.max(1, Math.round(image.height * baseScale * retryScale));
    if (width < 20 || height < 20 || width > 4000 || height > 4000) continue;

    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = retryScale < 1;
    // 透過PNGの背景を白で埋めないと、暗い背景と誤認して検出に失敗する
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const code = decodeImageData(context.getImageData(0, 0, width, height), 'attemptBoth');
    if (code && code.data) return { text: code.data, source: 'image' };
  }
  return null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を読み込めませんでした'));
    image.src = src;
  });
}
