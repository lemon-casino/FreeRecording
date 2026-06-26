import {
	Check,
	ChevronDown,
	CircleDot,
	Clapperboard,
	Columns3,
	FileVideo,
	FolderOpen,
	GripVertical,
	Languages,
	Mic,
	MicOff,
	Minus,
	Monitor,
	MousePointer2,
	PauseCircle,
	PlayCircle,
	RefreshCcw,
	Rows3,
	Settings,
	Square,
	Video,
	VideoOff,
	Volume2,
	VolumeX,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import {
	loadUserPreferences,
	saveUserPreferences,
	type TrayLayoutPreference,
} from "@/lib/userPreferences";
import { nativeBridgeClient } from "@/native";
import { useAudioLevelMeter } from "../../hooks/useAudioLevelMeter";
import { useCameraDevices } from "../../hooks/useCameraDevices";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { formatTimePadded } from "../../utils/timeUtils";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { Switch } from "../ui/switch";
import { Tooltip } from "../ui/tooltip";
import {
	AUDIO_DEVICE_MENU_MAX_WIDTH,
	AUDIO_DEVICE_ROW_GAP,
	AUDIO_DEVICE_ROW_HEIGHT,
	getAudioDeviceMenuLayout,
} from "./audioDeviceMenuLayout";
import styles from "./LaunchWindow.module.css";
import { openSourceSelectorWithPermissionRetry } from "./openSourceSelectorFlow";

const ICON_SIZE = 20;

const LANGUAGE_MENU_WIDTH = 240;
const LANGUAGE_MENU_MAX_HEIGHT = 420;
const AUDIO_MENU_WIDTH = 380;
const AUDIO_MENU_MAX_HEIGHT = 460;
const WEBCAM_MENU_WIDTH = 440;
const WEBCAM_MENU_MAX_HEIGHT = 600;
const WEBCAM_MENU_CHROME_HEIGHT = 112;
const FLOATING_MENU_GAP = 8;
const HUD_OVERLAY_SIDE_MARGIN = 24;
const HUD_OVERLAY_TOP_MARGIN = 24;
const HUD_RESERVED_POPUP_WIDTH = Math.max(
	LANGUAGE_MENU_WIDTH,
	AUDIO_DEVICE_MENU_MAX_WIDTH,
	WEBCAM_MENU_WIDTH,
);
const HUD_RESERVED_POPUP_HEIGHT = Math.max(
	LANGUAGE_MENU_MAX_HEIGHT,
	AUDIO_MENU_MAX_HEIGHT,
	WEBCAM_MENU_MAX_HEIGHT,
);

const ICON_CONFIG = {
	drag: { icon: GripVertical, size: ICON_SIZE },
	monitor: { icon: Monitor, size: ICON_SIZE },
	volumeOn: { icon: Volume2, size: ICON_SIZE },
	volumeOff: { icon: VolumeX, size: ICON_SIZE },
	micOn: { icon: Mic, size: ICON_SIZE },
	micOff: { icon: MicOff, size: ICON_SIZE },
	webcamOn: { icon: Video, size: ICON_SIZE },
	webcamOff: { icon: VideoOff, size: ICON_SIZE },
	cursor: { icon: MousePointer2, size: ICON_SIZE },
	pause: { icon: PauseCircle, size: ICON_SIZE },
	resume: { icon: PlayCircle, size: ICON_SIZE },
	stop: { icon: Square, size: ICON_SIZE },
	restart: { icon: RefreshCcw, size: ICON_SIZE },
	cancel: { icon: XCircle, size: ICON_SIZE },
	record: { icon: CircleDot, size: ICON_SIZE },
	videoFile: { icon: FileVideo, size: ICON_SIZE },
	folder: { icon: FolderOpen, size: ICON_SIZE },
	minimize: { icon: Minus, size: ICON_SIZE },
	close: { icon: X, size: ICON_SIZE },
} as const;

type IconName = keyof typeof ICON_CONFIG;
type HudOverlayEdge = "top" | "right" | "bottom" | "left";
type ResolvedTrayLayout = "horizontal" | "vertical";
type FloatingMenuStyle = {
	left: number;
	top: number;
	width: number;
	maxHeight: number;
};

function clampNumber(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function getAnchoredMenuStyle({
	triggerRect,
	panelWidth,
	panelHeight,
	minHeight,
	maxHeight,
	hudEdge,
}: {
	triggerRect: DOMRect;
	panelWidth: number;
	panelHeight?: number;
	minHeight: number;
	maxHeight: number;
	hudEdge: HudOverlayEdge;
}): FloatingMenuStyle {
	const gap = FLOATING_MENU_GAP;
	const viewportPadding = 8;
	const availableAbove = Math.max(0, triggerRect.top - viewportPadding - gap);
	const availableBelow = Math.max(
		0,
		window.innerHeight - triggerRect.bottom - viewportPadding - gap,
	);
	const availableLeft = Math.max(0, triggerRect.left - viewportPadding - gap);
	const availableRight = Math.max(0, window.innerWidth - triggerRect.right - viewportPadding - gap);
	const verticalSpace =
		hudEdge === "bottom"
			? availableAbove
			: hudEdge === "top"
				? availableBelow
				: Math.max(availableAbove + triggerRect.height + availableBelow, minHeight);
	const desiredHeight =
		typeof panelHeight === "number" && Number.isFinite(panelHeight) && panelHeight > 0
			? panelHeight
			: minHeight;
	const availableMaxHeight = Math.min(maxHeight, Math.max(1, verticalSpace || maxHeight));
	const placementHeight = Math.min(availableMaxHeight, Math.max(1, desiredHeight));
	const maxLeft = Math.max(viewportPadding, window.innerWidth - viewportPadding - panelWidth);
	const maxTop = Math.max(viewportPadding, window.innerHeight - viewportPadding - placementHeight);

	if (hudEdge === "left" || hudEdge === "right") {
		const preferRight = hudEdge === "left";
		const sideLeft =
			preferRight && availableRight >= panelWidth
				? triggerRect.right + gap
				: !preferRight && availableLeft >= panelWidth
					? triggerRect.left - panelWidth - gap
					: availableRight >= availableLeft
						? triggerRect.right + gap
						: triggerRect.left - panelWidth - gap;

		return {
			left: clampNumber(sideLeft, viewportPadding, maxLeft),
			top: clampNumber(
				triggerRect.top + triggerRect.height / 2 - placementHeight / 2,
				viewportPadding,
				maxTop,
			),
			width: panelWidth,
			maxHeight: availableMaxHeight,
		};
	}

	const placeAbove =
		hudEdge === "bottom" || (hudEdge !== "top" && availableAbove >= availableBelow);
	const centeredLeft = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;

	return {
		left: clampNumber(centeredLeft, viewportPadding, maxLeft),
		top: clampNumber(
			placeAbove ? triggerRect.top - gap - placementHeight : triggerRect.bottom + gap,
			viewportPadding,
			maxTop,
		),
		width: panelWidth,
		maxHeight: availableMaxHeight,
	};
}

/** Renders the configured icon for a HUD control. */
function getIcon(name: IconName, className?: string) {
	const { icon: Icon, size } = ICON_CONFIG[name];
	return <Icon size={size} className={className} />;
}

const hudGroupClasses =
	"flex items-center gap-0.5 rounded-xl border border-white/[0.07] bg-white/[0.045] transition-colors duration-150 hover:bg-white/[0.075]";

const hudIconBtnClasses =
	"flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer text-white hover:bg-white/10 active:scale-95";

const hudAuxIconBtnClasses =
	"flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150 text-white/55 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed";

const windowBtnClasses =
	"flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer opacity-50 hover:opacity-90 hover:bg-white/[0.08]";

const hudSidebarClasses = "ml-0.5 pl-1.5 border-l border-white/10 flex items-center gap-0.5";
const hudSidebarVerticalClasses =
	"mt-0.5 pt-1.5 border-t border-white/10 flex flex-col items-center gap-0.5";

/** Launches the floating recording HUD and its recorder controls. */
export function LaunchWindow() {
	const t = useScopedT("launch");
	const availableLocales = getAvailableLocales();
	const { locale, setLocale, resolveSystemLocaleSuggestion } = useI18n();
	const activeLanguageLabel = getLocaleName(locale).split(/\s+/)[0] || locale.toUpperCase();

	const {
		recording,
		paused,
		elapsedSeconds,
		toggleRecording,
		togglePaused,
		canPauseRecording,
		restartRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		setMicrophoneDeviceName,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		setWebcamDeviceName,
		cursorCaptureMode,
		setCursorCaptureMode,
	} = useScreenRecorder();

	const audioMeterEnabled = microphoneEnabled && !recording;

	const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
	const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);
	const [isAudioDeviceListOpen, setIsAudioDeviceListOpen] = useState(false);
	const [isWebcamMenuOpen, setIsWebcamMenuOpen] = useState(false);
	const [isWebcamDeviceListOpen, setIsWebcamDeviceListOpen] = useState(false);
	const [trayLayoutPreference, setTrayLayoutPreference] = useState<TrayLayoutPreference>(
		() => loadUserPreferences().trayLayout,
	);
	const [hudEdge, setHudEdge] = useState<HudOverlayEdge>("bottom");
	const trayLayout: ResolvedTrayLayout =
		trayLayoutPreference === "auto"
			? hudEdge === "left" || hudEdge === "right"
				? "vertical"
				: "horizontal"
			: trayLayoutPreference;
	const isSmartTrayLayout = trayLayoutPreference === "auto";
	const [supportsCursorModeToggle, setSupportsCursorModeToggle] = useState(false);
	const [recordingDirectoryPath, setRecordingDirectoryPath] = useState("");
	const [recordingDirectoryWritable, setRecordingDirectoryWritable] = useState(true);
	const [showOpenStudioShortcut, setShowOpenStudioShortcut] = useState(true);
	const audioTriggerRef = useRef<HTMLButtonElement | null>(null);
	const audioMenuPanelRef = useRef<HTMLDivElement | null>(null);
	const webcamTriggerRef = useRef<HTMLButtonElement | null>(null);
	const webcamMenuPanelRef = useRef<HTMLDivElement | null>(null);
	const languageTriggerRef = useRef<HTMLButtonElement | null>(null);
	const languageMenuPanelRef = useRef<HTMLDivElement | null>(null);
	const hudBarRef = useRef<HTMLDivElement | null>(null);
	const isDraggingHudRef = useRef(false);
	const [languageMenuStyle, setLanguageMenuStyle] = useState<FloatingMenuStyle>({
		left: 12,
		top: 12,
		width: LANGUAGE_MENU_WIDTH,
		maxHeight: LANGUAGE_MENU_MAX_HEIGHT,
	});
	const [audioMenuStyle, setAudioMenuStyle] = useState<FloatingMenuStyle>({
		left: 12,
		top: 12,
		width: AUDIO_MENU_WIDTH,
		maxHeight: AUDIO_MENU_MAX_HEIGHT,
	});
	const [webcamMenuStyle, setWebcamMenuStyle] = useState<FloatingMenuStyle>({
		left: 12,
		top: 12,
		width: WEBCAM_MENU_WIDTH,
		maxHeight: WEBCAM_MENU_MAX_HEIGHT,
	});

	const {
		devices: micDevices,
		selectedDeviceId: selectedMicId,
		setSelectedDeviceId: setSelectedMicId,
	} = useMicrophoneDevices(microphoneEnabled);
	const {
		devices: cameraDevices,
		selectedDeviceId: selectedCameraId,
		setSelectedDeviceId: setSelectedCameraId,
		isLoading: isCameraDevicesLoading,
		error: cameraDevicesError,
	} = useCameraDevices(webcamEnabled || isWebcamMenuOpen);

	const audioEnabled = microphoneEnabled || systemAudioEnabled;
	const selectedMicDevice = micDevices.find(
		(device) => device.deviceId === (microphoneDeviceId || selectedMicId),
	);
	const selectedMicLabel = selectedMicDevice?.label || t("audio.defaultMicrophone");
	const audioDeviceNaturalMenuLayout = getAudioDeviceMenuLayout(micDevices.length);
	const audioMenuTargetHeight =
		isAudioDeviceListOpen && microphoneEnabled
			? Math.min(audioDeviceNaturalMenuLayout.menuNaturalHeight, AUDIO_MENU_MAX_HEIGHT)
			: undefined;
	const audioDeviceMenuLayout = getAudioDeviceMenuLayout(micDevices.length, audioMenuTargetHeight);
	const audioMenuTargetWidth =
		isAudioDeviceListOpen && microphoneEnabled ? audioDeviceMenuLayout.menuWidth : AUDIO_MENU_WIDTH;
	const selectedCameraDevice = cameraDevices.find(
		(d) => d.deviceId === (webcamDeviceId || selectedCameraId),
	);
	const selectedCameraLabel = isCameraDevicesLoading
		? t("webcam.searching")
		: cameraDevicesError
			? t("webcam.unavailable")
			: cameraDevices.length === 0
				? t("webcam.noneFound")
				: selectedCameraDevice?.label || t("webcam.defaultCamera");
	const webcamDeviceNaturalMenuLayout = getAudioDeviceMenuLayout(
		cameraDevices.length,
		undefined,
		WEBCAM_MENU_CHROME_HEIGHT,
	);
	const webcamMenuTargetHeight = isWebcamDeviceListOpen
		? Math.min(webcamDeviceNaturalMenuLayout.menuNaturalHeight, WEBCAM_MENU_MAX_HEIGHT)
		: undefined;
	const webcamDeviceMenuLayout = getAudioDeviceMenuLayout(
		cameraDevices.length,
		webcamMenuTargetHeight,
		WEBCAM_MENU_CHROME_HEIGHT,
	);
	const webcamMenuTargetWidth = isWebcamDeviceListOpen
		? webcamDeviceMenuLayout.menuWidth
		: WEBCAM_MENU_WIDTH;

	const { level } = useAudioLevelMeter({
		enabled: audioMeterEnabled,
		deviceId: microphoneDeviceId,
	});
	const recordingDirectoryTooltip = recordingDirectoryPath
		? `${t("tooltips.chooseRecordingDirectory")}: ${recordingDirectoryPath}`
		: t("tooltips.chooseRecordingDirectory");

	const refreshRecordingDirectory = useCallback(async () => {
		try {
			const result = await window.electronAPI?.getRecordingDirectory?.();
			if (!result?.success) {
				setRecordingDirectoryWritable(false);
				return;
			}
			setRecordingDirectoryPath(result.path);
			setRecordingDirectoryWritable(result.writable);
		} catch (error) {
			console.error("Failed to load recording directory:", error);
			setRecordingDirectoryWritable(false);
		}
	}, []);

	const pickRecordingDirectory = useCallback(async () => {
		try {
			const result = await window.electronAPI?.pickRecordingDirectory?.();
			if (!result || result.canceled) {
				return;
			}
			if (!result.success || !result.path) {
				setRecordingDirectoryWritable(false);
				alert(result.error ?? "Failed to set recording directory");
				return;
			}
			setRecordingDirectoryPath(result.path);
			setRecordingDirectoryWritable(result.writable !== false);
		} catch (error) {
			console.error("Failed to pick recording directory:", error);
			setRecordingDirectoryWritable(false);
			alert(error instanceof Error ? error.message : "Failed to set recording directory");
		}
	}, []);

	useEffect(() => {
		void refreshRecordingDirectory();
	}, [refreshRecordingDirectory]);

	const refreshOpenStudioShortcutVisibility = useCallback(async () => {
		try {
			const result = await window.electronAPI?.getAppSettings?.();
			if (result?.success && result.settings) {
				setShowOpenStudioShortcut(result.settings.postRecordingOpenStudio);
			}
		} catch (error) {
			console.warn("Failed to load Open Studio shortcut setting:", error);
		}
	}, []);

	useEffect(() => {
		void refreshOpenStudioShortcutVisibility();
		return window.electronAPI?.onAppSettingsChanged?.((settings) => {
			setShowOpenStudioShortcut(settings.postRecordingOpenStudio);
		});
	}, [refreshOpenStudioShortcutVisibility]);

	useEffect(() => {
		if (selectedMicId && selectedMicId !== "default") {
			setMicrophoneDeviceId(selectedMicId);
			setMicrophoneDeviceName(micDevices.find((d) => d.deviceId === selectedMicId)?.label);
		}
	}, [selectedMicId, micDevices, setMicrophoneDeviceId, setMicrophoneDeviceName]);

	useEffect(() => {
		if (selectedCameraId) {
			setWebcamDeviceId(selectedCameraId);
			setWebcamDeviceName(cameraDevices.find((d) => d.deviceId === selectedCameraId)?.label);
		}
	}, [selectedCameraId, cameraDevices, setWebcamDeviceId, setWebcamDeviceName]);

	useEffect(() => {
		let cancelled = false;
		nativeBridgeClient.system
			.getPlatform()
			.then((platform) => {
				if (!cancelled) {
					setSupportsCursorModeToggle(platform === "win32" || platform === "darwin");
				}
			})
			.catch(() => {
				if (!cancelled) {
					setSupportsCursorModeToggle(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!isLanguageMenuOpen && !isAudioMenuOpen && !isWebcamMenuOpen) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			const clickedLanguageTrigger = languageTriggerRef.current?.contains(target);
			const clickedLanguageMenu = languageMenuPanelRef.current?.contains(target);
			const clickedAudioTrigger = audioTriggerRef.current?.contains(target);
			const clickedAudioMenu = audioMenuPanelRef.current?.contains(target);
			const clickedWebcamTrigger = webcamTriggerRef.current?.contains(target);
			const clickedWebcamMenu = webcamMenuPanelRef.current?.contains(target);

			if (isLanguageMenuOpen && !clickedLanguageTrigger && !clickedLanguageMenu) {
				setIsLanguageMenuOpen(false);
			}
			if (isAudioMenuOpen && !clickedAudioTrigger && !clickedAudioMenu) {
				setIsAudioMenuOpen(false);
			}
			if (isWebcamMenuOpen && !clickedWebcamTrigger && !clickedWebcamMenu) {
				setIsWebcamMenuOpen(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsLanguageMenuOpen(false);
				setIsAudioMenuOpen(false);
				setIsWebcamMenuOpen(false);
			}
		};

		window.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleEscape);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleEscape);
		};
	}, [isLanguageMenuOpen, isAudioMenuOpen, isWebcamMenuOpen]);

	useLayoutEffect(() => {
		if (!isLanguageMenuOpen || !languageTriggerRef.current) return;

		const updatePosition = () => {
			if (!languageTriggerRef.current) return;
			const rect = languageTriggerRef.current.getBoundingClientRect();
			const measuredHeight = languageMenuPanelRef.current?.getBoundingClientRect().height;
			setLanguageMenuStyle(
				getAnchoredMenuStyle({
					triggerRect: rect,
					panelWidth: LANGUAGE_MENU_WIDTH,
					panelHeight: measuredHeight,
					minHeight: 140,
					maxHeight: LANGUAGE_MENU_MAX_HEIGHT,
					hudEdge,
				}),
			);
		};

		updatePosition();
		const raf = requestAnimationFrame(updatePosition);
		const timer = window.setTimeout(updatePosition, 80);
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("hud-menu-layout-change", updatePosition);

		return () => {
			cancelAnimationFrame(raf);
			window.clearTimeout(timer);
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("hud-menu-layout-change", updatePosition);
		};
	}, [hudEdge, isLanguageMenuOpen]);

	useLayoutEffect(() => {
		if (!isAudioMenuOpen || !audioTriggerRef.current) return;

		const updatePosition = () => {
			if (!audioTriggerRef.current) return;
			const rect = audioTriggerRef.current.getBoundingClientRect();
			const measuredHeight = audioMenuPanelRef.current?.getBoundingClientRect().height;
			setAudioMenuStyle(
				getAnchoredMenuStyle({
					triggerRect: rect,
					panelWidth: audioMenuTargetWidth,
					panelHeight: measuredHeight || audioMenuTargetHeight,
					minHeight: 180,
					maxHeight: AUDIO_MENU_MAX_HEIGHT,
					hudEdge,
				}),
			);
		};

		updatePosition();
		const raf = requestAnimationFrame(updatePosition);
		const timer = window.setTimeout(updatePosition, 80);
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("hud-menu-layout-change", updatePosition);

		return () => {
			cancelAnimationFrame(raf);
			window.clearTimeout(timer);
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("hud-menu-layout-change", updatePosition);
		};
	}, [hudEdge, isAudioMenuOpen, audioMenuTargetHeight, audioMenuTargetWidth]);

	useLayoutEffect(() => {
		if (!isWebcamMenuOpen || !webcamTriggerRef.current) return;

		const updatePosition = () => {
			if (!webcamTriggerRef.current) return;
			const rect = webcamTriggerRef.current.getBoundingClientRect();
			const measuredHeight = webcamMenuPanelRef.current?.getBoundingClientRect().height;
			setWebcamMenuStyle(
				getAnchoredMenuStyle({
					triggerRect: rect,
					panelWidth: webcamMenuTargetWidth,
					panelHeight: measuredHeight || webcamMenuTargetHeight,
					minHeight: 260,
					maxHeight: WEBCAM_MENU_MAX_HEIGHT,
					hudEdge,
				}),
			);
		};

		updatePosition();
		const raf = requestAnimationFrame(updatePosition);
		const timer = window.setTimeout(updatePosition, 80);
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("hud-menu-layout-change", updatePosition);

		return () => {
			cancelAnimationFrame(raf);
			window.clearTimeout(timer);
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("hud-menu-layout-change", updatePosition);
		};
	}, [hudEdge, isWebcamMenuOpen, webcamMenuTargetHeight, webcamMenuTargetWidth]);

	useEffect(() => {
		if (!isAudioMenuOpen || !microphoneEnabled) {
			setIsAudioDeviceListOpen(false);
		}
	}, [isAudioMenuOpen, microphoneEnabled]);

	useEffect(() => {
		if (!isWebcamMenuOpen) {
			setIsWebcamDeviceListOpen(false);
		}
	}, [isWebcamMenuOpen]);

	useEffect(() => {
		if (!isLanguageMenuOpen || !languageMenuPanelRef.current) return;
		const id = requestAnimationFrame(() => {
			if (languageMenuPanelRef.current) {
				languageMenuPanelRef.current.scrollTop = 0;
			}
		});
		return () => cancelAnimationFrame(id);
	}, [isLanguageMenuOpen]);

	// Resize the overlay window to fit content, else the taller vertical tray gets clipped
	// and scrolls. Measure from the window's bottom-centre (the anchor the main process
	// preserves) so fixed bottom/centre offsets keep this stable and it doesn't oscillate.
	const lastHudSizeRef = useRef({ width: 0, height: 0 });
	const measureHudSize = useCallback(() => {
		if (isDraggingHudRef.current) return;
		const barEl = hudBarRef.current;
		if (!barEl || !window.electronAPI?.setHudOverlaySize) return;

		// Breathing room so the drop shadow isn't clipped. TOP_MARGIN must also exceed the
		// slack in the bar's `max-h: calc(100vh - 2.5rem)` cap (40px reserved - 20px bottom
		// gap = 20px) so the window stays tall enough that the cap never engages and adds a scrollbar.
		// Wide enough that the language menu (11rem) never clips, even when the bar is narrow.
		const MIN_WIDTH = 220;

		// Use natural (scroll) size, not the clipped box: vertical mode's max-h cap is a
		// small-screen fallback, and reading clipped height would pin the window to it.
		// scrollHeight gives full content height; the cap only engages when the main process clamps to screen.
		const barWidth = Math.ceil(barEl.scrollWidth);
		const barHeight = Math.ceil(barEl.scrollHeight);
		let contentWidth = Math.max(barWidth, HUD_RESERVED_POPUP_WIDTH);
		let contentHeight =
			hudEdge === "top" || hudEdge === "bottom"
				? Math.max(barHeight + 20, barHeight + FLOATING_MENU_GAP + HUD_RESERVED_POPUP_HEIGHT)
				: Math.max(barHeight, HUD_RESERVED_POPUP_HEIGHT);

		// Popups are positioned in the same transparent HUD window as the bar. Reserve
		// space for both the bar and the popup; measuring only the popup's clipped box
		// creates a resize feedback loop where device lists can never grow past the old
		// small window height.
		const measurePopup = (el: HTMLElement | null) => {
			if (!el) return;
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) return;
			contentWidth = Math.max(contentWidth, Math.ceil(rect.width));
			contentHeight = Math.max(
				contentHeight,
				Math.ceil(barHeight + FLOATING_MENU_GAP + rect.height),
			);
		};

		measurePopup(languageMenuPanelRef.current);
		measurePopup(audioMenuPanelRef.current);
		measurePopup(webcamMenuPanelRef.current);

		const width = Math.max(MIN_WIDTH, contentWidth + HUD_OVERLAY_SIDE_MARGIN * 2);
		const height = contentHeight + HUD_OVERLAY_TOP_MARGIN * 2;
		if (width === lastHudSizeRef.current.width && height === lastHudSizeRef.current.height) {
			return;
		}
		lastHudSizeRef.current = { width, height };
		window.electronAPI.setHudOverlaySize(width, height);
	}, [hudEdge]);

	// One persistent observer; elements wire themselves up via callback refs as they
	// mount/unmount so measurement re-runs without recreating it or threading mount state through deps.
	const hudResizeObserverRef = useRef<ResizeObserver | null>(null);
	useEffect(() => {
		const observer = new ResizeObserver(() => {
			measureHudSize();
			window.dispatchEvent(new Event("hud-menu-layout-change"));
		});
		hudResizeObserverRef.current = observer;
		if (hudBarRef.current) observer.observe(hudBarRef.current);
		if (audioMenuPanelRef.current) observer.observe(audioMenuPanelRef.current);
		if (webcamMenuPanelRef.current) observer.observe(webcamMenuPanelRef.current);
		measureHudSize();
		return () => {
			observer.disconnect();
			hudResizeObserverRef.current = null;
		};
	}, [measureHudSize]);

	const observeHudElement = useCallback(
		<T extends HTMLElement>(el: T | null, ref: React.MutableRefObject<T | null>) => {
			const observer = hudResizeObserverRef.current;
			if (ref.current && observer) observer.unobserve(ref.current);
			ref.current = el;
			if (el && observer) observer.observe(el);
			measureHudSize();
		},
		[measureHudSize],
	);
	const setHudBarEl = useCallback(
		(el: HTMLDivElement | null) => observeHudElement(el, hudBarRef),
		[observeHudElement],
	);
	const setLanguageMenuPanelEl = useCallback(
		(el: HTMLDivElement | null) => observeHudElement(el, languageMenuPanelRef),
		[observeHudElement],
	);
	const setAudioMenuPanelEl = useCallback(
		(el: HTMLDivElement | null) => observeHudElement(el, audioMenuPanelRef),
		[observeHudElement],
	);
	const setWebcamMenuPanelEl = useCallback(
		(el: HTMLDivElement | null) => observeHudElement(el, webcamMenuPanelRef),
		[observeHudElement],
	);

	const hudMouseEventsEnabledRef = useRef<boolean | undefined>(undefined);
	const setHudMouseEventsEnabled = useCallback((enabled: boolean) => {
		if (hudMouseEventsEnabledRef.current === enabled) {
			return;
		}
		hudMouseEventsEnabledRef.current = enabled;
		window.electronAPI?.setHudOverlayIgnoreMouseEvents?.(!enabled);
	}, []);

	useEffect(() => {
		setHudMouseEventsEnabled(false);
		return () => {
			window.electronAPI?.setHudOverlayIgnoreMouseEvents?.(false);
		};
	}, [setHudMouseEventsEnabled]);

	useEffect(() => {
		setHudMouseEventsEnabled(isLanguageMenuOpen || isAudioMenuOpen || isWebcamMenuOpen);
	}, [isLanguageMenuOpen, isAudioMenuOpen, isWebcamMenuOpen, setHudMouseEventsEnabled]);

	useEffect(() => {
		return window.electronAPI?.onHudOverlayEdgeChanged?.((edge) => {
			setHudEdge(edge);
		});
	}, []);

	const [selectedSource, setSelectedSource] = useState("Screen");
	useEffect(() => {
		const checkSelectedSource = async () => {
			if (window.electronAPI) {
				const source =
					(await window.electronAPI.getSelectedSource()) ??
					(await window.electronAPI.ensureDefaultSelectedSource?.());
				if (source) {
					setSelectedSource(source.name);
				} else {
					setSelectedSource("Screen");
				}
			}
		};

		checkSelectedSource();

		const interval = setInterval(checkSelectedSource, 500);
		return () => clearInterval(interval);
	}, []);

	const openSourceSelector = async () => {
		if (window.electronAPI) {
			await openSourceSelectorWithPermissionRetry({
				openSourceSelector: () => window.electronAPI.openSourceSelector(),
				requestScreenAccess: () => window.electronAPI.requestScreenAccess(),
			});
		}
	};

	const sendHudOverlayHide = () => {
		if (window.electronAPI && window.electronAPI.hudOverlayHide) {
			window.electronAPI.hudOverlayHide();
		}
	};
	const sendHudOverlayClose = () => {
		if (window.electronAPI && window.electronAPI.hudOverlayClose) {
			window.electronAPI.hudOverlayClose();
		}
	};
	/** Switches the HUD between smart, horizontal, and vertical tray layouts. */
	const toggleTrayLayout = () => {
		const nextLayout: TrayLayoutPreference =
			trayLayoutPreference === "auto"
				? "horizontal"
				: trayLayoutPreference === "horizontal"
					? "vertical"
					: "auto";
		setTrayLayoutPreference(nextLayout);
		saveUserPreferences({ trayLayout: nextLayout });
	};

	const selectMicrophoneDevice = (deviceId: string) => {
		const selectedDevice = micDevices.find((device) => device.deviceId === deviceId);
		setSelectedMicId(deviceId);
		setMicrophoneDeviceId(deviceId);
		setMicrophoneDeviceName(selectedDevice?.label);
	};

	const selectCameraDevice = (deviceId: string) => {
		const selectedDevice = cameraDevices.find((device) => device.deviceId === deviceId);
		setSelectedCameraId(deviceId);
		setWebcamDeviceId(deviceId);
		setWebcamDeviceName(selectedDevice?.label);
	};

	const toggleWebcamEnabled = async (enabled: boolean) => {
		const updated = await setWebcamEnabled(enabled);
		if (updated && enabled) {
			setIsWebcamDeviceListOpen(cameraDevices.length > 0);
		}
	};

	const handleHudDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
		setHudMouseEventsEnabled(true);
		event.currentTarget.setPointerCapture(event.pointerId);
		isDraggingHudRef.current = true;
		window.electronAPI?.startHudOverlayDrag?.();
	};
	const handleHudDragPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!isDraggingHudRef.current) return;
		event.preventDefault();
		event.stopPropagation();
		window.electronAPI?.dragHudOverlayToCursor?.();
	};
	const handleHudDragPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
		const wasDragging = isDraggingHudRef.current;
		isDraggingHudRef.current = false;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (!wasDragging) return;
		void window.electronAPI
			?.snapHudOverlayToNearestEdge?.()
			.then((result) => {
				if (result?.edge) {
					setHudEdge(result.edge);
				}
				measureHudSize();
			})
			.finally(() => {
				window.electronAPI?.endHudOverlayDrag?.();
			});
		setHudMouseEventsEnabled(false);
	};
	const hudBarPositionClass =
		hudEdge === "left"
			? "fixed left-0 top-1/2 -translate-y-1/2"
			: hudEdge === "right"
				? "fixed right-0 top-1/2 -translate-y-1/2"
				: hudEdge === "top"
					? "fixed top-0 left-1/2 -translate-x-1/2"
					: "fixed bottom-0 left-1/2 -translate-x-1/2";

	return (
		// Avoid w-screen/h-screen: 100vw can exceed the inner layout width when scrollbars
		// affect the viewport (Windows), causing a horizontal scrollbar (issue #305).
		<div
			className="h-full w-full min-w-0 max-w-full overflow-x-hidden overflow-y-hidden bg-transparent"
			onPointerMove={(event) => {
				if (isDraggingHudRef.current) {
					setHudMouseEventsEnabled(true);
					return;
				}
				const target = event.target as HTMLElement | null;
				const shouldCapture =
					isLanguageMenuOpen ||
					isAudioMenuOpen ||
					isWebcamMenuOpen ||
					Boolean(target?.closest("[data-hud-interactive='true']"));
				setHudMouseEventsEnabled(shouldCapture);
			}}
			onPointerLeave={() => {
				if (isDraggingHudRef.current) {
					return;
				}
				if (!isLanguageMenuOpen && !isAudioMenuOpen && !isWebcamMenuOpen) {
					setHudMouseEventsEnabled(false);
				}
			}}
		>
			{/* HUD bar, viewport-relative, aligned with the edge chosen by the native window. */}
			<div
				ref={setHudBarEl}
				data-hud-interactive="true"
				data-tray-layout={trayLayout}
				className={`${hudBarPositionClass} flex rounded-2xl border border-white/[0.10] bg-[#07080a]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl backdrop-saturate-[140%] ${
					trayLayout === "vertical"
						? "max-h-[calc(100vh-2.5rem)] flex-col items-center gap-1 overflow-y-auto px-1 py-1.5"
						: "items-center gap-1.5 px-2 py-1.5"
				}`}
				onPointerEnter={() => setHudMouseEventsEnabled(true)}
				onPointerDown={() => setHudMouseEventsEnabled(true)}
				onMouseEnter={() => setHudMouseEventsEnabled(true)}
				onMouseLeave={() => {
					if (isDraggingHudRef.current) {
						return;
					}
					if (!isLanguageMenuOpen && !isAudioMenuOpen && !isWebcamMenuOpen) {
						setHudMouseEventsEnabled(false);
					}
				}}
			>
				{/* Drag handle */}
				<div
					className={`flex ${trayLayout === "vertical" ? "h-6 w-8" : "h-8 w-7"} cursor-grab items-center justify-center active:cursor-grabbing ${styles.electronNoDrag}`}
					onPointerDown={handleHudDragPointerDown}
					onPointerMove={handleHudDragPointerMove}
					onPointerUp={handleHudDragPointerEnd}
					onPointerCancel={handleHudDragPointerEnd}
				>
					{getIcon("drag", "text-white/30")}
				</div>

				<Tooltip
					content={
						isSmartTrayLayout
							? "智能托盘：贴左右边竖向，贴上下边横向"
							: trayLayout === "horizontal"
								? t("tooltips.useVerticalTray")
								: t("tooltips.useHorizontalTray")
					}
				>
					<button
						data-testid="launch-tray-layout-button"
						type="button"
						aria-label={
							isSmartTrayLayout
								? "智能托盘布局"
								: trayLayout === "horizontal"
									? t("tooltips.useVerticalTray")
									: t("tooltips.useHorizontalTray")
						}
						aria-pressed={isSmartTrayLayout || trayLayout === "vertical"}
						className={`${hudIconBtnClasses} ${isSmartTrayLayout ? "bg-white/10 ring-1 ring-white/15" : ""} ${styles.electronNoDrag}`}
						onClick={toggleTrayLayout}
					>
						{trayLayout === "horizontal" ? (
							<Columns3 size={ICON_SIZE} className="text-white/60" />
						) : (
							<Rows3 size={ICON_SIZE} className="text-white/60" />
						)}
					</button>
				</Tooltip>

				{/* Source selector */}
				<button
					data-testid="launch-source-selector-button"
					className={`${hudGroupClasses} h-8 ${trayLayout === "vertical" ? "w-8 justify-center px-0" : "px-2.5"} ${styles.electronNoDrag}`}
					onClick={openSourceSelector}
					disabled={recording}
					title={selectedSource}
					aria-label={selectedSource}
				>
					{getIcon("monitor", "text-white/80")}
					<span
						className={`${trayLayout === "vertical" ? "sr-only" : "max-w-[86px]"} truncate text-[11px] font-medium text-white/75`}
					>
						{selectedSource}
					</span>
				</button>

				{/* Audio controls group */}
				<div
					className={`${hudGroupClasses} ${trayLayout === "vertical" ? "flex-col py-1" : ""} ${styles.electronNoDrag}`}
				>
					<button
						ref={audioTriggerRef}
						data-testid="launch-audio-button"
						type="button"
						aria-label={t("audio.menu")}
						aria-expanded={isAudioMenuOpen}
						aria-haspopup="menu"
						className={`${hudIconBtnClasses} ${audioEnabled ? "drop-shadow-[0_0_4px_rgba(74,222,128,0.4)]" : ""}`}
						onClick={() => {
							setIsAudioMenuOpen((open) => !open);
							setIsLanguageMenuOpen(false);
							setIsWebcamMenuOpen(false);
						}}
						title={t("audio.menu")}
					>
						{audioEnabled
							? getIcon("volumeOn", "text-rose-400")
							: getIcon("volumeOff", "text-white/40")}
					</button>
					<button
						ref={webcamTriggerRef}
						data-testid="launch-webcam-button"
						type="button"
						aria-label={t("webcam.menu")}
						aria-expanded={isWebcamMenuOpen}
						aria-haspopup="menu"
						className={`${hudIconBtnClasses} ${webcamEnabled ? "drop-shadow-[0_0_4px_rgba(74,222,128,0.4)]" : ""}`}
						onClick={() => {
							setIsWebcamMenuOpen((open) => !open);
							setIsAudioMenuOpen(false);
							setIsLanguageMenuOpen(false);
						}}
						disabled={recording}
						title={t("webcam.menu")}
					>
						{webcamEnabled
							? getIcon("webcamOn", "text-rose-400")
							: getIcon("webcamOff", "text-white/40")}
					</button>
					{supportsCursorModeToggle && (
						<button
							data-testid="launch-cursor-mode-button"
							className={`${hudIconBtnClasses} ${
								cursorCaptureMode === "editable-overlay"
									? "drop-shadow-[0_0_4px_rgba(74,222,128,0.4)]"
									: ""
							}`}
							onClick={() =>
								!recording &&
								setCursorCaptureMode(
									cursorCaptureMode === "editable-overlay" ? "system" : "editable-overlay",
								)
							}
							disabled={recording}
							title={
								cursorCaptureMode === "editable-overlay"
									? t("cursor.useSystemCursor")
									: t("cursor.useEditableCursor")
							}
						>
							{getIcon(
								"cursor",
								cursorCaptureMode === "editable-overlay" ? "text-rose-400" : "text-white/40",
							)}
						</button>
					)}
				</div>

				{isWebcamMenuOpen
					? createPortal(
							<div
								ref={setWebcamMenuPanelEl}
								data-hud-interactive="true"
								role="menu"
								className={`${styles.languageMenuPanel} ${styles.electronNoDrag}`}
								style={
									{
										WebkitAppRegion: "no-drag",
										pointerEvents: "auto",
										left: `${webcamMenuStyle.left}px`,
										right: "auto",
										top: `${webcamMenuStyle.top}px`,
										bottom: "auto",
										maxHeight: `${webcamMenuStyle.maxHeight}px`,
										width: `${webcamMenuStyle.width}px`,
										height: webcamMenuTargetHeight ? `${webcamMenuTargetHeight}px` : undefined,
										overflow: "hidden",
									} as React.CSSProperties
								}
								onPointerDown={(event) => event.stopPropagation()}
								onPointerEnter={() => setHudMouseEventsEnabled(true)}
								onPointerMove={() => setHudMouseEventsEnabled(true)}
								onWheel={(event) => {
									setHudMouseEventsEnabled(true);
									event.stopPropagation();
								}}
							>
								<div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-white/85">
									<div className="flex min-w-0 items-center gap-2">
										<Video size={14} className="shrink-0 text-white/55" />
										<div className="min-w-0">
											<div className="text-[11px] font-semibold">{t("webcam.menu")}</div>
											<div className="truncate text-[10px] text-white/42">
												{webcamEnabled ? selectedCameraLabel : t("webcam.notRecordingWebcam")}
											</div>
										</div>
									</div>
									<Switch
										data-testid="launch-webcam-switch"
										checked={webcamEnabled}
										disabled={recording}
										onCheckedChange={(checked) => void toggleWebcamEnabled(checked)}
										aria-label={t("webcam.recordWebcam")}
									/>
								</div>

								<div className="mt-1 border-t border-white/10 pt-1">
									<button
										type="button"
										className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-white/75 transition-colors hover:bg-white/[0.055]"
										onClick={() => setIsWebcamDeviceListOpen((open) => !open)}
										disabled={recording}
										aria-expanded={isWebcamDeviceListOpen}
									>
										<div className="min-w-0">
											<div className="text-[10px] font-medium uppercase text-white/35">
												{t("webcam.cameraDevice")}
											</div>
											<div className="whitespace-normal break-words text-[11px] font-medium leading-snug">
												{selectedCameraLabel}
											</div>
										</div>
										<ChevronDown
											size={13}
											className={`shrink-0 text-white/45 transition-transform ${
												isWebcamDeviceListOpen ? "rotate-180" : ""
											}`}
										/>
									</button>
									{isWebcamDeviceListOpen ? (
										<div
											className={`${styles.languageMenuScroll} mt-1 grid pr-1`}
											style={{
												gridTemplateColumns: `repeat(${webcamDeviceMenuLayout.columnCount}, minmax(0, 1fr))`,
												gap: `${AUDIO_DEVICE_ROW_GAP}px`,
												maxHeight: `${webcamDeviceMenuLayout.listMaxHeight}px`,
											}}
										>
											{isCameraDevicesLoading ? (
												<div className="px-2 py-1.5 text-[11px] text-white/45">
													{t("webcam.searching")}
												</div>
											) : cameraDevicesError ? (
												<div className="px-2 py-1.5 text-[11px] text-white/45">
													{t("webcam.unavailable")}
												</div>
											) : cameraDevices.length > 0 ? (
												cameraDevices.map((device) => {
													const selected = device.deviceId === (webcamDeviceId || selectedCameraId);
													return (
														<button
															key={device.deviceId}
															type="button"
															role="menuitemradio"
															aria-checked={selected}
															disabled={recording}
															onClick={() => {
																selectCameraDevice(device.deviceId);
																setIsWebcamDeviceListOpen(false);
															}}
															className={`${styles.languageMenuItem} ${selected ? styles.languageMenuItemActive : ""}`}
															style={{ minHeight: `${AUDIO_DEVICE_ROW_HEIGHT}px` }}
															title={device.label}
														>
															<span className="min-w-0 flex-1 whitespace-normal break-words text-left leading-snug">
																{device.label}
															</span>
															{selected ? (
																<Check size={11} className="shrink-0 text-white/85" />
															) : null}
														</button>
													);
												})
											) : (
												<div className="px-2 py-1.5 text-[11px] text-white/45">
													{t("webcam.noneFound")}
												</div>
											)}
										</div>
									) : null}
								</div>
							</div>,
							document.body,
						)
					: null}

				{isAudioMenuOpen
					? createPortal(
							<div
								ref={setAudioMenuPanelEl}
								data-hud-interactive="true"
								role="menu"
								className={`${styles.languageMenuPanel} ${styles.electronNoDrag}`}
								style={
									{
										WebkitAppRegion: "no-drag",
										pointerEvents: "auto",
										left: `${audioMenuStyle.left}px`,
										right: "auto",
										top: `${audioMenuStyle.top}px`,
										bottom: "auto",
										maxHeight: `${audioMenuStyle.maxHeight}px`,
										width: `${audioMenuStyle.width}px`,
										height: audioMenuTargetHeight ? `${audioMenuTargetHeight}px` : undefined,
										overflow: "hidden",
									} as React.CSSProperties
								}
								onPointerDown={(event) => event.stopPropagation()}
								onPointerEnter={() => setHudMouseEventsEnabled(true)}
								onPointerMove={() => setHudMouseEventsEnabled(true)}
								onWheel={(event) => {
									setHudMouseEventsEnabled(true);
									event.stopPropagation();
								}}
							>
								<div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-white/80 hover:bg-white/[0.055]">
									<div className="flex min-w-0 items-center gap-2">
										<Volume2 size={14} className="shrink-0 text-white/55" />
										<span className="truncate text-[11px] font-medium">
											{t("audio.systemAudio")}
										</span>
									</div>
									<Switch
										data-testid="launch-system-audio-switch"
										checked={systemAudioEnabled}
										disabled={recording}
										onCheckedChange={setSystemAudioEnabled}
										aria-label={t("audio.systemAudio")}
									/>
								</div>
								<div className="mt-1 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-white/80 hover:bg-white/[0.055]">
									<div className="flex min-w-0 items-center gap-2">
										<Mic size={14} className="shrink-0 text-white/55" />
										<span className="truncate text-[11px] font-medium">
											{t("audio.microphone")}
										</span>
									</div>
									<Switch
										data-testid="launch-microphone-switch"
										checked={microphoneEnabled}
										disabled={recording}
										onCheckedChange={setMicrophoneEnabled}
										aria-label={t("audio.microphone")}
									/>
								</div>
								{microphoneEnabled ? (
									<div className="mt-1 border-t border-white/10 pt-1">
										<button
											type="button"
											className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-white/75 transition-colors hover:bg-white/[0.055]"
											onClick={() => setIsAudioDeviceListOpen((open) => !open)}
											aria-expanded={isAudioDeviceListOpen}
										>
											<div className="min-w-0">
												<div className="text-[10px] font-medium uppercase text-white/35">
													{t("audio.microphoneDevice")}
												</div>
												<div className="truncate text-[11px] font-medium">{selectedMicLabel}</div>
											</div>
											<ChevronDown
												size={13}
												className={`shrink-0 text-white/45 transition-transform ${
													isAudioDeviceListOpen ? "rotate-180" : ""
												}`}
											/>
										</button>
										{isAudioDeviceListOpen ? (
											<div
												className={`${styles.languageMenuScroll} mt-1 grid pr-1`}
												style={{
													gridTemplateColumns: `repeat(${audioDeviceMenuLayout.columnCount}, minmax(0, 1fr))`,
													gap: `${AUDIO_DEVICE_ROW_GAP}px`,
													maxHeight: `${audioDeviceMenuLayout.listMaxHeight}px`,
												}}
											>
												{micDevices.length > 0 ? (
													micDevices.map((device) => {
														const selected =
															device.deviceId === (microphoneDeviceId || selectedMicId);
														return (
															<button
																key={device.deviceId}
																type="button"
																role="menuitemradio"
																aria-checked={selected}
																onClick={() => {
																	selectMicrophoneDevice(device.deviceId);
																	setIsAudioDeviceListOpen(false);
																}}
																className={`${styles.languageMenuItem} ${selected ? styles.languageMenuItemActive : ""}`}
																style={{ minHeight: `${AUDIO_DEVICE_ROW_HEIGHT}px` }}
																title={device.label}
															>
																<span className="min-w-0 flex-1 whitespace-normal break-words text-left leading-snug">
																	{device.label}
																</span>
																{selected ? (
																	<Check size={11} className="shrink-0 text-white/85" />
																) : null}
															</button>
														);
													})
												) : (
													<div className="px-2 py-1.5 text-[11px] text-white/45">
														{t("audio.noMicrophones")}
													</div>
												)}
											</div>
										) : null}
										<div className="mt-1.5 px-2 pb-0.5">
											<AudioLevelMeter level={level} className="h-2 w-full" />
										</div>
									</div>
								) : null}
							</div>,
							document.body,
						)
					: null}

				{/* Record/Stop group */}
				<div
					className={`flex items-center ${
						trayLayout === "vertical" ? "flex-col gap-1" : "gap-1.5"
					} ${styles.electronNoDrag}`}
					style={{ flex: "0 0 auto" }}
				>
					<button
						data-testid="launch-record-button"
						className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-2 transition-[background-color] duration-150 ${
							recording
								? paused
									? "bg-amber-500/10 hover:bg-amber-500/15"
									: "bg-red-500/12 hover:bg-red-500/16"
								: "bg-white/[0.06] hover:bg-white/[0.10]"
						}`}
						onClick={toggleRecording}
					>
						{recording
							? getIcon("stop", paused ? "text-amber-400" : "text-red-400")
							: getIcon("record", "text-white/80")}
					</button>
					{recording && (
						<span
							className={`block shrink-0 rounded-full text-center text-xs font-semibold tabular-nums ${
								trayLayout === "vertical" ? "w-[38px]" : "w-[50px] bg-white/[0.045] px-1.5 py-1"
							} ${paused ? "text-amber-400" : "text-red-400"}`}
						>
							{formatTimePadded(elapsedSeconds)}
						</span>
					)}
				</div>

				{recording && (
					<div
						className={`flex items-center gap-0.5 ${trayLayout === "vertical" ? "flex-col" : ""} ${styles.electronNoDrag}`}
					>
						{canPauseRecording && (
							<Tooltip
								content={paused ? t("tooltips.resumeRecording") : t("tooltips.pauseRecording")}
							>
								<button className={hudAuxIconBtnClasses} onClick={togglePaused}>
									{getIcon(
										paused ? "resume" : "pause",
										paused ? "text-amber-400" : "text-white/60",
									)}
								</button>
							</Tooltip>
						)}
						<Tooltip content={t("tooltips.restartRecording")}>
							<button className={hudAuxIconBtnClasses} onClick={restartRecording}>
								{getIcon("restart", "text-white/60")}
							</button>
						</Tooltip>
						<Tooltip content={t("tooltips.cancelRecording")}>
							<button className={hudAuxIconBtnClasses} onClick={cancelRecording}>
								{getIcon("cancel", "text-white/60")}
							</button>
						</Tooltip>
					</div>
				)}

				{!recording && (
					<Tooltip content={recordingDirectoryTooltip}>
						<button
							data-testid="launch-recording-directory-button"
							type="button"
							aria-label={t("tooltips.chooseRecordingDirectory")}
							title={recordingDirectoryPath}
							className={`${hudIconBtnClasses} ${styles.electronNoDrag}`}
							onClick={pickRecordingDirectory}
						>
							{getIcon("folder", recordingDirectoryWritable ? "text-white/60" : "text-red-400")}
						</button>
					</Tooltip>
				)}
				{!recording && showOpenStudioShortcut && (
					<Tooltip content={t("tooltips.openStudio")}>
						<button
							data-testid="launch-open-studio-button"
							className={`${hudIconBtnClasses} ${styles.electronNoDrag}`}
							onClick={() => window.electronAPI.switchToEditor()}
						>
							<Clapperboard size={ICON_SIZE} className="text-white/60" />
						</button>
					</Tooltip>
				)}

				{/* Right sidebar controls */}
				<div
					className={`${trayLayout === "vertical" ? hudSidebarVerticalClasses : hudSidebarClasses} ${styles.electronNoDrag}`}
				>
					<div className={`${styles.languageMenuContainer} ${styles.electronNoDrag}`}>
						<button
							ref={languageTriggerRef}
							type="button"
							aria-label={t("language")}
							aria-expanded={isLanguageMenuOpen}
							aria-haspopup="menu"
							onClick={() => {
								setIsLanguageMenuOpen((open) => !open);
								setIsAudioMenuOpen(false);
								setIsWebcamMenuOpen(false);
							}}
							title={activeLanguageLabel}
							className={`flex h-8 items-center rounded-lg border border-white/10 bg-white/[0.045] text-white/85 shadow-none transition-colors hover:bg-white/10 ${
								trayLayout === "vertical" ? "w-8 justify-center px-0" : "gap-1.5 px-2"
							} ${styles.electronNoDrag}`}
						>
							<Languages size={13} className="text-white/70" />
							<span
								className={`${trayLayout === "vertical" ? "sr-only" : "max-w-[54px]"} truncate text-[10px] font-semibold text-white/75`}
							>
								{activeLanguageLabel}
							</span>
						</button>
					</div>

					<Tooltip content="设置">
						<button
							type="button"
							aria-label="设置"
							onClick={() => void window.electronAPI.openAppSettings()}
							className={`flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.045] text-white/70 shadow-none transition-colors hover:border-[#C24B72]/35 hover:bg-[#C24B72]/10 hover:text-white ${styles.electronNoDrag}`}
						>
							<Settings size={14} />
						</button>
					</Tooltip>

					{isLanguageMenuOpen
						? createPortal(
								<div
									ref={setLanguageMenuPanelEl}
									data-hud-interactive="true"
									role="menu"
									className={`${styles.languageMenuPanel} ${styles.languageMenuScroll} ${styles.electronNoDrag}`}
									style={
										{
											WebkitAppRegion: "no-drag",
											pointerEvents: "auto",
											left: `${languageMenuStyle.left}px`,
											right: "auto",
											top: `${languageMenuStyle.top}px`,
											bottom: "auto",
											maxHeight: `${languageMenuStyle.maxHeight}px`,
											width: `${languageMenuStyle.width}px`,
										} as React.CSSProperties
									}
									onPointerDown={(event) => event.stopPropagation()}
									onPointerEnter={() => setHudMouseEventsEnabled(true)}
									onPointerMove={() => setHudMouseEventsEnabled(true)}
									onWheel={(event) => {
										setHudMouseEventsEnabled(true);
										event.stopPropagation();
									}}
								>
									{availableLocales.map((loc) => (
										<button
											key={loc}
											type="button"
											role="menuitemradio"
											aria-checked={loc === locale}
											onClick={() => {
												setLocale(loc);
												resolveSystemLocaleSuggestion();
												setIsLanguageMenuOpen(false);
											}}
											className={`${styles.languageMenuItem} ${loc === locale ? styles.languageMenuItemActive : ""}`}
										>
											<span className="truncate">{getLocaleName(loc)}</span>
											{loc === locale ? <Check size={11} className="text-white/85" /> : null}
										</button>
									))}
								</div>,
								document.body,
							)
						: null}

					{/* Window controls */}
					<div
						className={`flex items-center gap-0.5 ${trayLayout === "vertical" ? "flex-col" : ""}`}
					>
						<button
							className={windowBtnClasses}
							title={t("tooltips.hideHUD")}
							onClick={sendHudOverlayHide}
						>
							{getIcon("minimize", "text-white")}
						</button>
						<button
							className={windowBtnClasses}
							title={t("tooltips.closeApp")}
							onClick={sendHudOverlayClose}
						>
							{getIcon("close", "text-white")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
