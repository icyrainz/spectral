export const theme = {
  // Surfaces
  base: undefined,
  backgroundPanel: "#313244",
  backgroundElement: undefined,

  // Text hierarchy
  text: "#cdd6f4",
  textMuted: "#a6adc8",
  textDim: "#6c7086",

  // Semantic accents
  blue: "#89b4fa",
  green: "#a6e3a1",
  red: "#f38ba8",
  yellow: "#f9e2af",
  mauve: "#cba6f7",

  // Borders
  border: "#45475a",
  borderAccent: "#89b4fa",

  // Status
  success: "#a6e3a1",
  warning: "#f9e2af",
  error: "#f38ba8",
  info: "#89b4fa",
} as const;

export const STATUS_ICONS: Record<string, string> = {
  open: "\u258c",     // ▌ half block
  pending: "\u25cb",  // ○ circle
  resolved: "\u2713", // ✓ checkmark
  outdated: "\u223c", // ∼ tilde
};

export const SPLIT_BORDER = {
  topLeft: " ",
  topRight: " ",
  bottomLeft: " ",
  bottomRight: " ",
  horizontal: " ",
  vertical: "\u2503",
  topT: " ",
  bottomT: " ",
  leftT: "\u2503",
  rightT: " ",
  cross: " ",
} as const;
