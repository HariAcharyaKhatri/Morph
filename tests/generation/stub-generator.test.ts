import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateComponentStubs } from '../../src/generation/components/stub-generator.js';
import type { ComponentTree } from '../../src/core/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe('generateComponentStubs', () => {
  it('renders captured descendant markup once instead of nesting duplicate child stubs', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'morph-stubs-'));
    temporaryDirectories.push(outputDir);

    const tree: ComponentTree = {
      root: {
        name: 'PageBody',
        filePath: 'src/components/PageBody.tsx',
        isClient: false,
        props: [],
        html: '<main><p>Captured once</p></main>',
        children: [{
          name: 'MainContent',
          filePath: 'src/components/MainContent.tsx',
          isClient: false,
          props: [],
          html: '<p>Captured once</p>',
          children: [],
        }],
      },
      totalComponents: 2,
      clientComponents: 0,
      serverComponents: 2,
    };

    await generateComponentStubs(tree, outputDir);
    const generated = await readFile(join(outputDir, 'src/components/PageBody.tsx'), 'utf8');

    expect(generated.match(/dangerouslySetInnerHTML/g)).toHaveLength(1);
    expect(generated).toContain('Captured once');
    expect(generated).not.toContain("from '@/components/MainContent'");
  });
});
