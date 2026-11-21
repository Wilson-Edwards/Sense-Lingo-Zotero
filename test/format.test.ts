import { describe, expect, it } from "vitest";

import { normalizeWordTranslation } from "../src/modules/llm/format";

describe("normalizeWordTranslation", () => {
  it("keeps an already well-formed three-line result", () => {
    const raw = "减轻（v.）\n美式音标：/ˈmɪtɪɡeɪt/\n英式音标：/ˈmɪtɪɡeɪt/";
    expect(normalizeWordTranslation(raw)).toBe(raw);
  });

  it("splits labels that the model put on one line", () => {
    expect(
      normalizeWordTranslation(
        "减轻（v.） 美式音标：/ˈmɪtɪɡeɪt/ 英式音标：/ˈmɪtɪɡeɪt/",
      ),
    ).toBe("减轻（v.）\n美式音标：/ˈmɪtɪɡeɪt/\n英式音标：/ˈmɪtɪɡeɪt/");
  });

  it("accepts full-width colons and extra spaces", () => {
    expect(
      normalizeWordTranslation(
        "固有的（adj.）   美式音标 : /ɪnˈhɛrənt/   英式音标:/ɪnˈhɪərənt/",
      ),
    ).toBe("固有的（adj.）\n美式音标：/ɪnˈhɛrənt/\n英式音标：/ɪnˈhɪərənt/");
  });

  it("does not leave a blank line when the result starts with a label", () => {
    expect(normalizeWordTranslation("美式音标：/x/\n英式音标：/y/")).toBe(
      "美式音标：/x/\n英式音标：/y/",
    );
  });

  it("normalises CRLF line endings", () => {
    expect(
      normalizeWordTranslation("减轻（v.）\r\n美式音标：/x/\r\n英式音标：/y/"),
    ).toBe("减轻（v.）\n美式音标：/x/\n英式音标：/y/");
  });

  it("leaves results without phonetic labels untouched", () => {
    expect(normalizeWordTranslation("固定搭配（n.）")).toBe("固定搭配（n.）");
    expect(normalizeWordTranslation("")).toBe("");
  });
});
