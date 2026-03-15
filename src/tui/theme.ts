export const theme = {
  // Base surfaces
  base:     "#1e1e2e",
  surface0: "#313244",
  surface1: "#45475a",

  // Text hierarchy
  text:     "#cdd6f4",
  subtext:  "#a6adc8",
  overlay:  "#6c7086",

  // Semantic accents
  blue:     "#89b4fa",
  green:    "#a6e3a1",
  red:      "#f38ba8",
  yellow:   "#f9e2af",
  mauve:    "#cba6f7",

  // Derived roles
  borderComment:  "#89b4fa",
  borderThread:   "#f9e2af",   // yellow for informational view
  borderList:     "#cba6f7",
  borderConfirm:  "#f38ba8",
  borderSearch:   "#89b4fa",
  hintFg:         "#6c7086",
  hintBg:         "#313244",
} as const;

export const STATUS_ICONS: Record<string, string> = {
  open: "\u258c",     // ▌ half block
  pending: "\u258c",  // ▌ half block
  resolved: "\u2713", // ✓ checkmark
  outdated: "\u258c", // ▌ half block
};
