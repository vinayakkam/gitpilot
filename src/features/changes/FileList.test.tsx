import { fireEvent, render, screen, within } from "@testing-library/react";
import type { FileEntry } from "@/bindings/FileEntry";
import { FileList, keyOf, VIRTUAL_THRESHOLD, type FileListActions } from "./FileList";

const files: FileEntry[] = [
  { path: "src/a.ts", origPath: null, area: "staged", change: "modified", conflict: null, submodule: false, ignored: false },
  { path: "src/b.ts", origPath: null, area: "unstaged", change: "modified", conflict: null, submodule: false, ignored: false },
  { path: "src/c.ts", origPath: null, area: "unstaged", change: "deleted", conflict: null, submodule: false, ignored: false },
  { path: "new.md", origPath: null, area: "untracked", change: "untracked", conflict: null, submodule: false, ignored: false },
  { path: "merge.txt", origPath: null, area: "conflicted", change: "conflicted", conflict: "both modified", submodule: false, ignored: false },
];

function actions(): FileListActions {
  return { stage: vi.fn(), unstage: vi.fn(), discard: vi.fn(), stageAll: vi.fn(), unstageAll: vi.fn(), copyPath: vi.fn(), showHistory: vi.fn(), ignore: vi.fn(), stash: vi.fn(), blame: vi.fn(), openInEditor: vi.fn(), updateSubmodules: vi.fn() };
}

describe("FileList", () => {
  it("groups files by Git area, conflicts first", () => {
    render(<FileList files={files} selected={new Set()} focusKey={null} onSelect={() => {}} actions={actions()} />);
    const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Conflicts", "Staged", "Changes", "New files"]);
    expect(screen.getByText("both modified")).toBeInTheDocument();
  });

  it("labels status with text, not only color", () => {
    render(<FileList files={files} selected={new Set()} focusKey={null} onSelect={() => {}} actions={actions()} />);
    expect(screen.getAllByLabelText("Modified")).toHaveLength(2);
    expect(screen.getByLabelText("Deleted")).toBeInTheDocument();
    expect(screen.getByLabelText("Conflicted")).toBeInTheDocument();
  });

  it("stages and unstages from row buttons", () => {
    const a = actions();
    render(<FileList files={files} selected={new Set()} focusKey={null} onSelect={() => {}} actions={a} />);
    const staged = screen.getByRole("group", { name: "Staged" });
    fireEvent.click(within(staged).getByRole("button", { name: "Unstage" }));
    expect(a.unstage).toHaveBeenCalledWith([files[0]]);
    const changes = screen.getByRole("group", { name: "Changes" });
    fireEvent.click(within(changes).getAllByRole("button", { name: "Stage" })[0]!);
    expect(a.stage).toHaveBeenCalledWith([files[1]]);
  });

  it("selects with click and extends with ctrl-click within one area", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<FileList files={files} selected={new Set()} focusKey={null} onSelect={onSelect} actions={actions()} />);
    fireEvent.click(screen.getByText("b.ts"));
    expect(onSelect).toHaveBeenLastCalledWith(new Set([keyOf(files[1]!)]), keyOf(files[1]!));
    rerender(<FileList files={files} selected={new Set([keyOf(files[1]!)])} focusKey={keyOf(files[1]!)} onSelect={onSelect} actions={actions()} />);
    fireEvent.click(screen.getByText("c.ts"), { ctrlKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(new Set([keyOf(files[1]!), keyOf(files[2]!)]), keyOf(files[2]!));
  });

  it("asks for discard confirmation via Delete key instead of discarding directly", () => {
    const a = actions();
    render(<FileList files={files} selected={new Set([keyOf(files[1]!)])} focusKey={keyOf(files[1]!)} onSelect={() => {}} actions={a} />);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Delete" });
    expect(a.discard).toHaveBeenCalledWith([files[1]]);
  });

  it("does not offer discard for staged files", () => {
    const a = actions();
    render(<FileList files={files} selected={new Set([keyOf(files[0]!)])} focusKey={keyOf(files[0]!)} onSelect={() => {}} actions={a} />);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Delete" });
    expect(a.discard).not.toHaveBeenCalled();
  });

  it("offers to update a changed submodule from its menu", () => {
    const a = actions();
    const sub: FileEntry = { path: "deps/lib", origPath: null, area: "unstaged", change: "modified", conflict: null, submodule: true, ignored: false };
    render(<FileList files={[sub]} selected={new Set([keyOf(sub)])} focusKey={keyOf(sub)} onSelect={() => {}} actions={a} />);
    fireEvent.contextMenu(screen.getByText("lib"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update submodule" }));
    expect(a.updateSubmodules).toHaveBeenCalledWith(["deps/lib"]);
  });

  it("opens a file in the editor, except deleted ones", () => {
    const a = actions();
    render(<FileList files={files} selected={new Set()} focusKey={null} onSelect={() => {}} actions={a} />);
    fireEvent.contextMenu(screen.getByText("b.ts"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in editor" }));
    expect(a.openInEditor).toHaveBeenCalledWith("src/b.ts");
    fireEvent.contextMenu(screen.getByText("c.ts"));
    expect(screen.queryByRole("menuitem", { name: "Open in editor" })).not.toBeInTheDocument();
  });

  it("renders only the rows on screen for very large change sets", async () => {
    const many: FileEntry[] = Array.from({ length: VIRTUAL_THRESHOLD * 10 }, (_, i) => ({ path: `gen/f${i}.txt`, origPath: null, area: "untracked", change: "untracked", conflict: null, submodule: false, ignored: false }));
    const onSelect = vi.fn();
    // jsdom has no layout: give the scroll area a real size so the virtualizer renders rows.
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(300);
    render(<FileList files={many} selected={new Set()} focusKey={keyOf(many[0]!)} onSelect={onSelect} actions={actions()} />);
    const shown = (await screen.findAllByRole("option")).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(200);
    expect(screen.getByText("New files")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(new Set([keyOf(many[1]!)]), keyOf(many[1]!));
    vi.restoreAllMocks();
  });
});
