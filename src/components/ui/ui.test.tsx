import { fireEvent, render, screen } from "@testing-library/react";
import { DiffViewer } from "@/features/diff/DiffViewer";
import { EmptyState, ErrorNotice } from "./Misc";

describe("ErrorNotice", () => {
  it("shows a plain message and reveals technical details on request", () => {
    render(<ErrorNotice error={{ kind: "authFailed", message: "Authentication failed.", detail: "fatal: Authentication failed for 'https://h/r'" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Authentication failed.");
    expect(screen.queryByText(/fatal:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Technical details/ }));
    expect(screen.getByText(/fatal:/)).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders title, body and action", () => {
    render(<EmptyState title="No changes" action={<button>Refresh</button>}>Your working tree is clean.</EmptyState>);
    expect(screen.getByText("No changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});

describe("DiffViewer", () => {
  const base = { oldPath: "a.png", newPath: "a.png", newFile: false, deletedFile: false, renamed: false, similarity: null, oldMode: null, newMode: null, hunks: [], additions: 0, deletions: 0, truncated: false, conflictView: false, hunkActions: false };
  it("never renders binary content as text", () => {
    render(<DiffViewer diff={{ ...base, binary: true }} mode="unified" onModeChange={() => {}} highlight />);
    expect(screen.getByText("Binary file")).toBeInTheDocument();
  });
  it("explains empty diffs and large-diff truncation", () => {
    render(<DiffViewer diff={{ ...base, binary: false, newFile: true, truncated: true }} mode="unified" onModeChange={() => {}} highlight />);
    expect(screen.getByText("Empty file")).toBeInTheDocument();
    expect(screen.getByText(/very large/)).toBeInTheDocument();
  });
  it("shows an empty state with no file selected", () => {
    render(<DiffViewer diff={null} mode="split" onModeChange={() => {}} highlight emptyTitle="Select a file" />);
    expect(screen.getByText("Select a file")).toBeInTheDocument();
  });
});
