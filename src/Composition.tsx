import {
  useCurrentFrame,
  interpolate,
  AbsoluteFill,
  Sequence,
  Img,
} from "remotion";
import screen1 from "./screen1.png";
import screen3 from "./screen3.png";
import logo from "./logo.png";
import coupons from "./coupons.png";
import course from "./course.png";
import live from "./live.png";
import mobile from "./mobile.png";
import webinars from "./webinars.png";

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

  const earnScale = frame >= 16 ? 1 + Math.sin((frame - 16) * 0.25) * 0.05 : 1;
  const earnRotate = frame >= 16 ? Math.sin((frame - 16) * 0.15) * 2 : 0;

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
          you can{" "}
          <span
            style={{
              color: "#22c55e",
              display: "inline-block",
              transform: `scale(${earnScale}) rotate(${earnRotate}deg)`,
            }}
          >
            earn
          </span>{" "}
          by teaching that skill{" "}
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
          width: 80,
          height: 80,
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
          width: 70,
          height: 70,
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
          borderLeft: "40px solid transparent",
          borderRight: "40px solid transparent",
          borderBottom: `70px solid ${color}`,
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

const SlideshowAnimation = () => {
  const frame = useCurrentFrame();
  const height = 720;
  const width = 1280;
  const centerX = width / 2;
  const centerY = height / 2;

  const slides = [
    { src: coupons, color: "#ff6b6b", name: "Coupons" },
    { src: course, color: "#ffd93d", name: "Courses" },
    { src: live, color: "#6bcb77", name: "Live" },
    { src: mobile, color: "#4ecdc4", name: "Mobile" },
    { src: webinars, color: "#a78bfa", name: "Webinars" },
  ];

  const slideDuration = 30;
  const currentSlide = Math.floor(frame / slideDuration) % slides.length;
  const slide = slides[currentSlide];
  const slideFrame = frame % slideDuration;

  const opacity = interpolate(slideFrame, [0, 5], [0, 1], {
    extrapolateRight: "clamp",
  });

  const exitOpacity = interpolate(slideFrame, [25, 30], [1, 0], {
    extrapolateRight: "clamp",
  });

  const scale = interpolate(slideFrame, [0, 15], [0.5, 1], {
    extrapolateRight: "clamp",
  });

  const rotateZ = interpolate(
    slideFrame,
    [0, 15, 25, 30],
    [currentSlide % 2 === 0 ? 15 : currentSlide % 2 === 1 ? -15 : 0, 0, 0, 0],
    {
      extrapolateRight: "clamp",
    },
  );

  const translateX = interpolate(
    slideFrame,
    [0, 15, 30],
    [centerX - 200, centerX, centerX],
    {
      extrapolateRight: "clamp",
    },
  );

  const floatY = Math.sin(frame * 0.08) * 8;
  const rotateX = Math.sin(frame * 0.05) * 4;
  const rotateY = Math.cos(frame * 0.04) * 3;

  const glowIntensity = 0.8 + Math.sin(frame * 0.1) * 0.3;
  const pulseScale = 1 + Math.sin(frame * 0.15) * 0.03;

  const particles = Array.from({ length: 8 }).map((_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    const distance = 150 + Math.sin(frame * 0.05 + i) * 30;
    const px = centerX + Math.cos(angle) * distance;
    const py = centerY + Math.sin(angle) * distance;
    const scale = 0.5 + Math.sin(frame * 0.1 + i) * 0.3;

    return {
      x: px,
      y: py,
      scale,
      color: slide.color,
    };
  });

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
          perspective: "2000px",
        }}
      >
        {particles.map((p, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: p.color,
              opacity: 0.6,
              transform: `scale(${p.scale})`,
              boxShadow: `0 0 15px ${p.color}`,
            }}
          />
        ))}

        <div
          style={{
            position: "relative",
            width: "850px",
            height: "550px",
            borderRadius: "20px",
            backgroundColor: "#111",
            boxShadow: `
              0 0 80px rgba(${parseInt(slide.color.slice(1, 3), 16)}, ${parseInt(slide.color.slice(3, 5), 16)}, ${parseInt(slide.color.slice(5, 7), 16)}, ${glowIntensity * 0.4}),
              0 0 150px rgba(${parseInt(slide.color.slice(1, 3), 16)}, ${parseInt(slide.color.slice(3, 5), 16)}, ${parseInt(slide.color.slice(5, 7), 16)}, ${glowIntensity * 0.2}),
              0 40px 80px rgba(0, 0, 0, 0.6)
            `,
            transform: `
              translateY(${floatY}px)
              rotateX(${rotateX}deg)
              rotateY(${rotateY}deg)
              translateZ(80px)
            `,
            transformStyle: "preserve-3d",
            opacity: exitOpacity,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "-4px",
              left: "-4px",
              right: "-4px",
              bottom: "-4px",
              borderRadius: "24px",
              background: `linear-gradient(135deg, ${slide.color}, ${slide.color}88)`,
              zIndex: -1,
              opacity: 0.9,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "-8px",
              left: "-8px",
              right: "-8px",
              bottom: "-8px",
              borderRadius: "28px",
              background: `linear-gradient(135deg, 
                ${slide.color}99, 
                ${slide.color}77, 
                ${slide.color}55)`,
              zIndex: -2,
              filter: "blur(12px)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "25px",
              left: "25px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#00ff88",
                boxShadow: `0 0 12px #00ff88, 0 0 24px #00ff88`,
                animation: "pulse 2s infinite",
              }}
            />
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: slide.color,
                boxShadow: `0 0 8px ${slide.color}`,
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              top: "25px",
              right: "30px",
              fontSize: "14px",
              fontWeight: "600",
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: "2px",
              opacity: 0.8,
            }}
          >
            {slide.name}
          </div>
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: `translate(-50%, -50%)`,
              width: "800px",
              height: "500px",
              overflow: "hidden",
              borderRadius: "15px",
              backgroundColor: "#000",
              boxShadow: "inset 0 0 60px rgba(0, 0, 0, 0.6)",
            }}
          >
            <Img
              src={slide.src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                transform: `rotateZ(${rotateZ}deg) scale(${scale * pulseScale})`,
              }}
            />
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: "40px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: "8px",
          }}
        >
          {slides.map((s, i) => (
            <div
              key={i}
              style={{
                width: currentSlide === i ? "12px" : "8px",
                height: currentSlide === i ? "12px" : "8px",
                borderRadius: currentSlide === i ? "6px" : "50%",
                backgroundColor: currentSlide === i ? s.color : "#333",
                opacity: currentSlide === i ? 1 : 0.4,
                transition: "all 0.3s ease",
                boxShadow: currentSlide === i ? `0 0 10px ${s.color}` : "none",
              }}
            />
          ))}
          {Array.from({ length: 12 }).map((_, i) => (
            <Particle
              key={i + 72}
              x={centerX - 100}
              y={centerY - 120}
              delay={4}
              index={i}
            />
          ))}
          {Array.from({ length: 12 }).map((_, i) => (
            <Particle
              key={i + 84}
              x={centerX + 100}
              y={centerY - 120}
              delay={3}
              index={i}
            />
          ))}
          {Array.from({ length: 12 }).map((_, i) => (
            <Particle
              key={i + 96}
              x={centerX - 60}
              y={centerY - 140}
              delay={5}
              index={i}
            />
          ))}
          {Array.from({ length: 12 }).map((_, i) => (
            <Particle
              key={i + 108}
              x={centerX + 60}
              y={centerY - 140}
              delay={4}
              index={i}
            />
          ))}
          {Array.from({ length: 12 }).map((_, i) => (
            <Particle
              key={i + 120}
              x={centerX}
              y={centerY - 170}
              delay={6}
              index={i}
            />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const FinalAnimation = () => {
  const frame = useCurrentFrame();
  const height = 720;
  const width = 1280;

  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const logoScale = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const logoPulse = frame >= 20 ? 1 + Math.sin((frame - 20) * 0.1) * 0.05 : 1;
  const logoRotate = frame >= 20 ? Math.sin((frame - 20) * 0.08) * 2 : 0;

  const words = ["Your", "Students", "Awaits"];

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
            width: 500,
            height: "auto",
            opacity,
            transform: `scale(${logoScale * logoPulse}) rotate(${logoRotate}deg)`,
          }}
        />
        <div
          style={{
            opacity: interpolate(frame, [15, 25], [0, 1], {
              extrapolateRight: "clamp",
            }),
            display: "flex",
            gap: "20px",
            marginTop: "40px",
            fontSize: "52px",
            fontWeight: "bold",
            color: "#000",
          }}
        >
          {words.map((word, i) => {
            const wordStart = 20 + i * 15;
            const wordOpacity = interpolate(
              frame,
              [wordStart, wordStart + 10],
              [0, 1],
              {
                extrapolateRight: "clamp",
              },
            );
            const translateX = interpolate(
              frame,
              [wordStart, wordStart + 10],
              [50 - i * 25, 0],
              {
                extrapolateRight: "clamp",
              },
            );
            const scale =
              frame >= wordStart + 10
                ? 1 + Math.sin((frame - wordStart - 10) * 0.2) * 0.1
                : 1;
            const rotate =
              frame >= wordStart + 10
                ? Math.sin((frame - wordStart - 10) * 0.15) * 3
                : 0;
            const hue = (i * 120) % 360;
            const color = i === 0 ? "#000" : `hsl(${hue}, 70%, 50%)`;
            const shadow =
              i === 0 ? "none" : `0 0 20px hsla(${hue}, 70%, 50%, 0.3)`;

            return (
              <span
                key={i}
                style={{
                  opacity: wordOpacity,
                  transform: `translateX(${translateX}px) scale(${scale}) rotate(${rotate}deg)`,
                  display: "inline-block",
                  color,
                  textShadow: shadow,
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
        <SlideshowAnimation />
      </Sequence>
      <Sequence from={420} durationInFrames={120}>
        <FinalAnimation />
      </Sequence>
    </>
  );
};
