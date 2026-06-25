import type { WebcamLayoutPreset } from "./compositeLayout";

export type WebcamMaskShape = "rectangle" | "circle" | "square" | "rounded";

export type WebcamResolutionPreset = "360p" | "720p" | "1080p";
export type WebcamSceneMode = "standard" | "education";
export type WebcamPositionPreset = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type WebcamFrameRate = 24 | 30 | 60;

export interface WebcamPosition {
	cx: number;
	cy: number;
}

export interface WebcamPresentationSettings {
	layoutPreset: Exclude<WebcamLayoutPreset, "no-webcam">;
	maskShape: WebcamMaskShape;
	mirrored: boolean;
	reactiveZoom: boolean;
	sizePreset: number;
	position: WebcamPosition | null;
}

export interface LaunchWebcamSettings {
	resolutionPreset: WebcamResolutionPreset;
	width: number;
	height: number;
	fps: WebcamFrameRate;
	sceneMode: WebcamSceneMode;
	mirrored: boolean;
	maskShape: WebcamMaskShape;
	positionPreset: WebcamPositionPreset;
	sizePreset: number;
}

export const WEBCAM_RESOLUTION_PRESETS: Record<
	WebcamResolutionPreset,
	{ label: string; width: number; height: number }
> = {
	"360p": { label: "640 x 360", width: 640, height: 360 },
	"720p": { label: "1280 x 720", width: 1280, height: 720 },
	"1080p": { label: "1920 x 1080", width: 1920, height: 1080 },
};

export const WEBCAM_RESOLUTION_PRESET_ORDER: WebcamResolutionPreset[] = ["360p", "720p", "1080p"];

export const WEBCAM_FRAME_RATE_OPTIONS: WebcamFrameRate[] = [24, 30, 60];

export const WEBCAM_POSITION_PRESET_ORDER: WebcamPositionPreset[] = [
	"bottom-right",
	"bottom-left",
	"top-right",
	"top-left",
];

export const WEBCAM_MASK_SHAPE_ORDER: WebcamMaskShape[] = [
	"circle",
	"rounded",
	"rectangle",
	"square",
];

export const DEFAULT_WEBCAM_PRESENTATION_SETTINGS: WebcamPresentationSettings = {
	layoutPreset: "picture-in-picture",
	maskShape: "circle",
	mirrored: false,
	reactiveZoom: true,
	sizePreset: 25,
	position: null,
};

export const DEFAULT_LAUNCH_WEBCAM_SETTINGS: LaunchWebcamSettings = {
	resolutionPreset: "720p",
	width: WEBCAM_RESOLUTION_PRESETS["720p"].width,
	height: WEBCAM_RESOLUTION_PRESETS["720p"].height,
	fps: 30,
	sceneMode: "standard",
	mirrored: DEFAULT_WEBCAM_PRESENTATION_SETTINGS.mirrored,
	maskShape: DEFAULT_WEBCAM_PRESENTATION_SETTINGS.maskShape,
	positionPreset: "bottom-right",
	sizePreset: DEFAULT_WEBCAM_PRESENTATION_SETTINGS.sizePreset,
};

function isResolutionPreset(value: unknown): value is WebcamResolutionPreset {
	return value === "360p" || value === "720p" || value === "1080p";
}

function isFrameRate(value: unknown): value is WebcamFrameRate {
	return value === 24 || value === 30 || value === 60;
}

function isSceneMode(value: unknown): value is WebcamSceneMode {
	return value === "standard" || value === "education";
}

function isMaskShape(value: unknown): value is WebcamMaskShape {
	return value === "rectangle" || value === "circle" || value === "square" || value === "rounded";
}

function isPositionPreset(value: unknown): value is WebcamPositionPreset {
	return (
		value === "bottom-right" ||
		value === "bottom-left" ||
		value === "top-right" ||
		value === "top-left"
	);
}

function isLayoutPreset(value: unknown): value is WebcamPresentationSettings["layoutPreset"] {
	return value === "picture-in-picture" || value === "vertical-stack" || value === "dual-frame";
}

function clampSizePreset(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_LAUNCH_WEBCAM_SETTINGS.sizePreset;
	}
	return Math.max(10, Math.min(50, Math.round(value)));
}

function normalizeWebcamPosition(value: unknown): WebcamPosition | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const raw = value as Partial<WebcamPosition>;
	if (
		typeof raw.cx !== "number" ||
		typeof raw.cy !== "number" ||
		!Number.isFinite(raw.cx) ||
		!Number.isFinite(raw.cy)
	) {
		return null;
	}

	return {
		cx: Math.max(0, Math.min(1, raw.cx)),
		cy: Math.max(0, Math.min(1, raw.cy)),
	};
}

export function getWebcamResolutionPresetValues(preset: WebcamResolutionPreset) {
	return WEBCAM_RESOLUTION_PRESETS[preset];
}

export function normalizeLaunchWebcamSettings(candidate: unknown): LaunchWebcamSettings {
	if (!candidate || typeof candidate !== "object") {
		return { ...DEFAULT_LAUNCH_WEBCAM_SETTINGS };
	}

	const raw = candidate as Partial<LaunchWebcamSettings>;
	const resolutionPreset = isResolutionPreset(raw.resolutionPreset)
		? raw.resolutionPreset
		: DEFAULT_LAUNCH_WEBCAM_SETTINGS.resolutionPreset;
	const resolution = getWebcamResolutionPresetValues(resolutionPreset);

	return {
		resolutionPreset,
		width: resolution.width,
		height: resolution.height,
		fps: isFrameRate(raw.fps) ? raw.fps : DEFAULT_LAUNCH_WEBCAM_SETTINGS.fps,
		sceneMode: isSceneMode(raw.sceneMode)
			? raw.sceneMode
			: DEFAULT_LAUNCH_WEBCAM_SETTINGS.sceneMode,
		mirrored:
			typeof raw.mirrored === "boolean" ? raw.mirrored : DEFAULT_LAUNCH_WEBCAM_SETTINGS.mirrored,
		maskShape: isMaskShape(raw.maskShape)
			? raw.maskShape
			: DEFAULT_LAUNCH_WEBCAM_SETTINGS.maskShape,
		positionPreset: isPositionPreset(raw.positionPreset)
			? raw.positionPreset
			: DEFAULT_LAUNCH_WEBCAM_SETTINGS.positionPreset,
		sizePreset: clampSizePreset(raw.sizePreset),
	};
}

export function normalizeWebcamPresentationSettings(
	candidate: unknown,
): WebcamPresentationSettings | undefined {
	if (!candidate || typeof candidate !== "object") {
		return undefined;
	}

	const raw = candidate as Partial<WebcamPresentationSettings>;
	return {
		layoutPreset: isLayoutPreset(raw.layoutPreset)
			? raw.layoutPreset
			: DEFAULT_WEBCAM_PRESENTATION_SETTINGS.layoutPreset,
		maskShape: isMaskShape(raw.maskShape)
			? raw.maskShape
			: DEFAULT_WEBCAM_PRESENTATION_SETTINGS.maskShape,
		mirrored:
			typeof raw.mirrored === "boolean"
				? raw.mirrored
				: DEFAULT_WEBCAM_PRESENTATION_SETTINGS.mirrored,
		reactiveZoom:
			typeof raw.reactiveZoom === "boolean"
				? raw.reactiveZoom
				: DEFAULT_WEBCAM_PRESENTATION_SETTINGS.reactiveZoom,
		sizePreset: clampSizePreset(raw.sizePreset),
		position: normalizeWebcamPosition(raw.position),
	};
}

export function positionPresetToWebcamPosition(
	preset: WebcamPositionPreset,
): WebcamPosition | null {
	switch (preset) {
		case "bottom-left":
			return { cx: 0.14, cy: 0.82 };
		case "top-right":
			return { cx: 0.86, cy: 0.18 };
		case "top-left":
			return { cx: 0.14, cy: 0.18 };
		case "bottom-right":
			return null;
	}
}

export function launchWebcamSettingsToPresentation(
	settings: LaunchWebcamSettings,
): WebcamPresentationSettings {
	// The launch tray only decides whether to record a camera and which device to use.
	// Keep fresh recordings in picture-in-picture so Open Studio starts from the
	// normal screen-first composition; users can switch to education/dual-frame there.
	return {
		layoutPreset: "picture-in-picture",
		maskShape: settings.maskShape,
		mirrored: settings.mirrored,
		reactiveZoom: true,
		sizePreset: settings.sizePreset,
		position: positionPresetToWebcamPosition(settings.positionPreset),
	};
}
