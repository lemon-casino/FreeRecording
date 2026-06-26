export function RecordingFrame() {
	return (
		<div className="pointer-events-none relative h-screen w-screen select-none overflow-hidden">
			<div className="absolute inset-0 border-2 border-[#ffd84d] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35),0_0_0_1px_rgba(0,0,0,0.42),0_0_18px_rgba(255,216,77,0.58)]" />
		</div>
	);
}
