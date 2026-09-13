import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAttributes, buildProfessions } from '../../src/shared/builds/presentation.js';

test('compact attributes keep distinct labels, full names, ranks and owning profession art', () => {
  const attributes = buildAttributes({ FastCasting: 12, IllusionMagic: 9, InspirationMagic: 8, Curses: 5, DominationMagic: 0 });
  assert.deepEqual(attributes.map(group => group.name), ['Necromancer', 'Mesmer']);
  assert.deepEqual(attributes[1]?.attributes.map(({ label, rank }) => [label, rank]), [['FC', 12], ['IM', 9], ['InM', 8]]);
  assert.equal(attributes[1]?.attributes[1]?.name, 'Illusion Magic');
  assert.equal(attributes[1]?.icon, buildProfessions(['Me'])[0]?.icon);
  assert.equal(attributes[0]?.icon, buildProfessions(['N'])[0]?.icon);
  assert.deepEqual(buildAttributes({}), []);
  assert.deepEqual(buildProfessions([null]), []);
});
