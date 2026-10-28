import { act, fireEvent, render, screen } from "@testing-library/react";
import { TitleTooltips } from "./TitleTooltips";

describe("TitleTooltips", () => {
  it("shows a title as the app's tooltip and puts it back afterwards", () => {
    vi.useFakeTimers();
    render(
      <>
        <TitleTooltips />
        <button type="button" title="Matches your search">
          <span>row</span>
        </button>
        <p>elsewhere</p>
      </>,
    );
    const btn = screen.getByRole("button");
    fireEvent.mouseOver(screen.getByText("row"));
    expect(btn).not.toHaveAttribute("title");
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Matches your search");
    fireEvent.mouseOut(btn, { relatedTarget: screen.getByText("elsewhere") });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(btn).toHaveAttribute("title", "Matches your search");
    vi.useRealTimers();
  });
});
