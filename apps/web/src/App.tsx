import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  INITIAL_GAME_STATE,
  advanceGame,
  fastForwardGame,
  getGame,
  getRuntimeHealth,
  normalizeGameState,
  resetGame,
  runTurn,
} from "./api";
import {
  ROOM_ZONES,
  characterAnchor,
  focusPointForRoom,
  roomForEvent,
  roomForLocation,
  type CharacterId,
  type Point,
} from "./room-layout";
import { ResidentPortrait, ResidentSceneSprite } from "./character-assets";
import {
  createAfterScenePlan,
  type AfterScenePlan,
  type SpriteDirection,
} from "./after-scene";
import { FurnitureSpriteLayer } from "./furniture-assets";
import { buildMemoryArticle, type MemoryArticle } from "./memory-article";
import { ResultScreen } from "./result";
import {
  DEKOPIN_NAME,
  getDekopinPresentation,
  type DekopinPresentation,
} from "./dekopin";
import { getGameControlState, type ActionBusy } from "./game-controls";
import dekopinSpriteUrl from "../../../assets/characters/navigator/walk-cycle.png";
import type {
  AgentDecision,
  CharacterState,
  GameEvent,
  GameState,
  Memory,
  MetricKey,
  Phase,
  RuntimeInfo,
  StreamMessage,
} from "./types";
import { PersonalityStudio } from "./personality/PersonalityStudio";
import { useCharacterSettings } from "./personality/useCharacterSettings";

type InspectorTab = "status" | "schedule" | "memories";
type StageStatus = "waiting" | "active" | "complete";
type LogFilter = "all" | "haru" | "aoi" | "event";

type AfterScenePlayback = {
  plan: AfterScenePlan;
  /** -1 places residents at the turn snapshot; beats.length means settled. */
  beatIndex: number;
};

type TurnStages = {
  navigator: StageStatus;
  haru: StageStatus;
  aoi: StageStatus;
  director: StageStatus;
};

type PlanItem = {
  time: string;
  title: string;
  location: string;
  icon: string;
};

const PRESETS = [
  "一緒に朝食を作ってみたら？",
  "今日は2人で映画を見よう",
  "部屋の掃除を一緒にしてほしい",
  "相手に昨日のことを謝ってみて",
  "ベランダでゆっくり話してみたら？",
];

const PHASES: { id: Phase; label: string; short: string; time: string; icon: string }[] = [
  { id: "morning", label: "朝", short: "朝", time: "07:00", icon: "☀" },
  { id: "afternoon", label: "昼", short: "昼", time: "12:00", icon: "▤" },
  { id: "evening", label: "夕方", short: "夕", time: "18:00", icon: "◆" },
  { id: "night", label: "夜", short: "夜", time: "22:00", icon: "☾" },
];

type PersonInfo = { name: string; job: string; age: number };
type People = Record<CharacterId, PersonInfo>;

const PEOPLE: People = {
  haru: { name: "Haru", job: "Web Engineer", age: 27 },
  aoi: { name: "Aoi", job: "Designer", age: 26 },
};

const DAILY_PLANS: Record<CharacterId, Record<Phase, PlanItem>> = {
  haru: {
    morning: { time: "07:30", title: "コーヒーと身支度", location: "キッチン", icon: "☕" },
    afternoon: { time: "10:00", title: "リモートワーク", location: "自室", icon: "PC" },
    evening: { time: "19:00", title: "夕食と自由時間", location: "リビング", icon: "♨" },
    night: { time: "23:30", title: "読書をして休む", location: "自室", icon: "本" },
  },
  aoi: {
    morning: { time: "08:00", title: "朝のスケッチ", location: "リビング", icon: "✎" },
    afternoon: { time: "10:30", title: "デザイン作業", location: "自室", icon: "絵" },
    evening: { time: "18:30", title: "買い物と夕食", location: "キッチン", icon: "袋" },
    night: { time: "22:30", title: "音楽を聴いて休む", location: "自室", icon: "♪" },
  },
};

const RELATIONSHIPS: Record<GameState["shared"]["relationshipLabel"], string> = {
  strangers: "まだ他人",
  roommates: "ルームメイト",
  friends: "友だち",
  close_friends: "親しい友だち",
  romantic_tension: "恋の予感",
  couple: "恋人",
  broken: "すれ違い",
};

const DECISION_LABELS: Record<AgentDecision["decision"], string> = {
  ACCEPT: "受け入れる",
  DECLINE: "断る",
  MODIFY: "少し変える",
  IGNORE: "別のことをする",
  INITIATE: "自分から動く",
};

const WAITING_STAGES: TurnStages = {
  navigator: "waiting",
  haru: "waiting",
  aoi: "waiting",
  director: "waiting",
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const stringValue = (...values: unknown[]): string => {
  const found = values.find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found : "";
};

const shortId = (value?: string): string =>
  value ? `${value.slice(0, 7)}…${value.slice(-4)}` : "未発行";

const phaseIndex = (phase: Phase): number => PHASES.findIndex((item) => item.id === phase);

const clipText = (value: string, limit = 48): string =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

const createRunSeed = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `run-${crypto.randomUUID()}`
    : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function RuntimeBadge({ runtime, offline }: { runtime: RuntimeInfo; offline: boolean }) {
  const mode = offline ? "offline" : runtime.mode;
  const content = {
    "app-server": ["live", "AI LIVE"],
    "openai-api": ["openai", "OPENAI API"],
    mock: ["mock", "DEMO"],
    offline: ["offline", "OFFLINE"],
    unknown: ["checking", "CONNECTING"],
  }[mode];

  return (
    <span className={`runtime-badge runtime-${content[0]}`} title="現在のエージェント実行環境">
      <i aria-hidden="true" />
      {content[1]}
    </span>
  );
}

function DekopinGuide({ presentation }: { presentation: DekopinPresentation }) {
  return (
    <div className={`dekopin-guide is-${presentation.mood}`}>
      <span className="dekopin-avatar" aria-hidden="true">
        <span className="dekopin-sprite-window">
          <img className="dekopin-sprite-sheet" src={dekopinSpriteUrl} alt="" />
        </span>
        <i />
      </span>
      <span className="dekopin-copy">
        <span><b id="dekopin-title">{DEKOPIN_NAME}</b><small>{presentation.statusLabel}</small></span>
        <p aria-live="polite">{presentation.message}</p>
      </span>
    </div>
  );
}

function PixelPortrait({ person, thinking = false }: { person: CharacterId; thinking?: boolean }) {
  return <ResidentPortrait person={person} thinking={thinking} className="pixel-portrait" />;
}

function MetricBar({ metric, value, compact = false }: { metric: MetricKey; value: number; compact?: boolean }) {
  const meta: Record<MetricKey, { label: string; icon: string }> = {
    energy: { label: "元気", icon: "⚡" },
    stress: { label: "ストレス", icon: "!" },
    affection: { label: "好感", icon: "♥" },
    trust: { label: "信頼", icon: "◆" },
    romanticAwareness: { label: "恋心", icon: "♡" },
  };
  const safeValue = Math.min(100, Math.max(0, value));

  return (
    <div className={`metric metric-${metric} ${compact ? "metric-compact" : ""}`}>
      <div className="metric-copy">
        <span><b aria-hidden="true">{meta[metric].icon}</b>{meta[metric].label}</span>
        <strong>{Math.round(safeValue)}</strong>
      </div>
      <div className="metric-track" role="progressbar" aria-label={meta[metric].label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safeValue)}>
        <span style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function planFor(person: CharacterId, phase: Phase, state: CharacterState, currentPhase: Phase): PlanItem {
  const base = DAILY_PLANS[person][phase];
  if (phase !== currentPhase) return base;
  return { ...base, title: state.currentGoal || base.title, location: state.location || base.location };
}

function PhaseRail({ game }: { game: GameState }) {
  const activeIndex = phaseIndex(game.shared.phase);
  return (
    <div className="day-phase" aria-label={`Day ${game.shared.day}、${PHASES[activeIndex].label}`}>
      <div className="day-number"><span>DAY</span><strong>{game.shared.day}</strong><small>/ 7</small></div>
      <div className="phase-rail">
        {PHASES.map((phase, index) => (
          <div className={`phase-node ${index === activeIndex ? "is-current" : ""} ${index < activeIndex ? "is-past" : ""}`} key={phase.id}>
            <span>{index < activeIndex ? "✓" : phase.icon}</span><small>{phase.short}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResidentChip({
  person,
  info,
  state,
  selected,
  thinking,
  onSelect,
}: {
  person: CharacterId;
  info: PersonInfo;
  state: CharacterState;
  selected: boolean;
  thinking: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`resident-chip resident-${person} ${selected ? "is-selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <PixelPortrait person={person} thinking={thinking} />
      <span className="resident-chip-copy">
        <span><strong>{info.name}</strong><small>{state.mood}</small></span>
        <span className="chip-bars">
          <i className="chip-energy" style={{ "--value": `${state.energy}%` } as CSSProperties} />
          <i className="chip-stress" style={{ "--value": `${state.stress}%` } as CSSProperties} />
        </span>
        <b><span aria-hidden="true">⌂</span>{state.location}</b>
      </span>
      <span className="resident-cue" aria-hidden="true">›</span>
    </button>
  );
}

function FurnitureLayer() {
  return (
    <g className="furniture-layer" aria-hidden="true">
      <g className="entry-furniture">
        <polygon className="entry-mat" points="929,329 981,355 956,368 904,342" />
        <path className="door-mark" d="M1016 309v60M1016 369l42 21" />
      </g>
      <g className="wash-furniture">
        <polygon className="wash-unit" points="1062,350 1122,380 1095,394 1035,364" />
        <polygon className="basin" points="1072,357 1100,371 1087,378 1059,364" />
        <path d="M1080 355q3-16 14-8" />
        <rect className="mirror" x="1115" y="325" width="42" height="50" rx="3" />
      </g>
      <g className="bath-furniture">
        <polygon className="tub" points="934,418 1038,470 989,495 885,443" />
        <polygon className="water" points="942,426 1022,466 987,484 907,444" />
        <circle className="bubble" cx="952" cy="449" r="5" />
        <circle className="bubble" cx="975" cy="457" r="3" />
      </g>
      <g className="kitchen-furniture">
        <polygon className="counter-top" points="322,245 475,322 430,345 277,268" />
        <polygon className="counter-front" points="277,268 430,345 430,382 277,305" />
        <polygon className="counter-side" points="430,345 475,322 475,359 430,382" />
        <rect className="hob" x="343" y="280" width="36" height="19" rx="2" transform="rotate(27 343 280)" />
        <path className="steam" d="M365 273c-8-10 8-12 0-23M381 282c-8-10 8-12 0-23" />
        <g className="fridge"><polygon points="254,231 302,255 302,326 254,302" /><polygon points="302,255 328,242 328,313 302,326" /><path d="M262 272l30 15" /></g>
      </g>
      <g className="living-furniture">
        <polygon className="rug" points="648,423 846,522 768,561 570,462" />
      </g>
      <g className="balcony-furniture">
        <path className="rail" d="M164 314L752 608M157 329L745 623M164 314v15M260 362v15M356 410v15M452 458v15M548 506v15M644 554v15M752 608v15" />
        <path className="laundry" d="M559 536l118 59M566 529l-14 28M670 582l15 29" />
        <path className="shirt" d="M585 551l14-5 14 13-9 8 4 25-28-14 9-21-8-9z" />
        <path className="towel" d="M625 573l29 14-8 31-29-15z" />
      </g>
      <FurnitureSpriteLayer />
    </g>
  );
}

function SceneCharacter({
  person,
  name,
  point,
  selected,
  thinking,
  direction,
  moving,
  travelling,
  conversing,
  acting,
  dialogue,
  action,
  onSelect,
}: {
  person: CharacterId;
  name: string;
  point: Point;
  selected: boolean;
  thinking: boolean;
  direction: SpriteDirection;
  moving: boolean;
  travelling: boolean;
  conversing: boolean;
  acting: boolean;
  dialogue?: string;
  action?: string;
  onSelect: () => void;
}) {
  const bubbleX = point.x > 950 || person === "haru" ? -216 : 38;
  const activate = () => onSelect();
  return (
    <g
      className={`scene-character scene-${person} ${selected ? "is-selected" : ""} ${thinking ? "is-thinking" : ""} ${moving ? "is-moving" : ""} ${travelling ? "is-travelling" : ""} ${conversing ? "is-conversing" : ""} ${acting ? "is-acting" : ""}`}
      style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
      role="button"
      tabIndex={0}
      aria-label={thinking ? `${name}、判断中。選択` : `${name}を選択`}
      aria-busy={thinking ? true : undefined}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      {selected && <ellipse className="selection-ring" cx="0" cy="20" rx="30" ry="14" />}
      <ellipse className="character-shadow" cx="0" cy="18" rx="21" ry="9" />
      <g className="character-sprite">
        <foreignObject x="-32" y="-41" width="64" height="64" className="resident-sprite-object">
          <ResidentSceneSprite person={person} direction={direction} moving={moving} />
        </foreignObject>
      </g>
      <foreignObject x="-45" y="28" width="90" height="30" className="nameplate-object">
        <div className="scene-nameplate">{name}</div>
      </foreignObject>
      {thinking && (
        <foreignObject x="-62" y="-130" width="124" height="48" className="character-running-object" aria-hidden="true">
          <div className={`character-running-indicator indicator-${person}`}>
            <span className="running-signal" aria-hidden="true" />
            <strong>判断中</strong>
            <span className="running-dots" aria-hidden="true"><i /><i /><i /></span>
          </div>
        </foreignObject>
      )}
      {!thinking && (dialogue || action) && (
        <foreignObject x={bubbleX} y="-142" width="208" height="94" className="speech-object">
          <div className={`scene-speech speech-${person} ${action ? "is-action" : ""}`} aria-live={conversing || acting ? "polite" : undefined}>
            <small>{action ? "ACTION" : name}</small>
            <p>{clipText(action || dialogue || "", 46)}</p>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function ApartmentStage({
  game,
  people,
  stages,
  selectedPerson,
  currentEvent,
  afterScene,
  turnStart,
  resolving,
  onSelectPerson,
}: {
  game: GameState;
  people: People;
  stages: TurnStages;
  selectedPerson: CharacterId;
  currentEvent?: GameEvent;
  afterScene?: AfterScenePlayback;
  turnStart?: Partial<Record<CharacterId, CharacterState>>;
  resolving: boolean;
  onSelectPerson: (person: CharacterId) => void;
}) {
  const playback = afterScene?.plan.eventId === currentEvent?.id ? afterScene : undefined;
  const activeBeat = playback && playback.beatIndex >= 0
    ? playback.plan.beats[playback.beatIndex]
    : undefined;
  const beatFocusPerson = activeBeat?.actor === "aoi" ? "aoi" : "haru";
  const beatRoom = activeBeat?.focusLocation
    ? roomForLocation(activeBeat.focusLocation, beatFocusPerson)
    : undefined;
  const playbackStartLocation = turnStart?.[selectedPerson]?.location
    ?? currentEvent?.before?.characters[selectedPerson]?.location;
  const playbackStartRoom = playback?.beatIndex === -1 && playbackStartLocation
    ? roomForLocation(playbackStartLocation, selectedPerson)
    : undefined;
  const eventRoom = beatRoom ?? playbackStartRoom ?? (
    game.status === "resolved" || game.status === "ended"
      ? roomForEvent(currentEvent)
      : undefined
  );
  const selectedLocation = turnStart?.[selectedPerson]?.location
    ?? game[selectedPerson].location;
  const selectedRoom = roomForLocation(selectedLocation, selectedPerson);
  const focusRoom = eventRoom ?? selectedRoom;
  const focusPoint = focusPointForRoom(focusRoom);
  // Event focus changes only the camera/lighting. Character placement always
  // follows the resolved world state, including decline and split-room cases.
  const pointFor = (person: CharacterId): Point => {
    if (!playback) {
      // Keep the pre-turn pose through React's completion batching. The ref is
      // cleared only when the ordered playback has been installed.
      const state = turnStart?.[person];
      return characterAnchor(person, state ?? game[person]);
    }
    if (playback.beatIndex < 0) return playback.plan.initialPoints[person];
    return activeBeat?.points[person] ?? playback.plan.finalPoints[person];
  };
  const dialogueFor = (person: CharacterId): string | undefined => {
    if (!playback || resolving) {
      if (resolving) return undefined;
      return game.decisions[person]?.dialogue
        ?? (person === "haru" ? currentEvent?.haruDialogue : currentEvent?.aoiDialogue);
    }
    return activeBeat?.kind === "dialogue" && activeBeat.actor === person
      ? activeBeat.text
      : undefined;
  };
  const directionFor = (person: CharacterId): SpriteDirection => {
    if (!playback) return "south";
    return activeBeat?.directions[person] ?? playback.plan.finalDirections[person];
  };
  const actorIncludes = (person: CharacterId): boolean =>
    activeBeat?.actor === "both" || activeBeat?.actor === person;
  const isMoving = (person: CharacterId): boolean =>
    activeBeat?.kind === "move" && actorIncludes(person) && activeBeat.routes[person].hasTravel;
  const isActing = (person: CharacterId): boolean =>
    activeBeat?.kind === "action" && actorIncludes(person);
  const actionFor = (person: CharacterId): string | undefined =>
    isActing(person) && activeBeat?.kind === "action" ? activeBeat.action : undefined;

  return (
    <div className={`apartment-stage phase-${game.shared.phase} ${eventRoom ? "has-event-focus" : ""}`}>
      <svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${people.haru.name}と${people.aoi.name}が暮らす2LDKを南西側の斜め上から見た全景`}>
        <defs>
          <pattern id="floor-grid" width="50" height="25" patternUnits="userSpaceOnUse">
            <path d="M25 0L50 12.5 25 25 0 12.5z" fill="none" stroke="rgba(44,63,86,.11)" strokeWidth="1" />
          </pattern>
          <linearGradient id="sky-day" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8ddcf0" /><stop offset="1" stopColor="#dff6ec" />
          </linearGradient>
          <linearGradient id="sky-night" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#26345f" /><stop offset="1" stopColor="#53698a" />
          </linearGradient>
          <filter id="focus-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="9" floodColor="#ffe37a" floodOpacity=".9" />
          </filter>
          <filter id="map-shadow" x="-20%" y="-20%" width="150%" height="160%">
            <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#182d38" floodOpacity=".32" />
          </filter>
        </defs>
        <rect className="world-sky" x="0" y="0" width="1280" height="720" />
        <g className="sky-details" aria-hidden="true">
          <circle className="sky-orb" cx="1068" cy="104" r="38" />
          <path className="cloud cloud-one" d="M151 135c8-25 43-29 57-9 20-15 50-1 47 24H137c-3-7 2-13 14-15z" />
          <path className="cloud cloud-two" d="M934 183c7-19 32-22 44-7 15-11 38 0 36 18h-91c-2-5 2-10 11-11z" />
          <g className="stars"><circle cx="130" cy="86" r="3" /><circle cx="244" cy="118" r="2" /><circle cx="1017" cy="74" r="2" /><circle cx="1134" cy="178" r="3" /></g>
        </g>
        <ellipse className="map-ground-shadow" cx="676" cy="626" rx="526" ry="42" />
        <g
          className="apartment-map"
          style={{ transformOrigin: `${focusPoint.x}px ${focusPoint.y}px` }}
          filter="url(#map-shadow)"
        >
          <g className="room-floors">
            {ROOM_ZONES.map((zone) => (
              <g className={`room-zone room-${zone.id} ${zone.id === focusRoom ? "is-focus" : ""} ${eventRoom && zone.id !== eventRoom ? "is-muted" : ""}`} key={zone.id}>
                <polygon points={zone.points} filter={eventRoom && zone.id === eventRoom ? "url(#focus-glow)" : undefined} />
                <polygon className="floor-grid" points={zone.points} fill="url(#floor-grid)" />
                <text x={zone.labelPoint.x} y={zone.labelPoint.y}>{zone.label}</text>
              </g>
            ))}
          </g>
          <g className="cutaway-walls" aria-hidden="true">
            <polygon className="wall wall-north" points="600,100 1200,400 1200,349 600,49" />
            <polygon className="wall-cap" points="600,49 1200,349 1191,354 591,54" />
            <polygon className="wall wall-east" points="1200,400 750,625 750,574 1200,349" />
            <polygon className="wall-cap" points="1200,349 750,574 741,570 1191,345" />
            <path className="low-wall" d="M600 100L150 325M150 325L750 625" />
            <path className="partition high" d="M800 200L650 275M1000 300L850 375M1075 338L1000 375M925 338L800 400" />
            <path className="partition" d="M450 175L925 413M400 200L875 438M925 338L925 413M1000 375L800 475" />
          </g>
          <FurnitureLayer />
          <g className="character-layer">
            <SceneCharacter person="haru" name={people.haru.name} point={pointFor("haru")} selected={selectedPerson === "haru"} thinking={resolving && stages.haru === "active"} direction={directionFor("haru")} moving={isMoving("haru")} travelling={isMoving("haru")} conversing={activeBeat?.kind === "dialogue" && activeBeat.actor === "haru"} acting={isActing("haru")} dialogue={dialogueFor("haru")} action={actionFor("haru")} onSelect={() => onSelectPerson("haru")} />
            <SceneCharacter person="aoi" name={people.aoi.name} point={pointFor("aoi")} selected={selectedPerson === "aoi"} thinking={resolving && stages.aoi === "active"} direction={directionFor("aoi")} moving={isMoving("aoi")} travelling={isMoving("aoi")} conversing={activeBeat?.kind === "dialogue" && activeBeat.actor === "aoi"} acting={isActing("aoi")} dialogue={dialogueFor("aoi")} action={actionFor("aoi")} onSelect={() => onSelectPerson("aoi")} />
          </g>
        </g>
      </svg>
      <div className="stage-caption"><span className="live-dot" /><b>ROOM VIEW</b><small>2LDK · 全景カメラ</small></div>
      <div className="camera-note">操作：住人を選んで様子を見る</div>
    </div>
  );
}

function ResolutionProgress({ stages, active, message }: { stages: TurnStages; active: boolean; message: string }) {
  if (!active) return null;
  const items = [
    { key: "navigator" as const, name: DEKOPIN_NAME },
    { key: "haru" as const, name: "Haru" },
    { key: "aoi" as const, name: "Aoi" },
    { key: "director" as const, name: "できごと" },
  ];
  return (
    <div className="resolution-progress" aria-live="polite">
      <span className="resolution-label">NOW</span>
      {items.map((item, index) => (
        <div className={`progress-step step-${stages[item.key]}`} key={item.key}>
          <span>{stages[item.key] === "complete" ? "✓" : index + 1}</span><b>{item.name}</b>
        </div>
      ))}
      <p>{clipText(message || "ふたりがそれぞれの気持ちで考えています…", 40)}</p>
    </div>
  );
}

function EventCard({
  event,
  resolving,
  fresh,
  lastSuggestion,
  navigatorMessage,
  onOpen,
}: {
  event?: GameEvent;
  resolving: boolean;
  fresh: boolean;
  lastSuggestion: string;
  navigatorMessage?: string;
  onOpen?: () => void;
}) {
  if (!event && !resolving) {
    return (
      <div className="event-card event-welcome">
        <span className="event-icon" aria-hidden="true">⌂</span>
        <div><small>DAY 1 · NEW LIFE</small><h2>ふたりの生活を見守ろう</h2><p>命令ではなく、きっかけだけを届けられます。</p></div>
      </div>
    );
  }
  if (resolving) {
    return (
      <div className="event-card event-live">
        <span className="event-icon" aria-hidden="true">…</span>
        <div><small>DEKOPIN · EVENT UPDATE</small><h2>デコピンが反映しています</h2><p>{clipText(lastSuggestion, 62)}</p></div>
      </div>
    );
  }
  return (
    <div className={`event-card event-result ${fresh ? "is-fresh" : ""}`}>
      <span className="event-icon" aria-hidden="true">★</span>
      <div>
        <small>デコピンが反映したイベント · DAY {event?.day}</small>
        <h2>{event?.eventTitle}</h2>
        <p>{clipText(event?.narration ?? "", 74)}</p>
        {navigatorMessage && <p className="event-dekopin-message"><b>{DEKOPIN_NAME}</b>「{clipText(navigatorMessage, 64)}」</p>}
        {event && onOpen && <button type="button" className="event-card-open" onClick={onOpen} aria-haspopup="dialog" aria-label={`${event.eventTitle}の全文を読む`}>全文を読む <span aria-hidden="true">↗</span></button>}
      </div>
    </div>
  );
}

function EventAnnouncementModal({
  event,
  people,
  suggestion,
  navigatorMessage,
  notice,
  canAdvance,
  logLabel = "生活ログで詳しく見る",
  continueLabel,
  onClose,
  onOpenLog,
  onAdvance,
}: {
  event: GameEvent;
  people: People;
  suggestion?: string;
  navigatorMessage?: string;
  notice?: string;
  canAdvance: boolean;
  logLabel?: string;
  continueLabel?: string;
  onClose: () => void;
  onOpenLog: () => void;
  onAdvance: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const phase = PHASES.find((item) => item.id === event.phase) ?? PHASES[0];
  const residents = [
    {
      id: "haru" as const,
      decision: event.haruDecision,
      action: event.haruAction,
      dialogue: event.haruDialogue,
      reason: event.haruPublicReason,
    },
    {
      id: "aoi" as const,
      decision: event.aoiDecision,
      action: event.aoiAction,
      dialogue: event.aoiDialogue,
      reason: event.aoiPublicReason,
    },
  ];
  const safetyFlags = event.cueResolution?.cue?.safetyFlags ?? event.cueSafetyFlags ?? [];
  const displayedSuggestion = suggestion || event.suggestion;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (keyboardEvent: globalThis.KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        onClose();
        return;
      }
      if (keyboardEvent.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        keyboardEvent.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        keyboardEvent.preventDefault();
        (keyboardEvent.shiftKey ? last : first)?.focus();
      } else if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault();
        last?.focus();
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="event-announcement-overlay"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose();
      }}
    >
      <section
        className="event-announcement-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-announcement-title"
        aria-describedby="event-announcement-narration"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="event-announcement-header">
          <span className="event-announcement-mark" aria-hidden="true">★</span>
          <div>
            <small>EVENT RESOLVED · DAY {event.day} · {phase.label} {phase.time}</small>
            <h2 id="event-announcement-title">{event.eventTitle}</h2>
            <p>デコピンが指示をイベントへ反映しました</p>
          </div>
          <button ref={closeRef} type="button" className="event-announcement-close" onClick={onClose} aria-label="イベント通知を閉じる">×</button>
        </header>

        <div className="event-announcement-scroll">
          {notice && <aside className="event-announcement-notice" role="status"><span aria-hidden="true">!</span><p>{notice}</p></aside>}

          {navigatorMessage && (
            <section className="event-announcement-dekopin" aria-label="デコピンの応答">
              <div className="event-announcement-mini-avatar" aria-hidden="true">
                <span><img src={dekopinSpriteUrl} alt="" /></span>
              </div>
              <div><small>{DEKOPIN_NAME} · EVENT NAVIGATOR</small><p>「{navigatorMessage}」</p></div>
            </section>
          )}

          {displayedSuggestion && (
            <section className="event-announcement-cue">
              <small>あなたからデコピンへの指示</small>
              <p>{displayedSuggestion}</p>
            </section>
          )}

          <section className="event-announcement-story">
            <small>起きたこと</small>
            <p id="event-announcement-narration">{event.narration}</p>
          </section>

          <section className="event-announcement-actions" aria-label="ふたりの選択">
            {residents.map((resident) => (
              <article className={`event-announcement-person person-${resident.id}`} key={resident.id}>
                <header>
                  <PixelPortrait person={resident.id} />
                  <div><small>{people[resident.id].job.toUpperCase()}</small><h3>{people[resident.id].name}</h3></div>
                  {resident.decision && <span className={`decision-chip chip-${resident.decision.toLowerCase()}`}>{DECISION_LABELS[resident.decision]}</span>}
                </header>
                <strong>{resident.action || "自分のペースで過ごしました"}</strong>
                {resident.dialogue && <blockquote>「{resident.dialogue}」</blockquote>}
                {resident.reason && <p><small>そうした理由</small>{resident.reason}</p>}
              </article>
            ))}
          </section>

          {(event.cueResolution?.outcome || event.cueResolution?.lock?.reason || safetyFlags.length > 0 || event.memory?.title) && (
            <dl className="event-announcement-details">
              {event.cueResolution?.outcome && <div><dt>指示の扱い</dt><dd>{event.cueResolution.outcome}</dd></div>}
              {event.cueResolution?.lock?.reason && <div><dt>調整した理由</dt><dd>{event.cueResolution.lock.reason}</dd></div>}
              {safetyFlags.length > 0 && <div><dt>安全確認</dt><dd>{safetyFlags.join("・")}</dd></div>}
              {event.memory?.title && <div><dt>残った思い出</dt><dd>{event.memory.title}</dd></div>}
            </dl>
          )}
        </div>

        <footer className="event-announcement-footer">
          <button type="button" className="event-announcement-log" onClick={onOpenLog}>{logLabel}</button>
          <button type="button" className="event-announcement-continue" onClick={canAdvance ? onAdvance : onClose}>
            {continueLabel ?? (canAdvance ? "次の時間帯へ" : "ゲームに戻る")}<span aria-hidden="true">›</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function CharacterInspector({
  person,
  info,
  state,
  decision,
  thinking,
}: {
  person: CharacterId;
  info: PersonInfo;
  state: CharacterState;
  decision?: AgentDecision;
  thinking: boolean;
}) {
  return (
    <section className={`inspector-character character-${person}`}>
      <div className="inspector-profile">
        <PixelPortrait person={person} thinking={thinking} />
        <div><small>{info.job.toUpperCase()} · {info.age}</small><h2>{info.name}</h2><span className="mood-pill">{state.mood}</span></div>
        <span className="level-badge"><small>LEVEL</small><b>{12 + (person === "aoi" ? 2 : 0)}</b></span>
      </div>
      <div className="inspector-now">
        <div><small>現在地</small><b><span aria-hidden="true">⌂</span>{state.location}</b></div>
        <div><small>いまの目標</small><p>{state.currentGoal}</p></div>
      </div>
      <div className="inspector-metrics">
        <MetricBar metric="energy" value={state.energy} />
        <MetricBar metric="stress" value={state.stress} />
        <MetricBar metric="affection" value={state.affection} />
        <MetricBar metric="trust" value={state.trust} />
        <MetricBar metric="romanticAwareness" value={state.romanticAwareness} />
      </div>
      <div className={`decision-card ${decision ? "has-decision" : ""}`}>
        <div><small>今回の選択</small>{decision && <span className={`decision-chip chip-${decision.decision.toLowerCase()}`}>{DECISION_LABELS[decision.decision]}</span>}</div>
        <strong>{thinking ? "どうするか考えています…" : decision?.action ?? "まだ行動は決めていません"}</strong>
        {decision?.publicReason && <p>{decision.publicReason}</p>}
      </div>
      <p className="private-note"><span aria-hidden="true">鍵</span> 公開できる気持ちの要約だけを表示しています。</p>
    </section>
  );
}

function SchedulePanel({
  game,
  people,
  canUseCue,
  onUseCue,
}: {
  game: GameState;
  people: People;
  canUseCue: boolean;
  onUseCue: (value: string) => void;
}) {
  const activeIndex = phaseIndex(game.shared.phase);
  return (
    <section className="schedule-panel">
      <div className="week-strip" aria-label="7日間の進行">
        {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => (
          <span className={`${day === game.shared.day ? "is-today" : ""} ${day < game.shared.day ? "is-done" : ""}`} key={day}><small>D</small><b>{day}</b></span>
        ))}
      </div>
      <div className="section-title"><div><small>TODAY'S PLAN</small><h2>今日の予定</h2></div><span>閲覧のみ</span></div>
      <div className="schedule-grid">
        {PHASES.map((phase, index) => (
          <div className={`schedule-row ${index === activeIndex ? "is-current" : ""} ${index < activeIndex ? "is-past" : ""}`} key={phase.id}>
            <div className="schedule-time"><span>{index < activeIndex ? "✓" : phase.icon}</span><b>{phase.time}</b><small>{phase.label}</small></div>
            <div className="schedule-pair">
              {(["haru", "aoi"] as CharacterId[]).map((person) => {
                const plan = planFor(person, phase.id, game[person], game.shared.phase);
                return (
                  <button type="button" className={`schedule-item schedule-${person}`} key={person} onClick={() => onUseCue(`${people[person].name}の「${plan.title}」に、ふたりで取り組んでみたら？`)} disabled={!canUseCue} title={canUseCue ? "この予定からきっかけ文を作る" : "次の時間帯へ進むと、新しいきっかけを作れます"}>
                    <span className="plan-icon" aria-hidden="true">{plan.icon}</span>
                    <span><small>{people[person].name}</small><strong>{plan.title}</strong><em>{plan.location}</em></span>
                    {index === activeIndex && <i>NOW</i>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="panel-note"><span>i</span><p>{canUseCue ? "予定を押すと、その行動に合わせた「きっかけ」の文案を作れます。" : "次の時間帯へ進むと、予定から新しい「きっかけ」を作れます。"}</p></div>
    </section>
  );
}

function MemoryPanel({
  game,
  onOpenMemory,
}: {
  game: GameState;
  onOpenMemory: (memory: Memory) => void;
}) {
  const memories = [...game.shared.sharedMemories].reverse();
  return (
    <section className="memories-panel">
      <div className="memory-summary"><span><small>MEMORIES</small><b>{memories.length.toString().padStart(2, "0")}</b></span><div><small>RELATIONSHIP</small><strong>♡ {RELATIONSHIPS[game.shared.relationshipLabel]}</strong></div></div>
      {game.shared.unresolvedConflicts.length > 0 && <div className="conflict-box"><small>気になること</small><ul>{game.shared.unresolvedConflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}</ul></div>}
      {memories.length ? (
        <ol className="memory-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <span className={memory.emotionalImpact >= 0 ? "memory-good" : "memory-bad"}>{memory.emotionalImpact >= 0 ? "✦" : "!"}</span>
              <div><small>DAY {memory.day} · IMPORTANCE {memory.importance}</small><h3>{memory.title}</h3><p>{memory.summary}</p><button type="button" onClick={() => onOpenMemory(memory)}>ふたりの記事を読む <span aria-hidden="true">›</span></button></div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-memories"><span aria-hidden="true">◇</span><h3>まだ思い出はありません</h3><p>心に残った出来事が、ここへコレクションされます。</p></div>
      )}
    </section>
  );
}

function MemoryArticleModal({
  article,
  people,
  onClose,
}: {
  article: MemoryArticle;
  people: People;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const phase = PHASES.find((item) => item.id === article.phase) ?? PHASES[0];

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!controls.length) return;
      const firstControl = controls[0];
      const lastControl = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  const characterStory = (person: CharacterId) => {
    const detail = article[person];
    const name = people[person].name;
    return (
      <section className={`memory-character-story is-${person}`}>
        <header><PixelPortrait person={person} /><div><small>{name.toUpperCase()} VIEW</small><h3>{name}が選んだこと</h3></div></header>
        {detail.decision && <span className="memory-decision-badge">{DECISION_LABELS[detail.decision]}</span>}
        <p className="memory-action">{detail.action || "公開された行動の記録はありません。"}</p>
        {detail.dialogue && <blockquote>「{detail.dialogue}」</blockquote>}
        {detail.publicReason && <p className="memory-public-reason"><strong>その時の理由</strong>{detail.publicReason}</p>}
      </section>
    );
  };

  return (
    <div
      className="memory-article-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article
        className="memory-article-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-article-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="memory-article-header">
          <div className="memory-article-date"><span>DAY</span><strong>{article.memory.day}</strong><small>{phase.icon} {phase.label}</small></div>
          <div><p>ROOMMATES LIFE ARCHIVE</p><h2 id="memory-article-title">{article.memory.title}</h2><span>記憶の重要度 {article.memory.importance} / 10</span></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="思い出の記事を閉じる">×</button>
        </header>

        <div className={`memory-article-scene phase-${article.phase}`}>
          <div className="memory-scene-person is-haru"><PixelPortrait person="haru" /><strong>{people.haru.name}</strong><span>{article.scene.haru}</span></div>
          <div className="memory-scene-heart" aria-hidden="true">✦</div>
          <div className="memory-scene-person is-aoi"><PixelPortrait person="aoi" /><strong>{people.aoi.name}</strong><span>{article.scene.aoi}</span></div>
          <small>{article.captureIsExact ? "保存された位置から再現" : "出来事から場所を再構成"}</small>
        </div>

        <div className="memory-article-body">
          <section className="memory-article-lead">
            <p className="memory-kicker">MEMORY STORY</p>
            <h3>{article.event?.eventTitle ?? article.memory.title}</h3>
            <p>{article.event?.narration || article.memory.summary}</p>
            {article.event?.suggestion && <p className="memory-producer-cue"><strong>デコピンへの指示</strong>{article.event.suggestion}</p>}
          </section>
          <div className="memory-character-columns">
            {characterStory("haru")}
            {characterStory("aoi")}
          </div>
          <footer>
            <span aria-hidden="true">✦</span>
            <p>{article.memory.summary}</p>
            {!article.event && <small>この記憶に対応する公開イベントログがないため、保存された記憶だけを表示しています。</small>}
          </footer>
        </div>
      </article>
    </div>
  );
}

function DebugDetails({ game }: { game: GameState }) {
  const runtime = game.runtime;
  return (
    <details className="debug-details">
      <summary><span>ランタイム情報</span><small>DEMO DEBUG</small></summary>
      <div className="debug-grid">
        <div><span>Revision</span><code>{game.revision}</code></div>
        <div><span>Status</span><code>{game.status}</code></div>
        <div><span>Haru thread</span><code>{shortId(runtime.haruThreadId)}</code></div>
        <div><span>Aoi thread</span><code>{shortId(runtime.aoiThreadId)}</code></div>
        <div><span>Director</span><code>{shortId(runtime.directorThreadId)}</code></div>
        <div><span>Model</span><code>{runtime.model ?? "server default"}</code></div>
      </div>
    </details>
  );
}

function LogDrawer({
  events,
  navigatorResponses,
  filter,
  onFilter,
  onClose,
}: {
  events: GameEvent[];
  navigatorResponses: Record<string, string>;
  filter: LogFilter;
  onFilter: (filter: LogFilter) => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const visible = events.filter((event) => {
    if (filter === "haru") return Boolean(event.haruDialogue);
    if (filter === "aoi") return Boolean(event.aoiDialogue);
    return true;
  }).slice().reverse();

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    drawerRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (keyboardEvent: globalThis.KeyboardEvent) => {
      if (keyboardEvent.key !== "Escape") return;
      keyboardEvent.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <section id="life-log-drawer" className="log-drawer" role="dialog" aria-modal="false" aria-labelledby="log-title" ref={drawerRef} tabIndex={-1}>
      <header>
        <div><small>LIFE ARCHIVE</small><h2 id="log-title">ふたりの生活ログ</h2></div>
        <div className="log-filters" role="tablist" aria-label="ログの絞り込み">
          {([[
            "all", "すべて"
          ], ["haru", "Haru"], ["aoi", "Aoi"], ["event", "できごと"]] as [LogFilter, string][]).map(([id, label]) => (
            <button type="button" id={`log-filter-${id}`} role="tab" aria-selected={filter === id} aria-controls="life-log-list" tabIndex={filter === id ? 0 : -1} className={filter === id ? "is-active" : ""} onClick={() => onFilter(id)} key={id}>{label}</button>
          ))}
        </div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="ログを閉じる">×</button>
      </header>
      <div id="life-log-list" className="log-list" role="tabpanel" aria-labelledby={`log-filter-${filter}`} tabIndex={0}>
        {visible.length ? visible.map((event) => {
          const navigatorMessage = event.navigatorMessage
            ?? navigatorResponses[event.id]
            ?? navigatorResponses[event.eventTitle];
          return (
          <article className="log-entry" key={event.id}>
            <div className="log-time"><b>DAY {event.day}</b><span>{PHASES.find((phase) => phase.id === event.phase)?.label ?? event.phase}</span></div>
            <div className="log-copy">
              <small>★ できごと</small><h3>{event.eventTitle}</h3>
              {filter !== "haru" && filter !== "aoi" && event.suggestion && <p className="log-cue"><b>デコピンへの指示</b>{event.suggestion}</p>}
              {filter !== "haru" && filter !== "aoi" && <p>{event.narration}</p>}
              {filter !== "haru" && filter !== "aoi" && navigatorMessage && <blockquote className="quote-dekopin"><b>{DEKOPIN_NAME}</b>「{navigatorMessage}」</blockquote>}
              {filter !== "event" && event.haruDialogue && <blockquote className="quote-haru"><b>Haru</b>「{event.haruDialogue}」</blockquote>}
              {filter !== "event" && event.aoiDialogue && <blockquote className="quote-aoi"><b>Aoi</b>「{event.aoiDialogue}」</blockquote>}
            </div>
          </article>
          );
        }) : <div className="empty-log"><span>⌁</span><h3>まだ記録はありません</h3><p>生活が進むと、ここから出来事を振り返れます。</p></div>}
      </div>
    </section>
  );
}

export default function App() {
  const characterSettings = useCharacterSettings();
  const people = useMemo<People>(() => ({
    haru: {
      name: characterSettings.savedSettings.characters.haru.profile.name,
      job: characterSettings.savedSettings.characters.haru.profile.occupation,
      age: characterSettings.savedSettings.characters.haru.profile.age,
    },
    aoi: {
      name: characterSettings.savedSettings.characters.aoi.profile.name,
      job: characterSettings.savedSettings.characters.aoi.profile.occupation,
      age: characterSettings.savedSettings.characters.aoi.profile.age,
    },
  }), [characterSettings.savedSettings]);
  const [game, setGame] = useState<GameState>(INITIAL_GAME_STATE);
  const [suggestion, setSuggestion] = useState("");
  const [lastSuggestion, setLastSuggestion] = useState("");
  const [stages, setStages] = useState<TurnStages>(WAITING_STAGES);
  const [resolving, setResolving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [openaiApiConfigured, setOpenaiApiConfigured] = useState(false);
  const [actionBusy, setActionBusy] = useState<ActionBusy>(null);
  const [streamMessage, setStreamMessage] = useState("");
  const [navigatorMessage, setNavigatorMessage] = useState("");
  const [navigatorResponses, setNavigatorResponses] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<CharacterId>("haru");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("status");
  const [logOpen, setLogOpen] = useState(false);
  const [mapOverlaysVisible, setMapOverlaysVisible] = useState(true);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [eventAnnouncementId, setEventAnnouncementId] = useState<string | null>(null);
  const [freshEventId, setFreshEventId] = useState<string | null>(null);
  const [eventSuggestionFallbacks, setEventSuggestionFallbacks] = useState<Record<string, string>>({});
  const [afterScene, setAfterScene] = useState<AfterScenePlayback>();
  const [reducedMotion, setReducedMotion] = useState(false);
  const [activeMemory, setActiveMemory] = useState<Memory>();
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const personalityButtonRef = useRef<HTMLButtonElement | null>(null);
  const suggestionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const operationRef = useRef<"turn" | Exclude<ActionBusy, null> | null>(null);
  const presentedEventIdRef = useRef<string | null | undefined>(undefined);
  const submittedSuggestionRef = useRef<string | null>(null);
  const playedAfterSceneIdsRef = useRef(new Set<string>());
  const turnStartStatesRef = useRef<Partial<Record<CharacterId, CharacterState>> | undefined>(undefined);

  const closePersonality = useCallback(() => {
    setPersonalityOpen(false);
    window.requestAnimationFrame(() => personalityButtonRef.current?.focus());
  }, []);
  const closeLog = useCallback(() => setLogOpen(false), []);

  const refreshGame = useCallback(async (signal?: AbortSignal) => {
    const payload = await getGame(signal);
    setGame((previous) => normalizeGameState(payload, previous));
    setOffline(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadRuntimeHealth = getRuntimeHealth(controller.signal)
      .then((health) => setOpenaiApiConfigured(health.openaiApiConfigured));
    Promise.all([refreshGame(controller.signal), loadRuntimeHealth])
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOffline(true);
        setNotice(error instanceof Error ? `ゲームサーバーに接続できません：${error.message}` : "ゲームサーバーに接続できません");
      })
      .finally(() => {
        if (!controller.signal.aborted) setInitialLoading(false);
      });
    return () => controller.abort();
  }, [refreshGame]);

  useEffect(() => {
    if (initialLoading || resolving || game.status !== "resolving") return;
    let cancelled = false;
    const pollPersistedTurn = () => {
      void refreshGame().catch(() => {
        if (!cancelled) setOffline(true);
      });
    };
    pollPersistedTurn();
    const interval = window.setInterval(pollPersistedTurn, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [game.status, initialLoading, refreshGame, resolving]);

  useEffect(() => () => turnAbortRef.current?.abort(), []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (
      !afterScene
      || eventAnnouncementId
      || logOpen
      || personalityOpen
      || activeMemory
      || resolving
      || actionBusy
    ) return;
    if (game.status === "ended" || game.completed) {
      setAfterScene(undefined);
      return;
    }

    const activeBeat = afterScene.beatIndex >= 0
      ? afterScene.plan.beats[afterScene.beatIndex]
      : undefined;
    const delay = afterScene.beatIndex < 0
      ? 80
      : !activeBeat
        ? null
        : activeBeat.kind === "move"
          ? reducedMotion
            ? 80
            : Object.values(activeBeat.routes).some((route) => route.hasTravel)
              ? 1_650
              : 450
          : activeBeat.kind === "dialogue"
            ? Math.min(3_400, Math.max(2_100, activeBeat.text.length * 70))
            : reducedMotion
              ? 500
              : Math.min(2_800, Math.max(1_500, activeBeat.action.length * 45));
    if (delay === null) return;

    const timer = window.setTimeout(() => {
      setAfterScene((current) => {
        if (!current || current.plan.eventId !== afterScene.plan.eventId) return current;
        return {
          ...current,
          beatIndex: Math.min(current.beatIndex + 1, current.plan.beats.length),
        };
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    actionBusy,
    activeMemory,
    afterScene,
    eventAnnouncementId,
    game.completed,
    game.status,
    logOpen,
    personalityOpen,
    reducedMotion,
    resolving,
  ]);

  const applyStreamMessage = useCallback((message: StreamMessage) => {
    const envelope = record(message.data);
    const inner = record(envelope.data);
    const payload = Object.keys(inner).length ? inner : message.data;
    const normalizedType = stringValue(message.event, envelope.type).toLowerCase();
    const agent = stringValue(envelope.agent, record(payload).agent).toLowerCase();
    const displayMessage = stringValue(envelope.message, record(payload).message);
    if (displayMessage) setStreamMessage(displayMessage);

    if (normalizedType === "result.generating" || normalizedType === "result.completed") {
      const resultPayload = Object.keys(record(record(payload).result)).length
        ? record(payload).result
        : payload;
      setGame((previous) => normalizeGameState({ result: resultPayload }, previous));
      setStreamMessage(
        displayMessage ||
        (normalizedType === "result.generating"
          ? "7日間の評価と総集編を作っています…"
          : "リザルトが完成しました"),
      );
      return;
    }
    if (normalizedType === "agent.reflecting" || normalizedType === "agent.reflected") {
      setStreamMessage(
        displayMessage ||
        (normalizedType === "agent.reflecting"
          ? "ふたりに7日間の感想を聞いています…"
          : "ふたりの感想を受け取りました"),
      );
      return;
    }

    if (normalizedType === "turn.started") {
      setNavigatorMessage("");
      setStages({ navigator: "active", haru: "waiting", aoi: "waiting", director: "waiting" });
      const safeSuggestion = record(payload);
      const lock = record(safeSuggestion.lock);
      const cue = record(safeSuggestion.cue);
      const lockReason = stringValue(lock.reason);
      if (lockReason) {
        const alternatives = Array.isArray(safeSuggestion.alternatives)
          ? safeSuggestion.alternatives.map((alternative) => stringValue(record(alternative).title, alternative)).filter(Boolean).slice(0, 3)
          : [];
        setNotice(alternatives.length ? `${lockReason} 代わりの候補：${alternatives.join("・")}` : lockReason);
      } else if (cue.transformed === true) {
        const eventTitle = stringValue(safeSuggestion.eventTitle);
        setNotice(eventTitle ? `安全なきっかけ「${eventTitle}」へ変換しました。` : "安全なきっかけへ変換しました。");
      }
    }
    if (normalizedType === "agent.thinking") {
      setStages((previous) => ({
        ...previous,
        ...(agent === "haru" ? { haru: "active" as const } : {}),
        ...(agent === "aoi" ? { aoi: "active" as const } : {}),
      }));
    }
    if (
      normalizedType === "navigator.thinking"
      || (normalizedType === "agent.thinking" && agent === "navigator")
    ) {
      setNavigatorMessage(displayMessage || "指示を受け取ったよ。ふたりの意思を確認しているところ…");
      setStages((previous) => ({ ...previous, navigator: "active" }));
    }
    if (normalizedType === "agent.completed") {
      setStages((previous) => ({
        ...previous,
        ...(agent === "haru" ? { haru: "complete" as const } : {}),
        ...(agent === "aoi" ? { aoi: "complete" as const } : {}),
      }));
    }
    if (
      normalizedType === "navigator.completed"
      || (normalizedType === "agent.completed" && agent === "navigator")
    ) {
      const response = displayMessage || stringValue(
        record(payload).navigatorMessage,
        record(payload).navigator_message,
        record(payload).response,
      );
      const eventTitle = stringValue(
        record(payload).eventTitle,
        record(payload).event_title,
        envelope.eventTitle,
      );
      const eventId = stringValue(record(payload).eventId, record(payload).event_id, envelope.eventId);
      if (response) {
        setNavigatorMessage(response);
        setNavigatorResponses((previous) => ({
          ...previous,
          ...(eventTitle ? { [eventTitle]: response } : {}),
          ...(eventId ? { [eventId]: response } : {}),
        }));
      }
      setStages((previous) => ({ ...previous, navigator: "complete" }));
    }
    if (normalizedType === "director.resolving" || normalizedType === "director.completed") {
      setStages((previous) => ({
        ...previous,
        director: normalizedType === "director.completed" ? "complete" : "active",
      }));
    }
    if (normalizedType === "turn.completed") setStages({ navigator: "complete", haru: "complete", aoi: "complete", director: "complete" });
    if (normalizedType === "warning") setNotice(displayMessage || "一部のエージェントがモックへ切り替わりました");
    if (normalizedType === "error") setNotice(displayMessage || "ターン処理でエラーが発生しました");
    // Intermediate agent/director payloads are progress only. The committed
    // turn is the sole authority for positions, dialogue, and choreography.
    if (normalizedType === "turn.completed" && Object.keys(record(payload)).length) {
      setGame((previous) => normalizeGameState(payload, previous));
    }
  }, []);

  const submitSuggestion = async (value?: string) => {
    if (operationRef.current || initialLoading || resolving || game.completed || offline) return;
    if (game.status !== "awaiting_suggestion") {
      setNotice(
        game.status === "resolved"
          ? "次の指示を送る前に「次の時間帯」を押してください。"
          : "デコピンが現在の指示を反映しています。しばらくお待ちください。",
      );
      return;
    }
    const cue = (value ?? suggestion).trim();
    if (!cue) {
      setNotice("ふたりへのきっかけを入力するか、「何もせず見守る」を選んでください。");
      return;
    }
    operationRef.current = "turn";
    setFreshEventId(null);
    turnStartStatesRef.current = {
      haru: { ...game.haru },
      aoi: { ...game.aoi },
    };
    setAfterScene(undefined);
    setNotice("");
    setLastSuggestion(cue);
    submittedSuggestionRef.current = cue;
    setNavigatorMessage("");
    setResolving(true);
    setStreamMessage("同じ瞬間のスナップショットを準備しています…");
    setStages({ navigator: "active", haru: "waiting", aoi: "waiting", director: "waiting" });
    turnAbortRef.current = new AbortController();
    try {
      await runTurn(
        cue,
        game.revision,
        characterSettings.savedSettings,
        applyStreamMessage,
        turnAbortRef.current.signal,
      );
      await refreshGame();
      setSuggestion("");
    } catch (error) {
      if (turnAbortRef.current.signal.aborted) return;
      setNotice(error instanceof Error ? error.message : "ターンの処理に失敗しました");
    } finally {
      setResolving(false);
      turnAbortRef.current = null;
      if (operationRef.current === "turn") operationRef.current = null;
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitSuggestion();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submitSuggestion();
    }
  };

  const runAction = async (
    kind: "advance" | "reset" | "fast",
    resetSeed = game.seed,
  ) => {
    if (operationRef.current || initialLoading || resolving || actionBusy) return;
    if (kind === "advance" && game.status !== "resolved") {
      setNotice(
        game.status === "awaiting_suggestion"
          ? "先にデコピンへ指示するか、「見守る」を選んでください。"
          : "現在のターンが完了するまでお待ちください。",
      );
      return;
    }
    if (kind === "fast" && game.status !== "awaiting_suggestion" && game.status !== "resolved") {
      setNotice("現在のターンが完了するまでお待ちください。");
      return;
    }
    operationRef.current = kind;
    setFreshEventId(null);
    setAfterScene(undefined);
    turnStartStatesRef.current = undefined;
    submittedSuggestionRef.current = null;
    if (kind === "fast") setNavigatorMessage("");
    setActionBusy(kind);
    setNotice("");
    try {
      const payload = await (kind === "advance"
        ? advanceGame()
        : kind === "reset"
          ? resetGame(resetSeed)
          : fastForwardGame(characterSettings.savedSettings));
      if (payload !== undefined) setGame((previous) => normalizeGameState(payload, kind === "reset" ? INITIAL_GAME_STATE : previous));
      else await refreshGame();
      if (kind === "reset") {
        setSuggestion("");
        setLastSuggestion("");
        setNavigatorMessage("");
        setNavigatorResponses({});
        setStages(WAITING_STAGES);
        setSelectedPerson("haru");
        setInspectorTab("status");
        setLogOpen(false);
        setEventAnnouncementId(null);
        setEventSuggestionFallbacks({});
        playedAfterSceneIdsRef.current.clear();
        presentedEventIdRef.current = null;
        setActiveMemory(undefined);
      } else if (kind === "advance") {
        setStreamMessage("");
        setNavigatorMessage("");
        setStages(WAITING_STAGES);
      }
      setOffline(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作に失敗しました");
    } finally {
      setActionBusy(null);
      if (operationRef.current === kind) operationRef.current = null;
    }
  };

  const eventLog = useMemo(() => {
    if (game.eventLog.length) return game.eventLog;
    return game.currentEvent ? [game.currentEvent] : [];
  }, [game.currentEvent, game.eventLog]);
  const memoryArticle = useMemo(
    () => activeMemory ? buildMemoryArticle(activeMemory, eventLog) : undefined,
    [activeMemory, eventLog],
  );
  const latestEvent = game.currentEvent ?? eventLog[eventLog.length - 1];
  const latestNavigatorMessage = latestEvent
    ? latestEvent.navigatorMessage
      ?? navigatorResponses[latestEvent.id]
      ?? navigatorResponses[latestEvent.eventTitle]
      ?? navigatorMessage
    : navigatorMessage;
  const dekopinPresentation = useMemo(
    () => getDekopinPresentation({
      resolving,
      offline,
      draft: suggestion,
      streamMessage: navigatorMessage || streamMessage,
      event: latestEvent
        ? {
            eventTitle: latestEvent.eventTitle,
            narration: latestEvent.narration,
            navigatorMessage: latestNavigatorMessage || undefined,
          }
        : undefined,
      sessionMessage: latestNavigatorMessage,
    }),
    [
      latestEvent,
      latestNavigatorMessage,
      navigatorMessage,
      offline,
      resolving,
      streamMessage,
      suggestion,
    ],
  );
  const controls = getGameControlState({
    status: game.status,
    completed: game.completed,
    loading: initialLoading,
    offline,
    resolving,
    actionBusy,
  });
  const { canSubmitCue, canAdvance, canFastForward } = controls;
  const activePhase = PHASES.find((phase) => phase.id === game.shared.phase) ?? PHASES[0];
  const eventAnnouncement = eventAnnouncementId
    ? eventLog.find((event) => event.id === eventAnnouncementId)
      ?? (latestEvent?.id === eventAnnouncementId ? latestEvent : undefined)
    : undefined;

  const beginAfterScene = useCallback((event: GameEvent) => {
    if (playedAfterSceneIdsRef.current.has(event.id)) return;
    playedAfterSceneIdsRef.current.add(event.id);
    setAfterScene({
      plan: createAfterScenePlan(event, game, turnStartStatesRef.current),
      beatIndex: -1,
    });
    turnStartStatesRef.current = undefined;
  }, [game]);

  useEffect(() => {
    if (initialLoading) return;
    const latestId = latestEvent?.id ?? null;
    if (presentedEventIdRef.current === undefined) {
      // Existing saves should not reopen their latest historical event on load.
      presentedEventIdRef.current = latestId;
      return;
    }
    if (!latestId) {
      if (game.status === "awaiting_suggestion") presentedEventIdRef.current = null;
      return;
    }
    // Intermediate acknowledgements arrive before the committed event. Once
    // turn.completed supplies it, install the initial pose while `resolving`
    // still blocks playback so the final position never flashes first.
    if (game.status !== "resolved" && game.status !== "ended") return;
    if (presentedEventIdRef.current === latestId) return;
    presentedEventIdRef.current = latestId;
    const submittedSuggestion = submittedSuggestionRef.current;
    if (submittedSuggestion) {
      setEventSuggestionFallbacks((previous) => ({ ...previous, [latestId]: submittedSuggestion }));
      submittedSuggestionRef.current = null;
    }
    if (game.status === "ended") {
      setFreshEventId(null);
      setLogOpen(false);
      setActiveMemory(undefined);
      setPersonalityOpen(false);
      setEventAnnouncementId(latestId);
      return;
    }
    if (submittedSuggestion) {
      setFreshEventId(latestId);
      setLogOpen(false);
      setActiveMemory(undefined);
      setPersonalityOpen(false);
      if (latestEvent) beginAfterScene(latestEvent);
    }
  }, [beginAfterScene, game.status, initialLoading, latestEvent, resolving]);

  const selectCharacter = (person: CharacterId) => {
    setSelectedPerson(person);
    setInspectorTab("status");
  };

  const useScheduleCue = (value: string) => {
    setSuggestion(value);
    setNotice("予定から「きっかけ」を作りました。送る前に編集できます。");
    window.requestAnimationFrame(() => {
      suggestionInputRef.current?.focus({ preventScroll: true });
      suggestionInputRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
    });
  };

  const closeEventAnnouncement = useCallback(() => {
    const closingEvent = eventAnnouncement;
    setEventAnnouncementId(null);
    setNotice("");
    if (closingEvent && game.status === "resolved" && !game.completed) {
      beginAfterScene(closingEvent);
    }
  }, [beginAfterScene, eventAnnouncement, game.completed, game.status]);
  const openEventLogFromAnnouncement = useCallback(() => {
    closeEventAnnouncement();
    setLogOpen(true);
  }, [closeEventAnnouncement]);
  const advanceFromAnnouncement = () => {
    closeEventAnnouncement();
  };

  const restartSameSeed = () => runAction("reset", game.seed);
  const restartNewSeed = () => runAction("reset", createRunSeed());
  const showResult = game.status === "ended" || (game.completed && Boolean(game.ending));

  if (showResult) {
    return (
      <div className="result-app-shell">
        <div aria-hidden={eventAnnouncement ? true : undefined} inert={eventAnnouncement ? true : undefined}>
          {notice && <div className="notice result-notice" role="alert"><span>!</span><p>{notice}</p><button type="button" onClick={() => setNotice("")} aria-label="閉じる">×</button></div>}
          {!game.result && (
            <aside className="legacy-result-guide" role="status" aria-labelledby="legacy-result-title">
              <div>
                <small>LEGACY SAVE</small>
                <h2 id="legacy-result-title">この7日間は旧形式で保存されています</h2>
                <p>結末と生活ログは残っていますが、デコピンのサポート評価と二人の振り返りに必要な構造化データがありません。新しいrunから完全なリザルトを作れます。</p>
              </div>
              <div>
                <button type="button" onClick={() => void restartSameSeed()} disabled={Boolean(actionBusy)}>同じseedで始め直す</button>
                <button type="button" className="is-primary" onClick={() => void restartNewSeed()} disabled={Boolean(actionBusy)}>新しいseedで始める</button>
              </div>
            </aside>
          )}
          <ResultScreen
            game={game}
            onRestartSameSeed={restartSameSeed}
            onRestartNewSeed={restartNewSeed}
          />
        </div>
        {eventAnnouncement && (
          <EventAnnouncementModal
            event={eventAnnouncement}
            people={people}
            suggestion={eventSuggestionFallbacks[eventAnnouncement.id] || eventAnnouncement.suggestion}
            navigatorMessage={eventAnnouncement.navigatorMessage ?? (latestNavigatorMessage || undefined)}
            notice={notice || undefined}
            canAdvance={false}
            logLabel="総集編で詳しく見る"
            continueLabel="結果を見る"
            onClose={closeEventAnnouncement}
            onOpenLog={closeEventAnnouncement}
            onAdvance={closeEventAnnouncement}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`app phase-theme-${game.shared.phase}`}>
      <header className="topbar" aria-label="ゲーム情報とメニュー" aria-hidden={eventAnnouncement ? true : undefined} inert={eventAnnouncement ? true : undefined}>
        <a href="#game" className="brand" aria-label="ROOMMATES ホーム"><span className="brand-mark"><i /><i /><b>♡</b></span><span><strong>ROOMMATES</strong><small>AUTONOMOUS LIFE SIM</small></span></a>
        <PhaseRail game={game} />
        <div className="header-stat relationship-status"><small>RELATIONSHIP</small><strong><span aria-hidden="true">♥</span>{RELATIONSHIPS[game.shared.relationshipLabel]}</strong></div>
        <div className="header-stat"><small>MEMORY</small><strong>{game.shared.sharedMemories.length.toString().padStart(2, "0")}</strong></div>
        <div className="header-meta">
          <RuntimeBadge runtime={game.runtime} offline={offline} />
          <button ref={personalityButtonRef} className="personality-open-button" type="button" aria-haspopup="dialog" aria-expanded={personalityOpen} onClick={() => setPersonalityOpen(true)}><span aria-hidden="true">◆</span>個性設定</button>
          <button className={`header-log-button ${logOpen ? "is-open" : ""}`} type="button" aria-controls="life-log-drawer" aria-expanded={logOpen} onClick={() => setLogOpen((open) => !open)}><span aria-hidden="true">▤</span>生活ログ</button>
          <button className="reset-button" type="button" onClick={() => void runAction("reset")} disabled={initialLoading || Boolean(actionBusy) || resolving} title="ゲームを最初からやり直す" aria-label="ゲームを最初からやり直す"><span aria-hidden="true">↻</span></button>
        </div>
      </header>

      {notice && <div className="notice" role="alert" aria-hidden={eventAnnouncement ? true : undefined} inert={eventAnnouncement ? true : undefined}><span>!</span><p>{notice}</p><button type="button" onClick={() => setNotice("")} aria-label="閉じる">×</button></div>}
      {initialLoading && <div className="loading-banner"><span /><p>ふたりの生活を読み込んでいます…</p></div>}

      {personalityOpen && <PersonalityStudio controller={characterSettings} onClose={closePersonality} />}
      {memoryArticle && <MemoryArticleModal article={memoryArticle} people={people} onClose={() => setActiveMemory(undefined)} />}

      <main id="game" className="game-layout" aria-hidden={eventAnnouncement ? true : undefined} inert={eventAnnouncement ? true : undefined}>
        <section className="world-column" aria-label="ふたりの生活画面">
          <div className={`world-stage-wrap ${mapOverlaysVisible ? "" : "is-map-focus"}`}>
            <button
              type="button"
              className={`map-overlay-toggle ${mapOverlaysVisible ? "is-visible" : ""}`}
              aria-label="マップ上の情報"
              aria-pressed={mapOverlaysVisible}
              aria-controls="map-overlay-layer"
              onClick={() => setMapOverlaysVisible((visible) => !visible)}
            >
              マップ情報
              <span aria-hidden="true">{mapOverlaysVisible ? "ON" : "OFF"}</span>
            </button>
            <ApartmentStage game={game} people={people} stages={stages} selectedPerson={selectedPerson} currentEvent={latestEvent} afterScene={afterScene} turnStart={turnStartStatesRef.current} resolving={resolving} onSelectPerson={selectCharacter} />
            <div id="map-overlay-layer" className="map-overlay-layer">
              <div className="resident-hud" aria-label="住人の状態">
                <ResidentChip person="haru" info={people.haru} state={game.haru} selected={selectedPerson === "haru"} thinking={resolving && stages.haru === "active"} onSelect={() => selectCharacter("haru")} />
                <ResidentChip person="aoi" info={people.aoi} state={game.aoi} selected={selectedPerson === "aoi"} thinking={resolving && stages.aoi === "active"} onSelect={() => selectCharacter("aoi")} />
              </div>
              <ResolutionProgress stages={stages} active={resolving} message={streamMessage} />
              <EventCard event={latestEvent} resolving={resolving} fresh={freshEventId === latestEvent?.id} lastSuggestion={lastSuggestion} navigatorMessage={latestNavigatorMessage || undefined} onOpen={latestEvent ? () => {
                setLogOpen(false);
                setActiveMemory(undefined);
                setPersonalityOpen(false);
                setEventAnnouncementId(latestEvent.id);
              } : undefined} />
            </div>
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {freshEventId === latestEvent?.id && latestEvent
                ? `イベントが反映されました：${latestEvent.eventTitle}。「全文を読む」で詳細を確認できます。`
                : ""}
            </p>
          </div>

          <section className="interaction-dock" aria-labelledby="dekopin-title">
            <button type="button" className="latest-log-strip" aria-controls="life-log-drawer" aria-expanded={logOpen} onClick={() => setLogOpen(true)}>
              <span className="log-clock">{activePhase.time}</span><span className="log-star">★</span>
              <span className="latest-log-copy"><small>最新の生活ログ</small><b>{latestEvent?.eventTitle ?? "共同生活がはじまりました"}</b><em>{latestEvent?.haruDialogue ? `「${clipText(latestEvent.haruDialogue, 28)}」` : "ふたりは、それぞれの朝を迎えています。"}</em></span>
              <span className="open-log-label">振り返る <b>⌃</b></span>
            </button>
            <div className="producer-row">
              <DekopinGuide presentation={dekopinPresentation} />
              <div className="preset-menu">
                <label htmlFor="preset-select">指示例</label>
                <select id="preset-select" value="" onChange={(event) => setSuggestion(event.target.value)} disabled={!canSubmitCue}>
                  <option value="">選ぶ…</option>{PRESETS.map((preset) => <option value={preset} key={preset}>{preset}</option>)}
                </select>
              </div>
              <div className="suggestion-stack">
                {openaiApiConfigured && (
                  <p className="openai-data-notice" id="openai-api-data-notice">
                    <span aria-hidden="true">i</span>
                    OpenAI API利用時、指示と生成内容は、選択中のAPIプロジェクトのデータ共有設定に従いOpenAIと共有される場合があります。
                  </p>
                )}
                <form className="suggestion-form" onSubmit={handleSubmit}>
                  <label htmlFor="suggestion" className="sr-only">デコピンへの指示</label>
                  <textarea ref={suggestionInputRef} id="suggestion" name="suggestion" rows={1} maxLength={240} value={suggestion} onChange={(event) => setSuggestion(event.target.value)} onKeyDown={handleInputKeyDown} disabled={!canSubmitCue} aria-describedby={openaiApiConfigured ? "game-control-status openai-api-data-notice" : "game-control-status"} enterKeyHint="send" autoCapitalize="sentences" placeholder="例：今日は一緒に夕食を作ってみたら？" />
                  <span className="character-count">{suggestion.length}/240</span>
                  <button className="submit-cue" type="submit" disabled={!canSubmitCue || !suggestion.trim()}><span>{resolving || game.status === "resolving" ? "反映中…" : game.status === "resolved" ? "先に時間を進める" : "デコピンに頼む"}</span><b aria-hidden="true">▶</b></button>
                </form>
              </div>
              <div className="dock-actions">
                <p id="game-control-status" className="sr-only" aria-live="polite">{controls.cueStatusMessage}</p>
                <button className="watch-button" type="button" onClick={() => void submitSuggestion("何も提案せず見守る")} disabled={!canSubmitCue}><span aria-hidden="true">◉</span>見守る</button>
                <button type="button" className={`fast-button ${actionBusy === "fast" ? "is-busy" : ""}`} onClick={() => void runAction("fast")} disabled={!canFastForward} title="デモ用に8ターン自動進行します" aria-label={actionBusy === "fast" ? "8ターン自動進行中" : "8ターン自動進行する"}>{actionBusy === "fast" ? "進行中…" : "×8"}</button>
                <button type="button" className="advance-button" onClick={() => void runAction("advance")} disabled={!canAdvance} title={game.status === "awaiting_suggestion" ? "先にデコピンへ指示するか、見守るを選んでください" : game.status === "resolved" ? "次の時間帯へ進む" : controls.cueStatusMessage}>{actionBusy === "advance" ? "進行中…" : game.status === "awaiting_suggestion" ? "指示後に進めます" : "次の時間帯"}<span aria-hidden="true">›</span></button>
              </div>
            </div>
          </section>

          {logOpen && <LogDrawer events={eventLog} navigatorResponses={navigatorResponses} filter={logFilter} onFilter={setLogFilter} onClose={closeLog} />}
        </section>

        <aside className="inspector-panel" aria-label="住人と共同生活の詳細">
          <div className="inspector-tabs" role="tablist" aria-label="詳細情報">
            {([[
              "status", "状態", "人"
            ], ["schedule", "予定", "予"], ["memories", "思い出", "記"]] as [InspectorTab, string, string][]).map(([id, label, icon]) => (
              <button type="button" id={`inspector-tab-${id}`} role="tab" aria-selected={inspectorTab === id} aria-controls="inspector-panel" tabIndex={inspectorTab === id ? 0 : -1} className={inspectorTab === id ? "is-active" : ""} onClick={() => setInspectorTab(id)} key={id}><span aria-hidden="true">{icon}</span>{label}</button>
            ))}
          </div>
          <div id="inspector-panel" className="inspector-body" role="tabpanel" aria-labelledby={`inspector-tab-${inspectorTab}`} tabIndex={0}>
            {inspectorTab === "status" && <CharacterInspector person={selectedPerson} info={people[selectedPerson]} state={game[selectedPerson]} decision={game.decisions[selectedPerson]} thinking={resolving && stages[selectedPerson] === "active"} />}
            {inspectorTab === "schedule" && <SchedulePanel game={game} people={people} canUseCue={canSubmitCue} onUseCue={useScheduleCue} />}
            {inspectorTab === "memories" && <MemoryPanel game={game} onOpenMemory={setActiveMemory} />}
          </div>
          <DebugDetails game={game} />
        </aside>
      </main>
      {eventAnnouncement && (
        <EventAnnouncementModal
          event={eventAnnouncement}
          people={people}
          suggestion={eventSuggestionFallbacks[eventAnnouncement.id] || eventAnnouncement.suggestion}
          navigatorMessage={eventAnnouncement.navigatorMessage ?? (latestNavigatorMessage || undefined)}
          notice={notice || undefined}
          canAdvance={canAdvance}
          continueLabel="ふたりの様子を見る"
          onClose={closeEventAnnouncement}
          onOpenLog={openEventLogFromAnnouncement}
          onAdvance={advanceFromAnnouncement}
        />
      )}
    </div>
  );
}
