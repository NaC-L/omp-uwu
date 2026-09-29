import type { ExtensionUiComponent, Theme } from "@oh-my-pi/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { type UwuLevel, type UwuLocale, uwufy, uwufyProse } from "./uwufy.ts";

export type UwuSettings = {
  enabled: boolean;
  style: "rewrite" | "prompt" | "display";
  level: UwuLevel;
  locale: UwuLocale;
  colorsEnabled: boolean;
};

export type UwuStatus = UwuSettings & {
  rewrite: "unknown" | "detected" | "not observed";
  display: "unavailable (no Container)" | "ANSI hook detected" | "pending component discovery";
  promptFallback: boolean;
};

export function createStatusCard(
  status: UwuStatus,
  theme: Theme,
  done: (settings: UwuSettings | undefined) => void,
  requestRender: () => void,
): ExtensionUiComponent {
  const draft: UwuSettings = {
    enabled: status.enabled, style: status.style, level: status.level,
    locale: status.locale, colorsEnabled: status.colorsEnabled,
  };
  const styles: UwuSettings["style"][] = ["rewrite", "prompt", "display"];
  const levels: UwuLevel[] = ["low", "mid", "max"];
  const locales: UwuLocale[] = ["auto", "en", "tr"];
  const sample = "Really lovely progress. Merhaba, bugün beraber çalışalım. Keep `raw_code` unchanged.";
  let tab: "controls" | "compatibility" = "controls";
  let focus = 0;
  let closed = false;
  const close = (settings?: UwuSettings) => {
    if (closed) return;
    closed = true;
    done(settings);
  };
  const cycle = <T,>(values: T[], current: T, direction: number): T =>
    values[(values.indexOf(current) + direction + values.length) % values.length];

  return {
    render(width: number): string[] {
      if (width < 1) return [];
      const cardWidth = Math.min(68, Math.floor(width));
      const bordered = cardWidth >= 4;
      const padding = cardWidth >= 24 ? 1 : 0;
      const contentWidth = cardWidth - (bordered ? 2 : 0) - padding * 2;
      const lines: string[] = [];
      const border = (text: string) => theme.fg("borderMuted", text);
      const rule = (left: string, right: string) => {
        if (bordered) lines.push(border(`${left}${"─".repeat(cardWidth - 2)}${right}`));
      };
      const row = (text: string) => {
        for (const wrapped of wrapTextWithAnsi(text, contentWidth)) {
          const line = truncateToWidth(wrapped, contentWidth, "");
          const padded = `${" ".repeat(padding)}${line}${" ".repeat(Math.max(0, contentWidth - visibleWidth(line)) + padding)}`;
          lines.push(bordered ? `${border("│")}${padded}${border("│")}` : padded);
        }
      };
      const chip = (label: string, selected: boolean) => selected
        ? theme.bg("selectedBg", theme.fg("accent", theme.bold(`[ ${label} ]`)))
        : theme.fg("dim", `[ ${label} ]`);
      const presets = (values: string[], selected: string) => values.map((value) => chip(value, value === selected)).join(" ");
      const control = (index: number, label: string, value: string) => {
        const cursor = theme.fg("accent", focus === index ? "› " : "  ");
        const name = theme.fg(focus === index ? "accent" : "muted", label);
        if (contentWidth >= 42) row(`${cursor}${name}${" ".repeat(Math.max(1, 14 - label.length))}${value}`);
        else {
          row(`${cursor}${name}`);
          row(`  ${value}`);
        }
      };
      const setting = (label: string, value: string) => {
        const key = contentWidth >= 34 ? label.padEnd(16) : `${label}: `;
        row(`${theme.fg("muted", key)}${value}`);
      };

      rule("╭", "╮");
      const title = theme.fg("accent", theme.bold("UwU"));
      const badge = theme.fg(draft.enabled ? "success" : "dim", theme.bold(draft.enabled ? "[ON]" : "[OFF]"));
      row(`${title}${" ".repeat(Math.max(1, contentWidth - visibleWidth(title) - visibleWidth(badge)))}${badge}`);
      row(`${chip("Controls", tab === "controls")} ${chip("Compatibility", tab === "compatibility")}`);
      rule("├", "┤");
      if (tab === "controls") {
        control(0, "Mode", `${chip(draft.enabled ? "● ON" : "ON", draft.enabled)} ${chip(draft.enabled ? "OFF" : "OFF ●", !draft.enabled)}`);
        control(1, "Style", presets(styles, draft.style));
        const filled = (levels.indexOf(draft.level) + 1) * 2;
        control(2, "Intensity", `${presets(levels, draft.level)} ${theme.fg("accent", "▰".repeat(filled))}${theme.fg("dim", "▱".repeat(6 - filled))}`);
        control(3, "Locale", presets(locales, draft.locale));
        control(4, "Kawaii colors", `${chip(draft.colorsEnabled ? "● ON" : "ON", draft.colorsEnabled)} ${chip(draft.colorsEnabled ? "OFF" : "OFF ●", !draft.colorsEnabled)}`);
        row("");
        row(`${theme.fg("accent", focus === 5 ? "› " : "  ")}${chip("Save", focus === 5)}`);
        const changes = (Object.keys(draft) as (keyof UwuSettings)[]).filter((key) => draft[key] !== status[key]).length;
        row(theme.fg(changes ? "warning" : "dim", changes ? `${changes} unsaved ${changes === 1 ? "change" : "changes"}` : "Draft unchanged"));
        rule("├", "┤");
        const previewKind = !draft.enabled ? "mode off" : draft.style === "display" ? "prose only · experimental" : draft.style === "prompt" ? "approximation" : "deterministic";
        row(theme.fg("accent", theme.bold(`Preview · ${previewKind}`)));
        const preview = !draft.enabled ? sample : draft.style === "display"
          ? uwufyProse(sample, { level: draft.level, locale: draft.locale })
          : uwufy(sample, { level: draft.level, locale: draft.locale });
        row(theme.fg("text", preview));
        rule("├", "┤");
        row(theme.fg("muted", "↑↓ focus · ←→ / Enter / Space edit"));
        row(theme.fg("muted", "Tab tabs · Enter on Save · Esc cancel"));
      } else {
        row(theme.fg("accent", theme.bold("Observed capabilities")));
        setting("Rewrite", theme.fg(status.rewrite === "detected" ? "success" : "muted", status.rewrite));
        setting("ANSI display", theme.fg(status.display === "ANSI hook detected" ? "success" : "muted", status.display));
        setting("Native/client", theme.fg("warning", "unsupported"));
        setting("Prompt fallback", theme.fg(status.promptFallback ? "success" : "dim", status.promptFallback ? "on" : "off"));
        row("");
        row(theme.fg("dim", `Fallback reflects saved ${status.style}/${status.enabled ? "on" : "off"} settings, not the draft.`));
        row(theme.fg("warning", "Display is experimental: ANSI prose only, not native/client rendering."));
        row(theme.fg("dim", "Unknown/pending is not a support guarantee. Display never adds a prompt or changes history."));
        rule("├", "┤");
        row(theme.fg("muted", "Tab controls · Esc cancel"));
      }
      rule("╰", "╯");
      return lines;
    },
    invalidate() {},
    handleInput(data: string) {
      if (closed) return;
      if (matchesKey(data, Key.escape)) {
        close();
        return;
      }
      if (matchesKey(data, Key.tab)) {
        tab = tab === "controls" ? "compatibility" : "controls";
      } else if (tab === "controls" && matchesKey(data, Key.up)) {
        focus = (focus + 5) % 6;
      } else if (tab === "controls" && matchesKey(data, Key.down)) {
        focus = (focus + 1) % 6;
      } else if (tab === "controls" && focus === 5 && matchesKey(data, Key.enter)) {
        close({ ...draft });
        return;
      } else if (tab === "controls" && focus < 5 && (
        matchesKey(data, Key.left) || matchesKey(data, Key.right) ||
        matchesKey(data, Key.enter) || matchesKey(data, Key.space)
      )) {
        const direction = matchesKey(data, Key.left) ? -1 : 1;
        if (focus === 0) draft.enabled = !draft.enabled;
        else if (focus === 1) draft.style = cycle(styles, draft.style, direction);
        else if (focus === 2) draft.level = cycle(levels, draft.level, direction);
        else if (focus === 3) draft.locale = cycle(locales, draft.locale, direction);
        else draft.colorsEnabled = !draft.colorsEnabled;
      } else return;
      requestRender();
    },
  };
}
