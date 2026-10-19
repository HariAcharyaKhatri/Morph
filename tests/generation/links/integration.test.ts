import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LinkResolver } from '../../../src/generation/links/resolver.js';
import { generateComponentStubs, sanitizeHtml } from '../../../src/generation/components/stub-generator.js';
import { decomposeDOM } from '../../../src/generation/components/decomposer.js';
import { generateRoutes } from '../../../src/generation/routes/generator.js';
import type { PageRoute, InteractionMap } from '../../../src/core/types.js';
import type { MorphConfig } from '../../../src/config/schema.js';

import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

describe('Link Resolution and Multi-Route Integration', () => {
  const dummyInteractions: InteractionMap = {
    forms: [],
    modals: [],
    carousels: [],
    tabs: [],
    dropdowns: [],
    accordions: [],
    tooltips: [],
    menus: [],
  };

  const dummyConfig: MorphConfig = {
    ...DEFAULT_CONFIG,
    output: {
      ...DEFAULT_CONFIG.output,
      directory: '',
      framework: 'nextjs',
    },
  };

  it('rewrites links inside sanitizeHtml before serialization', () => {
    const resolver = new LinkResolver({
      sourceBaseUrl: 'https://example.com',
      routes: ['/', '/play', '/puzzles'],
    });

    const rawHtml = `
      <nav>
        <a href="https://example.com/play">Play Live</a>
        <a href="/puzzles">Puzzles</a>
        <a href="https://example.com/terms">Uncrawled Terms</a>
        <a href="https://google.com">Google</a>
        <a href="javascript:alert('xss')">Bad Link</a>
        <img src="https://example.com/logo.png" alt="Logo" />
      </nav>
    `;

    const sanitized = sanitizeHtml(rawHtml, resolver, 'https://example.com');

    // /play was same-origin absolute and registered -> converted to /play
    expect(sanitized).toContain('href="/play"');
    // /puzzles was relative and registered -> /puzzles
    expect(sanitized).toContain('href="/puzzles"');
    // /terms was uncrawled -> kept as absolute source URL
    expect(sanitized).toContain('href="https://example.com/terms"');
    // google.com is external -> kept as external
    expect(sanitized).toContain('href="https://google.com"');
    // javascript: alert was unsafe -> stripped
    expect(sanitized).not.toContain('javascript:');
    // image src untouched
    expect(sanitized).toContain('src="https://example.com/logo.png"');
  });

  it('generates distinct route-specific components with resolved links for multiple pages', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'morph-integration-'));
    temporaryDirectories.push(outputDir);

    const routes: PageRoute[] = [
      {
        url: 'https://example.com',
        path: '/',
        title: 'Home Page',
        isDistinct: true,
        html: `
          <body>
            <header>
              <h1>Welcome to Example</h1>
              <a href="https://example.com/play">Go to Play</a>
              <a href="https://example.com/puzzles">Go to Puzzles</a>
              <a href="https://external.com">External Partner</a>
            </header>
          </body>
        `,
      },
      {
        url: 'https://example.com/play',
        path: '/play',
        title: 'Play Arena',
        isDistinct: true,
        html: `
          <body>
            <main>
              <h1>Play Arena</h1>
              <a href="https://example.com/">Back to Home</a>
              <a href="./puzzles">Try Puzzles</a>
            </main>
          </body>
        `,
      },
      {
        url: 'https://example.com/puzzles',
        path: '/puzzles',
        title: 'Puzzles Arena',
        isDistinct: true,
        html: `
          <body>
            <main>
              <h1>Daily Puzzles</h1>
              <a href="https://example.com/play">Go to Play</a>
            </main>
          </body>
        `,
      },
    ];

    const resolver = new LinkResolver({
      sourceBaseUrl: 'https://example.com',
      routes,
      framework: 'nextjs',
    });

    // 1. Generate routes
    await generateRoutes(routes, outputDir, dummyConfig);

    // 2. Generate component stubs for each route with its distinct root name
    for (const route of routes) {
      const rootName = route.path === '/' ? 'PageBody' : 'PlayBody';
      const actualRootName = route.path === '/'
        ? 'PageBody'
        : route.path === '/play'
          ? 'PlayBody'
          : 'PuzzlesBody';

      const tree = decomposeDOM(route.html!, dummyInteractions, actualRootName);
      await generateComponentStubs(tree, outputDir, {
        resolver,
        pageUrl: route.url,
      });
    }

    // Verify HomePage renders PageBody
    const homePageContent = await readFile(join(outputDir, 'src/app/page.tsx'), 'utf8');
    expect(homePageContent).toContain("import { PageBody } from '@/components/PageBody';");
    expect(homePageContent).toContain('<PageBody />');

    // Verify PlayPage renders PlayBody (NOT PageBody!)
    const playPageContent = await readFile(join(outputDir, 'src/app/play/page.tsx'), 'utf8');
    expect(playPageContent).toContain("import { PlayBody } from '@/components/PlayBody';");
    expect(playPageContent).toContain('<PlayBody />');
    expect(playPageContent).not.toContain("from '@/components/PageBody'");

    // Verify PuzzlesPage renders PuzzlesBody (NOT PageBody!)
    const puzzlesPageContent = await readFile(join(outputDir, 'src/app/puzzles/page.tsx'), 'utf8');
    expect(puzzlesPageContent).toContain("import { PuzzlesBody } from '@/components/PuzzlesBody';");
    expect(puzzlesPageContent).toContain('<PuzzlesBody />');

    // Verify PageBody has resolved internal links
    const pageBodyContent = await readFile(join(outputDir, 'src/components/PageBody.tsx'), 'utf8');
    expect(pageBodyContent).toContain('href=\\"/play\\"');
    expect(pageBodyContent).toContain('href=\\"/puzzles\\"');
    expect(pageBodyContent).toContain('href=\\"https://external.com\\"');

    // Verify PlayBody has resolved internal links
    const playBodyContent = await readFile(join(outputDir, 'src/components/PlayBody.tsx'), 'utf8');
    expect(playBodyContent).toContain('href=\\"/\\"');
    expect(playBodyContent).toContain('href=\\"/puzzles\\"');
    expect(playBodyContent).toContain('Play Arena');

    // Verify PuzzlesBody has its own content and resolved link
    const puzzlesBodyContent = await readFile(join(outputDir, 'src/components/PuzzlesBody.tsx'), 'utf8');
    expect(puzzlesBodyContent).toContain('href=\\"/play\\"');
    expect(puzzlesBodyContent).toContain('Daily Puzzles');
  });
});
