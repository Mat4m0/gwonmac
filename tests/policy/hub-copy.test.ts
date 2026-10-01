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

// The removed standalone palette must not return with a conflicting keyboard guide.
test('Characters has only a Hub-owned entry and the guide describes that keyboard model (HUB-196, HUB-251)', () => {
  const palette = readFileSync('src/renderer/character-switch-palette.ts', 'utf8');
  assert.match(palette, /if \(!hub\) throw new Error\("Hub is not installed"\)/u);
  assert.doesNotMatch(palette, /if \(hub\)|if \(!hubFooter\)|showModal\(/u);
  const guide = readFileSync('docs/user-guide.md', 'utf8');
  assert.match(guide, /Build Library and Characters open inside Hub/u);
  assert.match(guide, /The search bar is shown for every account size/u);
  assert.match(guide, /they never switch/u);
  assert.match(guide, /each card shows|Each card shows/u);
  assert.match(guide, /resign before the party returns to the outpost/u);
  assert.match(guide, /click the red \*\*Resign\*\* button/u);
  assert.match(guide, /Resign is available only in a PvE outpost or explorable area/u);
});

test('Hub companion instructions keep the floating-window model (HUB-139)', () => {
  for (const [file, section] of [
    ['user-guide.md', /Build Library and Characters open inside Hub\.[\s\S]*?Storage opens quietly/u],
    ['whispers.md', /The default \*\*Command-D\*\*[\s\S]*?## Acceptance criteria/u],
    ['trade-discovery.md', /- Escape and Command-Backspace[\s\S]*?Closing a level returns focus/u],
  ] as const) {
    const text = readFileSync(new URL(`../../docs/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bDetach\b/u, file);
    const instructions = text.match(section)?.[0];
    assert.ok(instructions, `${file}: companion instructions exist`);
    assert.doesNotMatch(instructions, /Back (?:to|returns? to) Hub|Back closes (?:Trade|Whispers)|(?:Trade Chat|Whispers) opens? inside Hub/u, file);
  }
});
