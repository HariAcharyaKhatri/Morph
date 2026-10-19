import { describe, expect, it } from 'vitest';
import { generateIconsComponent } from '../../../src/extraction/assets/pipeline.js';

describe('generateIconsComponent', () => {
  it('generates unique component names for duplicate SVG names', () => {
    const result = generateIconsComponent([
      {
        name: 'site-nav-item',
        svg: '<svg class="nav-icon" viewBox="0 0 24 24"><path d="M0 0" /></svg>',
      },
      {
        name: 'site-nav-item',
        svg: '<svg class="nav-icon" viewBox="0 0 24 24"><path d="M1 1" /></svg>',
      },
    ]);

    expect(result).toContain('function SiteNavItemIcon(');
    expect(result).toContain('function SiteNavItemIcon2(');
  });

  it('converts inline SVG style strings into JSX style objects', () => {
    const result = generateIconsComponent([
      {
        name: 'user-avatar',
        svg: '<svg style="width: 30px; height: 30px;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>',
      },
    ]);

    expect(result).toContain('style={{ width: "30px", height: "30px" }}');
  });
});
