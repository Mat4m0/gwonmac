/**
 * Owns the embedded document language regression; the English fixture must not
 * hide a missing language declaration in the production game document.
 */
import { expect, test } from 'vitest';
// The offline test parses the shipped document, not the fixture's English HTML shell.
// eslint-disable-next-line no-restricted-imports
import source from '../../../src/renderer/index.html?raw';

test('the production game document declares English (HUB-168)', () => {
  expect(source.match(/<html\b[^>]*\blang=["']([^"']+)["']/iu)?.[1]).toBe('en');
});
