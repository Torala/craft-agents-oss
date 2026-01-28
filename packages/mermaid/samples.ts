/**
 * Generates samples.html showcasing all @craft-agent/mermaid rendering capabilities.
 *
 * Usage: bun run packages/mermaid/samples.ts
 *
 * This file doubles as a **visual test suite** — every supported feature,
 * shape, edge type, block construct, and theme variant is exercised by at
 * least one sample. If a rendering change causes regressions, it will be
 * visible in the generated HTML.
 *
 * The generated HTML is **dynamic** — it includes a bundled copy of the
 * mermaid renderer and renders all diagrams client-side in real time,
 * showing progressive loading and per-diagram render timing.
 *
 * Sample definitions live in samples-data.ts (shared with bench.ts).
 */

import { samples } from './samples-data.ts'
import { THEMES } from './src/theme.ts'

// ============================================================================
// HTML generation — dynamic version
//
// Instead of pre-rendering SVGs at build time, we:
//   1. Bundle the mermaid renderer for the browser via Bun.build()
//   2. Embed sample definitions as inline JSON
//   3. Emit client-side JS that renders each diagram on page load
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Human-readable labels for theme keys */
const THEME_LABELS: Record<string, string> = {
  'zinc-light': 'Zinc',
  'zinc-dark': 'Zinc Dark',
  'tokyo-night': 'Tokyo Night',
  'tokyo-night-storm': 'Tokyo Storm',
  'tokyo-night-light': 'Tokyo Light',
  'catppuccin-mocha': 'Catppuccin',
  'catppuccin-latte': 'Latte',
  'nord': 'Nord',
  'nord-light': 'Nord Light',
  'dracula': 'Dracula',
  'github-light': 'GitHub',
  'github-dark': 'GitHub Dark',
  'solarized-light': 'Solarized',
  'solarized-dark': 'Solar Dark',
  'one-dark': 'One Dark',
}

async function generateHtml(): Promise<string> {
  // Step 1: Bundle the mermaid renderer for the browser
  const buildResult = await Bun.build({
    entrypoints: [new URL('./src/browser.ts', import.meta.url).pathname],
    target: 'browser',
    format: 'esm',
    minify: true,
  })
  if (!buildResult.success) {
    console.error('Bundle build failed:', buildResult.logs)
    process.exit(1)
  }
  const bundleJs = await buildResult.outputs[0]!.text()
  console.log(`Browser bundle: ${(bundleJs.length / 1024).toFixed(1)} KB`)

  // Step 2: Build sample JSON (only serializable fields needed by client)
  const samplesJson = JSON.stringify(samples.map(s => ({
    title: s.title,
    description: s.description,
    source: s.source,
    category: s.category ?? 'Other',
    options: s.options ?? {},
  })))

  // Step 3: Group samples by category for TOC (done at build time since it's static)
  const categories = new Map<string, number[]>()
  samples.forEach((sample, i) => {
    const cat = sample.category ?? 'Other'
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push(i)
  })

  const categoryBadgeColors: Record<string, string> = {
    Flowchart: '#3b82f6',
    State: '#8b5cf6',
    Sequence: '#10b981',
    Class: '#f59e0b',
    ER: '#ef4444',
    'Theme Showcase': '#06b6d4',
  }

  // Map category names to the title prefixes they use, so we can strip duplicates in the ToC
  const categoryPrefixes: Record<string, string> = {
    'State': 'State: ',
    'Sequence': 'Sequence: ',
    'Class': 'Class: ',
    'ER': 'ER: ',
    'Theme Showcase': 'Theme: ',
  }

  const tocSections = [...categories.entries()].map(([cat, indices]) => {
    const badgeColor = categoryBadgeColors[cat] ?? '#71717a'
    const prefix = categoryPrefixes[cat]
    const items = indices.map(i => {
      let title = samples[i]!.title
      // Strip the category prefix from the title since it's already under the category heading
      if (prefix && title.startsWith(prefix)) title = title.slice(prefix.length)
      return `<li><a href="#sample-${i}">${i + 1}. ${escapeHtml(title)}</a></li>`
    }).join('\n            ')
    return `
        <div class="toc-category">
          <h3>${escapeHtml(cat)} (${indices.length} samples)</h3>
          <ol start="${indices[0]! + 1}">
            ${items}
          </ol>
        </div>`
  }).join('\n')

  // Step 3b: Build theme selector pills (build-time so we include swatches)
  const themePills = [
    '<button class="theme-pill active" data-theme=""><span class="theme-swatch" style="background:#FFFFFF;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.1)"></span>Default</button>',
    ...Object.entries(THEMES).map(([key, colors]) => {
      const isDark = parseInt(colors.bg.replace('#', '').slice(0, 2), 16) < 0x80
      const shadow = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'
      const label = THEME_LABELS[key] ?? key
      return `<button class="theme-pill" data-theme="${key}"><span class="theme-swatch" style="background:${colors.bg};box-shadow:inset 0 0 0 1px ${shadow}"></span>${escapeHtml(label)}</button>`
    }),
  ].join('\n        ')

  // Step 4: Build sample card HTML shells (SVG + ASCII are empty, filled client-side)
  // data-sample-bg stores the per-sample background for "Default" mode restoration.
  const sampleCards = samples.map((sample, i) => {
    const bg = sample.options?.bg ?? ''
    return `
    <section class="sample" id="sample-${i}">
      <div class="sample-header">
        <h2>${i + 1}. ${escapeHtml(sample.title)}</h2>
        <p class="description">${escapeHtml(sample.description)}</p>
      </div>
      <div class="sample-content">
        <div class="source-panel">
          <h3>Mermaid Source</h3>
          <pre><code>${escapeHtml(sample.source.trim())}</code></pre>
          ${sample.options ? `<div class="options"><strong>Options:</strong> <code>${escapeHtml(JSON.stringify(sample.options))}</code></div>` : ''}
        </div>
        <div class="svg-panel" id="svg-panel-${i}" data-sample-bg="${bg}">
          <h3>Rendered SVG</h3>
          <div class="svg-container" id="svg-${i}">
            <div class="loading-spinner"></div>
          </div>
        </div>
        <div class="ascii-panel" id="ascii-panel-${i}">
          <h3>ASCII Output</h3>
          <pre class="ascii-output"><code id="ascii-${i}">Rendering\u2026</code></pre>
        </div>
      </div>
    </section>`
  }).join('\n')

  // ============================================================================
  // Step 5: Assemble full HTML
  // ============================================================================

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>@craft-agent/mermaid — Visual Test Suite</title>
  <style>
    /* -- Reset & base -- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* -----------------------------------------------------------------
     * CSS custom property theming
     *
     * --t-bg and --t-fg drive the entire page color scheme.
     * All other colors are derived via color-mix(). When a theme is
     * selected from the pill bar, JS updates these two variables on
     * <body> — and the whole page adapts instantly.
     * ----------------------------------------------------------------- */
    body {
      --t-bg: #FFFFFF;
      --t-fg: #27272A;
      --t-accent: #3b82f6;

      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: color-mix(in srgb, var(--t-fg) 3%, var(--t-bg));
      color: var(--t-fg);
      line-height: 1.6;
      padding: 2rem;
      padding-top: 3.5rem; /* space for sticky theme bar */
      max-width: 1800px;
      margin: 0 auto;
      transition: background 0.2s, color 0.2s;
    }

    /* -- Header -- */
    .page-header {
      text-align: center;
      margin-bottom: 2rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid color-mix(in srgb, var(--t-fg) 12%, var(--t-bg));
    }
    .page-header h1 {
      font-size: 2rem;
      font-weight: 700;
      color: var(--t-fg);
      margin-bottom: 0.5rem;
    }
    .page-header p {
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
      font-size: 1rem;
    }
    .page-header .meta {
      margin-top: 0.75rem;
      font-size: 0.85rem;
      color: color-mix(in srgb, var(--t-fg) 30%, var(--t-bg));
    }
    .page-header .meta code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
    }
    .page-header .stats {
      margin-top: 0.5rem;
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .page-header .stat {
      font-size: 0.85rem;
      color: color-mix(in srgb, var(--t-fg) 60%, var(--t-bg));
      background: var(--t-bg);
      border: 1px solid color-mix(in srgb, var(--t-fg) 12%, var(--t-bg));
      border-radius: 6px;
      padding: 0.25rem 0.75rem;
    }

    /* -- Theme selector bar -- */
    .theme-bar {
      position: sticky;
      top: 0;
      z-index: 999;
      background: var(--t-bg);
      border-bottom: 1px solid color-mix(in srgb, var(--t-fg) 10%, var(--t-bg));
      padding: 0.5rem 1.5rem;
      margin: -3.5rem -2rem 2rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .theme-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      white-space: nowrap;
    }
    .theme-pills {
      display: flex;
      gap: 0.3rem;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .theme-pills::-webkit-scrollbar { display: none; }
    .theme-pill {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.2rem 0.55rem;
      border: 1.5px solid color-mix(in srgb, var(--t-fg) 10%, var(--t-bg));
      border-radius: 999px;
      background: transparent;
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
      font-size: 0.65rem;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .theme-pill:hover {
      border-color: color-mix(in srgb, var(--t-fg) 25%, var(--t-bg));
      color: var(--t-fg);
    }
    .theme-pill.active {
      border-color: var(--t-accent);
      color: var(--t-fg);
      background: color-mix(in srgb, var(--t-accent) 8%, var(--t-bg));
      font-weight: 600;
    }
    .theme-swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* -- Contents button in theme bar -- */
    .contents-btn {
      padding: 0.2rem 0.6rem;
      border: 1.5px solid color-mix(in srgb, var(--t-fg) 15%, var(--t-bg));
      background: transparent;
      color: color-mix(in srgb, var(--t-fg) 60%, var(--t-bg));
      font-size: 0.7rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
      transition: border-color 0.15s, color 0.15s;
    }
    .contents-btn:hover {
      border-color: color-mix(in srgb, var(--t-fg) 30%, var(--t-bg));
      color: var(--t-fg);
    }
    .contents-btn.active {
      border-color: var(--t-accent);
      color: var(--t-fg);
    }
    .bar-separator {
      width: 1px;
      height: 16px;
      background: color-mix(in srgb, var(--t-fg) 12%, var(--t-bg));
    }

    /* -- Mega menu dropdown -- */
    .mega-menu {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--t-bg);
      border-top: 1px solid color-mix(in srgb, var(--t-fg) 10%, var(--t-bg));
      border-bottom: 1px solid color-mix(in srgb, var(--t-fg) 12%, var(--t-bg));
      padding: 1.5rem 2rem;
      max-height: 70vh;
      overflow-y: auto;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      z-index: 998;
    }
    .mega-menu.open {
      display: block;
    }
    .toc-grid {
      columns: 4;
      column-gap: 2rem;
    }
    .toc-category {
      break-inside: avoid;
      margin-bottom: 1rem;
    }
    .toc-category h3 {
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: color-mix(in srgb, var(--t-fg) 70%, var(--t-bg));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toc-category ol {
      padding-left: 0;
      list-style: none;
      font-size: 0.8rem;
    }
    .toc-category li {
      margin-bottom: 0.15rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toc-category a { color: var(--t-accent); text-decoration: none; }
    .toc-category a:hover { text-decoration: underline; }

    /* -- Sample card -- */
    .sample {
      background: var(--t-bg);
      border: 1px solid color-mix(in srgb, var(--t-fg) 12%, var(--t-bg));
      margin-bottom: 2rem;
      overflow: hidden;
    }
    .sample-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid color-mix(in srgb, var(--t-fg) 5%, var(--t-bg));
    }
    .sample-header h2 {
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--t-fg);
    }
    .description {
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }

    .sample-content {
      display: grid;
      grid-template-columns:
        minmax(200px, 1fr)
        minmax(250px, 2fr)
        minmax(250px, 2fr);
      min-height: 200px;
    }
    @media (max-width: 900px) {
      .sample-content { grid-template-columns: 1fr; }
      .ascii-panel { border-left: none !important; border-top: 1px solid color-mix(in srgb, var(--t-fg) 5%, var(--t-bg)) !important; }
    }

    /* -- Source panel -- */
    .source-panel {
      padding: 1.25rem 1.5rem;
      border-right: 1px solid color-mix(in srgb, var(--t-fg) 5%, var(--t-bg));
    }
    .source-panel h3 {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      margin-bottom: 0.75rem;
    }
    .source-panel pre {
      padding: 1rem;
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .source-panel code {
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }
    .options {
      margin-top: 0.75rem;
      font-size: 0.8rem;
      color: color-mix(in srgb, var(--t-fg) 50%, var(--t-bg));
    }
    .options code {
      background: color-mix(in srgb, var(--t-fg) 6%, var(--t-bg));
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 0.75rem;
    }

    /* -- SVG panel -- */
    .svg-panel {
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-direction: column;
      /* Background set dynamically: matches the SVG --bg in default mode,
         or the global theme bg when a theme is active. */
    }
    .svg-panel h3 {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      margin-bottom: 0.75rem;
    }
    .svg-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
    }
    .svg-container svg {
      max-width: 100%;
      height: auto;
    }

    /* -- ASCII panel -- */
    .ascii-panel {
      padding: 1.25rem 1.5rem;
      border-left: 1px solid color-mix(in srgb, var(--t-fg) 5%, var(--t-bg));
      display: flex;
      flex-direction: column;
    }
    .ascii-panel h3 {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      margin-bottom: 0.75rem;
    }
    .ascii-output {
      padding: 1rem;
      font-size: 0.7rem;
      line-height: 1.3;
      overflow-x: auto;
      white-space: pre;
      flex: 1;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    /* -- Loading spinner -- */
    .loading-spinner {
      width: 24px;
      height: 24px;
      border: 2px solid color-mix(in srgb, var(--t-fg) 12%, var(--t-bg));
      border-top-color: color-mix(in srgb, var(--t-fg) 35%, var(--t-bg));
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* -- Timing badge -- */
    .timing {
      font-size: 0.7rem;
      font-weight: 400;
      color: color-mix(in srgb, var(--t-fg) 30%, var(--t-bg));
      margin-left: 0.5rem;
      text-transform: none;
      letter-spacing: normal;
    }

    /* -- Error state -- */
    .render-error {
      color: #ef4444;
      font-size: 0.85rem;
      font-family: 'JetBrains Mono', monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <!-- Navigation + theme bar -->
  <div class="theme-bar" id="theme-bar">
    <button class="contents-btn" id="contents-btn">Contents</button>
    <span class="bar-separator"></span>
    <span class="theme-label">Theme</span>
    <div class="theme-pills" id="theme-pills">
      ${themePills}
    </div>
    <div class="mega-menu" id="mega-menu">
      <div class="toc-grid">
        ${tocSections}
      </div>
    </div>
  </div>

  <header class="page-header">
    <h1>@craft-agent/mermaid — Visual Test Suite</h1>
    <p>Mermaid diagram renderer — SVG with CSS custom property theming + ASCII/Unicode text output</p>
    <p style="margin-top: 0.5rem; color: color-mix(in srgb, var(--t-fg) 60%, var(--t-bg)); font-size: 0.9rem;">
      Supports: <strong>Flowcharts</strong>, <strong>State Diagrams</strong>,
      <strong>Sequence Diagrams</strong>, <strong>Class Diagrams</strong>, and
      <strong>ER Diagrams</strong>
    </p>
    <p class="meta" id="total-timing">Rendering ${samples.length * 2} diagrams\u2026</p>
    <div class="meta">Generated by <code>samples.ts</code> &middot; Diagrams rendered client-side in real time</div>
  </header>

${sampleCards}

  <!-- Bundled mermaid renderer — exposes window.__mermaid -->
  <script type="module">
${bundleJs}

  // ============================================================================
  // Client-side rendering + theme switching
  // ============================================================================

  var samples = ${samplesJson};
  var THEMES = window.__mermaid.THEMES;
  var renderMermaid = window.__mermaid.renderMermaid;
  var renderMermaidAscii = window.__mermaid.renderMermaidAscii;

  var totalTimingEl = document.getElementById('total-timing');

  // -- Theme state --
  // Stores each SVG element's original inline style attribute (from initial render)
  // so we can restore per-sample colors when switching back to "Default".
  var originalSvgStyles = [];

  // ----------------------------------------------------------------
  // Apply a named theme (or '' for Default) to the entire page.
  //
  // This is instant — no re-rendering needed. SVGs use CSS custom
  // properties internally, so updating --bg/--fg on the <svg> tag
  // re-paints all nodes, edges, text, and backgrounds via color-mix().
  // ----------------------------------------------------------------
  function applyTheme(themeKey) {
    var theme = themeKey ? THEMES[themeKey] : null;
    var body = document.body;

    // 1. Update body CSS variables — the entire page derives from these
    if (theme) {
      body.style.setProperty('--t-bg', theme.bg);
      body.style.setProperty('--t-fg', theme.fg);
      body.style.setProperty('--t-accent', theme.accent || '#3b82f6');
    } else {
      body.style.setProperty('--t-bg', '#FFFFFF');
      body.style.setProperty('--t-fg', '#27272A');
      body.style.setProperty('--t-accent', '#3b82f6');
    }

    // 2. Update all rendered SVG elements' CSS variables
    var svgs = document.querySelectorAll('.svg-container svg');
    for (var j = 0; j < svgs.length; j++) {
      var svgEl = svgs[j];
      if (theme) {
        // Override with the global theme colors
        svgEl.style.setProperty('--bg', theme.bg);
        svgEl.style.setProperty('--fg', theme.fg);
        // Set enrichment variables if provided, else remove so SVG
        // internal color-mix() fallbacks activate
        var enrichment = ['line', 'accent', 'muted', 'surface', 'border'];
        for (var k = 0; k < enrichment.length; k++) {
          var prop = enrichment[k];
          if (theme[prop]) svgEl.style.setProperty('--' + prop, theme[prop]);
          else svgEl.style.removeProperty('--' + prop);
        }
      } else {
        // Restore original inline style from initial render
        if (originalSvgStyles[j] !== undefined) {
          svgEl.setAttribute('style', originalSvgStyles[j]);
        }
      }
    }

    // 3. Update SVG panel backgrounds to match
    for (var j = 0; j < samples.length; j++) {
      var panel = document.getElementById('svg-panel-' + j);
      if (!panel) continue;
      if (theme) {
        panel.style.background = theme.bg;
      } else {
        // Default mode: use the per-sample bg (or clear for page default)
        var sampleBg = panel.getAttribute('data-sample-bg');
        panel.style.background = sampleBg || '';
      }
    }

    // 4. Update active pill
    var pills = document.querySelectorAll('.theme-pill');
    for (var j = 0; j < pills.length; j++) {
      pills[j].classList.toggle('active', pills[j].getAttribute('data-theme') === themeKey);
    }

    // 5. Persist selection
    if (themeKey) {
      localStorage.setItem('mermaid-theme', themeKey);
    } else {
      localStorage.removeItem('mermaid-theme');
    }
  }

  // -- Set up theme pill click handlers --
  document.getElementById('theme-pills').addEventListener('click', function(e) {
    var pill = e.target.closest('.theme-pill');
    if (!pill) return;
    applyTheme(pill.getAttribute('data-theme') || '');
  });

  // -- Mega menu (Contents dropdown) --
  var contentsBtn = document.getElementById('contents-btn');
  var megaMenu = document.getElementById('mega-menu');

  contentsBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = megaMenu.classList.toggle('open');
    contentsBtn.classList.toggle('active', isOpen);
  });

  // Close on clicking a ToC link (smooth scroll to target)
  megaMenu.addEventListener('click', function(e) {
    var link = e.target.closest('a');
    if (!link) return;
    e.preventDefault();
    megaMenu.classList.remove('open');
    contentsBtn.classList.remove('active');
    var target = document.querySelector(link.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!megaMenu.classList.contains('open')) return;
    if (!e.target.closest('.mega-menu') && !e.target.closest('.contents-btn')) {
      megaMenu.classList.remove('open');
      contentsBtn.classList.remove('active');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && megaMenu.classList.contains('open')) {
      megaMenu.classList.remove('open');
      contentsBtn.classList.remove('active');
    }
  });

  // -- Restore saved theme immediately (before rendering begins) --
  var savedTheme = localStorage.getItem('mermaid-theme');
  if (savedTheme && THEMES[savedTheme]) {
    // Apply page-level CSS variables right away to avoid flash
    document.body.style.setProperty('--t-bg', THEMES[savedTheme].bg);
    document.body.style.setProperty('--t-fg', THEMES[savedTheme].fg);
    document.body.style.setProperty('--t-accent', THEMES[savedTheme].accent || '#3b82f6');
    // Mark the correct pill as active
    var pills = document.querySelectorAll('.theme-pill');
    for (var j = 0; j < pills.length; j++) {
      pills[j].classList.toggle('active', pills[j].getAttribute('data-theme') === savedTheme);
    }
  }

  // ============================================================================
  // Progressive rendering — render each diagram sequentially
  // ============================================================================

  var totalStart = performance.now();

  for (var i = 0; i < samples.length; i++) {
    var sample = samples[i];
    var svgContainer = document.getElementById('svg-' + i);
    var asciiContainer = document.getElementById('ascii-' + i);
    var svgPanel = document.getElementById('svg-panel-' + i);

    // Render SVG — wrapped in a timeout guard so a stalled layout
    // doesn't block all remaining diagrams from rendering.
    try {
      var svg = await renderMermaid(sample.source, sample.options);
      svgContainer.innerHTML = svg;

      // Store the SVG's original inline style for Default mode restoration
      var svgEl = svgContainer.querySelector('svg');
      if (svgEl) {
        originalSvgStyles.push(svgEl.getAttribute('style') || '');

        // If a global theme is active, immediately override the SVG's variables
        if (savedTheme && THEMES[savedTheme]) {
          var th = THEMES[savedTheme];
          svgEl.style.setProperty('--bg', th.bg);
          svgEl.style.setProperty('--fg', th.fg);
          var enrichment = ['line', 'accent', 'muted', 'surface', 'border'];
          for (var k = 0; k < enrichment.length; k++) {
            if (th[enrichment[k]]) svgEl.style.setProperty('--' + enrichment[k], th[enrichment[k]]);
            else svgEl.style.removeProperty('--' + enrichment[k]);
          }
        }
      } else {
        originalSvgStyles.push('');
      }

      // Set panel background to match the SVG
      if (savedTheme && THEMES[savedTheme]) {
        svgPanel.style.background = THEMES[savedTheme].bg;
      } else {
        var sampleBg = svgPanel.getAttribute('data-sample-bg');
        if (sampleBg) svgPanel.style.background = sampleBg;
      }
    } catch (err) {
      svgContainer.innerHTML = '<div class="render-error">SVG Error: ' + escapeHtml(String(err)) + '</div>';
      originalSvgStyles.push('');
    }

    try {
      asciiContainer.textContent = renderMermaidAscii(sample.source);
    } catch (e) {
      asciiContainer.textContent = '(ASCII not supported for this diagram type)';
    }

  }

  // Done — show total time
  var totalMs = (performance.now() - totalStart).toFixed(0);
  totalTimingEl.textContent = (samples.length * 2) + ' diagrams (SVG+ASCII) rendered in ' + totalMs + ' ms';

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  </script>
</body>
</html>`
}

// ============================================================================
// Main
// ============================================================================

const html = await generateHtml()
const outPath = new URL('./samples.html', import.meta.url).pathname
await Bun.write(outPath, html)
console.log(`Written to ${outPath} (${(html.length / 1024).toFixed(1)} KB)`)
