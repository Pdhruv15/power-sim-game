// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LOAD_TYPES } from '../sim';
import { ICON_NAMES, loadIcon, PartIcon } from './PartIcon';

afterEach(cleanup);

describe('PartIcon', () => {
  it('draws every symbol', () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<PartIcon name={name} />);
      expect(container.querySelector(`[data-symbol="${name}"]`)!.childElementCount).toBeGreaterThan(0);
      cleanup();
    }
  });

  it('has a symbol for every kind of load', () => {
    for (const type of LOAD_TYPES) expect(ICON_NAMES).toContain(loadIcon(type));
    expect(loadIcon('ac')).toBe('motor');
    expect(loadIcon('lighting')).toBe('lamp');
  });
});
