import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL auto-cleanup only registers itself when test globals exist; wire it explicitly.
afterEach(cleanup);
