import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// Slow machines (CI runners, a busy laptop) need longer than the 1 s default to find elements.
configure({ asyncUtilTimeout: 4000 });
