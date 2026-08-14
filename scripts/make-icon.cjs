/**
 * Draws the app icon and writes build/icon.png at 1024².
 *
 *   npx electron scripts/make-icon.cjs
 *   npm run icon        (renders, then packs the .icns)
 *
 * The mark is the same lucide `waypoints` glyph the sidebar header uses — four
 * nodes and the paths between them — so the Dock icon and the logo inside the
 * window are the same drawing. Electron does the rendering because it is
 * already a dependency: no design tool, no image library, and the colours come
 * from the app's own accent tokens.
 */

const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SIZE = 1024;
const OUT = join(__dirname, '..', 'build', 'icon.png');

/* Apple's icon grid: the shape sits inside the canvas with room to breathe,
 * and the corner radius is ~22.4% of the shape's width. */
const INSET = 100;
const SHAPE = SIZE - INSET * 2;
const RADIUS = Math.round(SHAPE * 0.2237);

/** lucide `waypoints`, in its own 24-unit space. */
const GLYPH_SCALE = 21;
const GLYPH = 24 * GLYPH_SCALE;
const GLYPH_X = (SIZE - GLYPH) / 2;
const GLYPH_Y = (SIZE - GLYPH) / 2;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; }
</style></head>
<body>
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%"  stop-color="#273040"/>
      <stop offset="55%" stop-color="#161b24"/>
      <stop offset="100%" stop-color="#0d1016"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="45%"  stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="cast" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <filter id="lift" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="6" stdDeviation="14" flood-color="#0a1622" flood-opacity="0.65"/>
    </filter>
  </defs>

  <g filter="url(#cast)">
    <rect x="${INSET}" y="${INSET}" width="${SHAPE}" height="${SHAPE}" rx="${RADIUS}"
          fill="url(#ground)"/>
    <rect x="${INSET + 1.5}" y="${INSET + 1.5}" width="${SHAPE - 3}" height="${SHAPE - 3}"
          rx="${RADIUS - 1.5}" fill="none" stroke="url(#rim)" stroke-width="3"/>
  </g>

  <!-- The glyph: edges first so the nodes sit on top of them. -->
  <g transform="translate(${GLYPH_X} ${GLYPH_Y}) scale(${GLYPH_SCALE})" filter="url(#lift)">
    <g fill="none" stroke="#4c9fe0" stroke-width="1.9"
       stroke-linecap="round" stroke-linejoin="round" opacity="0.95">
      <path d="m10.586 5.414-5.172 5.172"/>
      <path d="m18.586 13.414-5.172 5.172"/>
      <path d="M6 12h12"/>
    </g>
    <g fill="#5aa9e8">
      <circle cx="12" cy="20" r="2.6"/>
      <circle cx="12" cy="4"  r="2.6"/>
      <circle cx="20" cy="12" r="2.6"/>
      <circle cx="4"  cy="12" r="2.6"/>
    </g>
  </g>
</svg>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  // One frame after load, or the capture can come back empty.
  await new Promise((r) => setTimeout(r, 400));

  const image = await win.webContents.capturePage();
  mkdirSync(join(__dirname, '..', 'build'), { recursive: true });
  writeFileSync(OUT, image.toPNG());
  console.log(`wrote ${OUT} (${image.getSize().width}×${image.getSize().height})`);
  app.exit(0);
});
