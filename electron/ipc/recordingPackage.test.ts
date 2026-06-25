import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildRecordingPackageManifest,
	getCursorPreviewPathForVideo,
	getCursorTelemetryPathForVideo,
	getRecordingManifestPathForVideo,
	getRecordingPackageDirForVideoPath,
	getRecordingPackagePaths,
	normalizeRecordingDirectoryBasePath,
	normalizeRecordingPackageManifest,
	resolveRecordingOutputPathInDirectory,
} from "./recordingPackage";

describe("recording package paths", () => {
	it("builds canonical package paths for a recording id", () => {
		const recordingDir = path.resolve("/recordings");
		const paths = getRecordingPackagePaths(
			recordingDir,
			new Date(2026, 5, 19, 12, 34, 56, 789).getTime(),
		);

		expect(paths.packageDir).toBe(
			path.join(recordingDir, "recording-2026-06-19-12-34-56-789.likelysnap"),
		);
		expect(paths.screenVideoPath).toBe(
			path.join(recordingDir, "recording-2026-06-19-12-34-56-789.likelysnap", "screen.mp4"),
		);
		expect(paths.webcamVideoPath).toBe(
			path.join(recordingDir, "recording-2026-06-19-12-34-56-789.likelysnap", "webcam.mp4"),
		);
		expect(paths.cursorTelemetryPath).toBe(
			path.join(recordingDir, "recording-2026-06-19-12-34-56-789.likelysnap", "cursor.json"),
		);
		expect(paths.cursorPreviewPath).toBe(
			path.join(
				recordingDir,
				"recording-2026-06-19-12-34-56-789.likelysnap",
				"cursor-preview.json",
			),
		);
	});

	it("normalizes a package directory back to the recording directory", () => {
		const baseDir = path.resolve("/recordings");
		const recordingDir = path.join(baseDir, "recording-2026-06-19-12-34-56-789.likelysnap");

		expect(normalizeRecordingDirectoryBasePath(recordingDir)).toBe(baseDir);
	});

	it("normalizes paths inside a package back to the package parent directory", () => {
		const baseDir = path.resolve("/recordings");
		const nestedDir = path.join(baseDir, "recording-2026-06-19-12-34-56-789.likelysnap", "nested");

		expect(normalizeRecordingDirectoryBasePath(nestedDir)).toBe(baseDir);
	});

	it("does not nest a new package inside an existing package directory", () => {
		const baseDir = path.resolve("/recordings");
		const paths = getRecordingPackagePaths(
			path.join(baseDir, "recording-2026-06-19-12-34-56-789.likelysnap"),
			new Date(2026, 5, 19, 12, 35, 0, 123).getTime(),
		);

		expect(paths.packageDir).toBe(
			path.join(baseDir, "recording-2026-06-19-12-35-00-123.likelysnap"),
		);
	});

	it("allows only known package child paths under the recording directory", () => {
		expect(resolveRecordingOutputPathInDirectory("recording-123.likelysnap/screen.mp4", "/r")).toBe(
			path.join("/r", "recording-123.likelysnap", "screen.mp4"),
		);
		expect(resolveRecordingOutputPathInDirectory("recording-123.likelysnap/webcam.mp4", "/r")).toBe(
			path.join("/r", "recording-123.likelysnap", "webcam.mp4"),
		);
		expect(resolveRecordingOutputPathInDirectory("recording-123.likelysnap/webcam.mov", "/r")).toBe(
			path.join("/r", "recording-123.likelysnap", "webcam.mov"),
		);
		expect(
			resolveRecordingOutputPathInDirectory("recording-123.likelysnap/webcam.webm", "/r"),
		).toBe(path.join("/r", "recording-123.likelysnap", "webcam.webm"));
		expect(
			resolveRecordingOutputPathInDirectory("recording-123.likelysnap/cursor-preview.json", "/r"),
		).toBe(path.join("/r", "recording-123.likelysnap", "cursor-preview.json"));
		expect(resolveRecordingOutputPathInDirectory("recording-123.webm", "/r")).toBe(
			path.join("/r", "recording-123.webm"),
		);

		expect(() =>
			resolveRecordingOutputPathInDirectory("recording-123.likelysnap/../screen.mp4", "/r"),
		).toThrow();
		expect(() =>
			resolveRecordingOutputPathInDirectory("recording-123.likelysnap/evil.webm", "/r"),
		).toThrow();
		expect(() => resolveRecordingOutputPathInDirectory("/tmp/screen.mp4", "/r")).toThrow();
	});

	it("uses package-local cursor and manifest paths when screen video lives in a package", () => {
		const recordingDir = path.resolve("/r");
		const screenPath = path.join(recordingDir, "recording-123.likelysnap", "screen.mp4");

		expect(getRecordingPackageDirForVideoPath(screenPath)).toBe(
			path.join(recordingDir, "recording-123.likelysnap"),
		);
		expect(getCursorTelemetryPathForVideo(screenPath)).toBe(
			path.join(recordingDir, "recording-123.likelysnap", "cursor.json"),
		);
		expect(getCursorPreviewPathForVideo(screenPath)).toBe(
			path.join(recordingDir, "recording-123.likelysnap", "cursor-preview.json"),
		);
		expect(getRecordingManifestPathForVideo(screenPath, ".session.json")).toBe(
			path.join(recordingDir, "recording-123.likelysnap", "manifest.json"),
		);
	});

	it("keeps preview sidecars package-local even after the package is moved", () => {
		const recordingDir = path.resolve("/moved");
		const screenPath = path.join(recordingDir, "recording-123.likelysnap", "screen.mp4");

		expect(getCursorPreviewPathForVideo(screenPath)).toBe(
			path.join(recordingDir, "recording-123.likelysnap", "cursor-preview.json"),
		);
	});

	it("keeps legacy loose manifest and cursor sidecar paths", () => {
		const screenPath = path.join("/r", "recording-123.mp4");

		expect(getRecordingPackageDirForVideoPath(screenPath)).toBeNull();
		expect(getCursorTelemetryPathForVideo(screenPath)).toBe(`${screenPath}.cursor.json`);
		expect(getCursorPreviewPathForVideo(screenPath)).toBe(`${screenPath}.cursor-preview.json`);
		expect(getRecordingManifestPathForVideo(screenPath, ".session.json")).toBe(
			path.join("/r", "recording-123.session.json"),
		);
	});

	it("round-trips package manifest relative media paths to absolute session paths", () => {
		const packageDir = path.join(path.resolve("/r"), "recording-123.likelysnap");
		const screenVideoPath = path.join(packageDir, "screen.mp4");
		const webcamVideoPath = path.join(packageDir, "webcam.mp4");
		const manifest = buildRecordingPackageManifest(
			{
				screenVideoPath,
				webcamVideoPath,
				webcamStartOffsetMs: 250,
				webcamPresentation: {
					layoutPreset: "picture-in-picture",
					maskShape: "circle",
					mirrored: true,
					reactiveZoom: true,
					sizePreset: 30,
					position: { cx: 0.14, cy: 0.82 },
				},
				cursorCaptureMode: "editable-overlay",
				createdAt: 123,
			},
			"ready",
			{ diagnostics: { ok: true } },
		);

		expect(manifest).toMatchObject({
			createdAt: 123,
			media: {
				screenVideoPath: "screen.mp4",
				webcamVideoPath: "webcam.mp4",
				webcamStartOffsetMs: 250,
				webcamPresentation: {
					layoutPreset: "picture-in-picture",
					maskShape: "circle",
					mirrored: true,
					reactiveZoom: true,
					sizePreset: 30,
					position: { cx: 0.14, cy: 0.82 },
				},
				cursorTelemetryPath: "cursor.json",
				cursorCaptureMode: "editable-overlay",
			},
			recording: {
				status: "ready",
				cursorCaptureMode: "editable-overlay",
			},
			diagnostics: { ok: true },
		});

		expect(normalizeRecordingPackageManifest(manifest, packageDir)).toEqual({
			screenVideoPath,
			webcamVideoPath,
			webcamStartOffsetMs: 250,
			webcamPresentation: {
				layoutPreset: "picture-in-picture",
				maskShape: "circle",
				mirrored: true,
				reactiveZoom: true,
				sizePreset: 30,
				position: { cx: 0.14, cy: 0.82 },
			},
			cursorCaptureMode: "editable-overlay",
			createdAt: 123,
		});
	});

	it("round-trips system cursor mode for auto zoom telemetry without editable overlay", () => {
		const packageDir = path.join(path.resolve("/r"), "recording-123.likelysnap");
		const screenVideoPath = path.join(packageDir, "screen.mp4");
		const manifest = buildRecordingPackageManifest(
			{
				screenVideoPath,
				cursorCaptureMode: "system",
				createdAt: 123,
			},
			"ready",
		);

		expect(manifest).toMatchObject({
			media: {
				screenVideoPath: "screen.mp4",
				cursorTelemetryPath: "cursor.json",
				cursorCaptureMode: "system",
			},
			recording: {
				status: "ready",
				cursorCaptureMode: "system",
			},
		});

		expect(normalizeRecordingPackageManifest(manifest, packageDir)).toEqual({
			screenVideoPath,
			cursorCaptureMode: "system",
			createdAt: 123,
		});
	});

	it("keeps legacy package manifests with webcam.webm loadable", () => {
		const packageDir = path.join(path.resolve("/r"), "recording-123.likelysnap");
		const manifest = {
			schemaVersion: 1,
			createdAt: 123,
			brand: "LikelySnap",
			media: {
				screenVideoPath: "screen.mp4",
				webcamVideoPath: "webcam.webm",
				cursorTelemetryPath: "cursor.json",
			},
			recording: {
				status: "ready",
			},
		};

		expect(normalizeRecordingPackageManifest(manifest, packageDir)).toEqual({
			screenVideoPath: path.join(packageDir, "screen.mp4"),
			webcamVideoPath: path.join(packageDir, "webcam.webm"),
			createdAt: 123,
		});
	});

	it("keeps macOS movie-file webcam sidecars loadable", () => {
		const packageDir = path.join(path.resolve("/r"), "recording-123.likelysnap");
		const manifest = {
			schemaVersion: 1,
			createdAt: 123,
			brand: "LikelySnap",
			media: {
				screenVideoPath: "screen.mp4",
				webcamVideoPath: "webcam.mov",
				cursorTelemetryPath: "cursor.json",
			},
			recording: {
				status: "ready",
			},
		};

		expect(normalizeRecordingPackageManifest(manifest, packageDir)).toEqual({
			screenVideoPath: path.join(packageDir, "screen.mp4"),
			webcamVideoPath: path.join(packageDir, "webcam.mov"),
			createdAt: 123,
		});
	});
});
