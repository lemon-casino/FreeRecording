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
import { useCallback, useEffect, useRef, useState } from "react";
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
import { requestCameraAccess } from "../../lib/requestCameraAccess";
import { formatTimePadded } from "../../utils/timeUtils";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { Switch } from "../ui/switch";
import { Tooltip } from "../ui/tooltip";
import styles from "./LaunchWindow.module.css";
import { openSourceSelectorWithPermissionRetry } from "./openSourceSelectorFlow";

const ICON_SIZE = 20;

// Vertical tray gap (px): bar's `bottom-5` (20px) plus an 8px gap.
const HUD_DEVICE_POPUP_GAP = 28;
// Horizontal layout: mirrors the `bottom-[68px]` class on the popup element.
const HUD_DEVICE_POPUP_HORIZONTAL_BOTTOM = 68;
const AUDIO_MENU_WIDTH = 224;
const AUDIO_MENU_MAX_HEIGHT = 240;

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
	const showWebcamControls = webcamEnabled && !recording;

	const [isWebcamHovered, setIsWebcamHovered] = useState(false);
	const [isWebcamFocused, setIsWebcamFocused] = useState(false);
	const webcamExpanded = isWebcamHovered || isWebcamFocused;
	const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
	const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);
	const [isAudioDeviceListOpen, setIsAudioDeviceListOpen] = useState(false);
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
	const languageTriggerRef = useRef<HTMLButtonElement | null>(null);
	const languageMenuPanelRef = useRef<HTMLDivElement | null>(null);
	const hudBarRef = useRef<HTMLDivElement | null>(null);
	const deviceSelectorRef = useRef<HTMLDivElement | null>(null);
	const isDraggingHudRef = useRef(false);
	// Measured bar height, anchors the popups above the tall vertical tray so they don't overlap it.
	const [hudBarHeight, setHudBarHeight] = useState(0);
	const [languageMenuStyle, setLanguageMenuStyle] = useState<{
		right: number;
		top: number;
		maxHeight: number;
	}>({
		right: 12,
		top: 12,
		maxHeight: 240,
	});
	const [audioMenuStyle, setAudioMenuStyle] = useState<{
		left: number;
		top: number;
		maxHeight: number;
	}>({
		left: 12,
		top: 12,
		maxHeight: AUDIO_MENU_MAX_HEIGHT,
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
	} = useCameraDevices(webcamEnabled);

	const audioEnabled = microphoneEnabled || systemAudioEnabled;
	const selectedMicDevice = micDevices.find(
		(device) => device.deviceId === (microphoneDeviceId || selectedMicId),
	);
	const selectedMicLabel = selectedMicDevice?.label || t("audio.defaultMicrophone");
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
		if (!import.meta.env.DEV) {
			return;
		}

		void requestCameraAccess().catch((error) => {
			console.warn("Failed to trigger camera access request during development:", error);
		});
	}, []);

	useEffect(() => {
		if (!isLanguageMenuOpen && !isAudioMenuOpen) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			const clickedLanguageTrigger = languageTriggerRef.current?.contains(target);
			const clickedLanguageMenu = languageMenuPanelRef.current?.contains(target);
			const clickedAudioTrigger = audioTriggerRef.current?.contains(target);
			const clickedAudioMenu = audioMenuPanelRef.current?.contains(target);

			if (isLanguageMenuOpen && !clickedLanguageTrigger && !clickedLanguageMenu) {
				setIsLanguageMenuOpen(false);
			}
			if (isAudioMenuOpen && !clickedAudioTrigger && !clickedAudioMenu) {
				setIsAudioMenuOpen(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsLanguageMenuOpen(false);
				setIsAudioMenuOpen(false);
			}
		};

		window.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleEscape);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleEscape);
		};
	}, [isLanguageMenuOpen, isAudioMenuOpen]);

	useEffect(() => {
		if (!isLanguageMenuOpen || !languageTriggerRef.current) return;

		const updatePosition = () => {
			if (!languageTriggerRef.current) return;
			const rect = languageTriggerRef.current.getBoundingClientRect();
			const gap = 8;
			const viewportPadding = 8;
			const availableHeight = Math.max(80, rect.top - viewportPadding - gap);
			const top = Math.max(viewportPadding, rect.top - gap - availableHeight);

			setLanguageMenuStyle({
				right: Math.max(viewportPadding, window.innerWidth - rect.right),
				top,
				maxHeight: availableHeight,
			});
		};

		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);

		return () => {
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [isLanguageMenuOpen]);

	useEffect(() => {
		if (!isAudioMenuOpen || !audioTriggerRef.current) return;

		const updatePosition = () => {
			if (!audioTriggerRef.current) return;
			const rect = audioTriggerRef.current.getBoundingClientRect();
			const gap = 8;
			const viewportPadding = 8;
			const availableAbove = rect.top - viewportPadding - gap;
			const availableBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
			const placeAbove = availableAbove >= 180 || availableAbove >= availableBelow;
			const availableHeight = Math.max(120, placeAbove ? availableAbove : availableBelow);
			const panelHeight = Math.min(AUDIO_MENU_MAX_HEIGHT, availableHeight);
			const centeredLeft = rect.left + rect.width / 2 - AUDIO_MENU_WIDTH / 2;
			const left = Math.min(
				Math.max(viewportPadding, centeredLeft),
				Math.max(viewportPadding, window.innerWidth - viewportPadding - AUDIO_MENU_WIDTH),
			);
			const top = placeAbove
				? Math.max(viewportPadding, rect.top - gap - panelHeight)
				: Math.min(window.innerHeight - viewportPadding - panelHeight, rect.bottom + gap);

			setAudioMenuStyle({
				left,
				top,
				maxHeight: panelHeight,
			});
		};

		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);

		return () => {
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [isAudioMenuOpen]);

	useEffect(() => {
		if (!isAudioMenuOpen || !microphoneEnabled) {
			setIsAudioDeviceListOpen(false);
		}
	}, [isAudioMenuOpen, microphoneEnabled]);

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
		const SIDE_MARGIN = 24;
		const TOP_MARGIN = 24;
		// Wide enough that the language menu (11rem) never clips, even when the bar is narrow.
		const MIN_WIDTH = 220;

		// Use natural (scroll) size, not the clipped box: vertical mode's max-h cap is a
		// small-screen fallback, and reading clipped height would pin the window to it.
		// scrollHeight gives full content height; the cap only engages when the main process clamps to screen.
		const barWidth = Math.ceil(barEl.scrollWidth);
		const barHeight = Math.ceil(barEl.scrollHeight);
		let contentWidth = barWidth;
		let contentHeight = hudEdge === "top" || hudEdge === "bottom" ? barHeight + 20 : barHeight;

		// Popups drive both dimensions too. Their vertical anchor depends on bar height,
		// which is fed back through React state and lags by a frame, so derive their top
		// edge from the bar's natural height instead of the stale rendered position. Keeps
		// one measurement pass authoritative and avoids a feedback re-measure.
		if (deviceSelectorRef.current) {
			const rect = deviceSelectorRef.current.getBoundingClientRect();
			if (rect.width !== 0 || rect.height !== 0) {
				contentWidth = Math.max(contentWidth, Math.ceil(rect.width));
				contentHeight =
					trayLayout === "vertical"
						? Math.max(contentHeight, barHeight + HUD_DEVICE_POPUP_GAP + Math.ceil(rect.height))
						: Math.max(contentHeight, HUD_DEVICE_POPUP_HORIZONTAL_BOTTOM + Math.ceil(rect.height));
			}
		}

		// The language menu scrolls within available height, so it only influences width.
		// Its presence in the DOM means it's open.
		if (languageMenuPanelRef.current) {
			const rect = languageMenuPanelRef.current.getBoundingClientRect();
			contentWidth = Math.max(contentWidth, Math.ceil(rect.width));
			contentHeight = Math.max(contentHeight, Math.ceil(rect.height));
		}
		if (audioMenuPanelRef.current) {
			const rect = audioMenuPanelRef.current.getBoundingClientRect();
			contentWidth = Math.max(contentWidth, Math.ceil(rect.width));
			contentHeight = Math.max(contentHeight, Math.ceil(rect.height));
		}

		setHudBarHeight((prev) => {
			const next = Math.round(barHeight);
			return Math.abs(prev - next) > 1 ? next : prev;
		});

		const width = Math.max(MIN_WIDTH, contentWidth + SIDE_MARGIN * 2);
		const height = contentHeight + TOP_MARGIN * 2;
		if (width === lastHudSizeRef.current.width && height === lastHudSizeRef.current.height) {
			return;
		}
		lastHudSizeRef.current = { width, height };
		window.electronAPI.setHudOverlaySize(width, height);
	}, [hudEdge, trayLayout]);

	// One persistent observer; elements wire themselves up via callback refs as they
	// mount/unmount so measurement re-runs without recreating it or threading mount state through deps.
	const hudResizeObserverRef = useRef<ResizeObserver | null>(null);
	useEffect(() => {
		const observer = new ResizeObserver(() => measureHudSize());
		hudResizeObserverRef.current = observer;
		if (hudBarRef.current) observer.observe(hudBarRef.current);
		if (deviceSelectorRef.current) observer.observe(deviceSelectorRef.current);
		if (audioMenuPanelRef.current) observer.observe(audioMenuPanelRef.current);
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
	const setDeviceSelectorEl = useCallback(
		(el: HTMLDivElement | null) => observeHudElement(el, deviceSelectorRef),
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
		setHudMouseEventsEnabled(isLanguageMenuOpen || isAudioMenuOpen);
	}, [isLanguageMenuOpen, isAudioMenuOpen, setHudMouseEventsEnabled]);

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
					Boolean(target?.closest("[data-hud-interactive='true']"));
				setHudMouseEventsEnabled(shouldCapture);
			}}
			onPointerLeave={() => {
				if (isDraggingHudRef.current) {
					return;
				}
				if (!isLanguageMenuOpen && !isAudioMenuOpen) {
					setHudMouseEventsEnabled(false);
				}
			}}
		>
			{/* Device selectors, fixed above HUD bar, viewport-relative, never clipped */}
			{showWebcamControls && (
				<div
					ref={setDeviceSelectorEl}
					data-hud-interactive="true"
					className={`fixed left-1/2 -translate-x-1/2 flex items-center gap-2 animate-mic-panel-in ${trayLayout === "vertical" ? "" : "bottom-[68px]"} ${styles.electronNoDrag}`}
					style={
						trayLayout === "vertical"
							? // Sit above the tall vertical tray, anchored to the measured bar
								// height. Matches the offset in measureHudSize.
								{ bottom: hudBarHeight + HUD_DEVICE_POPUP_GAP }
							: undefined
					}
				>
					{/* Webcam selector */}
					<div
						className={`flex h-9 items-center gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0c10]/90 px-3 py-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.24)] backdrop-blur-2xl transition-all duration-300 ${!webcamExpanded ? "opacity-60 grayscale-[0.5]" : "opacity-100"}`}
						onMouseEnter={() => setIsWebcamHovered(true)}
						onMouseLeave={() => setIsWebcamHovered(false)}
						onFocus={() => setIsWebcamFocused(true)}
						onBlur={() => setIsWebcamFocused(false)}
						style={{ width: webcamExpanded ? "240px" : "140px", transition: "width 300ms ease" }}
					>
						<div className="relative flex-1 min-w-0">
							{!webcamExpanded && (
								<div className="text-white/60 text-[10px] font-medium truncate">
									{selectedCameraLabel}
								</div>
							)}
							{webcamExpanded &&
								(isCameraDevicesLoading ? (
									<span className="text-white/40 text-[10px] italic">{t("webcam.searching")}</span>
								) : cameraDevicesError ? (
									<span className="text-white/40 text-[10px] italic">
										{t("webcam.unavailable")}
									</span>
								) : cameraDevices.length === 0 ? (
									<span className="text-white/40 text-[10px] italic">{t("webcam.noneFound")}</span>
								) : (
									<>
										<select
											value={webcamDeviceId || selectedCameraId}
											onChange={(e) => {
												const device = cameraDevices.find(
													(item) => item.deviceId === e.target.value,
												);
												setSelectedCameraId(e.target.value);
												setWebcamDeviceId(e.target.value);
												setWebcamDeviceName(device?.label);
											}}
											className="w-full appearance-none bg-white/5 text-white text-[11px] rounded-lg pl-2 pr-6 py-1 border border-white/10 outline-none hover:bg-white/10 transition-colors cursor-pointer"
										>
											{cameraDevices.map((device) => (
												<option
													key={device.deviceId}
													value={device.deviceId}
													className="bg-[#1c1c24]"
												>
													{device.label}
												</option>
											))}
										</select>
										<ChevronDown
											size={12}
											className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
										/>
									</>
								))}
							{(!webcamExpanded || cameraDevices.length === 0) && (
								<select
									value={webcamDeviceId || selectedCameraId}
									onChange={(e) => {
										const device = cameraDevices.find((item) => item.deviceId === e.target.value);
										setSelectedCameraId(e.target.value);
										setWebcamDeviceId(e.target.value);
										setWebcamDeviceName(device?.label);
									}}
									className="sr-only"
								>
									{cameraDevices.map((device) => (
										<option key={device.deviceId} value={device.deviceId}>
											{device.label}
										</option>
									))}
								</select>
							)}
						</div>
					</div>
				</div>
			)}

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
					if (!isLanguageMenuOpen && !isAudioMenuOpen) {
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
						}}
						title={t("audio.menu")}
					>
						{audioEnabled
							? getIcon("volumeOn", "text-rose-400")
							: getIcon("volumeOff", "text-white/40")}
					</button>
					<button
						data-testid="launch-webcam-button"
						className={`${hudIconBtnClasses} ${webcamEnabled ? "drop-shadow-[0_0_4px_rgba(74,222,128,0.4)]" : ""}`}
						onClick={async () => {
							await setWebcamEnabled(!webcamEnabled);
						}}
						disabled={recording}
						title={webcamEnabled ? t("webcam.disableWebcam") : t("webcam.enableWebcam")}
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

				{isAudioMenuOpen
					? createPortal(
							<div
								ref={setAudioMenuPanelEl}
								data-hud-interactive="true"
								role="menu"
								className={`${styles.languageMenuPanel} ${styles.languageMenuScroll} ${styles.electronNoDrag}`}
								style={
									{
										WebkitAppRegion: "no-drag",
										pointerEvents: "auto",
										left: `${audioMenuStyle.left}px`,
										right: "auto",
										top: `${audioMenuStyle.top}px`,
										maxHeight: `${audioMenuStyle.maxHeight}px`,
										width: `${AUDIO_MENU_WIDTH}px`,
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
											<div className="mt-1 max-h-28 overflow-y-auto pr-1">
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
															>
																<span className="truncate">{device.label}</span>
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
											right: `${languageMenuStyle.right}px`,
											top: `${languageMenuStyle.top}px`,
											maxHeight: `${languageMenuStyle.maxHeight}px`,
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
