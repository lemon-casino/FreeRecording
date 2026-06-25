import { Check, Crop } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import styles from "./SourceSelector.module.css";

interface DesktopSource {
	id: string;
	sourceId?: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	bounds?: CaptureBounds;
}

interface CaptureBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface NormalizedRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

type SourceTab = "screens" | "windows" | "custom";

const DEFAULT_CUSTOM_REGION: NormalizedRegion = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
const MIN_CUSTOM_REGION_SIZE = 0.08;

function clamp(value: number, min = 0, max = 1) {
	return Math.min(max, Math.max(min, value));
}

function regionFromPoints(start: { x: number; y: number }, end: { x: number; y: number }) {
	const left = clamp(Math.min(start.x, end.x));
	const top = clamp(Math.min(start.y, end.y));
	const right = clamp(Math.max(start.x, end.x));
	const bottom = clamp(Math.max(start.y, end.y));
	return fitNormalizedRegion({
		x: left,
		y: top,
		width: Math.max(MIN_CUSTOM_REGION_SIZE, right - left),
		height: Math.max(MIN_CUSTOM_REGION_SIZE, bottom - top),
	});
}

function normalizedPointFromPointer(event: ReactPointerEvent<HTMLElement>) {
	const rect = event.currentTarget.getBoundingClientRect();
	return {
		x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)),
		y: clamp((event.clientY - rect.top) / Math.max(1, rect.height)),
	};
}

function boundsFromNormalizedRegion(screenBounds: CaptureBounds, region: NormalizedRegion) {
	const fittedRegion = fitNormalizedRegion(region);
	const x = Math.round(screenBounds.x + screenBounds.width * fittedRegion.x);
	const y = Math.round(screenBounds.y + screenBounds.height * fittedRegion.y);
	const maxWidth = Math.max(2, screenBounds.x + screenBounds.width - x);
	const maxHeight = Math.max(2, screenBounds.y + screenBounds.height - y);
	const width = Math.min(
		maxWidth,
		Math.max(2, Math.round(screenBounds.width * fittedRegion.width)),
	);
	const height = Math.min(
		maxHeight,
		Math.max(2, Math.round(screenBounds.height * fittedRegion.height)),
	);
	return { x, y, width, height };
}

function areCaptureBoundsEqual(left?: CaptureBounds, right?: CaptureBounds) {
	if (!left || !right) {
		return left === right;
	}
	return (
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height
	);
}

function areDesktopSourcesEqual(left: DesktopSource | null, right: DesktopSource | null) {
	if (!left || !right) {
		return left === right;
	}
	return (
		left.id === right.id &&
		left.sourceId === right.sourceId &&
		left.name === right.name &&
		left.thumbnail === right.thumbnail &&
		left.display_id === right.display_id &&
		left.appIcon === right.appIcon &&
		areCaptureBoundsEqual(left.bounds, right.bounds)
	);
}

function fitNormalizedRegion(region: NormalizedRegion): NormalizedRegion {
	const width = clamp(region.width, MIN_CUSTOM_REGION_SIZE, 1);
	const height = clamp(region.height, MIN_CUSTOM_REGION_SIZE, 1);
	return {
		x: clamp(region.x, 0, 1 - width),
		y: clamp(region.y, 0, 1 - height),
		width,
		height,
	};
}

export function SourceSelector() {
	const t = useScopedT("launch");
	const tc = useScopedT("common");
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
	const [activeTab, setActiveTab] = useState<SourceTab>("screens");
	const [customScreenId, setCustomScreenId] = useState<string | null>(null);
	const [customRegion, setCustomRegion] = useState<NormalizedRegion>(DEFAULT_CUSTOM_REGION);
	const [loading, setLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);
	const customDragStartRef = useRef<{ x: number; y: number } | null>(null);

	const fetchSources = useCallback(async () => {
		setLoading(true);
		setLoadFailed(false);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 320, height: 180 },
				fetchWindowIcons: true,
			});
			const mappedSources = rawSources.map((source) => ({
				id: source.id,
				name:
					source.id.startsWith("window:") && source.name.includes(" — ")
						? source.name.split(" — ")[1] || source.name
						: source.name,
				thumbnail: source.thumbnail,
				display_id: source.display_id,
				appIcon: source.appIcon,
				bounds: source.bounds,
			}));
			setSources(mappedSources);
			setSelectedSource((current) =>
				current && rawSources.some((source) => source.id === current.id)
					? current
					: (mappedSources[0] ?? null),
			);
		} catch (error) {
			console.error("Error loading sources:", error);
			setSources([]);
			setSelectedSource(null);
			setLoadFailed(true);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchSources();
	}, [fetchSources]);

	const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
	const windowSources = sources.filter((s) => s.id.startsWith("window:"));
	const hasNoSources = !loading && sources.length === 0;
	const customScreen =
		screenSources.find((source) => source.id === customScreenId) ?? screenSources[0] ?? null;

	useEffect(() => {
		if (
			!loading &&
			activeTab === "screens" &&
			screenSources.length === 0 &&
			windowSources.length > 0
		) {
			setActiveTab("windows");
		}
	}, [activeTab, loading, screenSources.length, windowSources.length]);

	useEffect(() => {
		if (!customScreen && customScreenId) {
			setCustomScreenId(null);
			return;
		}
		if (!customScreenId && customScreen) {
			setCustomScreenId(customScreen.id);
		}
	}, [customScreen, customScreenId]);

	const handleSourceSelect = (source: DesktopSource) => setSelectedSource(source);
	const createCustomSource = useCallback(
		(screenSource: DesktopSource | null, region: NormalizedRegion): DesktopSource | null => {
			if (!screenSource?.bounds) {
				return null;
			}
			const bounds = boundsFromNormalizedRegion(screenSource.bounds, region);
			return {
				id: `custom:${screenSource.display_id}:${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`,
				sourceId: screenSource.id,
				name: `${t("sourceSelector.customRegion")} - ${screenSource.name}`,
				thumbnail: screenSource.thumbnail,
				display_id: screenSource.display_id,
				appIcon: null,
				bounds,
			};
		},
		[t],
	);

	useEffect(() => {
		if (activeTab !== "custom") {
			return;
		}
		const nextSource = createCustomSource(customScreen, customRegion);
		setSelectedSource((current) =>
			areDesktopSourcesEqual(current, nextSource) ? current : nextSource,
		);
	}, [activeTab, createCustomSource, customRegion, customScreen]);

	const handleRecord = async () => {
		if (selectedSource) await window.electronAPI.selectSource(selectedSource);
	};

	const handleTabChange = (value: string) => {
		const nextTab = value as SourceTab;
		setActiveTab(nextTab);
		if (nextTab === "custom") {
			const nextSource = createCustomSource(customScreen, customRegion);
			setSelectedSource((current) =>
				areDesktopSourcesEqual(current, nextSource) ? current : nextSource,
			);
		}
	};

	const handleCustomScreenSelect = (source: DesktopSource) => {
		setCustomScreenId(source.id);
		setCustomRegion(DEFAULT_CUSTOM_REGION);
		setSelectedSource(createCustomSource(source, DEFAULT_CUSTOM_REGION));
	};

	const handleCustomRegionPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!customScreen?.bounds) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		const point = normalizedPointFromPointer(event);
		customDragStartRef.current = point;
		const nextRegion = regionFromPoints(point, point);
		setCustomRegion(nextRegion);
		setSelectedSource(createCustomSource(customScreen, nextRegion));
	};

	const handleCustomRegionPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!customScreen?.bounds || !customDragStartRef.current) return;
		event.preventDefault();
		const nextRegion = regionFromPoints(
			customDragStartRef.current,
			normalizedPointFromPointer(event),
		);
		setCustomRegion(nextRegion);
		setSelectedSource(createCustomSource(customScreen, nextRegion));
	};

	const handleCustomRegionPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
		customDragStartRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	if (loading) {
		return (
			<div
				className={`h-full flex items-center justify-center ${styles.glassContainer}`}
				style={{ minHeight: "100vh" }}
			>
				<div className="text-center">
					<div className="animate-spin duration-500 rounded-[50%] h-6 w-6 border-2 border-b-transparent border-[#C24B72] mx-auto mb-2" />
					<p className="text-xs text-zinc-400">{t("sourceSelector.loading")}</p>
				</div>
			</div>
		);
	}

	if (hasNoSources) {
		return (
			<div
				className={`h-full flex items-center justify-center ${styles.glassContainer}`}
				style={{ minHeight: "100vh" }}
			>
				<div className="max-w-[320px] px-6 text-center">
					<h2 className="text-sm font-semibold text-white">{t("sourceSelector.emptyTitle")}</h2>
					<p className="mt-2 text-xs leading-5 text-zinc-400">
						{loadFailed
							? t("sourceSelector.loadFailedDescription")
							: t("sourceSelector.emptyDescription")}
					</p>
					<Button
						onClick={() => void fetchSources()}
						className="mt-4 h-8 rounded-lg bg-[#C24B72] px-5 text-[11px] font-semibold text-white transition-transform duration-150 hover:bg-[#C24B72]/85 active:scale-95"
					>
						{tc("actions.reload")}
					</Button>
				</div>
			</div>
		);
	}

	const renderSourceCard = (source: DesktopSource) => {
		const isSelected = selectedSource?.id === source.id;
		const sourceKind = source.id.startsWith("screen:") ? "screen" : "window";
		return (
			<div
				key={source.id}
				data-testid="source-selector-card"
				data-source-kind={sourceKind}
				className={`${styles.sourceCard} ${isSelected ? styles.selected : ""} p-1.5`}
				onClick={() => handleSourceSelect(source)}
			>
				<div className="relative mb-1.5 overflow-hidden rounded-lg border border-white/[0.06] bg-black/30">
					<img
						src={source.thumbnail || ""}
						alt={source.name}
						className="w-full aspect-video object-cover"
					/>
					{isSelected && (
						<div className="absolute right-1.5 top-1.5">
							<div className={styles.checkBadge}>
								<Check size={11} className="text-white" />
							</div>
						</div>
					)}
				</div>
				<div className="flex items-center gap-1.5 px-1 pb-0.5">
					{source.appIcon && (
						<img src={source.appIcon} alt="" className={`${styles.icon} flex-shrink-0`} />
					)}
					<div className={`${styles.name} truncate`}>{source.name}</div>
				</div>
			</div>
		);
	};

	return (
		<div className={`min-h-screen flex flex-col ${styles.glassContainer}`}>
			<div className="flex-1 flex flex-col w-full px-3.5 pt-3.5">
				<Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col">
					<TabsList className="mb-3 grid h-8 grid-cols-3 rounded-xl border border-white/[0.06] bg-white/[0.04] p-0.5">
						<TabsTrigger
							value="screens"
							onClick={() => handleTabChange("screens")}
							className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
						>
							{t("sourceSelector.screens", { count: String(screenSources.length) })}
						</TabsTrigger>
						<TabsTrigger
							value="windows"
							onClick={() => handleTabChange("windows")}
							className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
						>
							{t("sourceSelector.windows", { count: String(windowSources.length) })}
						</TabsTrigger>
						<TabsTrigger
							value="custom"
							onClick={() => handleTabChange("custom")}
							className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
						>
							{t("sourceSelector.customRegion")}
						</TabsTrigger>
					</TabsList>
					<div className="flex-1 min-h-0">
						<TabsContent value="screens" className="h-full mt-0">
							<div
								className={`grid h-[282px] auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto pr-1.5 pt-1 ${styles.sourceGridScroll}`}
							>
								{screenSources.map(renderSourceCard)}
							</div>
						</TabsContent>
						<TabsContent value="windows" className="h-full mt-0">
							<div
								className={`grid h-[282px] auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto pr-1.5 pt-1 ${styles.sourceGridScroll}`}
							>
								{windowSources.map(renderSourceCard)}
							</div>
						</TabsContent>
						<TabsContent value="custom" className="h-full mt-0">
							<div className="grid h-[282px] grid-cols-[150px_minmax(0,1fr)] gap-3 pt-1">
								<div className={`min-h-0 overflow-y-auto pr-1 ${styles.sourceGridScroll}`}>
									<div className="grid gap-2">
										{screenSources.map((source) => {
											const selected = customScreen?.id === source.id;
											return (
												<button
													key={source.id}
													type="button"
													onClick={() => handleCustomScreenSelect(source)}
													className={`rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors ${
														selected
															? "border-[#C24B72]/60 bg-[#C24B72]/15 text-white"
															: "border-white/[0.07] bg-white/[0.045] text-zinc-300 hover:bg-white/[0.07]"
													}`}
												>
													{source.name}
												</button>
											);
										})}
									</div>
								</div>
								<div className="min-w-0">
									{customScreen ? (
										<div
											className={`${styles.customPreview} relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/35`}
											onPointerDown={handleCustomRegionPointerDown}
											onPointerMove={handleCustomRegionPointerMove}
											onPointerUp={handleCustomRegionPointerEnd}
											onPointerCancel={handleCustomRegionPointerEnd}
										>
											<img
												src={customScreen.thumbnail || ""}
												alt={customScreen.name}
												className="h-full w-full select-none object-cover"
												draggable={false}
											/>
											<div className={styles.customRegionScrim} />
											<div
												className={styles.customRegionBox}
												style={{
													left: `${customRegion.x * 100}%`,
													top: `${customRegion.y * 100}%`,
													width: `${customRegion.width * 100}%`,
													height: `${customRegion.height * 100}%`,
												}}
											>
												<Crop size={14} className="text-white" />
											</div>
										</div>
									) : (
										<div className="flex h-full items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-[11px] text-zinc-500">
											{t("sourceSelector.noScreens")}
										</div>
									)}
								</div>
							</div>
						</TabsContent>
					</div>
				</Tabs>
			</div>
			<div className="flex justify-center gap-2 border-t border-white/[0.06] p-3">
				<Button
					data-testid="source-selector-cancel-button"
					variant="ghost"
					onClick={() => window.close()}
					className="h-8 rounded-lg px-5 text-[11px] text-zinc-400 transition-transform duration-150 hover:bg-white/5 hover:text-white active:scale-95"
				>
					{tc("actions.cancel")}
				</Button>
				<Button
					data-testid="source-selector-record-button"
					onClick={handleRecord}
					disabled={!selectedSource}
					className="h-8 rounded-lg bg-[#C24B72] px-5 text-[11px] font-semibold text-white transition-transform duration-150 hover:bg-[#C24B72]/85 active:scale-95 disabled:bg-zinc-700 disabled:opacity-30"
				>
					{tc("actions.record")}
				</Button>
			</div>
		</div>
	);
}
