
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ComponentTree,
  ComponentNode,
  GeneratedFile,
} from '../../core/types.js';
import { load } from 'cheerio';
import type { LinkResolver } from '../links/resolver.js';

export interface StubGeneratorOptions {
  resolver?: LinkResolver;
  pageUrl?: string;
}

export async function generateComponentStubs(
  tree: ComponentTree,
  outputDir: string,
  options?: StubGeneratorOptions
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  const nodes = flattenTree(tree.root);

  // Filter out generic/unknown nodes and duplicate component names.
  const uniqueNodes = new Map<string, ComponentNode>();

  for (const node of nodes) {
    if (node.name !== 'Unknown' && node.name !== 'MainContent') {
      if (!uniqueNodes.has(node.name)) {
        uniqueNodes.set(node.name, node);
      }
    }
  }

  for (const node of uniqueNodes.values()) {
    const content = generateStub(node, options);
    const filePath = join(outputDir, node.filePath);

    files.push({
      path: filePath,
      content,
      type: 'component',
    });
  }

  // Write generated component files.
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
  }

  return files;
}

function generateStub(node: ComponentNode, options?: StubGeneratorOptions): string {
  const lines: string[] = [];

  if (node.isClient) {
    lines.push("'use client';");
    lines.push('');
  }

  // Keep generated fragments self-contained. Their preserved HTML already
  // contains descendants, so rendering child stubs here would duplicate them.
  lines.push("import { cn } from '@/lib/utils';");

  lines.push('');

  // Props interface.
  const propsName = `${node.name}Props`;

  lines.push(`export interface ${propsName} {`);
  lines.push('  className?: string;');

  for (const prop of node.props) {
    const optional = prop.required ? '' : '?';
    lines.push(`  ${prop.name}${optional}: ${prop.type};`);
  }

  lines.push('}');
  lines.push('');

  // Component declaration.
  lines.push(
    `export function ${node.name}({ className${
      node.props.length > 0 ? ', ...props' : ''
    } }: ${propsName}) {`
  );

  if (node.isClient && hasInteractiveElements(node)) {
    lines.push('  // TODO: Add state management for interactive elements');
    lines.push('');
  }

  lines.push('  return (');
  lines.push("    <section className={cn('', className)}>");

  // Preserve the original HTML exactly once, including all descendants.
  if (node.html?.trim()) {
    const safeHtml = sanitizeHtml(node.html, options?.resolver, options?.pageUrl);

    if (safeHtml) {
      lines.push(
        `      <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(
          safeHtml
        )} }} />`
      );
    } else {
      lines.push(`      {/* No safe HTML extracted for ${node.name} */}`);
    }
  } else {
    lines.push(`      {/* No content extracted for ${node.name} */}`);
  }
  lines.push('    </section>');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function hasInteractiveElements(node: ComponentNode): boolean {
  return (
    node.isClient &&
    (
      node.reason?.includes('form') ||
      node.reason?.includes('interactive') ||
      node.reason?.includes('event') ||
      false
    )
  );
}

function flattenTree(node: ComponentNode): ComponentNode[] {
  const result = [node];

  for (const child of node.children) {
    result.push(...flattenTree(child));
  }

  return result;
}

function extractText(html?: string): string {
  if (!html) {
    return '';
  }

  const $ = load(html);
  $('script, style, noscript').remove();

  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function escapeJsxText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

export function sanitizeHtml(html: string, resolver?: LinkResolver, pageUrl?: string): string {
  const $ = load(html);

  // Remove elements that should not be injected into generated pages.
  $('script, iframe, object, embed, base').remove();

  $('*').each((_, element) => {
    const attributes = 'attribs' in element && element.attribs ? element.attribs : {};

    for (const name of Object.keys(attributes)) {
      const value = attributes[name] ?? '';
      const lowerName = name.toLowerCase();

      if (
        lowerName.startsWith('on') ||
        lowerName === 'srcdoc'
      ) {
        $(element).removeAttr(name);
        continue;
      }

      if (
        ['href', 'src', 'xlink:href', 'action', 'formaction'].includes(
          lowerName
        ) &&
        /^\s*(javascript|vbscript):/i.test(value)
      ) {
        $(element).removeAttr(name);
      }
    }
  });

  if (resolver) {
    const pageContext = { currentPageUrl: pageUrl };

    $('a[href], area[href]').each((_, el) => {
      const raw = $(el).attr('href');
      if (raw !== undefined) {
        const resolved = resolver.resolveLink(raw, pageContext);
        if (resolved.href) {
          $(el).attr('href', resolved.href);
        } else {
          $(el).removeAttr('href');
        }
      }
    });

    $('svg a, a[xlink\\:href]').each((_, el) => {
      const xlinkHref = $(el).attr('xlink:href');
      if (xlinkHref !== undefined) {
        const resolved = resolver.resolveLink(xlinkHref, pageContext);
        if (resolved.href) {
          $(el).attr('xlink:href', resolved.href);
        } else {
          $(el).removeAttr('xlink:href');
        }
      }
      const href = $(el).attr('href');
      if (href !== undefined) {
        const resolved = resolver.resolveLink(href, pageContext);
        if (resolved.href) {
          $(el).attr('href', resolved.href);
        } else {
          $(el).removeAttr('href');
        }
      }
    });

    $('form[action]').each((_, el) => {
      const raw = $(el).attr('action');
      if (raw !== undefined && raw.trim() !== '') {
        const resolved = resolver.resolveLink(raw, pageContext);
        if (resolved.href) {
          $(el).attr('action', resolved.href);
        }
      }
    });

    $('button[formaction], input[formaction]').each((_, el) => {
      const raw = $(el).attr('formaction');
      if (raw !== undefined && raw.trim() !== '') {
        const resolved = resolver.resolveLink(raw, pageContext);
        if (resolved.href) {
          $(el).attr('formaction', resolved.href);
        }
      }
    });
  }

  return $('body').html() ?? $.root().html() ?? '';
}
