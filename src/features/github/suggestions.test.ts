import { showSuggestions, suggestionBlock } from "./suggestions";

describe("suggested changes", () => {
  it("writes GitHub's block and labels it when shown", () => {
    expect(suggestionBlock("let a = 1;")).toBe("```suggestion\nlet a = 1;\n```");
    expect(showSuggestions("Try:\n```suggestion\nx\n```")).toBe("Try:\n**Suggested change:**\n\n```\nx\n```");
    expect(showSuggestions("```ts\nx\n```")).toBe("```ts\nx\n```");
  });
});
