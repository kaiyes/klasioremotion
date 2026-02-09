export type SegmentType = 'talk' | 'cutaway';

export type AutoShortPoint = {
	title: string;
	detail?: string;
};

export type AutoShortSegment = {
	id: string;
	type: SegmentType;
	startSec: number;
	endSec: number;
	headline?: string;
	supportingText?: string;
	points?: AutoShortPoint[];
};

export type AutoShortOverlay = {
	text: string;
	startSec: number;
	endSec: number;
};

export type AutoShortCaptionCue = {
	startSec: number;
	endSec: number;
	text: string;
};

export type AutoShortCaptionWord = {
	startSec: number;
	endSec: number;
	text: string;
};

export type AutoShortIconMoment = {
	kind: 'money';
	startSec: number;
	endSec: number;
};

export type AutoShortPalette = {
	backgroundA: string;
	backgroundB: string;
	accent: string;
	accentMuted: string;
	textPrimary: string;
};

export type AutoShortPlan = {
	version: number;
	sourceVideo: string;
	fps: number;
	width: number;
	height: number;
	durationInFrames: number;
	segments: AutoShortSegment[];
	topOverlays: AutoShortOverlay[];
	captions: AutoShortCaptionCue[];
	wordCaptions?: AutoShortCaptionWord[];
	decorativeImages: string[];
	backgroundCard?: string;
	iconMoments?: AutoShortIconMoment[];
	palette: AutoShortPalette;
};
