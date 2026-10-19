import { load } from 'cheerio';
import type { PageRoute } from '../../core/types.js';

export type MissingRoutePolicy = 'preserve-source' | 'rewrite-local' | 'custom';

export interface LinkResolverOptions {
  /** The base URL of the source website (e.g. 'https://www.example.com') */
  sourceBaseUrl: string;
  /** Current source page URL being processed, for relative link resolution */
  currentPageUrl?: string;
  /** Known generated/discovered routes (PageRoutes or string paths) */
  routes?: Array<PageRoute | string>;
  /**
   * Policy for links whose destination route was not generated in the clone.
   * - 'preserve-source': Keep the absolute URL pointing to the source site so clicking it remains functional.
   * - 'rewrite-local': Rewrite to local path even if the route was not crawled.
   * - 'custom': Use customMissingRouteHandler.
   * Defaults to 'preserve-source'. Never silently redirects to '/'.
   */
  missingRoutePolicy?: MissingRoutePolicy;
  /** Custom handler when missingRoutePolicy is 'custom' */
  customMissingRouteHandler?: (destinationUrl: string, pathname: string) => string;
  /** Optional base path prefix for the cloned application (e.g. '/subpath') */
  basePath?: string;
  /** Target output framework */
  framework?: 'nextjs' | 'vite-react' | 'astro' | 'static-html';
  /** Whether trailing slashes should be preserved (false by default, consistent with route-mapper) */
  trailingSlash?: boolean;
}

export interface ResolvedLink {
  /** The final resolved URL or path */
  href: string;
  /** True if this is an internal route within the clone */
  isInternal: boolean;
  /** True if the destination route exists in the route registry */
  isRouteGenerated: boolean;
  /** The matched route pattern if internal, e.g. '/play' or '/blog/[slug]' */
  matchedRoute?: string;
  /** True if this points to an external origin */
  isExternal: boolean;
  /** True if this is a special scheme or fragment (mailto, tel, #hash, javascript, etc.) */
  isSpecialScheme: boolean;
}

/** Known non-page file extensions that represent media or downloadable assets */
const ASSET_EXTENSIONS = new Set([
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z',
  '.dmg', '.exe', '.apk', '.ipa', '.bin',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff',
  '.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv',
  '.mp3', '.wav', '.flac', '.aac', '.m4a',
  '.css', '.js', '.mjs', '.map', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.csv', '.tsv', '.xml', '.json',
]);

/** Known external auth, payment, and oauth service host substrings */
const EXTERNAL_SERVICE_PATTERNS = [
  'accounts.google.com',
  'appleid.apple.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'github.com/login',
  'login.microsoftonline.com',
  'checkout.stripe.com',
  'paypal.com',
  'auth0.com',
  'okta.com',
];

export class LinkResolver {
  private readonly sourceBaseUrl: string;
  private readonly sourceOrigin: string;
  private readonly currentPageUrl: string;
  private readonly routeRegistry: Set<string>;
  private readonly dynamicRoutes: string[];
  private readonly missingRoutePolicy: MissingRoutePolicy;
  private readonly customMissingRouteHandler?: (destinationUrl: string, pathname: string) => string;
  private readonly basePath: string;
  private readonly framework: 'nextjs' | 'vite-react' | 'astro' | 'static-html';
  private readonly trailingSlash: boolean;

  constructor(options: LinkResolverOptions) {
    this.sourceBaseUrl = options.sourceBaseUrl;
    try {
      this.sourceOrigin = new URL(options.sourceBaseUrl).origin.toLowerCase();
    } catch {
      this.sourceOrigin = '';
    }
    this.currentPageUrl = options.currentPageUrl || options.sourceBaseUrl;
    this.missingRoutePolicy = options.missingRoutePolicy || 'preserve-source';
    this.customMissingRouteHandler = options.customMissingRouteHandler;
    this.basePath = (options.basePath || '').replace(/\/$/, '');
    this.framework = options.framework || 'nextjs';
    this.trailingSlash = options.trailingSlash ?? false;

    this.routeRegistry = new Set<string>();
    this.dynamicRoutes = [];

    if (options.routes) {
      for (const item of options.routes) {
        const routePath = typeof item === 'string' ? item : item.path;
        const normalized = this.normalizePathname(routePath);
        this.routeRegistry.add(normalized);
        if (normalized.includes('[')) {
          this.dynamicRoutes.push(normalized);
        }
      }
    }
  }

  /**
   * Resolves a raw href value into a structured ResolvedLink result.
   */
  public resolveLink(rawHref: string, context?: { currentPageUrl?: string }): ResolvedLink {
    if (rawHref === undefined || rawHref === null) {
      return {
        href: '',
        isInternal: false,
        isRouteGenerated: false,
        isExternal: false,
        isSpecialScheme: true,
      };
    }

    const trimmed = rawHref.trim();

    // 1. Empty or fragment-only links
    if (trimmed === '' || trimmed === '#') {
      return {
        href: trimmed,
        isInternal: true,
        isRouteGenerated: true,
        isExternal: false,
        isSpecialScheme: true,
      };
    }

    if (trimmed.startsWith('#')) {
      return {
        href: trimmed,
        isInternal: true,
        isRouteGenerated: true,
        isExternal: false,
        isSpecialScheme: true,
      };
    }

    // 2. Unsafe navigation schemes: javascript:, vbscript:, data: (HTML execution)
    if (/^\s*(javascript|vbscript|data\s*:)/i.test(trimmed)) {
      return {
        href: '',
        isInternal: false,
        isRouteGenerated: false,
        isExternal: false,
        isSpecialScheme: true,
      };
    }

    // 3. Special external communication schemes: mailto:, tel:, sms:, callto:
    if (/^\s*(mailto|tel|sms|callto|facetime):/i.test(trimmed)) {
      return {
        href: trimmed,
        isInternal: false,
        isRouteGenerated: false,
        isExternal: true,
        isSpecialScheme: true,
      };
    }

    // 4. Protocol-relative URLs (e.g. //cdn.example.com/file)
    let parsed: URL;
    let isAbsolute = false;
    const pageUrl = context?.currentPageUrl || this.currentPageUrl;

    if (trimmed.startsWith('//')) {
      try {
        const protocol = this.sourceBaseUrl ? new URL(this.sourceBaseUrl).protocol : 'https:';
        parsed = new URL(`${protocol}${trimmed}`);
        isAbsolute = true;
      } catch {
        return {
          href: trimmed,
          isInternal: false,
          isRouteGenerated: false,
          isExternal: true,
          isSpecialScheme: false,
        };
      }
    } else {
      try {
        parsed = new URL(trimmed);
        isAbsolute = true;
      } catch {
        // Relative URL, e.g. '/play', '../about', 'contact', '?tab=1'
        try {
          parsed = new URL(trimmed, pageUrl);
          isAbsolute = false;
        } catch {
          // Unparseable URL
          return {
            href: trimmed,
            isInternal: false,
            isRouteGenerated: false,
            isExternal: false,
            isSpecialScheme: true,
          };
        }
      }
    }

    // 5. External domain check
    const targetOrigin = parsed.origin.toLowerCase();
    const isSameOrigin = this.sourceOrigin && targetOrigin === this.sourceOrigin;

    // Check if hostname matches any known external auth or payment service
    const isThirdPartyAuth = EXTERNAL_SERVICE_PATTERNS.some((pattern) =>
      parsed.href.includes(pattern)
    );

    if (!isSameOrigin || isThirdPartyAuth) {
      return {
        href: trimmed,
        isInternal: false,
        isRouteGenerated: false,
        isExternal: true,
        isSpecialScheme: false,
      };
    }

    // 6. Check for file / asset download extensions
    const fileExtension = this.extractFileExtension(parsed.pathname);
    if (fileExtension && ASSET_EXTENSIONS.has(fileExtension)) {
      // Intended download or resource URL, not an internal page route.
      // Preserve as absolute source URL or relative download target.
      return {
        href: isAbsolute ? parsed.href : trimmed,
        isInternal: false,
        isRouteGenerated: false,
        isExternal: false,
        isSpecialScheme: false,
      };
    }

    // 7. Check if this is a query-only link on the current page
    if (trimmed.startsWith('?')) {
      const currentParsed = new URL(pageUrl);
      const normalizedPath = this.normalizePathname(currentParsed.pathname);
      const match = this.matchRouteRegistry(normalizedPath);
      if (match.matched) {
        const local = this.applyBasePath(normalizedPath) + parsed.search + parsed.hash;
        return {
          href: local,
          isInternal: true,
          isRouteGenerated: true,
          matchedRoute: match.routePath,
          isExternal: false,
          isSpecialScheme: false,
        };
      }
    }

    // 8. Normalize pathname
    const normalizedPathname = this.normalizePathname(parsed.pathname);

    // 8b. If base path is set, check if path was already localized with base path
    if (this.basePath && (normalizedPathname === this.basePath || normalizedPathname.startsWith(this.basePath + '/'))) {
      const unPrefixed = this.normalizePathname(normalizedPathname.slice(this.basePath.length) || '/');
      const unPrefixedMatch = this.matchRouteRegistry(unPrefixed);
      if (unPrefixedMatch.matched) {
        return {
          href: normalizedPathname + parsed.search + parsed.hash,
          isInternal: true,
          isRouteGenerated: true,
          matchedRoute: unPrefixedMatch.routePath,
          isExternal: false,
          isSpecialScheme: false,
        };
      }
    }

    // 9. Match against Route Registry
    const match = this.matchRouteRegistry(normalizedPathname);

    if (match.matched) {
      const localPath = this.applyBasePath(normalizedPathname);
      const finalHref = localPath + parsed.search + parsed.hash;

      return {
        href: finalHref,
        isInternal: true,
        isRouteGenerated: true,
        matchedRoute: match.routePath,
        isExternal: false,
        isSpecialScheme: false,
      };
    }

    // 10. Destination route was NOT generated in the clone.
    // Apply deliberate missing route policy: NEVER silently point to '/'.
    switch (this.missingRoutePolicy) {
      case 'rewrite-local': {
        const localPath = this.applyBasePath(normalizedPathname);
        return {
          href: localPath + parsed.search + parsed.hash,
          isInternal: true,
          isRouteGenerated: false,
          isExternal: false,
          isSpecialScheme: false,
        };
      }
      case 'custom': {
        if (this.customMissingRouteHandler) {
          const customHref = this.customMissingRouteHandler(parsed.href, normalizedPathname + parsed.search + parsed.hash);
          return {
            href: customHref,
            isInternal: customHref.startsWith('/'),
            isRouteGenerated: false,
            isExternal: !customHref.startsWith('/'),
            isSpecialScheme: false,
          };
        }
        break;
      }
      case 'preserve-source':
      default:
        // Keep the absolute source URL so clicking it navigates to the live site.
        return {
          href: parsed.href,
          isInternal: false,
          isRouteGenerated: false,
          isExternal: false,
          isSpecialScheme: false,
        };
    }

    return {
      href: parsed.href,
      isInternal: false,
      isRouteGenerated: false,
      isExternal: false,
      isSpecialScheme: false,
    };
  }

  /**
   * Convenience method returning only the resolved href string.
   */
  public resolve(rawHref: string, context?: { currentPageUrl?: string }): string {
    return this.resolveLink(rawHref, context).href;
  }

  /**
   * Rewrites all navigation links in the given HTML string using this resolver.
   */
  public rewriteHtml(html: string, context?: { currentPageUrl?: string }): string {
    if (!html || !html.trim()) return html;

    const $ = load(html);
    const pageContext = context || { currentPageUrl: this.currentPageUrl };

    // 1. Rewrite <a href> and <area href>
    $('a[href], area[href]').each((_, el) => {
      const raw = $(el).attr('href');
      if (raw !== undefined) {
        const resolved = this.resolveLink(raw, pageContext);
        if (resolved.href) {
          $(el).attr('href', resolved.href);
        } else {
          $(el).removeAttr('href');
        }
      }
    });

    // 2. Rewrite SVG links: <svg> <a xlink:href> and <a href>
    $('svg a, a[xlink\\:href]').each((_, el) => {
      const xlinkHref = $(el).attr('xlink:href');
      if (xlinkHref !== undefined) {
        const resolved = this.resolveLink(xlinkHref, pageContext);
        if (resolved.href) {
          $(el).attr('xlink:href', resolved.href);
        } else {
          $(el).removeAttr('xlink:href');
        }
      }
      const href = $(el).attr('href');
      if (href !== undefined) {
        const resolved = this.resolveLink(href, pageContext);
        if (resolved.href) {
          $(el).attr('href', resolved.href);
        } else {
          $(el).removeAttr('href');
        }
      }
    });

    // 3. Rewrite form actions
    $('form[action]').each((_, el) => {
      const raw = $(el).attr('action');
      if (raw !== undefined && raw.trim() !== '') {
        const resolved = this.resolveLink(raw, pageContext);
        if (resolved.href) {
          $(el).attr('action', resolved.href);
        }
      }
    });

    // 4. Rewrite submit button and input formactions
    $('button[formaction], input[formaction]').each((_, el) => {
      const raw = $(el).attr('formaction');
      if (raw !== undefined && raw.trim() !== '') {
        const resolved = this.resolveLink(raw, pageContext);
        if (resolved.href) {
          $(el).attr('formaction', resolved.href);
        }
      }
    });

    return $('body').html() ?? $.root().html() ?? '';
  }

  /**
   * Matches a normalized pathname against the route registry (both exact and dynamic routes).
   */
  public matchRouteRegistry(pathname: string): { matched: boolean; routePath?: string } {
    // Exact match in route registry
    if (this.routeRegistry.has(pathname)) {
      return { matched: true, routePath: pathname };
    }

    // Dynamic routes match (e.g. /blog/[slug] matches /blog/123)
    const candidateSegments = pathname.split('/').filter(Boolean);

    for (const pattern of this.dynamicRoutes) {
      const patternSegments = pattern.split('/').filter(Boolean);

      if (patternSegments.length !== candidateSegments.length) {
        continue;
      }

      let matches = true;
      for (let i = 0; i < patternSegments.length; i++) {
        const pSeg = patternSegments[i];
        const cSeg = candidateSegments[i];

        if (pSeg.startsWith('[') && pSeg.endsWith(']')) {
          // Dynamic parameter segment matches any non-empty value
          continue;
        }

        if (pSeg.toLowerCase() !== cSeg.toLowerCase()) {
          matches = false;
          break;
        }
      }

      if (matches) {
        return { matched: true, routePath: pattern };
      }
    }

    return { matched: false };
  }

  /**
   * Normalizes a pathname:
   * - Decodes URI components safely
   * - Strips multiple consecutive slashes
   * - Strips trailing slash unless path is '/' (consistent with route-mapper)
   */
  public normalizePathname(pathname: string): string {
    if (!pathname || pathname === '/') return '/';

    let decoded = pathname;
    try {
      decoded = decodeURI(pathname);
    } catch {
      decoded = pathname;
    }

    // Collapse multiple slashes
    let cleaned = decoded.replace(/\/+/g, '/');

    // Ensure leading slash
    if (!cleaned.startsWith('/')) {
      cleaned = '/' + cleaned;
    }

    // Handle trailing slash
    if (cleaned !== '/') {
      if (this.trailingSlash) {
        if (!cleaned.endsWith('/')) {
          cleaned = cleaned + '/';
        }
      } else {
        cleaned = cleaned.replace(/\/$/, '');
      }
    }

    return cleaned || '/';
  }

  /**
   * Applies base path configuration while preventing double-prefixing.
   */
  private applyBasePath(pathname: string): string {
    if (!this.basePath) return pathname;

    if (pathname === this.basePath || pathname.startsWith(this.basePath + '/')) {
      // Already prefixed, prevent double-rewriting
      return pathname;
    }

    if (pathname === '/') {
      return this.basePath;
    }

    return `${this.basePath}${pathname}`;
  }

  /**
   * Extracts file extension from a pathname.
   */
  private extractFileExtension(pathname: string): string | null {
    const lastSlash = pathname.lastIndexOf('/');
    const filename = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === filename.length - 1) return null;
    return filename.slice(dotIndex).toLowerCase();
  }
}

/**
 * Functional helper to rewrite HTML links in a document.
 */
export function rewriteHtmlLinks(
  html: string,
  optionsOrResolver: LinkResolver | LinkResolverOptions
): string {
  const resolver = optionsOrResolver instanceof LinkResolver
    ? optionsOrResolver
    : new LinkResolver(optionsOrResolver);

  return resolver.rewriteHtml(html);
}
