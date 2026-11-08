type CutoutRequest = { id: string; pixels: Uint8ClampedArray; width: number; height: number; tolerance: number };

self.onmessage = (event: MessageEvent<CutoutRequest>) => {
  const { id, pixels, width, height, tolerance } = event.data;
  const pixelCount = width * height;
  const quantized = new Map<number, number>();
  const sample = (index: number) => {
    const offset = index * 4;
    return (pixels[offset] >> 4) << 8 | (pixels[offset + 1] >> 4) << 4 | (pixels[offset + 2] >> 4);
  };
  const edgeIndices = new Set<number>();
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 300));
  for (let x = 0; x < width; x += stride) {
    edgeIndices.add(x);
    edgeIndices.add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += stride) {
    edgeIndices.add(y * width);
    edgeIndices.add(y * width + width - 1);
  }
  for (const index of edgeIndices) {
    const key = sample(index);
    quantized.set(key, (quantized.get(key) ?? 0) + 1);
  }
  const dominant = [...quantized.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key]) => [key >> 8 & 15, key >> 4 & 15, key & 15].map((channel) => channel * 17));
  const threshold = tolerance * tolerance * 3;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let start = 0;
  let end = 0;
  const matches = (index: number) => {
    const offset = index * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    return dominant.some(([br, bg, bb]) => (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2 <= threshold);
  };
  const add = (index: number) => {
    if (index < 0 || index >= pixelCount || visited[index] || !matches(index)) return;
    visited[index] = 1;
    queue[end++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    add(y * width);
    add(y * width + width - 1);
  }
  while (start < end) {
    const index = queue[start++];
    const alphaOffset = index * 4 + 3;
    pixels[alphaOffset] = 0;
    const x = index % width;
    if (x > 0) add(index - 1);
    if (x + 1 < width) add(index + 1);
    if (index >= width) add(index - width);
    if (index + width < pixelCount) add(index + width);
  }
  const workerScope = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void };
  workerScope.postMessage({ id, pixels, removed: end }, [pixels.buffer as ArrayBuffer]);
};
