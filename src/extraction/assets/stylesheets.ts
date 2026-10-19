import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function getExtension(url: string): string {
  try {
    return extname(new URL(url).pathname).replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
  } catch {
    return '.bin';
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download stylesheet: ${url} (${response.status})`);
  }
  return response.text();
}

async function downloadCssAsset(url: string, outputDir: string): Promise<string> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return url;
  }

  const filename = `${hash(url)}${getExtension(url)}`;
  const relativePath = `/styles/assets/${filename}`;
  const outputPath = join(outputDir, 'public', 'styles', 'assets', filename);

  await mkdir(join(outputDir, 'public', 'styles', 'assets'), { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    return url;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);

  return relativePath;
}

async function inlineCssImports(
  css: string,
  baseUrl: string,
  outputDir: string,
  visited: Set<string>,
): Promise<string> {
  const importPattern =
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^)"'\s;]+))\s*\)?\s*([^;]*);/gi;

  let result = '';
  let lastIndex = 0;

  for (const match of css.matchAll(importPattern)) {
    const index = match.index ?? 0;
    result += css.slice(lastIndex, index);

    const importedUrl = match[1] || match[2] || match[3];
    const media = match[4]?.trim() || '';

    if (!importedUrl) {
      result += match[0];
      lastIndex = index + match[0].length;
      continue;
    }

    try {
      const absoluteUrl = new URL(importedUrl, baseUrl).href;

      if (visited.has(absoluteUrl)) {
        lastIndex = index + match[0].length;
        continue;
      }

      visited.add(absoluteUrl);
      let importedCss = await fetchText(absoluteUrl);
      importedCss = await inlineCssImports(
        importedCss,
        absoluteUrl,
        outputDir,
        visited,
      );

      importedCss = await rewriteCssUrls(importedCss, absoluteUrl, outputDir);

      result += media ? `\n@media ${media} {\n${importedCss}\n}\n` : `\n${importedCss}\n`;
    } catch {
      // Skip inaccessible imports rather than leaving broken remote @import rules.
    }

    lastIndex = index + match[0].length;
  }

  result += css.slice(lastIndex);
  return result;
}

async function rewriteCssUrls(
  css: string,
  baseUrl: string,
  outputDir: string,
): Promise<string> {
  const pattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/gi;
  const matches = [...css.matchAll(pattern)];

  for (const match of matches) {
    const rawUrl = match[1] || match[2] || match[3];
    if (!rawUrl || /^(data:|blob:|#|\/(?!\/))/i.test(rawUrl)) continue;

    try {
      const absoluteUrl = new URL(rawUrl, baseUrl);
      if (!['http:', 'https:'].includes(absoluteUrl.protocol)) continue;

      const localUrl = await downloadCssAsset(absoluteUrl.href, outputDir);
      css = css.replace(match[0], `url("${localUrl}")`);
    } catch {
      // Keep the original URL if it cannot be resolved.
    }
  }

  return css;
}

export async function downloadStylesheets(
  stylesheetUrls: string[],
  outputDir: string,
): Promise<string[]> {
  const localPaths: string[] = [];

  for (const url of [...new Set(stylesheetUrls)]) {
    try {
      const cssUrl = new URL(url);
      if (!['http:', 'https:'].includes(cssUrl.protocol)) continue;

      const filename = `site-${hash(cssUrl.href)}.css`;
      const outputPath = join(outputDir, 'public', 'styles', filename);

      const css = await fetchText(cssUrl.href);
      const visited = new Set<string>([cssUrl.href]);

      let localCss = await inlineCssImports(css, cssUrl.href, outputDir, visited);
      localCss = await rewriteCssUrls(localCss, cssUrl.href, outputDir);

      await mkdir(join(outputDir, 'public', 'styles'), { recursive: true });
      await writeFile(outputPath, localCss, 'utf8');

      localPaths.push(`/styles/${filename}`);
    } catch {
      // Skip stylesheets that cannot be downloaded.
    }
  }

  return localPaths;
}
