import { describe, expect, it } from 'vitest';
import { normalizeEntryName } from '../../src/utils/nameValidation';

describe('normalizeEntryName', () => {
  it('trims valid names', () => {
    expect(normalizeEntryName('  notes.md  ')).toBe('notes.md');
  });

  it('rejects empty names', () => {
    expect(() => normalizeEntryName('   ')).toThrow('名称不能为空');
  });

  it('rejects traversal-like names', () => {
    expect(() => normalizeEntryName('../evil')).toThrow('名称不能包含路径');
    expect(() => normalizeEntryName('..')).toThrow('名称不能包含路径');
  });

  it('rejects names containing slashes or backslashes', () => {
    expect(() => normalizeEntryName('foo/bar')).toThrow('名称不能包含路径');
    expect(() => normalizeEntryName('foo\\bar')).toThrow('名称不能包含路径');
  });
});
