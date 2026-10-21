import { render, screen } from "@testing-library/react";
import { parseNotes, ReleaseNotes } from "./ReleaseNotes";
// @ts-expect-error -- plain JS build script, no type declarations
import { plainNotes } from "../../../scripts/notes.mjs";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const md = `### Added
- **Accent colours.** Pick a \`#rrggbb\` colour.
- Line-ending guard.

### Changed
- Settings rearranged.

| System | File |
|---|---|
| Windows | \`GitPilot.exe\` |`;

describe("release notes", () => {
  it("renders Markdown as headings, lists and formatting (no raw marks)", () => {
    const { container } = render(<ReleaseNotes source={md} />);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Added", "Changed"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Accent colours.").tagName).toBe("STRONG");
    expect(screen.getByText("#rrggbb").tagName).toBe("CODE");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/###|\*\*|`/);
  });

  it("turns the changelog into plain text that old versions show cleanly", () => {
    const plain: string = plainNotes(md);
    expect(plain).not.toMatch(/###|\*\*|`/);
    expect(plain.startsWith("Added\n• Accent colours. Pick a #rrggbb colour.")).toBe(true);
    expect(plain).toContain("\n\nChanged\n• Settings rearranged.");
  });

  it("renders the plain-text form with the same structure", () => {
    const blocks = parseNotes(plainNotes(md));
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "list", "heading", "list", "table"]);
  });

  it("bolds the opening sentence of plain bullets", () => {
    render(<ReleaseNotes source={"Added\n• Add to .gitignore. Right-click a file.\n• No lead sentence here"} />);
    expect(screen.getByText("Add to .gitignore.").tagName).toBe("STRONG");
    expect(screen.getByText("No lead sentence here").tagName).toBe("LI");
  });

  it("keeps ordinary paragraphs as paragraphs", () => {
    expect(parseNotes("GitPilot 0.3.1\n\nSmall fixes.").map((b) => b.kind)).toEqual(["para", "para"]);
  });
});
