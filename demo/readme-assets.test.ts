import { describe, expect, test } from "bun:test";
import {
  BASELINE_SCORE, UWU_SCORE, DELTA_PERCENTAGE_POINTS, BENCHMARK_AXIS,
  buildHero, buildBenchmark, buildStyleMap, scoreWidth,
} from "./readme-assets";

const panels = [
  ["readme-hero.svg", buildHero, 300],
  ["uwu-bench.svg", buildBenchmark, 440],
  ["style-map.svg", buildStyleMap, 340],
] as const;

describe("README artwork", () => {
  for (const [name, build, height] of panels) {
    test(`${name} is deterministic, accessible, self-contained and current`, async () => {
      const svg = build();
      expect(build()).toBe(svg);
      expect(svg).toContain(`viewBox="0 0 960 ${height}"`);
      expect(svg).toContain('role="img" aria-labelledby="title desc"');
      expect(svg).toMatch(/<title id="title">[^<]+<\/title>/);
      expect(svg).toMatch(/<desc id="desc">[^<]+<\/desc>/);
      expect(svg).not.toMatch(/<script|<foreignObject|<image|(?:href|src)=|@import|@font-face/i);
      expect(await Bun.file(new URL(name, import.meta.url)).text()).toBe(svg);
    });
  }

  test("hero keeps the original hewwo tagline", () => {
    expect(buildHero()).toContain('Your coding agent, but it says "hewwo" (◕ᴗ◕✿)');
  });

  test("reported scores use one zero-based scale, without minimum-width inflation", () => {
    expect(BASELINE_SCORE).toBe(0.1);
    expect(UWU_SCORE).toBe(98.5);
    expect(DELTA_PERCENTAGE_POINTS).toBe(98.4);
    expect(BENCHMARK_AXIS.min).toBe(0);
    expect(BENCHMARK_AXIS.max).toBe(100);
    expect(scoreWidth(0)).toBe(0);
    expect(scoreWidth(100)).toBe(BENCHMARK_AXIS.width);
    expect(scoreWidth(BASELINE_SCORE)).toBeCloseTo(0.64);
    expect(scoreWidth(UWU_SCORE)).toBeCloseTo(630.4);
    const svg = buildBenchmark();
    for (const [id, score] of [["baseline-bar", BASELINE_SCORE], ["uwu-bar", UWU_SCORE]] as const) {
      const rect = svg.match(new RegExp(`<rect id="${id}"[^>]+>`))![0];
      expect(Number(rect.match(/ x="([^"]+)"/)![1])).toBe(BENCHMARK_AXIS.x);
      expect(Number(rect.match(/ width="([^"]+)"/)![1])).toBe(scoreWidth(score));
    }
    expect(svg).toContain('id="baseline-visibility-marker"');
    expect(svg).toContain("Hollow marker enlarged; bar is true scale.");
    expect(svg).toContain("DERIVED: 98.5 − 0.1");
    expect(svg).toContain("not a coding-performance benchmark");
  });

  test("mode diagram is illustrative and discloses the rewrite fallback", () => {
    const svg = buildStyleMap();
    expect(svg).toContain("not measured data");
    expect(svg).toContain("fallback stays on");
    expect(svg).toContain("raw history unchanged");
  });
});
