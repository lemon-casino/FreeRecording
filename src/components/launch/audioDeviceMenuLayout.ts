const AUDIO_DEVICE_MENU_WIDTH = 380;
const AUDIO_DEVICE_MENU_COLUMN_WIDTH = 260;
const AUDIO_DEVICE_MENU_MAX_COLUMNS = 3;
const AUDIO_DEVICE_MENU_TARGET_ROWS = 6;
const AUDIO_DEVICE_MENU_CHROME_HEIGHT = 132;
export const AUDIO_DEVICE_ROW_HEIGHT = 52;
export const AUDIO_DEVICE_ROW_GAP = 4;
const AUDIO_DEVICE_LIST_MIN_HEIGHT = 72;

export interface AudioDeviceMenuLayout {
	columnCount: number;
	rowCount: number;
	menuWidth: number;
	listNaturalHeight: number;
	menuNaturalHeight: number;
	listMaxHeight: number;
}

function normalizeDeviceCount(deviceCount: number) {
	return Math.max(0, Math.floor(Number.isFinite(deviceCount) ? deviceCount : 0));
}

function getAudioDeviceColumnCount(deviceCount: number) {
	if (deviceCount <= 0) return 1;
	return Math.min(
		AUDIO_DEVICE_MENU_MAX_COLUMNS,
		Math.max(1, Math.ceil(deviceCount / AUDIO_DEVICE_MENU_TARGET_ROWS)),
	);
}

export function getAudioDeviceMenuLayout(
	deviceCount: number,
	maxPanelHeight?: number,
	chromeHeight = AUDIO_DEVICE_MENU_CHROME_HEIGHT,
): AudioDeviceMenuLayout {
	const normalizedDeviceCount = normalizeDeviceCount(deviceCount);
	const columnCount = getAudioDeviceColumnCount(normalizedDeviceCount);
	const rowCount = Math.max(1, Math.ceil(Math.max(1, normalizedDeviceCount) / columnCount));
	const listNaturalHeight =
		rowCount * AUDIO_DEVICE_ROW_HEIGHT + Math.max(0, rowCount - 1) * AUDIO_DEVICE_ROW_GAP;
	const menuWidth = Math.max(AUDIO_DEVICE_MENU_WIDTH, columnCount * AUDIO_DEVICE_MENU_COLUMN_WIDTH);
	const menuNaturalHeight = chromeHeight + listNaturalHeight;
	const listAvailableHeight =
		maxPanelHeight === undefined || !Number.isFinite(maxPanelHeight)
			? listNaturalHeight
			: Math.max(AUDIO_DEVICE_LIST_MIN_HEIGHT, maxPanelHeight - chromeHeight);

	return {
		columnCount,
		rowCount,
		menuWidth,
		listNaturalHeight,
		menuNaturalHeight,
		listMaxHeight: Math.min(listNaturalHeight, listAvailableHeight),
	};
}
