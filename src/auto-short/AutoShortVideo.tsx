import {useMemo} from 'react';
import {
	AbsoluteFill,
	Img,
	OffthreadVideo,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';

import type {
	AutoShortCaptionCue,
	AutoShortCaptionWord,
	AutoShortIconMoment,
	AutoShortOverlay,
	AutoShortPalette,
	AutoShortPlan,
	AutoShortSegment,
} from './types';

type AutoShortVideoProps = {
	plan: AutoShortPlan;
};

const secToFrame = (sec: number, fps: number): number => Math.round(sec * fps);

const getActiveItem = <T extends {startSec: number; endSec: number}>(
	items: T[],
	frame: number,
	fps: number,
): T | null => {
	const currentSec = frame / fps;
	for (const item of items) {
		if (currentSec >= item.startSec && currentSec < item.endSec) {
			return item;
		}
	}

	return null;
};

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const normalizeText = (value: string): string =>
	value
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();

const getShortsSafeInsets = (width: number, height: number) => ({
	top: Math.round(height * 0.08),
	right: Math.round(width * 0.14),
	bottom: Math.round(height * 0.2),
	left: Math.round(width * 0.06),
});

type TopWordStyle = {
	fontFamily: string;
	fontWeight: number;
	letterSpacing: string;
	textTransform: 'uppercase' | 'none';
	fillGradient: string;
	stroke: string;
	glow: string;
	accent: string;
};

const splitCaptionIntoOneLinePages = (text: string, maxChars: number): string[] => {
	const words = text
		.toUpperCase()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) {
		return [];
	}

	const safeMax = Math.max(12, maxChars);
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		const next = current.length === 0 ? word : `${current} ${word}`;
		if (next.length <= safeMax) {
			current = next;
			continue;
		}

		if (current.length > 0) {
			lines.push(current);
		}

		if (word.length > safeMax) {
			lines.push(word);
			current = '';
		} else {
			current = word;
		}
	}

	if (current.length > 0) {
		lines.push(current);
	}

	return lines.slice(0, 8);
};

type OneLineWordPage = {
	startSec: number;
	endSec: number;
	words: AutoShortCaptionWord[];
	text: string;
};

const buildOneLineWordPages = (words: AutoShortCaptionWord[], maxChars: number): OneLineWordPage[] => {
	const safeMax = Math.max(10, maxChars);
	const sorted = [...words]
		.filter((word) => Number.isFinite(word.startSec) && Number.isFinite(word.endSec))
		.filter((word) => word.endSec > word.startSec)
		.map((word) => ({
			startSec: word.startSec,
			endSec: word.endSec,
			text: word.text.replace(/\s+/g, ' ').trim(),
		}))
		.filter((word) => word.text.length > 0)
		.sort((a, b) => a.startSec - b.startSec);

	const pages: OneLineWordPage[] = [];
	let currentWords: AutoShortCaptionWord[] = [];
	let currentChars = 0;

	const pushCurrent = () => {
		if (currentWords.length === 0) return;
		pages.push({
			startSec: currentWords[0].startSec,
			endSec: currentWords[currentWords.length - 1].endSec,
			words: currentWords,
			text: currentWords.map((word) => word.text).join(' '),
		});
		currentWords = [];
		currentChars = 0;
	};

	for (const word of sorted) {
		if (currentWords.length === 0) {
			currentWords.push(word);
			currentChars = word.text.length;
			continue;
		}

		const projectedChars = currentChars + 1 + word.text.length;
		if (projectedChars > safeMax) {
			pushCurrent();
			currentWords.push(word);
			currentChars = word.text.length;
			continue;
		}

		currentWords.push(word);
		currentChars = projectedChars;
	}

	pushCurrent();
	return pages;
};

const getTopBannerStyle = (text: string, palette: AutoShortPalette) => {
	const normalized = normalizeText(text);
	if (/(^|\s)open\s*claw(\s|$)|(^|\s)openclaw(\s|$)/.test(normalized)) {
		return {
			fontFamily:
				'"Orbitron", "Eurostile", "Bank Gothic", "Avenir Next Condensed", "Impact", sans-serif',
			fontWeight: 800,
			letterSpacing: '0.03em',
			textTransform: 'uppercase' as const,
			fillGradient: 'linear-gradient(135deg, #22d3ee 0%, #f0f9ff 44%, #38bdf8 100%)',
			stroke: '#06243a',
			glow: '0 0 34px rgba(34,211,238,0.6), 0 8px 30px rgba(0,0,0,0.4)',
			accent: '#22d3ee',
		} satisfies TopWordStyle;
	}

	if (/(^|\s)ai automation(\s|$)/.test(normalized)) {
		return {
			fontFamily:
				'"Bebas Neue", "Anton", "Impact", "Arial Black", "Avenir Next Condensed", sans-serif',
			fontWeight: 800,
			letterSpacing: '0.025em',
			textTransform: 'uppercase' as const,
			fillGradient: `linear-gradient(140deg, ${palette.accent} 0%, #f8fafc 44%, #a855f7 100%)`,
			stroke: '#200d31',
			glow: '0 0 30px rgba(251,113,133,0.55), 0 8px 28px rgba(0,0,0,0.45)',
			accent: palette.accent,
		} satisfies TopWordStyle;
	}

	return {
		fontFamily: '"Poppins", "Avenir Next", sans-serif',
		fontWeight: 700,
		letterSpacing: '-0.02em',
		textTransform: 'none' as const,
		fillGradient: 'linear-gradient(140deg, #f8fafc 0%, #fde68a 55%, #fb7185 100%)',
		stroke: '#111827',
		glow: '0 0 24px rgba(251,113,133,0.35), 0 6px 20px rgba(0,0,0,0.4)',
		accent: palette.accentMuted,
	} satisfies TopWordStyle;
};

const FloatingLayer: React.FC<{
	frame: number;
	images: string[];
	palette: AutoShortPalette;
}> = ({frame, images, palette}) => {
	const fallbackDots = [0, 1, 2];
	const dotColor = [palette.accent, palette.accentMuted, '#ffffff'];
	const positions = [
		{left: '9%', top: '12%'},
		{left: '70%', top: '17%'},
		{left: '17%', top: '36%'},
	];

	if (images.length === 0) {
		return (
			<>
				{fallbackDots.map((idx) => {
					const driftY = Math.sin((frame + idx * 25) / 20) * 18;
					const driftX = Math.sin((frame + idx * 13) / 36) * 12;
					return (
						<div
							key={`dot-${idx}`}
							style={{
								position: 'absolute',
								width: 120 - idx * 18,
								height: 120 - idx * 18,
								borderRadius: 999,
								background: dotColor[idx],
								opacity: 0.18,
								left: positions[idx].left,
								top: positions[idx].top,
								transform: `translate(${driftX}px, ${driftY}px)`,
								filter: 'blur(0.3px)',
							}}
						/>
					);
				})}
			</>
		);
	}

	return (
		<>
			{images.slice(0, 3).map((img, idx) => {
				const floatY = Math.sin((frame + idx * 17) / 16) * 16;
				const floatX = Math.sin((frame + idx * 21) / 33) * 10;
				const rotate = Math.sin((frame + idx * 33) / 42) * 8;
				return (
					<Img
						key={`${img}-${idx}`}
						src={staticFile(img)}
						style={{
							position: 'absolute',
							width: idx === 0 ? 250 : 210,
							height: idx === 0 ? 250 : 210,
							borderRadius: 28,
							objectFit: 'cover',
							left: positions[idx].left,
							top: positions[idx].top,
							transform: `translate(${floatX}px, ${floatY}px) rotate(${rotate}deg)`,
							boxShadow: '0 30px 70px rgba(0, 0, 0, 0.35)',
							border: '3px solid rgba(255,255,255,0.25)',
						}}
					/>
				);
			})}
		</>
	);
};

const CutawayOverlay: React.FC<{
	segment: AutoShortSegment;
	frame: number;
	fps: number;
	images: string[];
	palette: AutoShortPalette;
	backgroundCard?: string;
}> = ({segment, frame, fps, images, palette, backgroundCard}) => {
	const {width, height} = useVideoConfig();
	const safeInsets = getShortsSafeInsets(width, height);
	const start = secToFrame(segment.startSec, fps);
	const end = secToFrame(segment.endSec, fps);
	const fadeFrames = Math.min(12, Math.max(8, Math.floor((end - start) * 0.2)));
	const opacity = interpolate(
		frame,
		[start, start + fadeFrames, end - fadeFrames, end],
		[0, 1, 1, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);
	const entry = spring({
		fps,
		frame: frame - start,
		config: {damping: 16, stiffness: 120, mass: 0.75},
		durationInFrames: 24,
	});
	const cardY = interpolate(entry, [0, 1], [95, 0]);
	const localFrame = Math.max(0, frame - start);
	const jiggle = spring({
		fps,
		frame: localFrame,
		config: {damping: 17, stiffness: 120, mass: 0.85},
		durationInFrames: 32,
	});
	const jiggleX = Math.sin(localFrame / 18) * 5 * jiggle;
	const jiggleY = Math.sin(localFrame / 24) * 4 * jiggle;
	const jiggleRotate = Math.sin(localFrame / 34) * 1.2 * jiggle;
	const points = (segment.points ?? []).slice(0, 3);

	return (
		<AbsoluteFill style={{opacity, pointerEvents: 'none'}}>
			<AbsoluteFill
				style={{
					overflow: 'hidden',
				}}
			>
				{backgroundCard ? (
					<Img
						src={staticFile(backgroundCard)}
						style={{
							position: 'absolute',
							inset: '-5%',
							width: '110%',
							height: '110%',
							objectFit: 'cover',
							transform: `translate(${jiggleX}px, ${jiggleY}px) rotate(${jiggleRotate}deg) scale(1.03)`,
						}}
					/>
				) : (
					<AbsoluteFill
						style={{
							background: `linear-gradient(145deg, ${palette.backgroundA} 0%, ${palette.backgroundB} 100%)`,
						}}
					/>
				)}
				<AbsoluteFill
					style={{
						background:
							'linear-gradient(180deg, rgba(2,6,23,0.5) 0%, rgba(2,6,23,0.58) 60%, rgba(2,6,23,0.66) 100%)',
					}}
				/>
				<div style={{opacity: 0.78}}>
					<FloatingLayer frame={frame - start} images={images} palette={palette} />
				</div>
				<div
					style={{
						position: 'absolute',
						inset: 0,
						background:
							'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.16), transparent 52%)',
					}}
				/>
			</AbsoluteFill>
			<AbsoluteFill
				style={{
					justifyContent: 'flex-start',
					alignItems: 'center',
					paddingTop: safeInsets.top + 90,
					paddingRight: safeInsets.right + 24,
					paddingBottom: safeInsets.bottom,
					paddingLeft: safeInsets.left + 24,
					transform: `translateY(${cardY}px)`,
				}}
			>
				<div
					style={{
						width: '100%',
						background: 'rgba(6, 10, 21, 0.64)',
						border: '2px solid rgba(255,255,255,0.2)',
						borderRadius: 34,
						padding: '56px 50px',
						backdropFilter: 'blur(8px)',
						boxShadow: '0 35px 80px rgba(0, 0, 0, 0.45)',
					}}
				>
					<div
						style={{
							fontSize: 74,
							fontWeight: 800,
							lineHeight: 1.05,
							letterSpacing: '-0.03em',
							color: palette.textPrimary,
							fontFamily: '"Poppins", "Avenir Next", sans-serif',
							textTransform: 'uppercase',
						}}
					>
						{segment.headline ?? 'Key Idea'}
					</div>
					{segment.supportingText ? (
						<div
							style={{
								marginTop: 18,
								fontSize: 40,
								lineHeight: 1.2,
								color: 'rgba(248,250,252,0.86)',
								fontFamily: '"Poppins", "Avenir Next", sans-serif',
							}}
						>
							{segment.supportingText}
						</div>
					) : null}
					{points.length > 0 ? (
						<div style={{marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12}}>
							{points.map((point, idx) => {
								const revealFrame = start + 8 + idx * 8;
								const reveal = interpolate(
									frame,
									[revealFrame, revealFrame + 8],
									[0, 1],
									{
										extrapolateLeft: 'clamp',
										extrapolateRight: 'clamp',
									},
								);
								const revealY = interpolate(
									frame,
									[revealFrame, revealFrame + 8],
									[26, 0],
									{
										extrapolateLeft: 'clamp',
										extrapolateRight: 'clamp',
									},
								);
								return (
									<div
										key={`${point.title}-${idx}`}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: 14,
											opacity: reveal,
											transform: `translateY(${revealY}px)`,
										}}
									>
										<div
											style={{
												width: 12,
												height: 12,
												background: palette.accent,
												borderRadius: 999,
												boxShadow: `0 0 24px ${palette.accent}`,
											}}
										/>
										<div
											style={{
												fontSize: 36,
												fontWeight: 600,
												fontFamily: '"Poppins", "Avenir Next", sans-serif',
												color: palette.textPrimary,
											}}
										>
											{point.title}
										</div>
									</div>
								);
							})}
						</div>
					) : null}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const TopBanner: React.FC<{
	overlay: AutoShortOverlay;
	frame: number;
	fps: number;
	palette: AutoShortPalette;
}> = ({overlay, frame, fps, palette}) => {
	const {width, height} = useVideoConfig();
	const safeInsets = getShortsSafeInsets(width, height);
	const bannerStyle = getTopBannerStyle(overlay.text, palette);
	const start = secToFrame(overlay.startSec, fps);
	const end = secToFrame(overlay.endSec, fps);
	const words = overlay.text
		.toUpperCase()
		.split(/\s+/)
		.filter(Boolean);
	const textLength = overlay.text.length;
	const baseFontSize = textLength <= 8 ? 122 : textLength <= 12 ? 112 : textLength <= 18 ? 96 : 84;
	const opacity = interpolate(
		frame,
		[start, start + 6, end - 6, end],
		[0, 1, 1, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);
	const slideY = interpolate(frame, [start, start + 10], [-124, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const fadeStretch = interpolate(
		frame,
		[start, start + 8, end - 10, end],
		[0.2, 1, 1, 0.65],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);
	const pop = spring({
		fps,
		frame: frame - start,
		config: {damping: 12, stiffness: 150, mass: 0.72},
		durationInFrames: 22,
	});
	const scale = interpolate(pop, [0, 1], [0.7, 1]);
	const jiggleX = Math.sin((frame - start) / 14) * 8;

	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			<div
				style={{
					position: 'absolute',
					top: safeInsets.top - 10,
					left: safeInsets.left + 8,
					right: safeInsets.right + 8,
					display: 'flex',
					justifyContent: 'center',
					opacity: opacity * fadeStretch,
					transform: `translate(${jiggleX}px, ${slideY}px) scale(${scale})`,
				}}
			>
				<div
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						gap: '4px 18px',
						justifyContent: 'center',
						alignItems: 'center',
						maxWidth: width - safeInsets.left - safeInsets.right - 20,
					}}
				>
					{words.map((word, idx) => {
						const wordPop = spring({
							fps,
							frame: frame - (start + idx * 2),
							config: {damping: 10, stiffness: 180, mass: 0.62},
							durationInFrames: 16,
						});
						const wordScale = interpolate(wordPop, [0, 1], [0.6, 1]);
						const bob = Math.sin((frame + idx * 9) / 12) * 6;
						const tilt = Math.sin((frame + idx * 11) / 16) * 3;
						return (
							<span
								key={`${overlay.text}-${idx}-${word}`}
								style={{
									fontSize: baseFontSize,
									fontWeight: bannerStyle.fontWeight,
									lineHeight: 0.95,
									letterSpacing: bannerStyle.letterSpacing,
									fontFamily: bannerStyle.fontFamily,
									textTransform: bannerStyle.textTransform,
									backgroundImage: bannerStyle.fillGradient,
									backgroundSize: '180% 180%',
									backgroundPosition: `${(frame * 2 + idx * 24) % 160}% 50%`,
									WebkitBackgroundClip: 'text',
									WebkitTextFillColor: 'transparent',
									WebkitTextStroke: `2.6px ${bannerStyle.stroke}`,
									textShadow: bannerStyle.glow,
									filter: `drop-shadow(0 0 14px ${bannerStyle.accent})`,
									transform: `translateY(${bob}px) rotate(${tilt}deg) scale(${wordScale})`,
									display: 'inline-block',
								}}
							>
								{word}
							</span>
						);
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};

const MoneyBurst: React.FC<{
	moment: AutoShortIconMoment;
	frame: number;
	fps: number;
	palette: AutoShortPalette;
}> = ({moment, frame, fps, palette}) => {
	const {width, height} = useVideoConfig();
	const safeInsets = getShortsSafeInsets(width, height);
	const start = secToFrame(moment.startSec, fps);
	const end = secToFrame(moment.endSec, fps);
	const opacity = interpolate(
		frame,
		[start, start + 6, end - 6, end],
		[0, 1, 1, 0],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);
	const lift = spring({
		fps,
		frame: frame - start,
		config: {damping: 17, stiffness: 130, mass: 0.8},
		durationInFrames: 20,
	});

	const anchorX = safeInsets.left + 24;
	const anchorY = safeInsets.top + 24;
	const tokens = [
		{size: 86, x: anchorX + 0, y: anchorY + 44, delay: 0},
		{size: 66, x: anchorX + 104, y: anchorY + 0, delay: 3},
		{size: 60, x: anchorX + 150, y: anchorY + 92, delay: 5},
	];

	return (
		<AbsoluteFill style={{pointerEvents: 'none', opacity}}>
			{tokens.map((token, idx) => {
				const reveal = spring({
					fps,
					frame: frame - (start + token.delay),
					config: {damping: 16, stiffness: 140, mass: 0.75},
					durationInFrames: 18,
				});
				const bob = Math.sin((frame + idx * 13) / 16) * 8;
				const driftY = interpolate(reveal, [0, 1], [34, 0]);
				const scale = interpolate(reveal, [0, 1], [0.7, 1]);
				const glow = 22 + lift * 10;
				return (
					<div
						key={`money-${idx}`}
						style={{
							position: 'absolute',
							left: token.x,
							top: token.y + bob + driftY,
							width: token.size,
							height: token.size,
							borderRadius: 999,
							background: 'rgba(3, 8, 20, 0.72)',
							border: `2px solid ${palette.accent}`,
							boxShadow: `0 0 ${glow}px ${palette.accent}`,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							transform: `scale(${scale})`,
							fontSize: token.size * 0.45,
							fontWeight: 800,
							color: palette.accent,
							fontFamily: '"Poppins", "Avenir Next", sans-serif',
						}}
					>
						$
					</div>
				);
			})}
		</AbsoluteFill>
	);
};

const WordTimedCaptionBar: React.FC<{
	words: AutoShortCaptionWord[];
	frame: number;
	fps: number;
	palette: AutoShortPalette;
}> = ({words, frame, fps, palette}) => {
	const {width, height} = useVideoConfig();
	const safeInsets = getShortsSafeInsets(width, height);
	const pages = useMemo(() => buildOneLineWordPages(words, 28), [words]);
	if (pages.length === 0) return null;

	const currentSec = frame / fps;
	let activePageIdx = pages.findIndex(
		(page) => currentSec >= page.startSec && currentSec < page.endSec,
	);

	if (activePageIdx < 0) {
		if (currentSec < pages[0].startSec) {
			activePageIdx = 0;
		} else {
			activePageIdx = pages.length - 1;
			for (let idx = 0; idx < pages.length; idx++) {
				if (currentSec >= pages[idx].startSec) {
					activePageIdx = idx;
				}
			}
		}
	}

	const activePage = pages[activePageIdx];
	let activeWordIdx = activePage.words.findIndex(
		(word) => currentSec >= word.startSec && currentSec < word.endSec,
	);

	if (activeWordIdx < 0) {
		if (currentSec < activePage.words[0].startSec) {
			activeWordIdx = 0;
		} else {
			activeWordIdx = activePage.words.length - 1;
			for (let idx = 0; idx < activePage.words.length; idx++) {
				if (currentSec >= activePage.words[idx].startSec) {
					activeWordIdx = idx;
				}
			}
		}
	}

	const lineLength = activePage.text.length;
	const captionFontSize =
		lineLength <= 12 ? 82 : lineLength <= 18 ? 76 : lineLength <= 24 ? 70 : lineLength <= 30 ? 62 : 56;
	const startFrame = secToFrame(activePage.startSec, fps);
	const grow = spring({
		fps,
		frame: frame - startFrame,
		config: {damping: 18, stiffness: 150, mass: 0.74},
		durationInFrames: 14,
	});
	const scale = interpolate(grow, [0, 1], [0.9, 1]);
	const captionWidth = width - safeInsets.left - safeInsets.right - 24;
	const lineShift = Math.sin((frame - startFrame) / 20) * 1.9;

	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				pointerEvents: 'none',
				paddingLeft: safeInsets.left + 10,
				paddingRight: safeInsets.right + 10,
				paddingBottom: safeInsets.bottom,
			}}
		>
			<div
				style={{
					padding: '14px 22px',
					maxWidth: captionWidth,
					textAlign: 'center',
					transform: `translateY(${lineShift}px) scale(${scale})`,
					fontFamily:
						'"Montserrat", "Poppins", "Avenir Next Condensed", "Arial Black", sans-serif',
					background: 'rgba(5,7,15,0.86)',
					borderRadius: 18,
					border: `2px solid ${palette.accentMuted}`,
					boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
					minWidth: Math.min(820, captionWidth),
				}}
			>
				<div
					style={{
						whiteSpace: 'nowrap',
						display: 'inline-flex',
						alignItems: 'baseline',
						gap: 10,
						lineHeight: 1.05,
					}}
				>
					{activePage.words.map((word, idx) => {
						const isActive = idx === activeWordIdx;
						return (
							<span
								key={`${word.startSec}-${idx}-${word.text}`}
								style={{
									fontSize: captionFontSize,
									fontWeight: 900,
									letterSpacing: '0.02em',
									textTransform: 'uppercase',
									color: isActive ? '#111827' : '#f8fafc',
									textShadow: isActive
										? `0 0 16px ${palette.accent}, 0 4px 10px rgba(0,0,0,0.55)`
										: '0 4px 12px rgba(0,0,0,0.55)',
									WebkitTextStroke: isActive
										? '1px rgba(17,24,39,0.4)'
										: '2px rgba(0,0,0,0.68)',
									background: isActive ? palette.accentMuted : 'transparent',
									borderRadius: 10,
									padding: isActive ? '2px 10px' : '2px 0',
									transform: isActive ? 'translateY(-2px) scale(1.04)' : 'scale(1)',
									display: 'inline-block',
								}}
							>
								{word.text.toUpperCase()}
							</span>
						);
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};

const CaptionBar: React.FC<{
	cue: AutoShortCaptionCue;
	frame: number;
	fps: number;
	palette: AutoShortPalette;
}> = ({cue, frame, fps, palette}) => {
	const {width, height} = useVideoConfig();
	const safeInsets = getShortsSafeInsets(width, height);
	const start = secToFrame(cue.startSec, fps);
	const end = secToFrame(cue.endSec, fps);
	const linePages = splitCaptionIntoOneLinePages(cue.text, 28);
	const durationFrames = Math.max(1, end - start);
	const pageProgress = clamp((frame - start) / durationFrames, 0, 0.999);
	const activePageIdx = Math.min(
		Math.max(0, linePages.length - 1),
		Math.floor(pageProgress * Math.max(1, linePages.length)),
	);
	const activeLine = linePages[activePageIdx] ?? cue.text.toUpperCase();
	const lineLength = activeLine.length;
	const captionFontSize =
		lineLength <= 14 ? 78 : lineLength <= 20 ? 70 : lineLength <= 26 ? 62 : lineLength <= 32 ? 56 : 52;
	const grow = spring({
		fps,
		frame: frame - start,
		config: {damping: 17, stiffness: 150, mass: 0.75},
		durationInFrames: 14,
	});
	const scale = interpolate(grow, [0, 1], [0.88, 1]);
	const captionWidth = width - safeInsets.left - safeInsets.right - 24;
	const lineShift = Math.sin((frame - start) / 18) * 2.5;

	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				pointerEvents: 'none',
				paddingLeft: safeInsets.left + 10,
				paddingRight: safeInsets.right + 10,
				paddingBottom: safeInsets.bottom,
			}}
		>
			<div
				style={{
					padding: '14px 22px',
					maxWidth: captionWidth,
					textAlign: 'center',
					transform: `translateY(${lineShift}px) scale(${scale})`,
					fontFamily:
						'"Montserrat", "Poppins", "Avenir Next Condensed", "Arial Black", sans-serif',
					background: 'rgba(5,7,15,0.86)',
					borderRadius: 18,
					border: `2px solid ${palette.accentMuted}`,
					boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
					minWidth: Math.min(820, captionWidth),
				}}
			>
				<div
					style={{
						fontSize: captionFontSize,
						fontWeight: 900,
						lineHeight: 1.05,
						letterSpacing: '0.02em',
						textTransform: 'uppercase',
						color: '#f8fafc',
						whiteSpace: 'nowrap',
						textShadow: '0 4px 12px rgba(0,0,0,0.55)',
						WebkitTextStroke: '2px rgba(0,0,0,0.68)',
					}}
				>
					{activeLine}
				</div>
			</div>
		</AbsoluteFill>
	);
};

export const AutoShortVideo: React.FC<AutoShortVideoProps> = ({plan}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const cutaways = plan.segments.filter((segment) => segment.type === 'cutaway');
	const activeCutaway = getActiveItem(cutaways, frame, fps);
	const activeOverlay = activeCutaway ? null : getActiveItem(plan.topOverlays, frame, fps);
	const hasWordCaptions = (plan.wordCaptions?.length ?? 0) > 0;
	const activeCaption = getActiveItem(plan.captions, frame, fps);
	const activeIconMoment = getActiveItem(plan.iconMoments ?? [], frame, fps);

	const subtleScale = 1 + Math.sin(frame / 110) * 0.008;

	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#020617',
				fontFamily: '"Poppins", "Avenir Next", sans-serif',
			}}
		>
			<AbsoluteFill style={{transform: `scale(${subtleScale})`}}>
				<OffthreadVideo
					src={staticFile(plan.sourceVideo)}
					style={{
						width: '100%',
						height: '100%',
						objectFit: 'cover',
					}}
				/>
			</AbsoluteFill>
			<AbsoluteFill
				style={{
					background:
						'linear-gradient(180deg, rgba(1,4,15,0.34) 0%, rgba(1,4,15,0.12) 40%, rgba(1,4,15,0.46) 100%)',
				}}
			/>
			{activeCutaway ? (
				<CutawayOverlay
					segment={activeCutaway}
					frame={frame}
					fps={fps}
					images={plan.decorativeImages}
					palette={plan.palette}
					backgroundCard={plan.backgroundCard}
				/>
			) : null}
			{activeIconMoment ? (
				<MoneyBurst moment={activeIconMoment} frame={frame} fps={fps} palette={plan.palette} />
			) : null}
			{activeOverlay ? (
				<TopBanner overlay={activeOverlay} frame={frame} fps={fps} palette={plan.palette} />
			) : null}
			{hasWordCaptions ? (
				<WordTimedCaptionBar
					words={plan.wordCaptions ?? []}
					frame={frame}
					fps={fps}
					palette={plan.palette}
				/>
			) : activeCaption ? (
				<CaptionBar cue={activeCaption} frame={frame} fps={fps} palette={plan.palette} />
			) : null}
		</AbsoluteFill>
	);
};
