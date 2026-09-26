import { afterEach, describe, expect, it, vi } from 'vitest';
// The Hub fixture's DOM environment tests the renderer's surface controller, as hub-fixture.ts runs it.
// eslint-disable-next-line no-restricted-imports
import { closeDisclosure, installSurfaceController } from '../../../src/renderer/surface-controller';

function disclosure(parent: HTMLElement) {
  const details = document.createElement('details');
  details.open = true;
  details.innerHTML = '<summary>Technical details</summary><button type="button">Copy</button>';
  parent.append(details);
  return { details, summary: details.querySelector('summary')!, inner: details.querySelector('button')! };
}

describe('closeDisclosure', () => {
  afterEach(() => document.body.replaceChildren());

  it('closes only a disclosure inside its owner and keeps focus on the summary', () => {
    const owner = document.createElement('section');
    document.body.append(owner);
    const inside = disclosure(owner);
    const outside = disclosure(document.body);
    expect(closeDisclosure(outside.inner, owner)).toBe(false);
    expect(outside.details.open).toBe(true);
    expect(closeDisclosure(owner, owner)).toBe(false);
    expect(closeDisclosure(inside.inner, owner)).toBe(true);
    expect(inside.details.open).toBe(false);
    expect(document.activeElement).toBe(inside.summary);
  });

  it('is the step surface Escape takes before it dismisses the surface', () => {
    const controller = installSurfaceController(document);
    const root = document.createElement('section');
    document.body.append(root);
    const { details, summary, inner } = disclosure(root);
    const dismiss = vi.fn();
    const surface = controller.register({ root, priority: 1, dismiss });
    surface.setOpen(true);
    inner.focus();
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(dismiss).not.toHaveBeenCalled();
    summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(dismiss).toHaveBeenCalledOnce();
    surface.dispose();
  });
});
