import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { log } from '../utils/logger.js';
import { withSpinner } from '../utils/progress.js';
import { resolveConfig } from '../utils/resolve-config.js';
import type { MorphConfig } from '../../config/schema.js';
import type { CloneResult } from '../../core/types.js';

async function writeNextjsScaffold(outputDir: string, globalsCSS: string): Promise<void> {
  const files: Array<{ path: string; content: string }> = [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'morph-cloned-site',
        version: '1.0.0',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          lint: 'eslint .'
        },
        dependencies: {
          next: '^16.2.1',
          react: '^19.2.4',
          'react-dom': '^19.2.4',
          clsx: '^2.1.1',
          'tailwind-merge': '^3.5.0',
          'tw-animate-css': '^1.4.0',
          'lucide-react': '^1.6.0',
          'class-variance-authority': '^0.7.1',
          shadcn: '^4.1.0',
          '@base-ui/react': '^1.3.0',
          'react-hook-form': '^7.72.0',
          zod: '^4.3.6'
        },
        devDependencies: {
          '@tailwindcss/postcss': '^4.0.0',
          '@types/node': '^24.0.0',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          tailwindcss: '^4.0.0',
          typescript: '^5.0.0'
        }
      }, null, 2) + '\n'
    },
    {
      path: 'next.config.ts',
      content: 'const nextConfig = {};\nexport default nextConfig;\n'
    },
    {
      path: 'postcss.config.mjs',
      content: 'const config = { plugins: { "@tailwindcss/postcss": {} } };\nexport default config;\n'
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2017',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./src/*'] }
        },
        include: ['next-env.d.ts', '.next/types/**/*.ts', '**/*.ts', '**/*.tsx'],
        exclude: ['node_modules']
      }, null, 2) + '\n'
    },
    {
      path: 'src/app/layout.tsx',
      content: `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cloned Website',
  description: 'Website generated with Morph'
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`
    },
    {
      path: 'src/app/globals.css',
      content: globalsCSS || '@import "tailwindcss";\n'
    },
    {
      path: 'src/lib/utils.ts',
      content: `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`
    }
  ];

  for (const file of files) {
    const fullPath = join(outputDir, file.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.content, 'utf8');
  }
}
export interface CloneOptions {
  config?: string;
  output?: string;
  framework?: string;
  depth?: string;
  skipAudit?: boolean;
  skipAssets?: boolean;
  viewports?: string;
  incremental?: boolean;
}

export async function runClone(urls: string[], options: CloneOptions): Promise<CloneResult> {
  const config = await resolveConfig(options.config);

  if (options.output) config.output.directory = options.output;
  if (options.framework) {
    config.output.framework = options.framework as MorphConfig['output']['framework'];
  }
  if (options.depth) config.extraction.maxDepth = parseInt(options.depth, 10);

  const startTime = Date.now();

  log.heading('Morph â€” AI Website Cloner');
  log.table({
    'URLs': urls.join(', '),
    'Framework': config.output.framework,
    'Output': config.output.directory,
    'Viewports': config.extraction.viewports.map((v) => v.name).join(', '),
  });
  log.divider();

  // Phase 1: Extract design tokens
  const designResult = await withSpinner(
    'Extracting design tokens',
    async () => {
      const { extractDesignTokens, extractSourceStyles } = await import('../../extraction/design-tokens/extractor.js');
      const { BrowserManager } = await import('../../extraction/browser.js');
      const browser = new BrowserManager();
      try {
        await browser.launch();
        const page = await browser.newPage(config.extraction.viewports.find((v) => v.name === 'desktop'));
        await page.goto(urls[0], { waitUntil: 'domcontentloaded', timeout: config.extraction.timeout });
        const result = await extractDesignTokens(page, config);
        const sourceStyles = await extractSourceStyles(page);
        return { ...result, globalsCSS: insertSourceStyles(result.globalsCSS, sourceStyles) };
      } finally {
        await browser.close();
      }
    }
  );

  const tokens = designResult.tokens;
  // Phase 2: Download & optimize assets
  let assets: CloneResult['assets'] = [];
  if (!options.skipAssets) {
    assets = await withSpinner(
      'Downloading and optimizing assets',
      async () => {
        const { runAssetPipeline } = await import('../../extraction/assets/pipeline.js');
        const { BrowserManager } = await import('../../extraction/browser.js');
        const browser = new BrowserManager();
        try {
          await browser.launch();
          const page = await browser.newPage();
          await page.goto(urls[0], { waitUntil: 'domcontentloaded', timeout: config.extraction.timeout });
          return await runAssetPipeline(page, config, config.output.directory);
        } finally {
          await browser.close();
        }
      }
    );
  }

  // Phase 3: Detect animations & interactions
  const [animations, interactions] = await withSpinner(
    'Analyzing animations and interactions',
    async () => {
      const { detectAnimations } = await import('../../extraction/animations/detector.js');
      const { detectInteractions } = await import('../../extraction/interactions/detector.js');
      const { BrowserManager } = await import('../../extraction/browser.js');
      const browser = new BrowserManager();
      try {
        await browser.launch();
        const page = await browser.newPage();
        await page.goto(urls[0], { waitUntil: 'domcontentloaded', timeout: config.extraction.timeout });
        const [anims, ints] = await Promise.all([
          detectAnimations(page),
          detectInteractions(page),
        ]);
        return [anims, ints] as const;
      } finally {
        await browser.close();
      }
    }
  );

  // Phase 4: Crawl & generate routes
  const routes = await withSpinner(
    'Crawling site and generating routes',
    async () => {
      const { crawlSite } = await import('../../extraction/crawler/multi-page.js');
      const { generateRoutes } = await import('../../generation/routes/generator.js');
      const { BrowserManager } = await import('../../extraction/browser.js');
      const browser = new BrowserManager();
      try {
        await browser.launch();
        const page = await browser.newPage();
        const discoveredRoutes = await crawlSite(urls[0], page, config);
        const generatedFiles = await generateRoutes(discoveredRoutes, config.output.directory, config);
        return { routes: discoveredRoutes, files: generatedFiles };
      } finally {
        await browser.close();
      }
    }
  );

  // Phase 5: Generate component stubs
  const generatedFiles = await withSpinner(
    'Generating component stubs',
    async () => {
      const { generateComponentStubs } = await import('../../generation/components/stub-generator.js');
      const { decomposeDOM } = await import('../../generation/components/decomposer.js');
      const { BrowserManager } = await import('../../extraction/browser.js');
      const browser = new BrowserManager();
      try {
        await browser.launch();
        const page = await browser.newPage();
        await page.goto(urls[0], { waitUntil: 'domcontentloaded', timeout: config.extraction.timeout });
        const html = await page.content();
        const tree = decomposeDOM(html, interactions);
        return generateComponentStubs(tree, config.output.directory);
      } finally {
        await browser.close();
      }
    }
  );

  // Generate runnable Next.js project scaffold
  if (config.output.framework === 'nextjs') {
    await withSpinner('Creating Next.js project files', async () => {
      await writeNextjsScaffold(config.output.directory, designResult.globalsCSS);
    });
  }
  // Phase 6: Audit (optional)
  let auditReport: CloneResult['auditReport'];
  if (!options.skipAudit && config.audit.enabled) {
    auditReport = await withSpinner(
      'Running quality audit',
      async () => {
        const { runAudit } = await import('../../quality/audit/runner.js');
        return runAudit(config.output.directory, config);
      }
    );
  }

  const duration = Date.now() - startTime;

  log.divider();
  log.heading('Clone Complete');
  log.table({
    'Routes': routes.routes.length.toString(),
    'Design tokens': tokens.length.toString(),
    'Assets': assets.length.toString(),
    'Components': generatedFiles.length.toString(),
    'Duration': `${(duration / 1000).toFixed(1)}s`,
  });

  if (auditReport?.lighthouse) {
    log.heading('Lighthouse Scores');
    log.table({
      'Performance': `${auditReport.lighthouse.performance}`,
      'Accessibility': `${auditReport.lighthouse.accessibility}`,
      'Best Practices': `${auditReport.lighthouse.bestPractices}`,
      'SEO': `${auditReport.lighthouse.seo}`,
    });
  }

  return {
    routes: routes.routes,
    tokens,
    assets,
    animations,
    interactions,
    generatedFiles: [...routes.files, ...generatedFiles],
    auditReport,
    duration,
  };
}

function insertSourceStyles(globalsCSS: string, sourceStyles: string): string {
  if (!sourceStyles.trim()) return globalsCSS;
  const firstRule = globalsCSS.indexOf('\n', globalsCSS.lastIndexOf('@import '));
  if (firstRule < 0) return `${sourceStyles}\n${globalsCSS}`;
  return `${globalsCSS.slice(0, firstRule + 1)}\n/* Target website styles */\n${sourceStyles}\n${globalsCSS.slice(firstRule + 1)}`;
}

export const cloneCommand = new Command('clone')
  .description('Clone a website into a clean Next.js + Tailwind codebase')
  .argument('<urls...>', 'URL(s) to clone')
  .option('-c, --config <path>', 'Path to morph.config.ts')
  .option('-o, --output <dir>', 'Output directory')
  .option('-f, --framework <type>', 'Output framework (nextjs, vite-react, astro, static-html)')
  .option('-d, --depth <n>', 'Max crawl depth', '1')
  .option('--skip-audit', 'Skip the quality audit step')
  .option('--skip-assets', 'Skip asset download and optimization')
  .option('--viewports <list>', 'Comma-separated viewport names')
  .option('--incremental', 'Only regenerate changed sections')
  .action(async (urls: string[], options: CloneOptions) => {
    try {
      await runClone(urls, options);
    } catch (error) {
      console.error('RAW ERROR DETAILS:', error);
	log.error(
  error instanceof Error
    ? error.stack || error.message
    : JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
);
            process.exit(1);
    }
  });




