import { useProgress } from "@react-three/drei";
import { useAtom } from "jotai";
import { itemsAtom } from "./SocketManager";
import { useState, useEffect, useMemo } from "react";

const LOADING_MESSAGES = [
  "Polishing claws...",
  "Gathering seashells...",
  "Warming up the tide pools...",
  "Convincing crabs to cooperate...",
  "Untangling seaweed...",
  "Calibrating pincers...",
  "Fluffing the sand...",
  "Negotiating with hermit crabs...",
  "Importing good vibes...",
  "Brewing ocean mist...",
  "Tuning the waves...",
  "Shedding old shells...",
  "Counting grains of sand...",
  "Waking up the starfish...",
  "Inflating pufferfish...",
];

const CAMERA_SETTLE_MS = 1500;

// Bubbles layer rendered independently so it can persist behind the WelcomeModal
export const BubblesBackground = () => {
  const bubbles = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        left: `${8 + ((i * 37 + 13) % 84)}%`,
        size: 6 + ((i * 7 + 3) % 14),
        delay: `${(i * 0.4) % 4}s`,
        duration: `${3 + (i % 4)}s`,
        opacity: 0.15 + ((i * 3) % 10) / 40,
      })),
    []
  );

  return (
    <div className="loader-bg fixed inset-0 z-[45] pointer-events-none overflow-hidden">
      {bubbles.map((b, i) => (
        <div
          key={i}
          className="loader-bubble absolute rounded-full"
          style={{
            left: b.left,
            width: b.size,
            height: b.size,
            animationDelay: b.delay,
            animationDuration: b.duration,
            opacity: b.opacity,
          }}
        />
      ))}
    </div>
  );
};

export const Loader = ({ loaded }) => {
  const { progress } = useProgress();
  const [items] = useAtom(itemsAtom);
  const [messageIndex, setMessageIndex] = useState(0);
  const [messageFade, setMessageFade] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const actualProgress = !items ? 0 : progress;

  // Buffer: wait for the camera to settle before fading out
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => setDismissed(true), CAMERA_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loaded]);

  // Cycle through fun loading messages
  useEffect(() => {
    if (dismissed) return;
    const interval = setInterval(() => {
      setMessageFade(false);
      setTimeout(() => {
        setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
        setMessageFade(true);
      }, 300);
    }, 2800);
    return () => clearInterval(interval);
  }, [dismissed]);

  const titleLetters = "MOLT'S LAND".split("");

  return (
    <div
      className={`loader-screen fixed inset-0 z-50 flex items-center justify-center pointer-events-none select-none transition-opacity duration-1000 ${
        dismissed ? "opacity-0" : ""
      }`}
    >
      {/* Animated background bubbles (inline copy for loader overlay) */}
      <div className="absolute inset-0 overflow-hidden">
        {Array.from({ length: 12 }, (_, i) => ({
          left: `${8 + ((i * 37 + 13) % 84)}%`,
          size: 6 + ((i * 7 + 3) % 14),
          delay: `${(i * 0.4) % 4}s`,
          duration: `${3 + (i % 4)}s`,
          opacity: 0.15 + ((i * 3) % 10) / 40,
        })).map((b, i) => (
          <div
            key={i}
            className="loader-bubble absolute rounded-full"
            style={{
              left: b.left,
              width: b.size,
              height: b.size,
              animationDelay: b.delay,
              animationDuration: b.duration,
              opacity: b.opacity,
            }}
          />
        ))}
      </div>

      {/* Main loading card */}
      <div className="loader-card relative">
        {/* Animated border */}
        <div className="loader-border absolute inset-0 rounded-2xl" />
        <div className="loader-border-inner absolute inset-[3px] rounded-xl" />

        {/* Content */}
        <div className="relative z-10 px-12 py-10 flex flex-col items-center gap-5">
          {/* Animated title */}
          <h1 className="loader-title flex gap-[2px]">
            {titleLetters.map((letter, i) => (
              <span
                key={i}
                className="loader-letter inline-block"
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                {letter === " " ? "\u00A0" : letter}
              </span>
            ))}
          </h1>

          {/* Subtitle */}
          <p className="loader-subtitle text-sm tracking-[0.3em] uppercase">
            A World Worth Molting For
          </p>

          {/* Progress bar */}
          <div className="w-72 relative">
            <div className="loader-bar-track h-5 rounded-full overflow-hidden relative">
              <div
                className="loader-bar-fill h-full rounded-full transition-all duration-500 ease-out relative"
                style={{ width: `${actualProgress}%` }}
              >
                <div className="loader-bar-shimmer absolute inset-0 rounded-full" />
              </div>
            </div>
            {/* Percentage */}
            <p className="loader-percent text-center mt-2 text-xs font-bold tracking-widest">
              {Math.round(actualProgress)}%
            </p>
          </div>

          {/* Fun loading message */}
          <p
            className={`loader-message text-sm italic transition-opacity duration-300 ${
              messageFade ? "opacity-100" : "opacity-0"
            }`}
          >
            {LOADING_MESSAGES[messageIndex]}
          </p>
        </div>

        {/* Corner decorations */}
        <div className="loader-corner loader-corner-tl" />
        <div className="loader-corner loader-corner-tr" />
        <div className="loader-corner loader-corner-bl" />
        <div className="loader-corner loader-corner-br" />
      </div>
    </div>
  );
};
