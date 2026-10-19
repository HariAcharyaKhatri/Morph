import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { MorphConfig } from '../../config/schema.js';
import type { PageRoute, GeneratedFile } from '../../core/types.js';
import { generateMetadata } from './metadata.js';

export async function generateRoutes(
  routes: PageRoute[],
  outputDir: string,
  config: MorphConfig
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];

  for (const route of routes) {
    if (!route.isDistinct) continue;

    const routeDir = route.path === '/'
      ? join(outputDir, 'src/app')
      : join(outputDir, 'src/app', route.path);

    // page.tsx
    const pageContent = generatePage(route, config);
    const pagePath = join(routeDir, 'page.tsx');
    files.push({ path: pagePath, content: pageContent, type: 'route' });

    // loading.tsx (for non-root routes)
    if (route.path !== '/') {
      const loadingContent = generateLoading();
      const loadingPath = join(routeDir, 'loading.tsx');
      files.push({ path: loadingPath, content: loadingContent, type: 'route' });
    }

    // layout.tsx (for route groups with multiple children)
    if (route.path !== '/' && hasChildRoutes(route.path, routes)) {
      const layoutContent = generateLayout(route);
      const layoutPath = join(routeDir, 'layout.tsx');
      files.push({ path: layoutPath, content: layoutContent, type: 'layout' });
    }
  }

  // Write all files to disk
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content);
  }

  return files;
}

function generatePage(route: PageRoute, _config: MorphConfig): string {
  const componentName = routeToComponentName(route.path);
  const metadataExport = generateMetadata(route);
  const bodyComponentName = route.path === '/' ? 'PageBody' : `${componentName}Body`;

  if (route.html || route.path === '/') {
    return `import type { Metadata } from 'next';
import { ${bodyComponentName} } from '@/components/${bodyComponentName}';

${metadataExport}

export default function ${componentName}Page() {
  return (
    <main className="min-h-screen">
      <${bodyComponentName} />
    </main>
  );
}
`;
  }

  return `import type { Metadata } from 'next';

${metadataExport}

export default function ${componentName}Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold">${route.title || componentName}</h1>
        <p className="mt-4 text-muted-foreground">${route.description || `Page for ${route.path}`}</p>
      </div>
    </main>
  );
}
`;
}

function generateLoading(): string {
  return `export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
    </div>
  );
}
`;
}

function generateLayout(route: PageRoute): string {
  const componentName = routeToComponentName(route.path);

  return `export default function ${componentName}Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
`;
}

export function routeToComponentName(path: string): string {
  if (path === '/') return 'Home';

  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const clean = segment.replace(/\[|\]/g, '').replace(/-/g, ' ');
      return clean
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
    })
    .join('');
}

function hasChildRoutes(path: string, routes: PageRoute[]): boolean {
  return routes.some((r) => r.path !== path && r.path.startsWith(path + '/'));
}
