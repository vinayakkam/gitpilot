import { act, fireEvent, render, screen } from "@testing-library/react";
import { expectNoAxeViolations } from "@/test/axe";
import { FunGate, fetchTimeline, ordinal, progressAlong, rollBack } from "./FunGate";

vi.mock("@/store/AppStore", () => ({ useStore: () => ({ settings: null }) }));

beforeEach(() => {
  localStorage.clear();
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

describe("fetchTimeline", () => {
  it("only a strong throw reaches the kennel, and the dog always comes home", () => {
    expect(fetchTimeline(0.3, 0).far).toBe(false);
    expect(fetchTimeline(0.9, 0).far).toBe(true);
    const strong = fetchTimeline(0.9, 0);
    expect(fetchTimeline(0.9, strong.back).dogX).toBe(122);
    expect(fetchTimeline(0.9, strong.back).ball).toBeNull();
    expect(fetchTimeline(0.3, 0.2).returning).toBe(false);
  });
});

describe("ordinal", () => {
  it("names counts", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
});

const noop = () => {};

describe("rollBack", () => {
  it("rolls the car from where it was to the bottom", () => {
    expect(rollBack(0.8, 0)).toBe(0.8);
    expect(rollBack(0.8, 0.3)).toBeLessThan(0.8);
    expect(rollBack(0.8, 5)).toBe(0);
  });
});

describe("FunGate", () => {
  it("pulls when the rope reaches the bottom (keyboard), then celebrates the result", async () => {
    vi.useFakeTimers();
    const action = vi.fn(() => Promise.resolve(true));
    const close = vi.fn();
    render(<FunGate kind="pull" info={{ count: 3 }} action={action} onClose={close} onSkip={noop} onCancel={noop} />);
    const rope = screen.getByRole("slider", { name: "Haul in the commits" });
    expect(screen.getByText("3 new")).toBeInTheDocument();
    for (let i = 0; i < 9; i++) fireEvent.keyDown(rope, { key: "ArrowDown" });
    expect(rope).toHaveAttribute("aria-valuenow", "90");
    expect(action).not.toHaveBeenCalled();
    fireEvent.keyDown(rope, { key: "ArrowDown" });
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Holding on… pulling.")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(screen.getByText(/Hauled in 3 commits!/)).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("plays the failure when the operation fails", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<FunGate kind="pull" action={() => Promise.resolve(false)} onClose={close} onSkip={noop} onCancel={noop} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(screen.getByText(/the pull failed/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(close).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("counts finished scenes", async () => {
    vi.useFakeTimers();
    localStorage.setItem("gitpilot.funCounts", JSON.stringify({ commit: 4 }));
    render(<FunGate kind="commit" info={{ label: "Fix login" }} action={() => true} onClose={noop} onSkip={noop} onCancel={noop} />);
    expect(screen.getByText("Fix login")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(screen.getByText(/your 5th commit in fun mode/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("can always be skipped or cancelled", () => {
    const action = vi.fn();
    const skip = vi.fn();
    const cancel = vi.fn();
    render(<FunGate kind="push" action={action} onClose={noop} onSkip={skip} onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Just push" }));
    expect(skip).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    render(<FunGate kind="fetch" action={noop} onClose={noop} onSkip={noop} onCancel={noop} />);
    await expectNoAxeViolations();
  });
});
