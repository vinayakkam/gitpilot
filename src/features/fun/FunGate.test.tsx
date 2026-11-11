import { act, fireEvent, render, screen } from "@testing-library/react";
import { expectNoAxeViolations } from "@/test/axe";
import { FunGate, progressAlong } from "./FunGate";

vi.mock("@/store/AppStore", () => ({ useStore: () => ({ settings: null }) }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe("progressAlong", () => {
  it("counts only movement along the path, clamped to 0…1", () => {
    expect(progressAlong([0, 0], [0, 100], 0, 30, 50)).toBe(0.5);
    expect(progressAlong([0, 0], [0, 100], 0, 0, -40)).toBe(0);
    expect(progressAlong([0, 0], [100, -100], 0.2, 50, -50)).toBeCloseTo(0.7);
    expect(progressAlong([0, 0], [100, 0], 0.5, 400, 0)).toBe(1);
  });
});

describe("FunGate", () => {
  it("pulls when the rope reaches the bottom (keyboard)", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    render(<FunGate kind="pull" onDone={done} onCancel={() => {}} />);
    const rope = screen.getByRole("slider", { name: "Pull the rope" });
    for (let i = 0; i < 9; i++) fireEvent.keyDown(rope, { key: "ArrowDown" });
    expect(rope).toHaveAttribute("aria-valuenow", "90");
    expect(done).not.toHaveBeenCalled();
    fireEvent.keyDown(rope, { key: "ArrowDown" });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(done).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("can always be skipped or cancelled", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const cancel = vi.fn();
    render(<FunGate kind="push" onDone={done} onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Just push" }));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(done).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("has no accessibility violations", async () => {
    render(<FunGate kind="fetch" onDone={() => {}} onCancel={() => {}} />);
    await expectNoAxeViolations();
  });
});
