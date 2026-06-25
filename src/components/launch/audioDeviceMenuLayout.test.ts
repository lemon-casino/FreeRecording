import { describe, expect, it } from "vitest";
import { getAudioDeviceMenuLayout } from "./audioDeviceMenuLayout";

describe("getAudioDeviceMenuLayout", () => {
	it("keeps short device lists in one full-height column", () => {
		const layout = getAudioDeviceMenuLayout(5);

		expect(layout.columnCount).toBe(1);
		expect(layout.rowCount).toBe(5);
		expect(layout.listMaxHeight).toBe(layout.listNaturalHeight);
	});

	it("adds columns so the device list height follows the row count", () => {
		const layout = getAudioDeviceMenuLayout(6);

		expect(layout.columnCount).toBe(2);
		expect(layout.rowCount).toBe(3);
	});

	it("caps at three columns for dense microphone setups", () => {
		const layout = getAudioDeviceMenuLayout(13);

		expect(layout.columnCount).toBe(3);
		expect(layout.rowCount).toBe(5);
	});

	it("clips only the list area when the available panel height is constrained", () => {
		const layout = getAudioDeviceMenuLayout(13, 220);

		expect(layout.listMaxHeight).toBeLessThan(layout.listNaturalHeight);
		expect(layout.menuNaturalHeight).toBeGreaterThan(220);
	});
});
