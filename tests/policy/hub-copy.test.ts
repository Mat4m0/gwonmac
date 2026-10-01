// Enforces the handoff's Hub product-name rule without changing packaged identities.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

test('Hub copy uses gwonmac rather than another product name (HUB-181)', () => {
  for (const name of readdirSync(new URL('../../src/renderer/', import.meta.url)).filter(name => name.startsWith('hub') && name.endsWith('.ts'))) {
    const source = readFileSync(new URL(`../../src/renderer/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /GWonMac|Guild Wars Reforged/u, name);
  }
});
