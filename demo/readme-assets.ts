// Rebuild the README artwork with: bun demo/readme-assets.ts
// Scores are reported in README.md / uwu-bench.html, not a rerun or raw evidence.
export const PALETTE = {
  background: "#0b0710",
  text: "#f6eaff",
  pink: "#ff8fc7",
  lavender: "#b48cff",
  mint: "#6fffd2",
  muted: "#b7a8c2",
  baseline: "#a89bac",
} as const;

export const BASELINE_SCORE = 0.1;
export const UWU_SCORE = 98.5;
export const DELTA_PERCENTAGE_POINTS = Number((UWU_SCORE - BASELINE_SCORE).toFixed(1));
export const BENCHMARK_AXIS = { min: 0, max: 100, x: 260, width: 640 } as const;

export function scoreWidth(score: number): number {
  return BENCHMARK_AXIS.width * (score / BENCHMARK_AXIS.max);
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function dither(id: string, color: string): string {
  const pixels = BAYER4.flatMap((row, y) => row.flatMap((threshold, x) =>
    threshold < 8 ? [`<rect x="${x * 2}" y="${y * 2}" width="2" height="2"/>`] : []));
  return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><g fill="${color}" shape-rendering="crispEdges">${pixels.join("")}</g></pattern>`;
}

function heart(x: number, y: number, size: number, color: string): string {
  return `<path d="M1 0H3V1H4V0H6V1H7V3H6V4H5V5H4V6H3V5H2V4H1V3H0V1H1Z" transform="translate(${x} ${y}) scale(${size})" fill="${color}" shape-rendering="crispEdges"/>`;
}

function svg(height: number, title: string, description: string, definitions: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}" role="img" aria-labelledby="title desc" style="width:100%;height:auto;max-width:960px">
  <title id="title">${title}</title>
  <desc id="desc">${description}</desc>
  <defs>${definitions}</defs>
  <style>
    text { fill: ${PALETTE.text}; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .mono { font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace; font-variant-numeric: tabular-nums; }
    .eyebrow { font-size: 16px; letter-spacing: 2px; fill: ${PALETTE.pink}; }
    .muted { fill: ${PALETTE.muted}; }
    .pink { fill: ${PALETTE.pink}; }
    .lavender { fill: ${PALETTE.lavender}; }
    .mint { fill: ${PALETTE.mint}; }
    .rule { stroke: ${PALETTE.text}; stroke-opacity: .16; fill: none; }
    .grid { stroke: ${PALETTE.text}; stroke-opacity: .09; stroke-dasharray: 2 6; fill: none; }
  </style>
  <rect width="960" height="${height}" rx="8" fill="${PALETTE.background}"/>
${body}
</svg>
`;
}

export function buildHero(): string {
  return svg(300, 'omp-uwu — Your coding agent, but it says "hewwo" (◕ᴗ◕✿)',
    "A soft pink omp-uwu title on dark plum, with an original dithered pixel cat and tiny hearts. Kawaii chat for omp.",
    dither("cat-dither", PALETTE.lavender), `  <path class="rule" d="M40 78.5H920M40 242.5H920"/>
  <path d="M40 78.5H112" stroke="${PALETTE.pink}"/>
  <text class="mono eyebrow" x="40" y="53">KAWAII CHAT / PRECISE BY DESIGN</text>
  <text x="36" y="170" font-size="104" font-weight="650" letter-spacing="-6">omp<tspan class="pink">-uwu</tspan></text>
  <text x="40" y="216" font-size="26" letter-spacing="-.5">Your coding agent, but it says "hewwo" (◕ᴗ◕✿)</text>
  <text class="mono muted" x="40" y="274" font-size="17">A little warmth for your coding agent.</text>
  <g aria-hidden="true">
    <path class="grid" d="M700 98.5H920M700 218.5H920M724.5 98V219M892.5 98V219"/>
    <path d="M754 176V116H766V104H778V116H790V128H838V116H850V104H862V116H874V176H862V188H766V176Z" fill="#22132f"/>
    <path d="M754 176V116H766V104H778V116H790V128H838V116H850V104H862V116H874V176H862V188H766V176Z" fill="url(#cat-dither)" stroke="${PALETTE.lavender}" stroke-width="1"/>
    <path d="M778 144H790V156H778ZM838 144H850V156H838Z" fill="${PALETTE.text}"/>
    <path d="M778 152H790V156H778ZM838 152H850V156H838Z" fill="${PALETTE.background}"/>
    <path d="M806 160H810V164H818V160H822V168H806Z" fill="${PALETTE.pink}"/>
    <path d="M736 154H762M742 168H762M866 154H892M866 168H886" stroke="${PALETTE.lavender}" stroke-width="2"/>
    <rect x="766" y="164" width="12" height="4" fill="${PALETTE.pink}"/>
    <rect x="850" y="164" width="12" height="4" fill="${PALETTE.pink}"/>
    ${heart(885, 113, 3, PALETTE.pink)}
    ${heart(717, 192, 2, PALETTE.mint)}
    <path d="M901 183V195M895 189H907" stroke="${PALETTE.mint}" stroke-width="2"/>
  </g>`);
}

export function buildBenchmark(): string {
  const { x, width } = BENCHMARK_AXIS;
  const baselineWidth = scoreWidth(BASELINE_SCORE);
  const uwuWidth = scoreWidth(UWU_SCORE);
  const baselineEnd = x + baselineWidth;
  const ticks = [0, 25, 50, 75, 100].map((value) => {
    const tickX = x + width * value / 100;
    return `  <path class="grid" d="M${tickX} 155V305"/>
  <text class="mono muted" x="${tickX}" y="327" font-size="17" text-anchor="middle">${value}%</text>`;
  }).join("\n");
  return svg(440, "Reported kawaii/uwu-bench scores — Opus 5.5",
    `Reported scores: Opus 5.5 ${BASELINE_SCORE}%; Opus 5.5 with omp-uwu ${UWU_SCORE}%. Horizontal bars share a zero-to-one-hundred-percent axis. The baseline bar is ${baselineWidth} SVG units wide; its separate hollow marker is enlarged only for visibility. The +${DELTA_PERCENTAGE_POINTS} percentage-point difference is derived by subtraction. This replots reported scores, not raw benchmark evidence or a coding-performance benchmark.`,
    dither("score-dither", PALETTE.pink), `  <text class="mono eyebrow" x="40" y="36">KAWAII / UWU-BENCH</text>
  <text x="40" y="75" font-size="32" font-weight="600" letter-spacing="-1">A little more uwu.</text>
  <g aria-hidden="true">${heart(897, 41, 3, PALETTE.pink)}</g>
  <path class="rule" d="M40 98.5H920"/>
${ticks}
  <text x="40" y="190" font-size="23" fill="${PALETTE.baseline}">Opus 5.5</text>
  <text class="mono muted" x="900" y="148" font-size="29" text-anchor="end">${BASELINE_SCORE}%</text>
  <rect id="baseline-bar" x="${x}" y="171" width="${baselineWidth}" height="28" fill="${PALETTE.baseline}"/>
  <path d="M${baselineEnd} 199V209" stroke="${PALETTE.baseline}"/>
  <rect id="baseline-visibility-marker" x="${baselineEnd - 4}" y="209" width="8" height="8" fill="${PALETTE.background}" stroke="${PALETTE.baseline}"/>
  <text class="mono muted" x="277" y="219" font-size="16">Hollow marker enlarged; bar is true scale.</text>
  <text x="40" y="278" font-size="23" font-weight="600">+ omp-uwu</text>
  <text class="mono pink" x="900" y="249" font-size="29" font-weight="600" text-anchor="end">${UWU_SCORE}%</text>
  <rect id="uwu-bar" x="${x}" y="260" width="${uwuWidth}" height="28" fill="#30182b"/>
  <rect x="${x}" y="260" width="${uwuWidth}" height="28" fill="url(#score-dither)"/>
  <rect x="${x + 0.5}" y="260.5" width="${uwuWidth - 1}" height="27" fill="none" stroke="${PALETTE.lavender}"/>
  <path class="rule" d="M40 345.5H920"/>
  <text class="mono mint" x="40" y="377" font-size="24">+${DELTA_PERCENTAGE_POINTS} percentage points</text>
  <text class="mono muted" x="900" y="375" font-size="17" text-anchor="end">DERIVED: ${UWU_SCORE} − ${BASELINE_SCORE}</text>
  <text class="mono" x="40" y="407" font-size="18">Reported kawaii/uwu-bench scores · Opus 5.5</text>
  <text class="muted" x="40" y="429" font-size="16">Reported scores only; not a coding-performance benchmark.</text>`);
}

export function buildStyleMap(): string {
  return svg(340, "Where the softness lives — illustrative style mode flow",
    "An illustrative diagram, not measured data. Prompt: before generation, the model follows instruction. Rewrite: after streaming, text is saved to history. Display: TUI render only, raw history is unchanged. Rewrite uses prompt style until the awaited assistant_message hook is observed; if absent, prompt fallback stays on.",
    "", `  <text class="mono eyebrow" x="40" y="32">THREE STYLES / ONE SOFT VOICE</text>
  <text x="40" y="69" font-size="31" font-weight="600" letter-spacing="-1">Where the softness lives</text>
  <g aria-hidden="true">${heart(897, 36, 3, PALETTE.lavender)}</g>
  <path class="rule" d="M40 86.5H920M40 277.5H920"/>
  <text class="mono muted" x="52" y="114" font-size="15" letter-spacing="1">MODE</text>
  <text class="mono muted" x="244" y="114" font-size="15" letter-spacing="1">WHEN</text>
  <text class="mono muted" x="548" y="114" font-size="15" letter-spacing="1">EFFECT</text>
  <path class="grid" d="M40 176.5H920M40 226.5H920"/>
  <rect x="40" y="132" width="3" height="30" fill="${PALETTE.pink}"/>
  <rect x="40" y="182" width="3" height="30" fill="${PALETTE.lavender}"/>
  <rect x="40" y="232" width="3" height="30" fill="${PALETTE.mint}"/>
  <text class="mono pink" x="52" y="155" font-size="23">prompt</text>
  <text x="244" y="155" font-size="22">before generation</text>
  <text x="548" y="155" font-size="22">model follows instruction</text>
  <text class="mono lavender" x="52" y="205" font-size="23">rewrite</text>
  <text x="244" y="205" font-size="22">after streaming</text>
  <text x="548" y="205" font-size="22">text saved to history</text>
  <text class="mono mint" x="52" y="255" font-size="23">display</text>
  <text x="244" y="255" font-size="22">TUI render only</text>
  <text x="548" y="255" font-size="22">raw history unchanged</text>
  <g fill="none" stroke="${PALETTE.muted}" aria-hidden="true">
    <path d="M181 148H219M213 143L219 148L213 153M488 148H526M520 143L526 148L520 153"/>
    <path d="M181 198H219M213 193L219 198L213 203M488 198H526M520 193L526 198L520 203"/>
    <path d="M181 248H219M213 243L219 248L213 253M488 248H526M520 243L526 248L520 253"/>
  </g>
  <text class="mono muted" x="40" y="302" font-size="15">Illustrative mode flow · not measured data.</text>
  <text class="muted" x="40" y="325" font-size="15">Rewrite uses prompt style until its awaited hook is observed; if absent, fallback stays on.</text>`);
}

if (import.meta.main) {
  await Promise.all([
    ["readme-hero.svg", buildHero()],
    ["uwu-bench.svg", buildBenchmark()],
    ["style-map.svg", buildStyleMap()],
  ].map(([name, content]) => Bun.write(new URL(name, import.meta.url), content)));
}
