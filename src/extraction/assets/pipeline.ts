import type { MorphConfig } from '../../config/schema.js';
import type { ExtractedAsset } from '../../core/types.js';
import { downloadAssets, resolveAssetPath } from './downloader.js';
import { extractFonts } from './fonts.js';
import { extractVideos } from './videos.js';
import { extractInlineSvgs } from './svgs.js';
import { downloadStylesheets } from './stylesheets.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>>['newPage']>>;

interface DiscoveredAssets {
  images: Array<{ src: string; alt: string; width: number; height: number }>;
  backgroundImages: Array<{ url: string; element: string }>;
  favicons: Array<{ href: string; sizes: string }>;
}

export async function runAssetPipeline(
  page: Page,
  config: MorphConfig,
  outputDir: string
): Promise<ExtractedAsset[]> {
  const allAssets: ExtractedAsset[] = [];

  // Discover assets on the page
  const discovered = await page.evaluate((): DiscoveredAssets => {
    const images = [...document.querySelectorAll('img')].map((img) => ({
      src: img.src || img.currentSrc,
      alt: img.alt || '',
      width: img.naturalWidth,
      height: img.naturalHeight,
    })).filter((img) => img.src);

    const backgroundImages = [...document.querySelectorAll('*')]
      .filter((el) => {
        const bg = getComputedStyle(el).backgroundImage;
        return bg && bg !== 'none' && bg.includes('url(');
      })
      .map((el) => {
        const bg = getComputedStyle(el).backgroundImage;
        const urlMatch = bg.match(/url\(["']?([^"')]+)["']?\)/);
        return {
          url: urlMatch?.[1] || '',
          element: `${el.tagName.toLowerCase()}.${el.className?.toString().split(' ')[0] || ''}`,
        };
      })
      .filter((bg) => bg.url);

    const favicons = [...document.querySelectorAll('link[rel*="icon"]')].map((link) => ({
      href: (link as HTMLLinkElement).href,
      sizes: (link as HTMLLinkElement).sizes?.toString() || '',
    }));

    return { images, backgroundImages, favicons };
  });

  // Download images
  if (config.assets.download) {
    const imageTasks = discovered.images.map((img) => ({
      url: img.src,
      outputPath: resolveAssetPath(img.src, outputDir, 'public/images'),
      type: 'image' as const,
      metadata: { alt: img.alt, width: img.width, height: img.height },
    }));

    const bgTasks = discovered.backgroundImages.map((bg) => ({
      url: bg.url,
      outputPath: resolveAssetPath(bg.url, outputDir, 'public/images'),
      type: 'image' as const,
      metadata: { isBackground: true, element: bg.element },
    }));

    const faviconTasks = discovered.favicons.map((fav) => ({
      url: fav.href,
      outputPath: resolveAssetPath(fav.href, outputDir, 'public/seo'),
      type: 'favicon' as const,
      metadata: { sizes: fav.sizes },
    }));

    const downloaded = await downloadAssets([...imageTasks, ...bgTasks, ...faviconTasks]);
    allAssets.push(...downloaded);
  }

  // Download source stylesheets locally
  if (config.assets.download) {
    const stylesheetUrls = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')]
        .map((link) => link.href)
        .filter((href) => href.startsWith('http:') || href.startsWith('https:'))
    );

    await downloadStylesheets(stylesheetUrls, outputDir);
  }

  // Extract fonts
  const fonts = await extractFonts(page, outputDir);
  allAssets.push(...fonts);

  // Extract videos
  const videos = await extractVideos(page, outputDir);
  allAssets.push(...videos);

  // Extract inline SVGs and save as component file
  const svgs = await extractInlineSvgs(page);
  if (svgs.length > 0) {
    const iconsContent = generateIconsComponent(svgs);
    const iconsPath = join(outputDir, 'src/components/icons.tsx');
    await mkdir(dirname(iconsPath), { recursive: true });
    await writeFile(iconsPath, iconsContent);
  }

  return allAssets;
}

export function generateIconsComponent(svgs: Array<{ name: string; svg: string }>): string {
  const lines: string[] = [
    "import type React from 'react';",
    "",
    "// Auto-extracted SVG icons from target site",
    "",
  ];
  const usedNames = new Set<string>();

  for (const { name, svg } of svgs) {
    const baseName = toPascalCase(name) || "Extracted";
    let componentName = `${baseName}Icon`;
    let suffix = 2;

    while (usedNames.has(componentName)) {
      componentName = `${baseName}Icon${suffix++}`;
    }
    usedNames.add(componentName);

    const jsxSvg = svg
      .replace(/\sclass=/g, " className=")
      .replace(/\sfill-rule=/g, " fillRule=")
      .replace(/\sclip-rule=/g, " clipRule=")
      .replace(/\sstroke-width=/g, " strokeWidth=")
      .replace(/\sstroke-linecap=/g, " strokeLinecap=")
      .replace(/\sstroke-linejoin=/g, " strokeLinejoin=")
      .replace(/\sfill-opacity=/g, " fillOpacity=")
      .replace(/\sstroke-opacity=/g, " strokeOpacity=")
      .replace(/\sxmlns:xlink=/g, " xmlnsXlink=")
      .replace(/\sxlink:href=/g, " xlinkHref=")
      .replace(/\sstyle="([^"]*)"/g, (_match, style: string) => {
        const declarations = style
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const separator = part.indexOf(":");
            if (separator < 0) return null;
            const property = part.slice(0, separator).trim();
            const value = part.slice(separator + 1).trim();
            const jsxProperty = property.replace(/-([a-z])/g, (_, letter: string) =>
              letter.toUpperCase()
            );
            return `${jsxProperty}: ${JSON.stringify(value)}`;
          })
          .filter((part): part is string => part !== null);

        return ` style={{ ${declarations.join(", ")} }}`;
      })
      .replace("<svg", "<svg {...props}");

    lines.push(`export function ${componentName}(props: React.SVGProps<SVGSVGElement>) {`);
    lines.push("  return (");
    lines.push(`    ${jsxSvg}`);
    lines.push("  );");
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}
function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}
