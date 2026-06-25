import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceSelector } from "./SourceSelector";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: (namespace: string) => {
		if (namespace === "common") {
			return (key: string) => {
				if (key === "actions.cancel") return "Cancel";
				if (key === "actions.share") return "Share";
				if (key === "actions.record") return "Record";
				if (key === "actions.reload") return "Reload";
				return key;
			};
		}

		return (key: string, vars?: Record<string, string>) => {
			if (key === "sourceSelector.loading") return "Loading sources...";
			if (key === "sourceSelector.emptyTitle") return "No screens or windows found";
			if (key === "sourceSelector.emptyDescription") {
				return "If you just granted screen recording permission, reload this picker. On macOS you may need to reopen LikelySnap.";
			}
			if (key === "sourceSelector.loadFailedDescription") {
				return "LikelySnap could not load capture sources. Reload this picker and try again.";
			}
			if (key === "sourceSelector.screens") return `Screens (${vars?.count ?? "0"})`;
			if (key === "sourceSelector.windows") return `Windows (${vars?.count ?? "0"})`;
			if (key === "sourceSelector.customRegion") return "Custom Area";
			if (key === "sourceSelector.noScreens") return "No screens available";
			return key;
		};
	},
}));

describe("SourceSelector", () => {
	beforeEach(() => {
		window.electronAPI = {
			...window.electronAPI,
			getSources: vi.fn().mockResolvedValue([]),
			selectSource: vi.fn(),
		} as typeof window.electronAPI;
	});

	it("shows a retry state when no capture sources are available", async () => {
		render(<SourceSelector />);

		await screen.findByText("No screens or windows found");
		expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
	});

	it("reloads capture sources from the empty state", async () => {
		const getSources = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					id: "screen:1:0",
					name: "Display 1",
					thumbnail: "data:image/png;base64,abc",
					display_id: "1",
					appIcon: null,
				},
			]);
		window.electronAPI = {
			...window.electronAPI,
			getSources,
			selectSource: vi.fn(),
		} as typeof window.electronAPI;

		render(<SourceSelector />);

		await screen.findByText("No screens or windows found");
		fireEvent.click(screen.getByRole("button", { name: "Reload" }));

		await waitFor(() => {
			expect(screen.getByText("Display 1")).toBeInTheDocument();
		});
		expect(getSources).toHaveBeenCalledTimes(2);
	});

	it("selects a custom recording area with the original screen source and bounds", async () => {
		const selectSource = vi.fn();
		window.electronAPI = {
			...window.electronAPI,
			getSources: vi.fn().mockResolvedValue([
				{
					id: "screen:1:0",
					name: "Display 1",
					thumbnail: "data:image/png;base64,abc",
					display_id: "1",
					appIcon: null,
					bounds: { x: 0, y: 0, width: 1000, height: 500 },
				},
			]),
			selectSource,
		} as typeof window.electronAPI;

		render(<SourceSelector />);

		await screen.findByText("Display 1");
		const customTab = screen.getByRole("tab", { name: "Custom Area" });
		fireEvent.pointerDown(customTab, { button: 0, ctrlKey: false, pointerType: "mouse" });
		fireEvent.click(customTab);
		const recordButton = screen.getByRole("button", { name: "Record" });
		await waitFor(() => {
			expect(recordButton).not.toBeDisabled();
		});
		fireEvent.click(recordButton);

		expect(selectSource).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "custom:1:200:100:600:300",
				sourceId: "screen:1:0",
				bounds: { x: 200, y: 100, width: 600, height: 300 },
			}),
		);
	});
});
