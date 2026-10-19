import type { DesignToken } from '../../core/types.js';
import type { MorphConfig } from '../../config/schema.js';
import { extractColors } from './colors.js';
import { extractTypography } from './typography.js';
import { extractSpacing } from './spacing.js';
import { extractShadows } from './shadows.js';
import { extractRadii } from './radii.js';
import { buildTokenReport, generateGlobalsCSS, flattenTokens, type DesignTokenReport } from './output.js';

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>>['newPage']>>;

export interface ExtractionResult {
  tokens: DesignToken[];
  globalsCSS: string;
  jsonReport: DesignTokenReport;
}

/** Preserve the target's authored CSS rules; design tokens alone cannot reproduce its layout. */
export async function extractSourceStyles(page: Page): Promise<string> {
  return page.evaluate(() => {
    const imports = new Set<string>();
    const inline: string[] = [];

    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach((link) => {
      if (link.href && !link.href.startsWith('data:')) imports.add(link.href);
    });
    document.querySelectorAll('style').forEach((style) => {
      if (style.textContent?.trim()) inline.push(style.textContent);
    });

    return [
      ...[...imports].map((href) => `@import url(${JSON.stringify(href)});`),
      ...inline,
    ].join('\n');
  });
}

export async function extractDesignTokens(
  page: Page,
  _config: MorphConfig
): Promise<ExtractionResult> {
  // Run all extractors in parallel
  const [colors, typography, spacing, shadows, radii] = await Promise.all([
    extractColors(page),
    extractTypography(page),
    extractSpacing(page),
    extractShadows(page),
    extractRadii(page),
  ]);

  const url = page.url();
  const tokens = flattenTokens(colors, typography, spacing, shadows, radii);
  const globalsCSS = generateGlobalsCSS(colors, typography, spacing, shadows, radii);
  const jsonReport = buildTokenReport(colors, typography, spacing, shadows, radii, url);

  return { tokens, globalsCSS, jsonReport };
}
