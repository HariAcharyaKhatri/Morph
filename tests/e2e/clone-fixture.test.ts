import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runClone } from '../../src/cli/commands/clone.js';

describe('E2E Clone Pipeline with Realistic Local Fixture', () => {
  let server: Server;
  let serverUrl: string;
  let outputDir: string;

  beforeAll(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'morph-e2e-fixture-'));

    // Spin up local HTTP fixture server
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');

        if (url.pathname === '/') {
          res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Home - Chess Test Site</title>
  <meta name="description" content="Play online chess" />
</head>
<body>
  <header>
    <nav>
      <a id="link-play" href="${serverUrl}/play">Play Arena</a>
      <a id="link-puzzles" href="/puzzles">Daily Puzzles</a>
      <a id="link-google" href="https://www.google.com/">Google</a>
      <a id="link-download" href="${serverUrl}/assets/rules.pdf">Download Rules</a>
      <a id="link-mail" href="mailto:support@chesssite.test">Support</a>
    </nav>
  </header>
  <main>
    <h1>Welcome to Chess Test</h1>
    <form action="${serverUrl}/play" method="GET">
      <input type="text" name="player" />
      <button type="submit" formaction="${serverUrl}/puzzles">Go to Puzzles</button>
    </form>
    <img src="${serverUrl}/images/logo.png" alt="Test Logo" />
  </main>
</body>
</html>`);
        } else if (url.pathname === '/play') {
          res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Play - Chess Arena</title>
</head>
<body>
  <main>
    <h1>Play Arena Live</h1>
    <a id="link-home" href="${serverUrl}/">Home</a>
    <a id="link-rel-puzzles" href="../puzzles">Solve Puzzles</a>
    <a id="link-query-frag" href="${serverUrl}/play?mode=rapid#board">Rapid Board</a>
  </main>
</body>
</html>`);
        } else if (url.pathname === '/puzzles') {
          res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Puzzles - Daily Challenges</title>
</head>
<body>
  <main>
    <h1>Daily Puzzles Arena</h1>
    <a id="link-to-play" href="/play">Play Live</a>
    <a id="link-uncrawled" href="${serverUrl}/never-crawled-secret">Uncrawled</a>
  </main>
</body>
</html>`);
        } else {
          res.statusCode = 404;
          res.end('Not Found');
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          serverUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (outputDir) {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('crawls the fixture site, generates distinct routes with working internal links', async () => {
    const result = await runClone([serverUrl], {
      output: outputDir,
      depth: '1',
      skipAssets: true,
      skipAudit: true,
      framework: 'nextjs',
    });

    expect(result.routes.length).toBeGreaterThanOrEqual(3);

    // 1. Verify generated page route files exist
    const homePage = await readFile(join(outputDir, 'src/app/page.tsx'), 'utf8');
    const playPage = await readFile(join(outputDir, 'src/app/play/page.tsx'), 'utf8');
    const puzzlesPage = await readFile(join(outputDir, 'src/app/puzzles/page.tsx'), 'utf8');

    // Each page must render its own route-specific component
    expect(homePage).toContain("import { PageBody } from '@/components/PageBody';");
    expect(homePage).toContain('<PageBody />');

    expect(playPage).toContain("import { PlayBody } from '@/components/PlayBody';");
    expect(playPage).toContain('<PlayBody />');
    expect(playPage).not.toContain("from '@/components/PageBody'");

    expect(puzzlesPage).toContain("import { PuzzlesBody } from '@/components/PuzzlesBody';");
    expect(puzzlesPage).toContain('<PuzzlesBody />');
    expect(puzzlesPage).not.toContain("from '@/components/PageBody'");

    // 2. Verify PageBody component stubs have link resolution applied
    const pageBody = await readFile(join(outputDir, 'src/components/PageBody.tsx'), 'utf8');

    // Same-origin absolute link rewritten to local route
    expect(pageBody).toContain('href=\\"/play\\"');
    // Relative link to puzzles preserved as /puzzles
    expect(pageBody).toContain('href=\\"/puzzles\\"');
    // External link remains external
    expect(pageBody).toContain('href=\\"https://www.google.com/\\"');
    // Download link to .pdf remains pointing to the download URL
    expect(pageBody).toContain(`${serverUrl}/assets/rules.pdf`);
    // Special mailto: scheme preserved
    expect(pageBody).toContain('href=\\"mailto:support@chesssite.test\\"');
    // Form action rewritten to local route
    expect(pageBody).toContain('action=\\"/play\\"');
    // Button formaction rewritten to local route
    expect(pageBody).toContain('formaction=\\"/puzzles\\"');
    // Image src remains resource URL
    expect(pageBody).toContain(`${serverUrl}/images/logo.png`);

    // 3. Verify PlayBody component stub
    const playBody = await readFile(join(outputDir, 'src/components/PlayBody.tsx'), 'utf8');
    // Link to root maps to /
    expect(playBody).toContain('href=\\"/\\"');
    // Parent-relative ../puzzles resolves to /puzzles
    expect(playBody).toContain('href=\\"/puzzles\\"');
    // Same-origin with query and fragment preserves both
    expect(playBody).toContain('href=\\"/play?mode=rapid#board\\"');
    expect(playBody).toContain('Play Arena Live');

    // 4. Verify PuzzlesBody component stub
    const puzzlesBody = await readFile(join(outputDir, 'src/components/PuzzlesBody.tsx'), 'utf8');
    expect(puzzlesBody).toContain('href=\\"/play\\"');
    // Uncrawled route follows preserve-source fallback policy
    expect(puzzlesBody).toContain(`${serverUrl}/never-crawled-secret`);
    expect(puzzlesBody).toContain('Daily Puzzles Arena');
  }, 30000);
});
