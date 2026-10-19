# Clone pipeline status

This describes behavior verified in the current repository, rather than the intended feature list.

## What the CLI currently does

`morph clone` visits the first supplied URL, extracts design tokens and source stylesheet references, downloads discoverable assets, analyzes interactions and animations, crawls same-domain routes, writes route files and component stubs, then creates a Next.js scaffold. The generated pages render sanitized HTML captured from the source page. Authored linked stylesheets are imported by URL and inline `<style>` rules are copied into the generated global CSS.

## Known fidelity limits

- The CSSOM/computed-style pipeline extracts a subset of design tokens; it does not reconstruct every responsive, pseudo-element, hover, or JavaScript-applied style. Cross-origin source CSS and its referenced assets still depend on the original host being reachable.
- Downloaded images, videos, and fonts are not consistently rewritten to local URLs inside captured HTML/CSS. Relative references can therefore resolve against the clone origin, and same-name downloads can collide.
- Each crawled route currently receives the same captured first-page body. Crawling discovers route paths and metadata, but does not capture and render each page's own DOM.
- The generated markup preserves static HTML. It does not reproduce source application logic, server data, or all interactive behavior; interaction detection produces analysis, not working behavior implementations.
- The CLI's audit option is not visual comparison unless original and clone URLs are configured for that audit. Always inspect the output at target viewports.

## AI-agent workflow

The `/clone-website` workflow exists as prompt/skill files. `scripts/sync-skills.mjs` generates command/skill files for nine platforms; `scripts/sync-agent-rules.sh` distributes project instructions to several agent configurations. The workflow describes browser inspection, writing component specifications, and asking an agent to build or delegate sections. There is no runtime service in the CLI that launches AI agents, creates their worktrees, merges their branches, or guarantees that every named AI platform supports the command. Those steps depend on the selected agent and its available tools.

## Run a clone locally

From an installed Morph checkout, install Chromium for Playwright and run:

```bash
npm install
npx playwright install chromium
npm run build:cli
node dist/cli/index.js clone https://example.com --depth 1 --skip-audit --output ./example-clone
cd example-clone
npm install
npm run dev
```

Open `http://localhost:3000`, then compare the result with the source at matching desktop and mobile widths. To run production compilation, use `npm run build` inside `example-clone`. For CLI visual comparison, start the clone and run Morph's audit with both `--original-url` and `--clone-url` configured.
