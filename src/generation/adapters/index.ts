import type { OutputAdapter } from './types.js';
import type { MorphConfig } from '../../config/schema.js';
import { astroAdapter } from './astro.js';
import { nextjsAdapter } from './nextjs.js';
import { staticHtmlAdapter } from './static-html.js';
import { viteReactAdapter } from './vite-react.js';

export { astroAdapter } from './astro.js';
export { nextjsAdapter } from './nextjs.js';
export { staticHtmlAdapter } from './static-html.js';
export { viteReactAdapter } from './vite-react.js';
export type { OutputAdapter } from './types.js';

export function getAdapter(framework?: MorphConfig['output']['framework']): OutputAdapter {
  switch (framework) {
    case 'vite-react':
      return viteReactAdapter;
    case 'astro':
      return astroAdapter;
    case 'static-html':
      return staticHtmlAdapter;
    case 'nextjs':
    default:
      return nextjsAdapter;
  }
}
