import {
  useCurrentFrame,
  interpolate,
  AbsoluteFill,
  Sequence,
  Img,
  Html5Video,
  staticFile,
} from "remotion";
import screen1 from "./screen1.png";
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
  const endFrame = 55;

  if (frame < startFrame || frame > endFrame + 5) return null;

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

  const opacity = interpolate(frame, [55, 60], [1, 0], {
    extrapolateRight: "clamp",
  });

  const textOpacity = interpolate(frame, [12, 16, 55, 60], [0, 1, 1, 0], {
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

  const logoJiggle = frame >= 11 ? Math.sin((frame - 11) * 0.15) * 1.5 : 0;
  const logoPulse = frame >= 11 ? 1 + Math.sin((frame - 11) * 0.1) * 0.02 : 0;

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
            transform: `translateY(${translateY - height / 2}px) rotate(${logoJiggle}deg) scale(${logoPulse})`,
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

  const floatY = frame >= 11 ? Math.sin((frame - 11) * 0.15) * 8 : 0;
  const floatRotate = frame >= 11 ? Math.sin((frame - 11) * 0.1) * 3 : 0;

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
              translate(${translateX - centerX}px, ${centerY - height / 2 + floatY}px)
              rotate(${rotation + floatRotate}deg)
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

const AnimatedShape = ({
  x,
  y,
  delay,
  type,
  color,
}: {
  x: number;
  y: number;
  delay: number;
  type: "circle" | "square" | "triangle";
  color: string;
}) => {
  const frame = useCurrentFrame();
  const startFrame = 5 + delay;

  if (frame < startFrame) return null;

  const scale = interpolate(frame, [startFrame, startFrame + 8], [0, 1], {
    extrapolateRight: "clamp",
  });

  const rotation =
    frame >= startFrame + 8 ? Math.sin((frame - startFrame - 8) * 0.2) * 15 : 0;

  const commonStyle = {
    position: "absolute" as const,
    left: x,
    top: y,
    transform: `scale(${scale}) rotate(${rotation}deg)`,
    opacity: 0.8,
  };

  if (type === "circle") {
    return (
      <div
        style={{
          ...commonStyle,
          width: 40,
          height: 40,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
    );
  } else if (type === "square") {
    return (
      <div
        style={{
          ...commonStyle,
          width: 35,
          height: 35,
          backgroundColor: color,
        }}
      />
    );
  } else {
    return (
      <div
        style={{
          ...commonStyle,
          width: 0,
          height: 0,
          borderLeft: "20px solid transparent",
          borderRight: "20px solid transparent",
          borderBottom: `35px solid ${color}`,
        }}
      />
    );
  }
};

const Screen1Animation = () => {
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

  const bounceY = frame >= 11 ? Math.sin((frame - 11) * 0.2) * 10 : 0;
  const bounceScale = frame >= 11 ? 1 + Math.sin((frame - 11) * 0.2) * 0.02 : 0;

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
            fontSize: "40px",
            fontWeight: "bold",
            color: "#000",
            marginBottom: "60px",
            fontFamily: "Georgia, serif",
          }}
        >
          All in on solution
        </div>
        <Img
          src={screen1}
          style={{
            width: 400,
            height: "auto",
            opacity,
            transform: `
              translate(${translateX - centerX}px, ${centerY - height / 2 + bounceY}px)
              rotate(${rotation}deg)
              scale(${scale + bounceScale})
              skewX(${skewX}deg)
            `,
            transformOrigin: "center",
          }}
        />
      </div>
      <AnimatedShape
        x={200}
        y={height / 2}
        delay={0}
        type="circle"
        color="#ff6b6b"
      />
      <AnimatedShape
        x={150}
        y={height / 2 - 80}
        delay={1}
        type="square"
        color="#ffd93d"
      />
      <AnimatedShape
        x={180}
        y={height / 2 + 80}
        delay={2}
        type="triangle"
        color="#6bcb77"
      />
      <AnimatedShape
        x={220}
        y={height / 2 - 40}
        delay={3}
        type="circle"
        color="#4ecdc4"
      />
      <AnimatedShape
        x={160}
        y={height / 2 + 40}
        delay={1.5}
        type="square"
        color="#ff6b6b"
      />
      <AnimatedShape
        x={1080}
        y={height / 2}
        delay={0.5}
        type="circle"
        color="#6bcb77"
      />
      <AnimatedShape
        x={1130}
        y={height / 2 - 80}
        delay={2}
        type="square"
        color="#ff6b6b"
      />
      <AnimatedShape
        x={1100}
        y={height / 2 + 80}
        delay={1}
        type="triangle"
        color="#ffd93d"
      />
      <AnimatedShape
        x={1060}
        y={height / 2 - 40}
        delay={2.5}
        type="circle"
        color="#ffd93d"
      />
      <AnimatedShape
        x={1120}
        y={height / 2 + 40}
        delay={1.5}
        type="square"
        color="#4ecdc4"
      />
    </AbsoluteFill>
  );
};

const VideoAnimation = () => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 5], [0, 1], {
    extrapolateRight: "clamp",
  });

  const floatY = Math.sin(frame * 0.1) * 15;
  const rotateX = Math.sin(frame * 0.06) * 8;
  const rotateY = Math.cos(frame * 0.05) * 6;

  const glowIntensity = 0.8 + Math.sin(frame * 0.1) * 0.2;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
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
          perspective: "1500px",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "700px",
            height: "450px",
            borderRadius: "20px",
            backgroundColor: "#111",
            boxShadow: `
              0 0 60px rgba(100, 200, 255, ${glowIntensity * 0.3}),
              0 0 120px rgba(100, 200, 255, ${glowIntensity * 0.15}),
              0 30px 60px rgba(0, 0, 0, 0.5)
            `,
            transform: `
              translateY(${floatY}px)
              rotateX(${rotateX}deg)
              rotateY(${rotateY}deg)
              translateZ(50px)
            `,
            transformStyle: "preserve-3d",
            transition: "transform 0.1s ease-out",
            opacity,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "-3px",
              left: "-3px",
              right: "-3px",
              bottom: "-3px",
              borderRadius: "23px",
              background: "linear-gradient(135deg, #00d4ff, #0099ff, #0066cc)",
              zIndex: -1,
              opacity: 0.8,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "-6px",
              left: "-6px",
              right: "-6px",
              bottom: "-6px",
              borderRadius: "26px",
              background: `linear-gradient(135deg, 
                rgba(0, 212, 255, ${glowIntensity * 0.5}), 
                rgba(0, 153, 255, ${glowIntensity * 0.3}), 
                rgba(0, 102, 204, ${glowIntensity * 0.2}))`,
              zIndex: -2,
              filter: "blur(10px)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "20px",
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: "#00ff88",
              boxShadow: `0 0 10px #00ff88, 0 0 20px #00ff88`,
              animation: "pulse 2s infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "22px",
              right: "25px",
              display: "flex",
              gap: "8px",
            }}
          >
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "#00d4ff",
              }}
            />
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "#0066cc",
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "650px",
              height: "400px",
              overflow: "hidden",
              borderRadius: "15px",
              backgroundColor: "#000",
              boxShadow: "inset 0 0 50px rgba(0, 0, 0, 0.5)",
            }}
          >
            <Html5Video
              src={staticFile("klasio.mp4")}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const MyComposition = () => {
  return (
    <>
      <Sequence from={0} durationInFrames={60}>
        <LogoAnimation />
      </Sequence>
      <Sequence from={60} durationInFrames={105}>
        <ScreenAnimation />
      </Sequence>
      <Sequence from={165} durationInFrames={105}>
        <Screen1Animation />
      </Sequence>
      <Sequence from={270} durationInFrames={150}>
        <VideoAnimation />
      </Sequence>
    </>
  );
};
