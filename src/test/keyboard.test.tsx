import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileEntry } from "@/bindings/FileEntry";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FileList, keyOf, type FileListActions } from "@/features/changes/FileList";

vi.mock("@/lib/api", () => ({ api: {}, onProgress: () => Promise.resolve(() => {}) }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  // jsdom has no layout, so no scrolling either.
  Element.prototype.scrollIntoView ??= () => {};
});

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Rename…</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Rename" footer={<Button onClick={() => setOpen(false)}>Cancel</Button>}>
        <input aria-label="New name" />
      </Dialog>
    </>
  );
}

describe("keyboard", () => {
  it("dialogs focus their first field and give focus back when they close", async () => {
    const user = userEvent.setup();
    render(<Opener />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Rename…" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("New name")).toHaveFocus();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename…" })).toHaveFocus());
  });

  it("the changed-file list works with arrows, Shift and Space", async () => {
    const user = userEvent.setup();
    const files: FileEntry[] = ["a.ts", "b.ts", "c.ts"].map((path) => ({ path, origPath: null, area: "unstaged", change: "modified", conflict: null, submodule: false, ignored: false }));
    const stage = vi.fn();
    const actions = { stage, unstage: vi.fn(), discard: vi.fn(), stageAll: vi.fn(), unstageAll: vi.fn(), copyPath: vi.fn(), showHistory: vi.fn(), ignore: vi.fn(), stash: vi.fn(), blame: vi.fn(), openInEditor: vi.fn(), updateSubmodules: vi.fn() } satisfies FileListActions;
    function Harness() {
      const [sel, setSel] = useState<Set<string>>(new Set([keyOf(files[0]!)]));
      const [focus, setFocus] = useState<string | null>(keyOf(files[0]!));
      return <FileList files={files} selected={sel} focusKey={focus} onSelect={(s, f) => { setSel(s); setFocus(f); }} actions={actions} />;
    }
    render(<Harness />);
    screen.getByRole("grid").focus();
    await user.keyboard("{ArrowDown}{Shift>}{ArrowDown}{/Shift}");
    expect(screen.getAllByRole("row", { selected: true }).map((r) => r.id)).toEqual(["file-unstaged:b.ts", "file-unstaged:c.ts"]);
    await user.keyboard(" ");
    expect(stage).toHaveBeenCalledWith([files[1], files[2]]);
  });
});
