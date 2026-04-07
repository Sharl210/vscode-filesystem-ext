import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_DISGUISE_IMAGE_TEMPLATES,
  createDisguiseImageSettingsStore
} from '../../src/state/disguiseImageSettings';

describe('disguise image settings store', () => {
  it('returns built-in templates and defaults to the first template', async () => {
    const state = new Map<string, unknown>();
    const store = createDisguiseImageSettingsStore({
      async get<T>(key: string) {
        return state.get(key) as T | undefined;
      },
      async update(key: string, value: unknown) {
        state.set(key, value);
      }
    });

    const settings = await store.getSettings();

    expect(settings.selectedSource).toBe('template');
    expect(settings.selectedTemplateId).toBe(BUILT_IN_DISGUISE_IMAGE_TEMPLATES[0]?.id);
    expect(settings.customImageDataUrl).toBeNull();
    expect(settings.templates).toHaveLength(BUILT_IN_DISGUISE_IMAGE_TEMPLATES.length);
    const firstTemplateBytes = Buffer.from(settings.templates[0]?.dataUrl.split(',')[1] ?? '', 'base64');
    expect(firstTemplateBytes.length).toBeGreaterThan(1024);
  });

  it('persists a custom png image across store instances', async () => {
    const state = new Map<string, unknown>();
    const storage = {
      async get<T>(key: string) {
        return state.get(key) as T | undefined;
      },
      async update(key: string, value: unknown) {
        state.set(key, value);
      }
    };

    const firstStore = createDisguiseImageSettingsStore(storage);
    await firstStore.saveSettings({
      selectedSource: 'custom',
      selectedTemplateId: BUILT_IN_DISGUISE_IMAGE_TEMPLATES[1]?.id ?? 'template-2',
      customImageDataUrl: 'data:image/png;base64,AAAA'
    });

    const secondStore = createDisguiseImageSettingsStore(storage);
    const settings = await secondStore.getSettings();

    expect(settings.selectedSource).toBe('custom');
    expect(settings.selectedTemplateId).toBe(BUILT_IN_DISGUISE_IMAGE_TEMPLATES[1]?.id ?? 'template-2');
    expect(settings.customImageDataUrl).toBe('data:image/png;base64,AAAA');
  });
});
