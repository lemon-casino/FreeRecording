import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";

type LogLevel = "debug" | "info" | "warn" | "error";

type LoggerState = {
	initialized: boolean;
	logDir: string;
	originalConsole: Pick<Console, "debug" | "info" | "log" | "warn" | "error">;
};

const state: LoggerState = {
	initialized: false,
	logDir: "",
	originalConsole: {
		debug: console.debug.bind(console),
		info: console.info.bind(console),
		log: console.log.bind(console),
		warn: console.warn.bind(console),
		error: console.error.bind(console),
	},
};

function getLogFilePath(date = new Date()) {
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return path.join(state.logDir, `likelysnap-${yyyy}-${mm}-${dd}.log`);
}

function formatValue(value: unknown): string {
	if (value instanceof Error) {
		return value.stack || `${value.name}: ${value.message}`;
	}
	if (typeof value === "string") {
		return value;
	}
	return inspect(value, {
		breakLength: 160,
		colors: false,
		depth: 8,
		maxArrayLength: 100,
		maxStringLength: 20_000,
	});
}

function appendLogLine(level: LogLevel, parts: unknown[]) {
	if (!state.initialized || !state.logDir) {
		return;
	}

	try {
		fs.mkdirSync(state.logDir, { recursive: true });
		const timestamp = new Date().toISOString();
		const message = parts.map(formatValue).join(" ");
		fs.appendFileSync(getLogFilePath(), `[${timestamp}] [${level}] ${message}\n`, "utf8");
	} catch (error) {
		state.originalConsole.error("[logger] Failed to write app log:", error);
	}
}

function patchConsole() {
	console.debug = (...args: unknown[]) => {
		appendLogLine("debug", args);
		state.originalConsole.debug(...args);
	};
	console.info = (...args: unknown[]) => {
		appendLogLine("info", args);
		state.originalConsole.info(...args);
	};
	console.log = (...args: unknown[]) => {
		appendLogLine("info", args);
		state.originalConsole.log(...args);
	};
	console.warn = (...args: unknown[]) => {
		appendLogLine("warn", args);
		state.originalConsole.warn(...args);
	};
	console.error = (...args: unknown[]) => {
		appendLogLine("error", args);
		state.originalConsole.error(...args);
	};
}

export function initializeAppLogger(userDataPath: string) {
	if (state.initialized) {
		return state.logDir;
	}

	state.logDir = path.join(userDataPath, "logs");
	fs.mkdirSync(state.logDir, { recursive: true });
	state.initialized = true;
	patchConsole();

	process.on("uncaughtException", (error) => {
		appendLogLine("error", ["[process] uncaughtException", error]);
		state.originalConsole.error(error);
	});

	process.on("unhandledRejection", (reason) => {
		appendLogLine("error", ["[process] unhandledRejection", reason]);
		state.originalConsole.error(reason);
	});

	console.info("[logger] App logs directory:", state.logDir);
	return state.logDir;
}

export function getAppLogDirectory() {
	return state.logDir;
}

export function writeAppLog(level: LogLevel, message: string, details?: unknown) {
	appendLogLine(level, details === undefined ? [message] : [message, details]);
}
