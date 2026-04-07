import { deflateSync } from 'node:zlib';
import type { DisguiseImageSettingsDto, DisguiseImageTemplateDto } from '../types/api';
import { crc32 } from '../utils/crc32';

const STORAGE_KEY = 'workspaceWebGateway.disguiseImageSettings';

export const BUILT_IN_DISGUISE_IMAGE_TEMPLATES: DisguiseImageTemplateDto[] = [
  {
    id: 'template-sunset',
    label: '日落',
    dataUrl: createGradientPngDataUrl([247, 148, 29], [255, 229, 180])
  },
  {
    id: 'template-ocean',
    label: '海面',
    dataUrl: createGradientPngDataUrl([53, 126, 221], [190, 236, 255])
  },
  {
    id: 'template-forest',
    label: '森林',
    dataUrl: createGradientPngDataUrl([52, 168, 83], [205, 247, 181])
  }
];

interface SettingsStorage {
  get<T>(key: string): PromiseLike<T | undefined>;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface StoredDisguiseImageSettings {
  selectedSource: 'template' | 'custom';
  selectedTemplateId: string;
  customImageDataUrl: string | null;
}

export function createDisguiseImageSettingsStore(storage: SettingsStorage) {
  return {
    async getSettings(): Promise<DisguiseImageSettingsDto> {
      const stored = await readStoredSettings(storage);
      return {
        templates: BUILT_IN_DISGUISE_IMAGE_TEMPLATES,
        selectedSource: stored.selectedSource,
        selectedTemplateId: stored.selectedTemplateId,
        customImageDataUrl: stored.customImageDataUrl
      };
    },
    async saveSettings(settings: { selectedSource: 'template' | 'custom'; selectedTemplateId: string; customImageDataUrl: string | null }) {
      const normalized = normalizeStoredSettings(settings);
      await storage.update(STORAGE_KEY, normalized);
    }
  };
}

async function readStoredSettings(storage: SettingsStorage): Promise<StoredDisguiseImageSettings> {
  const fallback = {
    selectedSource: 'template' as const,
    selectedTemplateId: BUILT_IN_DISGUISE_IMAGE_TEMPLATES[0]?.id ?? 'template-sunset',
    customImageDataUrl: null
  };
  const stored = await storage.get<StoredDisguiseImageSettings>(STORAGE_KEY);

  if (!stored) {
    return fallback;
  }

  return normalizeStoredSettings(stored);
}

function normalizeStoredSettings(settings: { selectedSource: 'template' | 'custom'; selectedTemplateId: string; customImageDataUrl: string | null }): StoredDisguiseImageSettings {
  const selectedTemplateId = BUILT_IN_DISGUISE_IMAGE_TEMPLATES.some((template) => template.id === settings.selectedTemplateId)
    ? settings.selectedTemplateId
    : (BUILT_IN_DISGUISE_IMAGE_TEMPLATES[0]?.id ?? 'template-sunset');
  const customImageDataUrl = typeof settings.customImageDataUrl === 'string' && settings.customImageDataUrl.startsWith('data:image/png;base64,')
    ? settings.customImageDataUrl
    : null;
  const selectedSource = settings.selectedSource === 'custom' && customImageDataUrl ? 'custom' : 'template';
  return {
    selectedSource,
    selectedTemplateId,
    customImageDataUrl
  };
}

function createGradientPngDataUrl(startColor: [number, number, number], endColor: [number, number, number]) {
  const width = 480;
  const height = 270;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = createPngChunk('IHDR', Uint8Array.from([
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    8,
    6,
    0,
    0,
    0
  ]));
  const pixels = new Uint8Array(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    pixels[offset] = 0;
    offset += 1;
    const verticalRatio = height <= 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const horizontalRatio = width <= 1 ? 0 : x / (width - 1);
      const mixRatio = (verticalRatio * 0.7) + (horizontalRatio * 0.3);
      const noise = ((x * 17 + y * 29) % 23) - 11;
      pixels[offset] = clampColor(startColor[0] * (1 - mixRatio) + endColor[0] * mixRatio + noise);
      pixels[offset + 1] = clampColor(startColor[1] * (1 - mixRatio) + endColor[1] * mixRatio + noise);
      pixels[offset + 2] = clampColor(startColor[2] * (1 - mixRatio) + endColor[2] * mixRatio + noise);
      pixels[offset + 3] = 255;
      offset += 4;
    }
  }
  const imageData = deflateSync(pixels);
  const idat = createPngChunk('IDAT', imageData);
  const end = createPngChunk('IEND', new Uint8Array());
  const bytes = concatBytes([signature, header, idat, end]);
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

function createPngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.byteLength);
  writeUint32Be(chunk, 0, data.byteLength);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  writeUint32Be(chunk, chunk.byteLength - 4, crc32(chunk.slice(4, chunk.byteLength - 4)));
  return chunk;
}

function writeUint32Be(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function clampColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
