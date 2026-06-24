// swift-tools-version: 5.9

import PackageDescription

let package = Package(
	name: "OpenScreenScreenCaptureKitHelper",
	platforms: [
		.macOS(.v13)
	],
	products: [
		.executable(
			name: "openscreen-screencapturekit-helper",
			targets: ["OpenScreenScreenCaptureKitHelper"]
		),
		.executable(
			name: "openscreen-macos-cursor-helper",
			targets: ["OpenScreenMacOSCursorHelper"]
		)
	],
	targets: [
		.target(
			name: "LikelyVoiceEnhancement",
			path: "Sources/LikelyVoiceEnhancement",
			publicHeadersPath: "include",
			cSettings: [
				.headerSearchPath("include"),
				.headerSearchPath("rnnoise/include"),
				.headerSearchPath("rnnoise/src"),
				.define("RNNOISE_BUILD"),
			]
		),
		.executableTarget(
			name: "OpenScreenScreenCaptureKitHelper",
			dependencies: ["LikelyVoiceEnhancement"],
			path: "Sources/OpenScreenScreenCaptureKitHelper"
		),
		.executableTarget(
			name: "OpenScreenMacOSCursorHelper",
			path: "Sources/OpenScreenMacOSCursorHelper"
		)
	]
)
