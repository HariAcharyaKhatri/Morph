
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ComponentTree,
  ComponentNode,
  GeneratedFile,
} from '../../core/types.js';
import { load } from 'cheerio';

export async function generateComponentStubs(
  tree: ComponentTree,
  outputDir: string
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
    const content = generateStub(node);
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

function generateStub(node: ComponentNode): string {
  const lines: string[] = [];

  if (node.isClient) {
    lines.push("'use client';");
    lines.push('');
  }

  // Imports: remove duplicate child imports and avoid self-imports.
  lines.push("import { cn } from '@/lib/utils';");

  const uniqueChildren = [
    ...new Map(
      node.children
        .filter(
          (child) =>
            child.name !== 'Unknown' &&
            child.name !== node.name
        )
        .map((child) => [child.name, child])
    ).values(),
  ];

  for (const child of uniqueChildren) {
    lines.push(
      `import { ${child.name} } from '@/components/${child.name}';`
    );
  }

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

  if (node.children.length > 0) {
  const renderedChildren = [
    ...new Map(
      node.children
        .filter(
          (child) =>
            child.name !== 'Unknown' &&
            child.name !== node.name
        )
        .map((child) => [child.name, child])
    ).values(),
  ];

  for (const child of renderedChildren) {
    lines.push(`      <${child.name} />`);
  }

  // Preserve the original HTML content as well.
  if (node.html?.trim()) {
    const safeHtml = sanitizeHtml(node.html);

    if (safeHtml) {
      lines.push(
        `      <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(
          safeHtml
        )} }} />`
      );
    }
  }
} else if (node.html?.trim()) {
  const safeHtml = sanitizeHtml(node.html);

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

function sanitizeHtml(html: string): string {
  const $ = load(html);

  // Remove elements that should not be injected into generated pages.
  $('script, iframe, object, embed, base').remove();

  $('*').each((_, element) => {
    const attributes ='attribs' in element && element.attribs ? element.attribs : {};

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

  return $('body').html() ?? $.root().html() ?? '';
}
