import { describe, expect, it } from "bun:test";
import { parseInlineMarkdown, parseMarkdownLine } from "../../../src/tui/ui/markdown";
import { TextAttributes } from "@opentui/core";

describe("parseInlineMarkdown", () => {
  describe("underscore word boundaries", () => {
    it("does not parse underscores mid-word as italic", () => {
      const segments = parseInlineMarkdown("some_variable_name");
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe("some_variable_name");
      expect(segments[0].attributes).toBeUndefined();
    });

    it("does not parse UPPER_SNAKE_CASE as italic", () => {
      const segments = parseInlineMarkdown("MAX_RETRY_COUNT");
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe("MAX_RETRY_COUNT");
      expect(segments[0].attributes).toBeUndefined();
    });

    it("parses _italic text_ at word boundaries", () => {
      const segments = parseInlineMarkdown("_italic text_");
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe("italic text");
      expect(segments[0].attributes).toBe(TextAttributes.ITALIC);
    });

    it("parses __bold text__ at word boundaries", () => {
      const segments = parseInlineMarkdown("__bold text__");
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe("bold text");
      expect(segments[0].attributes).toBe(TextAttributes.BOLD);
    });

    it("does not parse underscores inside a longer identifier", () => {
      const segments = parseInlineMarkdown("use DEFAULT_TIMEOUT_MS here");
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe("use DEFAULT_TIMEOUT_MS here");
      expect(segments[0].attributes).toBeUndefined();
    });

    it("parses _italic_ surrounded by other text", () => {
      const segments = parseInlineMarkdown("this is _important_ stuff");
      expect(segments).toHaveLength(3);
      expect(segments[0].text).toBe("this is ");
      expect(segments[1].text).toBe("important");
      expect(segments[1].attributes).toBe(TextAttributes.ITALIC);
      expect(segments[2].text).toBe(" stuff");
    });
  });
});

describe("parseMarkdownLine", () => {
  it("delegates plain text to parseInlineMarkdown", () => {
    const segments = parseMarkdownLine("plain text with some_var");
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("plain text with some_var");
  });
});
