import {Composition} from 'remotion';

import {AutoShortVideo} from './auto-short/AutoShortVideo';
import {generatedPlan} from './auto-short/generated-plan';

export const RemotionRoot = () => {
	return (
		<Composition
			id="AutoShort"
			component={AutoShortVideo}
			durationInFrames={generatedPlan.durationInFrames}
			fps={generatedPlan.fps}
			width={generatedPlan.width}
			height={generatedPlan.height}
			defaultProps={{
				plan: generatedPlan,
			}}
		/>
	);
};
