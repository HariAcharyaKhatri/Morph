import type { MorphConfig } from '../../config/schema.js';
import type { PageRoute } from '../../core/types.js';
import { MAX_PAGES } from '../../core/constants.js';
import { mapUrlToRoute } from './route-mapper.js';

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>>['newPage']>>;

export async function crawlSite(
  startUrl: string,
  page: Page,
  config: MorphConfig
): Promise<PageRoute[]> {
  const baseUrl = new URL(startUrl);
  const visited = new Set<string>();
  const routes: PageRoute[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];

  while (queue.length > 0 && routes.length < MAX_PAGES) {
    const current = queue.shift();
    if (!current) break;

    const normalized = normalizeUrl(current.url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    // Check exclude patterns
    if (config.extraction.excludePatterns.some((p) => normalized.includes(p))) continue;

    try {
      await page.goto(current.url, {
        waitUntil: 'domcontentloaded',
        timeout: config.extraction.timeout,
      });

      const title = await page.title();
      const description = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="description"]');
        return meta?.getAttribute('content') || undefined;
      });
      const html = await page.content();

      const route = mapUrlToRoute(current.url, baseUrl.origin);
      routes.push({
        ...route,
        title,
        description,
        isDistinct: true,
        html,
      });

      // Discover links for next depth level
      if (current.depth < config.extraction.maxDepth) {
        const links = await page.evaluate((origin) => {
          return [...document.querySelectorAll('a[href]')]
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((href) => {
              try {
                const url = new URL(href);
                return url.origin === origin
                  && !href.includes('#')
                  && !href.match(/\.(pdf|zip|png|jpg|jpeg|gif|svg|mp4|mp3)$/i);
              } catch {
                return false;
              }
            });
        }, baseUrl.origin);

        for (const link of [...new Set(links)]) {
          if (!visited.has(normalizeUrl(link))) {
            queue.push({ url: link, depth: current.depth + 1 });
          }
        }
      }
    } catch {
      // Skip pages that fail to load
    }
  }

  return deduplicateRoutes(routes);
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

function deduplicateRoutes(routes: PageRoute[]): PageRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    if (seen.has(route.path)) {
      return false;
    }
    seen.add(route.path);
    return true;
  });
}
