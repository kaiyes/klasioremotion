import {
  useCurrentFrame,
  interpolate,
  AbsoluteFill,
  Sequence,
  Img,
} from "remotion";
import screen3 from "./screen3.png";
import logo from "./logo.png";

const Particle = ({
  x,
  y,
  delay,
  index,
}: {
  x: number;
  y: number;
  delay: number;
  index: number;
}) => {
  const frame = useCurrentFrame();
  const startFrame = 10 + delay;
  const duration = 15;
  const endFrame = 38;

  if (frame < startFrame || frame > endFrame + 4) return null;

  const progress = Math.min((frame - startFrame) / duration, 1);
  const angle = (index / 12) * Math.PI * 2;
  const distance = progress * 80;
  const px = x + Math.cos(angle) * distance;
  const py = y + Math.sin(angle) * distance;
  const opacity = frame > endFrame ? 1 - (frame - endFrame) / 5 : 1 - progress;
  const scale = 1 - progress * 0.8;

  return (
    <div
      style={{
        position: "absolute",
        left: px,
        top: py,
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor:
          index % 2 === 0 ? "#ff6b6b" : index % 3 === 0 ? "#ffd93d" : "#6bcb77",
        opacity,
        transform: `scale(${scale})`,
      }}
    />
  );
};

const LogoAnimation = () => {
  const frame = useCurrentFrame();
  const height = 720;
  const width = 1280;
  const centerX = width / 2;
  const centerY = height / 2;

  const translateY = interpolate(
    frame,
    [0, 6, 8, 10, 11],
    [height + 200, height / 2, height / 2 - 40, height / 2 + 15, height / 2],
    {
      extrapolateRight: "clamp",
    },
  );

  const opacity = interpolate(frame, [38, 42], [1, 0], {
    extrapolateRight: "clamp",
  });

  const textOpacity = interpolate(frame, [12, 16, 38, 42], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });

  const textTranslateX = interpolate(frame, [12, 16], [-100, 0], {
    extrapolateRight: "clamp",
  });

  const easyTranslateX = interpolate(frame, [16, 20, 22], [100, -10, 0], {
    extrapolateRight: "clamp",
  });

  const easyScale = interpolate(frame, [16, 18, 20], [1.2, 0.9, 1], {
    extrapolateRight: "clamp",
  });

  const easyWiggle = frame >= 22 ? Math.sin((frame - 22) * 0.3) * 3 : 0;
  const easyPulse = frame >= 22 ? 1 + Math.sin((frame - 22) * 0.2) * 0.05 : 1;

  return (
    <AbsoluteFill style={{ backgroundColor: "#fff" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
        }}
      >
        <Img
          src={logo}
          style={{
            width: 450,
            height: "auto",
            opacity,
            transform: `translateY(${translateY - height / 2}px)`,
          }}
        />
        <div
          style={{
            opacity: textOpacity,
            transform: `translateX(${textTranslateX}px)`,
            marginTop: "20px",
            fontSize: "48px",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span>Online Courses Made</span>
          <span
            style={{
              color: "#22c55e",
              transform: `translateX(${easyTranslateX + easyWiggle}px) scale(${easyScale * easyPulse})`,
              display: "inline-block",
            }}
          >
            Easy
          </span>
        </div>
      </div>
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle key={i} x={centerX} y={centerY - 180} delay={0} index={i} />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 12}
          x={centerX - 80}
          y={centerY - 200}
          delay={2}
          index={i}
        />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 24}
          x={centerX + 80}
          y={centerY - 200}
          delay={1}
          index={i}
        />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 36}
          x={centerX - 120}
          y={centerY - 150}
          delay={3}
          index={i}
        />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 48}
          x={centerX + 120}
          y={centerY - 150}
          delay={0}
          index={i}
        />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 60}
          x={centerX - 40}
          y={centerY - 220}
          delay={1}
          index={i}
        />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 72}
          x={centerX + 40}
          y={centerY - 220}
          delay={2}
          index={i}
        />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 84}
          x={centerX - 150}
          y={centerY - 180}
          delay={1}
          index={i}
        />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 96}
          x={centerX + 150}
          y={centerY - 180}
          delay={0}
          index={i}
        />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <Particle
          key={i + 108}
          x={centerX}
          y={centerY - 240}
          delay={2}
          index={i}
        />
      ))}
    </AbsoluteFill>
  );
};

const ScreenAnimation = () => {
  const frame = useCurrentFrame();
  const height = 720;
  const width = 1280;
  const centerX = width / 2;
  const centerY = height / 2;

  const translateX = interpolate(
    frame,
    [0, 6, 8, 10, 11],
    [width + 200, centerX, centerX - 80, centerX + 30, centerX],
    {
      extrapolateRight: "clamp",
    },
  );

  const rotation = interpolate(frame, [0, 6], [45, 0], {
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [0, 6], [0.5, 1.3], {
    extrapolateRight: "clamp",
  });

  const skewX = interpolate(frame, [0, 6], [-15, 0], {
    extrapolateRight: "clamp",
  });

  const opacity = interpolate(frame, [0, 5], [0, 1], {
    extrapolateRight: "clamp",
  });

  const topTextOpacity = interpolate(frame, [8, 12], [0, 1], {
    extrapolateRight: "clamp",
  });

  const topTextTranslateY = interpolate(frame, [8, 12], [-30, 0], {
    extrapolateRight: "clamp",
  });

  const skillsScale = frame >= 12 ? 1 + Math.sin((frame - 12) * 0.3) * 0.05 : 1;
  const skillsRotate = frame >= 12 ? Math.sin((frame - 12) * 0.2) * 2 : 0;

  const bottomTextOpacity = interpolate(frame, [12, 16], [0, 1], {
    extrapolateRight: "clamp",
  });

  const bottomTextTranslateY = interpolate(frame, [12, 16], [30, 0], {
    extrapolateRight: "clamp",
  });

  const onlineScale =
    frame >= 16 ? 1 + Math.sin((frame - 16) * 0.25) * 0.05 : 1;
  const onlineRotate = frame >= 16 ? Math.sin((frame - 16) * 0.15) * 2 : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#fff" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            opacity: topTextOpacity,
            transform: `translateY(${topTextTranslateY}px)`,
            fontSize: "42px",
            fontWeight: "bold",
            color: "#000",
            marginBottom: "60px",
            fontFamily: "Georgia, serif",
          }}
        >
          you have{" "}
          <span
            style={{
              color: "#22c55e",
              display: "inline-block",
              transform: `scale(${skillsScale}) rotate(${skillsRotate}deg)`,
            }}
          >
            Skills
          </span>
        </div>
        <Img
          src={screen3}
          style={{
            width: 400,
            height: "auto",
            opacity,
            transform: `
              translate(${translateX - centerX}px, ${centerY - height / 2}px)
              rotate(${rotation}deg)
              scale(${scale})
              skewX(${skewX}deg)
            `,
            transformOrigin: "center",
          }}
        />
        <div
          style={{
            opacity: bottomTextOpacity,
            transform: `translateY(${bottomTextTranslateY}px)`,
            fontSize: "36px",
            fontWeight: "500",
            color: "#333",
            marginTop: "60px",
            textAlign: "center",
            maxWidth: "700px",
            fontFamily: "Arial, sans-serif",
          }}
        >
          you can earn by teaching that skill{" "}
          <span
            style={{
              color: "#22c55e",
              display: "inline-block",
              transform: `scale(${onlineScale}) rotate(${onlineRotate}deg)`,
            }}
          >
            online
          </span>{" "}
          !
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const MyComposition = () => {
  return (
    <>
      <Sequence from={0} durationInFrames={42}>
        <LogoAnimation />
      </Sequence>
      <Sequence from={42} durationInFrames={40}>
        <ScreenAnimation />
      </Sequence>
    </>
  );
};
