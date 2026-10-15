/**
 * Verifies the primary navigation actually renders a working link for every
 * operational destination.
 *
 * This exists because the first version of the layout put the nav links in a
 * horizontally-scrolling row that the viewport clipped, so the links were in
 * the DOM but unreachable on screen — the dashboard could only be reached by
 * typing a URL. Asserting hrefs rather than labels keeps this test independent
 * of the active language (the app defaults to Chinese) and checks the thing
 * that actually matters: the destination is reachable.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { Layout } from "@/routes/_authenticated";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "u1", email: "demo@oic.hk" } }, loading: false }),
}));

// The signed-in user is staff. This is the case that was broken.
vi.mock("@/hooks/useRole", () => ({
  useRole: () => ({
    roles: ["operator"],
    loading: false,
    isStaff: true,
    isFamily: false,
    linkedElderIds: [],
  }),
}));

vi.mock("@/hooks/useScheduler", () => ({ useScheduler: () => undefined }));

const STAFF_DESTINATIONS = ["/cases", "/enrol", "/test-controls", "/analytics"];
const FAMILY_DESTINATION = "/family";

function renderLayout() {
  const rootRoute = createRootRoute();
  const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: Layout,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([layoutRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <RouterProvider router={router as any} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/** The hrefs present in the main nav, in order. */
function navHrefs(): string[] {
  const nav = screen.getByRole("navigation", { name: /main/i });
  return Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

describe("primary navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders every staff destination", async () => {
    renderLayout();
    await waitFor(() => {
      const hrefs = navHrefs();
      for (const to of STAFF_DESTINATIONS) {
        expect(hrefs).toContain(to);
      }
    });
  });

  it("gives each link an accessible name", async () => {
    renderLayout();
    await waitFor(() => {
      expect(navHrefs().length).toBeGreaterThan(0);
    });
    // A link whose only child is an aria-hidden icon is unreachable to a
    // screen reader, so every nav link must have real text.
    const nav = screen.getByRole("navigation", { name: /main/i });
    for (const a of Array.from(nav.querySelectorAll("a"))) {
      expect((a.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("shows Family only when the user is also a relative", async () => {
    renderLayout();
    await waitFor(() => {
      expect(navHrefs().length).toBeGreaterThan(0);
    });
    expect(navHrefs()).not.toContain(FAMILY_DESTINATION);
  });

  it("does not hide the links behind a horizontal scroll container", async () => {
    renderLayout();
    const nav = await screen.findByRole("navigation", { name: /main/i });
    // The regression was an `overflow-x-auto` row at narrow widths. Wrapping is
    // the fix: every link keeps a real box on its own line.
    expect(nav.className).not.toContain("overflow-x-auto");
    expect(nav.className).toContain("flex-wrap");
  });
});
