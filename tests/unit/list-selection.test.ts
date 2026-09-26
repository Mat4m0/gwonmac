/** The one Hub list selection policy: steps, ends, pages and no wrap. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSelectionIndex } from '../../src/shared/list-selection.js';

const key = (value: string, modifiers: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) =>
  ({ key: value, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers });

test('arrows and Emacs keys step one item and never wrap', () => {
  assert.equal(listSelectionIndex(key('ArrowDown'), 0, 5), 1);
  assert.equal(listSelectionIndex(key('n', { ctrlKey: true }), 1, 5), 2);
  assert.equal(listSelectionIndex(key('p', { ctrlKey: true }), 2, 5), 1);
  assert.equal(listSelectionIndex(key('ArrowUp'), 0, 5), 0);
  assert.equal(listSelectionIndex(key('ArrowDown'), 4, 5), 4);
});

test('Home, End and pages move to the ends or by a page, clamped', () => {
  assert.equal(listSelectionIndex(key('End'), 1, 5), 4);
  assert.equal(listSelectionIndex(key('Home'), 3, 5), 0);
  assert.equal(listSelectionIndex(key('PageDown'), 0, 20, 8), 8);
  assert.equal(listSelectionIndex(key('PageDown'), 15, 20, 8), 19);
  assert.equal(listSelectionIndex(key('PageUp'), 5, 20, 8), 0);
});

test('with nothing selected every list key but End starts at the first item', () => {
  assert.equal(listSelectionIndex(key('ArrowDown'), -1, 3), 0);
  assert.equal(listSelectionIndex(key('ArrowUp'), -1, 3), 0);
  assert.equal(listSelectionIndex(key('End'), -1, 3), 2);
  assert.equal(listSelectionIndex(key('ArrowDown'), -1, 0), -1);
});

test('text editing and other keys are left to the field', () => {
  for (const event of [key('a'), key('ArrowLeft'), key('Home', { shiftKey: true }), key('End', { metaKey: true }), key('ArrowDown', { altKey: true }), key('a', { ctrlKey: true })]) {
    assert.equal(listSelectionIndex(event, 1, 5), null, JSON.stringify(event));
  }
});
