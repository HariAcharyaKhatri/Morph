export interface DesignToken {
  name: string;
  value: string;
  category: 'color' | 'typography' | 'spacing' | 'shadow' | 'radius';
  source: string;
}

export interface ColorToken extends DesignToken {
  category: 'color';
  oklch?: { l: number; c: number; h: number };
  hex?: string;
  usage: 'background' | 'foreground' | 'border' | 'accent' | 'muted' | 'other';
}

export interface TypographyToken extends DesignToken {
  category: 'typography';
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
}

export interface SpacingToken extends DesignToken {
  category: 'spacing';
  px: number;
  rem: number;
}

export interface ShadowToken extends DesignToken {
  category: 'shadow';
  parsed?: {
    offsetX: string;
    offsetY: string;
    blur: string;
    spread: string;
    color: string;
    inset: boolean;
  };
}

export interface RadiusToken extends DesignToken {
  category: 'radius';
  px: number;
}

export interface ExtractedAsset {
  url: string;
  localPath: string;
  type: 'image' | 'video' | 'font' | 'svg' | 'favicon';
  optimizedPath?: string;
  size?: number;
  metadata: Record<string, unknown>;
}

export interface AnimationEntry {
  selector: string;
  type: 'css-keyframes' | 'css-transition' | 'gsap' | 'framer-motion' | 'lottie' | 'scroll-driven' | 'unknown';
  properties: string[];
  duration?: string;
  easing?: string;
  recommendation: string;
}

export interface AnimationInventory {
  libraries: Array<{
    name: string;
    detected: boolean;
    version?: string;
    evidence: string;
  }>;
  entries: AnimationEntry[];
  scrollBehavior: {
    type: 'native' | 'lenis' | 'locomotive' | 'custom' | 'none';
    evidence: string;
  };
}

export interface InteractiveElement {
  selector: string;
  type: 'form' | 'modal' | 'carousel' | 'tabs' | 'dropdown' | 'accordion' | 'tooltip' | 'menu';
  componentType: 'server' | 'client';
  reason: string;
  children?: InteractiveElement[];
}

export interface InteractionMap {
  forms: InteractiveElement[];
  modals: InteractiveElement[];
  carousels: InteractiveElement[];
  tabs: InteractiveElement[];
  dropdowns: InteractiveElement[];
  accordions: InteractiveElement[];
  tooltips: InteractiveElement[];
  menus: InteractiveElement[];
}

export interface PageRoute {
  url: string;
  path: string;
  title: string;
  description?: string;
  isDistinct: boolean;
  template?: string;
  metadata?: Record<string, string>;
  html?: string;
}

export interface ComponentNode {
  name: string;
  filePath: string;
  isClient: boolean;
  reason?: string;
  props: Array<{ name: string; type: string; required: boolean }>;
  children: ComponentNode[];
  html?: string;
}

export interface ComponentTree {
  root: ComponentNode;
  totalComponents: number;
  clientComponents: number;
  serverComponents: number;
}

export interface GeneratedFile {
  path: string;
  content: string;
  type: 'component' | 'route' | 'layout' | 'config' | 'style' | 'type' | 'util';
}

export interface LighthouseResult {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  details?: Record<string, unknown>;
}

export interface AccessibilityResult {
  violations: Array<{
    id: string;
    impact: 'critical' | 'serious' | 'moderate' | 'minor';
    description: string;
    nodes: number;
  }>;
  passes: number;
  incomplete: number;
}

export interface UnusedCssResult {
  totalRules: number;
  unusedRules: number;
  unusedBytes: number;
  details: Array<{ selector: string; file: string }>;
}

export interface BundleSizeResult {
  totalSize: number;
  jsSize: number;
  cssSize: number;
  imageSize: number;
  chunks: Array<{ name: string; size: number }>;
}

export interface BrokenLinksResult {
  total: number;
  broken: Array<{ url: string; status: number; source: string }>;
  redirects: Array<{ url: string; redirectTo: string; source: string }>;
}

export interface VisualRegressionResult {
  viewports: Array<{
    name: string;
    width: number;
    diffPercent: number;
    diffPixels: number;
    passed: boolean;
    originalScreenshot: string;
    cloneScreenshot: string;
    diffScreenshot: string;
  }>;
  overallPassed: boolean;
}

export interface AuditReport {
  timestamp: string;
  lighthouse?: LighthouseResult;
  accessibility?: AccessibilityResult;
  unusedCss?: UnusedCssResult;
  bundleSize?: BundleSizeResult;
  brokenLinks?: BrokenLinksResult;
  visualRegression?: VisualRegressionResult;
}

export interface CloneResult {
  routes: PageRoute[];
  tokens: DesignToken[];
  assets: ExtractedAsset[];
  animations: AnimationInventory;
  interactions: InteractionMap;
  generatedFiles: GeneratedFile[];
  auditReport?: AuditReport;
  duration: number;
}

export interface CachedCloneState {
  timestamp: string;
  url: string;
  tokenHashes: Record<string, string>;
  componentHashes: Record<string, string>;
  screenshotHashes: Record<string, string>;
}

export interface ChangedSection {
  name: string;
  type: 'added' | 'modified' | 'removed';
  componentPath?: string;
  specPath?: string;
}

export interface FigmaFile {
  name: string;
  lastModified: string;
  document: Record<string, unknown>;
  styles: Record<string, FigmaStyle>;
  components: Record<string, FigmaComponent>;
}

export interface FigmaStyle {
  key: string;
  name: string;
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
  description?: string;
}

export interface FigmaComponent {
  key: string;
  name: string;
  description?: string;
  containingFrame?: { name: string };
}
