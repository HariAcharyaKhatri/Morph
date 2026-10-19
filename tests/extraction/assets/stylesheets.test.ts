import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadStylesheets } from '../../../src/extraction/assets/stylesheets.js';

let outputDir: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();

  if (outputDir) {
    await rm(outputDir, { recursive: true, force: true });
    outputDir = undefined;
  }
});

describe('downloadStylesheets', () => {
  it('rewrites repeated relative asset URLs to the same local asset', async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'morph-css-test-'));

    const cssUrl = 'https://example.com/css/site.css';
    const assetUrl = 'https://example.com/img/bg.png';

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === cssUrl) {
        return {
          ok: true,
          text: async () =>
            '.first { background: url("../img/bg.png"); }\n.second { background: url("../img/bg.png"); }',
        };
      }

      if (url === assetUrl) {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }

      return { ok: false, status: 404 };
    }));

    const paths = await downloadStylesheets([cssUrl], outputDir);

    expect(paths).toHaveLength(1);

    const css = await readFile(join(outputDir, 'public', paths[0].slice(1)), 'utf8');
    const matches = [...css.matchAll(/url\("([^"]+)"\)/g)];

    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe(matches[1][1]);
    expect(matches[0][1]).toMatch(/^\/styles\/assets\//);
  });

  it('inlines imported stylesheets and resolves their relative assets', async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'morph-css-import-test-'));

    const cssUrl = 'https://example.com/css/site.css';
    const importedUrl = 'https://example.com/css/theme/colors.css';
    const assetUrl = 'https://example.com/css/theme/pattern.svg';

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === cssUrl) {
        return {
          ok: true,
          text: async () => '@import "./theme/colors.css";\nbody { color: black; }',
        };
      }

      if (url === importedUrl) {
        return {
          ok: true,
          text: async () => '.theme { background: url("./pattern.svg"); }',
        };
      }

      if (url === assetUrl) {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
        };
      }

      return { ok: false, status: 404 };
    }));

    const paths = await downloadStylesheets([cssUrl], outputDir);

    expect(paths).toHaveLength(1);

    const css = await readFile(join(outputDir, 'public', paths[0].slice(1)), 'utf8');

    expect(css).not.toContain('@import');
    expect(css).toContain('.theme');
    expect(css).toContain('body { color: black; }');
    expect(css).toMatch(/url\("\/styles\/assets\/[^"]+\.svg"\)/);
  });
});
