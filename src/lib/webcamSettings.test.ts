import { describe, expect, it } from "vitest";
import {
	DEFAULT_LAUNCH_WEBCAM_SETTINGS,
	launchWebcamSettingsToPresentation,
	normalizeLaunchWebcamSettings,
	normalizeWebcamPresentationSettings,
	positionPresetToWebcamPosition,
} from "./webcamSettings";

describe("webcamSettings", () => {
	it("normalizes invalid launch settings to durable defaults", () => {
		expect(
			normalizeLaunchWebcamSettings({
				resolutionPreset: "8k",
				fps: 144,
				sceneMode: "lecture",
				maskShape: "hexagon",
				positionPreset: "middle",
				sizePreset: "huge",
				mirrored: "yes",
			}),
		).toEqual(DEFAULT_LAUNCH_WEBCAM_SETTINGS);
	});

	it("derives width and height from the selected resolution preset", () => {
		expect(
			normalizeLaunchWebcamSettings({
				resolutionPreset: "1080p",
				fps: 60,
				sceneMode: "standard",
				maskShape: "rounded",
				positionPreset: "top-left",
				sizePreset: 34,
				mirrored: true,
			}),
		).toEqual({
			resolutionPreset: "1080p",
			width: 1920,
			height: 1080,
			fps: 60,
			sceneMode: "standard",
			mirrored: true,
			maskShape: "rounded",
			positionPreset: "top-left",
			sizePreset: 34,
		});
	});

	it("maps launch settings to picture-in-picture presentation metadata", () => {
		const settings = normalizeLaunchWebcamSettings({
			resolutionPreset: "720p",
			fps: 30,
			sceneMode: "standard",
			maskShape: "circle",
			positionPreset: "bottom-left",
			sizePreset: 28,
			mirrored: true,
		});

		expect(launchWebcamSettingsToPresentation(settings)).toEqual({
			layoutPreset: "picture-in-picture",
			maskShape: "circle",
			mirrored: true,
			reactiveZoom: true,
			sizePreset: 28,
			position: { cx: 0.14, cy: 0.82 },
		});
	});

	it("maps education scene settings to a transparent dual-frame presentation", () => {
		const settings = normalizeLaunchWebcamSettings({
			sceneMode: "education",
			maskShape: "circle",
			positionPreset: "top-left",
			sizePreset: 32,
		});

		expect(launchWebcamSettingsToPresentation(settings)).toEqual({
			layoutPreset: "dual-frame",
			maskShape: "rectangle",
			mirrored: false,
			reactiveZoom: true,
			sizePreset: 32,
			position: null,
		});
	});

	it("normalizes stored presentation metadata", () => {
		expect(
			normalizeWebcamPresentationSettings({
				layoutPreset: "dual-frame",
				maskShape: "circle",
				mirrored: true,
				reactiveZoom: false,
				sizePreset: 5,
				position: { cx: 1.4, cy: -0.3 },
			}),
		).toEqual({
			layoutPreset: "dual-frame",
			maskShape: "circle",
			mirrored: true,
			reactiveZoom: false,
			sizePreset: 10,
			position: { cx: 1, cy: 0 },
		});
	});

	it("uses null for the default bottom-right position so editor defaults stay compatible", () => {
		expect(positionPresetToWebcamPosition("bottom-right")).toBeNull();
	});
});
