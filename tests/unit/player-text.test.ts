/** Pasted-text cleanup shared by game paste and character-name search. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPastedText, normaliseCharacterName } from '../../src/shared/player-text.ts';

test('pasted text loses invisible characters and surrounding whitespace, nothing else', () => {
  assert.equal(cleanPastedText('Mo Kai '), 'Mo Kai', 'double-click selection adds a trailing space');
  assert.equal(cleanPastedText('Mo\u00a0Kai'), 'Mo Kai', 'web pages use non-breaking spaces');
  assert.equal(cleanPastedText('\u200e\u2068Mo\u200b Kai\u2069\ufeff'), 'Mo Kai', 'direction marks and zero-width characters');
  assert.equal(cleanPastedText('Mo Kai\r\n'), 'Mo Kai');
  assert.equal(cleanPastedText('é🙂 line\nnext'), 'é🙂 line\nnext', 'Unicode and inner line breaks survive');
  assert.equal(cleanPastedText('Ecto  ×\u3000250'), 'Ecto  ×\u3000250', 'ordinary and ideographic spacing inside text survives');
  assert.equal(cleanPastedText('\u200b \u00a0'), '');
});

test('a character name has single spaces between words', () => {
  assert.equal(normaliseCharacterName('  Mo \u00a0 Kai\t'), 'Mo Kai');
});
