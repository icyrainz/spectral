export const theme = {
  // Surfaces
  base: undefined,
  backgroundPanel: "#313244",
  backgroundElement: "#313244",

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
  open: "\u2588",     // █ full block — white
  pending: "\u2588",  // █ full block — yellow (unread)
  resolved: "\u2588", // █ full block — green
  outdated: "\u2588", // █ full block — dim
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
