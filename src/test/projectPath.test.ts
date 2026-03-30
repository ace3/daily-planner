import { describe, expect, it } from 'vitest';
import {
  deriveProjectName,
  normalizeProjectPath,
  validateProjectPathLocally,
} from '../lib/projectPath';

describe('projectPath utilities', () => {
  it('normalizes trailing slashes and whitespace', () => {
    expect(normalizeProjectPath('  /Users/dev/my-app/  ')).toBe('/Users/dev/my-app');
    expect(normalizeProjectPath('C:\\code\\project\\\\')).toBe('C:\\code\\project');
  });

  it('derives project name from path', () => {
    expect(deriveProjectName('/Users/dev/my-app')).toBe('my-app');
    expect(deriveProjectName('C:\\code\\project')).toBe('project');
  });

  it('rejects relative paths', () => {
    const result = validateProjectPathLocally('my/project');
    expect(result.isValid).toBe(false);
    expect(result.message).toContain('absolute path');
  });

  it('accepts absolute unix path', () => {
    const result = validateProjectPathLocally('/Users/dev/my-project');
    expect(result.isValid).toBe(true);
  });

  it('accepts absolute windows path', () => {
    const result = validateProjectPathLocally('C:\\code\\project');
    expect(result.isValid).toBe(true);
  });
});
