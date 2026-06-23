#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
	console.log("Skipping macOS DMG creation: host platform is not macOS.");
	process.exit(0);
}

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const version = packageJson.version;
const arch = process.env.MACOS_DMG_ARCH ?? process.arch;
const releaseDir = path.join(root, "release", version);
const appPath = path.join(releaseDir, `mac-${arch}`, "LikelySnap.app");
const stagingDir = path.join(releaseDir, `dmg-staging-${arch}`);
const dmgPath = path.join(releaseDir, `LikelySnap-Mac-${arch}-${version}-Installer.dmg`);

if (!fs.existsSync(appPath)) {
	console.error(`macOS app bundle was not found: ${appPath}`);
	process.exit(1);
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.cpSync(appPath, path.join(stagingDir, "LikelySnap.app"), { recursive: true });

try {
	fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"));
} catch (error) {
	console.warn(`Failed to create Applications symlink: ${error.message}`);
}

fs.rmSync(dmgPath, { force: true });
const result = spawnSync(
	"hdiutil",
	["create", "-volname", "LikelySnap", "-srcfolder", stagingDir, "-ov", "-format", "UDZO", dmgPath],
	{ stdio: "inherit" },
);

fs.rmSync(stagingDir, { recursive: true, force: true });

if (result.error) {
	console.error(`Failed to start hdiutil: ${result.error.message}`);
	process.exit(1);
}
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

console.log(`Created macOS DMG: ${dmgPath}`);
