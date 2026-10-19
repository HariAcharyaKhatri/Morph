import { describe, expect, it } from 'vitest';
import { LinkResolver, rewriteHtmlLinks } from '../../../src/generation/links/resolver.js';
import type { PageRoute } from '../../../src/core/types.js';

describe('LinkResolver', () => {
  const routes: PageRoute[] = [
    { url: 'https://example.com', path: '/', title: 'Home', isDistinct: true },
    { url: 'https://example.com/play', path: '/play', title: 'Play', isDistinct: true },
    { url: 'https://example.com/puzzles', path: '/puzzles', title: 'Puzzles', isDistinct: true },
    { url: 'https://example.com/blog/[slug]', path: '/blog/[slug]', title: 'Blog Post', isDistinct: true },
    { url: 'https://example.com/users/[id]', path: '/users/[id]', title: 'User Profile', isDistinct: true },
  ];

  const resolver = new LinkResolver({
    sourceBaseUrl: 'https://example.com',
    routes,
  });

  // 1. Same-origin absolute URL becomes a local path
  it('1. converts same-origin absolute URL to a local route path', () => {
    const res = resolver.resolveLink('https://example.com/play');
    expect(res.href).toBe('/play');
    expect(res.isInternal).toBe(true);
    expect(res.isRouteGenerated).toBe(true);
    expect(res.isExternal).toBe(false);
  });

  // 2. External domain remains unchanged
  it('2. preserves external domains unchanged', () => {
    const externalUrl = 'https://www.google.com/search?q=chess';
    const res = resolver.resolveLink(externalUrl);
    expect(res.href).toBe(externalUrl);
    expect(res.isInternal).toBe(false);
    expect(res.isExternal).toBe(true);
  });

  // 3. Same-origin URL with query string preserves query
  it('3. preserves query strings on same-origin URLs', () => {
    const res = resolver.resolveLink('https://example.com/play?mode=blitz&time=300');
    expect(res.href).toBe('/play?mode=blitz&time=300');
    expect(res.isInternal).toBe(true);
  });

  // 4. Same-origin URL with fragment preserves fragment
  it('4. preserves fragments on same-origin URLs', () => {
    const res = resolver.resolveLink('https://example.com/play#leaderboard');
    expect(res.href).toBe('/play#leaderboard');
    expect(res.isInternal).toBe(true);

    const withQueryAndFrag = resolver.resolveLink('https://example.com/play?mode=blitz#chat');
    expect(withQueryAndFrag.href).toBe('/play?mode=blitz#chat');
  });

  // 5. Root homepage URL maps to /
  it('5. maps root homepage URLs to /', () => {
    expect(resolver.resolve('https://example.com')).toBe('/');
    expect(resolver.resolve('https://example.com/')).toBe('/');
  });

  // 6. Relative URL resolves against its source page
  it('6. resolves relative URLs against the current source page URL', () => {
    const context = { currentPageUrl: 'https://example.com/blog/intro-to-chess' };

    // Parent-relative link resolving to /play
    const parentRelative = resolver.resolveLink('../play', context);
    expect(parentRelative.href).toBe('/play');
    expect(parentRelative.isInternal).toBe(true);

    // Root-relative link
    const rootRelative = resolver.resolveLink('/puzzles', context);
    expect(rootRelative.href).toBe('/puzzles');

    // Query-only link on current page
    const queryOnly = resolver.resolveLink('?tab=comments', context);
    expect(queryOnly.href).toBe('/blog/intro-to-chess?tab=comments');
  });

  // 7. Trailing slash normalization is consistent
  it('7. normalizes trailing slashes consistently with the route mapper', () => {
    expect(resolver.resolve('https://example.com/play/')).toBe('/play');
    expect(resolver.resolve('/play/')).toBe('/play');
    expect(resolver.resolve('https://example.com/')).toBe('/');
  });

  // 8. Existing local paths are not double-rewritten
  it('8. avoids double-rewriting already localized paths', () => {
    expect(resolver.resolve('/play')).toBe('/play');

    const prefixResolver = new LinkResolver({
      sourceBaseUrl: 'https://example.com',
      routes,
      basePath: '/clone',
    });

    expect(prefixResolver.resolve('https://example.com/play')).toBe('/clone/play');
    // Already localized with base path must not become /clone/clone/play
    expect(prefixResolver.resolve('/clone/play')).toBe('/clone/play');
  });

  // 9. Missing routes follow the documented fallback policy
  it('9. applies deliberate fallback policy for ungenerated routes (never redirects to /)', () => {
    const ungeneratedUrl = 'https://example.com/settings/privacy';

    // Default policy: preserve-source
    const defaultRes = resolver.resolveLink(ungeneratedUrl);
    expect(defaultRes.href).toBe(ungeneratedUrl);
    expect(defaultRes.isRouteGenerated).toBe(false);
    expect(defaultRes.href).not.toBe('/');

    // rewrite-local policy
    const localResolver = new LinkResolver({
      sourceBaseUrl: 'https://example.com',
      routes,
      missingRoutePolicy: 'rewrite-local',
    });
    const localRes = localResolver.resolveLink(ungeneratedUrl);
    expect(localRes.href).toBe('/settings/privacy');
    expect(localRes.isRouteGenerated).toBe(false);

    // custom policy
    const customResolver = new LinkResolver({
      sourceBaseUrl: 'https://example.com',
      routes,
      missingRoutePolicy: 'custom',
      customMissingRouteHandler: (dest, path) => `https://archive.org/web/${dest}`,
    });
    expect(customResolver.resolve(ungeneratedUrl)).toBe(`https://archive.org/web/${ungeneratedUrl}`);
  });

  // 10. Dynamic routes are handled consistently with the route registry
  it('10. matches dynamic routes registered in the registry without inventing new patterns', () => {
    // /blog/[slug] is in registry -> matches concrete slug
    const blogRes = resolver.resolveLink('https://example.com/blog/world-championship-2026');
    expect(blogRes.href).toBe('/blog/world-championship-2026');
    expect(blogRes.isRouteGenerated).toBe(true);
    expect(blogRes.matchedRoute).toBe('/blog/[slug]');

    // /users/[id] is in registry -> matches concrete ID
    const userRes = resolver.resolveLink('https://example.com/users/magnuscarlsen?tab=stats');
    expect(userRes.href).toBe('/users/magnuscarlsen?tab=stats');
    expect(userRes.isRouteGenerated).toBe(true);
    expect(userRes.matchedRoute).toBe('/users/[id]');

    // /products/999 is NOT in registry -> must NOT invent dynamic route
    const unknownRes = resolver.resolveLink('https://example.com/products/999');
    expect(unknownRes.isRouteGenerated).toBe(false);
    expect(unknownRes.href).toBe('https://example.com/products/999');
  });

  // 11. mailto: and tel: links are preserved
  it('11. preserves mailto: and tel: links', () => {
    expect(resolver.resolve('mailto:support@example.com')).toBe('mailto:support@example.com');
    expect(resolver.resolve('tel:+18005550199')).toBe('tel:+18005550199');
    expect(resolver.resolve('sms:+18005550199')).toBe('sms:+18005550199');
  });

  // 12. javascript: URLs are removed or rejected safely
  it('12. safely rejects javascript: and vbscript: URLs', () => {
    expect(resolver.resolve('javascript:void(0)')).toBe('');
    expect(resolver.resolve('javascript:alert(document.cookie)')).toBe('');
    expect(resolver.resolve('vbscript:msgbox(1)')).toBe('');
  });

  // 13. Image, script, CSS, and media resource URLs remain unchanged
  it('13. does not treat media files or downloadable documents as internal page routes', () => {
    const pdfUrl = 'https://example.com/downloads/rulebook.pdf';
    const zipUrl = 'https://example.com/files/archive.zip';
    const mp4Url = 'https://example.com/videos/tutorial.mp4';

    expect(resolver.resolveLink(pdfUrl).isRouteGenerated).toBe(false);
    expect(resolver.resolveLink(pdfUrl).href).toBe(pdfUrl);

    expect(resolver.resolveLink(zipUrl).isRouteGenerated).toBe(false);
    expect(resolver.resolveLink(zipUrl).href).toBe(zipUrl);

    expect(resolver.resolveLink(mp4Url).isRouteGenerated).toBe(false);
    expect(resolver.resolveLink(mp4Url).href).toBe(mp4Url);
  });

  // 14. Form actions and other navigation attributes are handled only where appropriate
  it('14. handles form actions, button formaction, area href, and SVG links in HTML', () => {
    const html = `
      <div>
        <a href="https://example.com/play">Play</a>
        <map name="board">
          <area href="https://example.com/puzzles" coords="0,0,50,50" />
        </map>
        <svg>
          <a xlink:href="https://example.com/play"><text>SVG Play</text></a>
        </svg>
        <form action="https://example.com/play" method="post">
          <input type="text" name="username" />
          <button type="submit" formaction="https://example.com/puzzles">Puzzle Submit</button>
        </form>
        <!-- Resource elements that must NOT be rewritten as routes -->
        <img src="https://example.com/logo.png" />
        <video src="https://example.com/intro.mp4"></video>
        <link rel="stylesheet" href="https://example.com/styles.css" />
      </div>
    `;

    const rewritten = resolver.rewriteHtml(html);

    // Internal links rewritten
    expect(rewritten).toContain('href="/play"');
    expect(rewritten).toContain('href="/puzzles"');
    expect(rewritten).toContain('coords="0,0,50,50"');
    expect(rewritten).toContain('xlink:href="/play"');
    expect(rewritten).toContain('action="/play"');
    expect(rewritten).toContain('formaction="/puzzles"');

    // Resources preserved
    expect(rewritten).toContain('src="https://example.com/logo.png"');
    expect(rewritten).toContain('src="https://example.com/intro.mp4"');
    expect(rewritten).toContain('href="https://example.com/styles.css"');
  });

  // 15. External login, payment, and authentication links remain external
  it('15. keeps third-party authentication and payment services external', () => {
    const googleAuth = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123';
    const appleAuth = 'https://appleid.apple.com/auth/authorize?client_id=com.app';
    const stripeCheckout = 'https://checkout.stripe.com/pay/cs_live_123';
    const paypalAuth = 'https://paypal.com/signin?returnUrl=abc';

    expect(resolver.resolve(googleAuth)).toBe(googleAuth);
    expect(resolver.resolve(appleAuth)).toBe(appleAuth);
    expect(resolver.resolve(stripeCheckout)).toBe(stripeCheckout);
    expect(resolver.resolve(paypalAuth)).toBe(paypalAuth);
  });

  // 16. All supported output frameworks receive consistent link-resolution behavior
  it('16. provides consistent link resolution across all supported output frameworks', () => {
    const frameworks: Array<'nextjs' | 'vite-react' | 'astro' | 'static-html'> = [
      'nextjs',
      'vite-react',
      'astro',
      'static-html',
    ];

    for (const fw of frameworks) {
      const fwResolver = new LinkResolver({
        sourceBaseUrl: 'https://example.com',
        routes,
        framework: fw,
      });

      expect(fwResolver.resolve('https://example.com/play')).toBe('/play');
      expect(fwResolver.resolve('https://example.com/puzzles')).toBe('/puzzles');
      expect(fwResolver.resolve('https://example.com')).toBe('/');
      expect(fwResolver.resolve('https://google.com')).toBe('https://google.com');
    }
  });

  // Additional edge cases: URL-encoded paths, hash-only, query-only
  it('handles URL-encoded paths and in-page hash fragments', () => {
    const encodedRoutes: PageRoute[] = [
      { url: 'https://example.com', path: '/', title: 'Home', isDistinct: true },
      { url: 'https://example.com/my%20games', path: '/my games', title: 'My Games', isDistinct: true },
    ];
    const encResolver = new LinkResolver({
      sourceBaseUrl: 'https://example.com',
      routes: encodedRoutes,
    });

    expect(encResolver.resolve('https://example.com/my%20games')).toBe('/my games');
    expect(encResolver.resolve('#section-top')).toBe('#section-top');
    expect(encResolver.resolve('')).toBe('');
  });
});
