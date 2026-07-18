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
import type {
  AgentDecision,
  CharacterState,
  GameEvent,
  GameState,
  MetricKey,
  Phase,
  RuntimeInfo,
  StreamMessage,
} from "./types";

type InspectorTab = "status" | "schedule" | "memories";
type StageStatus = "waiting" | "active" | "complete";
type LogFilter = "all" | "haru" | "aoi" | "event";

type TurnStages = {
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

const PEOPLE: Record<CharacterId, { name: string; job: string; age: number }> = {
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

function RuntimeBadge({ runtime, offline }: { runtime: RuntimeInfo; offline: boolean }) {
  const mode = offline ? "offline" : runtime.mode;
  const content = {
    "app-server": ["live", "AI LIVE"],
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

function PixelPortrait({ person, thinking = false }: { person: CharacterId; thinking?: boolean }) {
  return (
    <span className={`pixel-portrait portrait-${person} ${thinking ? "is-thinking" : ""}`} aria-hidden="true">
      <i className="pixel-hair" />
      <i className="pixel-face"><b /><b /><em /></i>
      <i className="pixel-shirt" />
      {thinking && <span className="pixel-thinking">•••</span>}
    </span>
  );
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
  state,
  selected,
  thinking,
  onSelect,
}: {
  person: CharacterId;
  state: CharacterState;
  selected: boolean;
  thinking: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`resident-chip resident-${person} ${selected ? "is-selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <PixelPortrait person={person} thinking={thinking} />
      <span className="resident-chip-copy">
        <span><strong>{PEOPLE[person].name}</strong><small>{state.mood}</small></span>
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
      <g className="furniture bed bed-haru">
        <polygon points="520,137 602,178 557,201 475,160" />
        <polygon className="furniture-side" points="475,160 557,201 557,216 475,175" />
        <polygon className="linen linen-haru" points="528,148 584,176 558,189 502,161" />
        <polygon className="pillow" points="500,153 526,166 512,173 486,160" />
      </g>
      <g className="furniture desk desk-haru">
        <polygon points="650,164 695,187 668,201 623,178" />
        <path d="M635 183v30M678 204v27" />
        <rect className="screen" x="657" y="154" width="28" height="23" rx="2" />
      </g>
      <g className="furniture bed bed-aoi">
        <polygon points="720,237 802,278 757,301 675,260" />
        <polygon className="furniture-side" points="675,260 757,301 757,316 675,275" />
        <polygon className="linen linen-aoi" points="728,248 784,276 758,289 702,261" />
        <polygon className="pillow" points="700,253 726,266 712,273 686,260" />
      </g>
      <g className="furniture easel">
        <polygon points="872,272 899,285 899,321 872,308" />
        <path d="M877 309l-10 35M894 320l12 37M883 315v31" />
        <circle cx="887" cy="293" r="5" />
      </g>
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
      <g className="dining-furniture">
        <polygon className="table-top" points="515,363 629,420 575,447 461,390" />
        <path d="M480 397v38M568 442v40M613 423v35" />
        <polygon className="plate" points="518,386 536,395 527,400 509,391" />
        <polygon className="plate" points="563,408 581,417 572,422 554,413" />
        <g className="chair"><polygon points="455,411 489,428 470,438 436,421" /><path d="M441 422v27M475 439v27" /></g>
        <g className="chair"><polygon points="606,391 640,408 621,418 587,401" /><path d="M592 402v27M626 419v27" /></g>
      </g>
      <g className="living-furniture">
        <polygon className="rug" points="648,423 846,522 768,561 570,462" />
        <g className="sofa">
          <polygon className="sofa-seat" points="726,438 853,502 803,527 676,463" />
          <polygon className="sofa-back" points="726,414 853,478 853,502 726,438" />
          <polygon className="sofa-front" points="676,463 803,527 803,549 676,485" />
          <polygon className="sofa-cushion" points="738,439 784,462 765,472 719,449" />
          <polygon className="sofa-cushion" points="790,465 836,488 817,498 771,475" />
        </g>
        <g className="coffee-table"><polygon points="632,463 714,504 678,522 596,481" /><path d="M609 486v23M669 516v24" /><circle cx="656" cy="489" r="7" /></g>
        <g className="tv"><polygon points="860,448 917,477 917,520 860,491" /><polygon points="917,477 933,469 933,512 917,520" /><path d="M876 504l-12 18M908 520l10 25" /></g>
        <g className="plant"><path d="M936 498v42" /><ellipse cx="925" cy="505" rx="17" ry="8" transform="rotate(-25 925 505)" /><ellipse cx="946" cy="513" rx="17" ry="8" transform="rotate(25 946 513)" /><polygon points="918,536 958,556 938,570 898,550" /></g>
      </g>
      <g className="balcony-furniture">
        <path className="rail" d="M164 314L752 608M157 329L745 623M164 314v15M260 362v15M356 410v15M452 458v15M548 506v15M644 554v15M752 608v15" />
        <path className="laundry" d="M559 536l118 59M566 529l-14 28M670 582l15 29" />
        <path className="shirt" d="M585 551l14-5 14 13-9 8 4 25-28-14 9-21-8-9z" />
        <path className="towel" d="M625 573l29 14-8 31-29-15z" />
      </g>
    </g>
  );
}

function SceneCharacter({
  person,
  point,
  selected,
  thinking,
  dialogue,
  decision,
  onSelect,
}: {
  person: CharacterId;
  point: Point;
  selected: boolean;
  thinking: boolean;
  dialogue?: string;
  decision?: AgentDecision;
  onSelect: () => void;
}) {
  const bubbleX = point.x > 950 || person === "haru" ? -216 : 38;
  const activate = () => onSelect();
  return (
    <g
      className={`scene-character scene-${person} ${selected ? "is-selected" : ""} ${thinking ? "is-thinking" : ""}`}
      transform={`translate(${point.x} ${point.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${PEOPLE[person].name}を選択`}
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
        <path className="character-leg leg-left" d="M-13 4h11v25h-13z" />
        <path className="character-leg leg-right" d="M2 4h11l2 25H2z" />
        <path className="character-body" d="M-20-32h40l7 41-27 10-27-14z" />
        <rect className="character-neck" x="-7" y="-43" width="14" height="14" />
        <rect className="character-face" x="-19" y="-74" width="38" height="34" rx="8" />
        <path className="character-hair" d="M-21-62v-18h42v25l-9-7-7 9-13-10-13 9z" />
        <rect className="character-eye" x="-11" y="-57" width="5" height="5" />
        <rect className="character-eye" x="7" y="-57" width="5" height="5" />
        <path className="character-arm arm-left" d="M-20-27l-13 29 9 5 13-24z" />
        <path className="character-arm arm-right" d="M20-27L33 2l-9 5-13-24z" />
      </g>
      <foreignObject x="-45" y="28" width="90" height="30" className="nameplate-object">
        <div className="scene-nameplate">{PEOPLE[person].name}</div>
      </foreignObject>
      {thinking && (
        <foreignObject x="-34" y="-122" width="68" height="40">
          <div className="thinking-cloud">•••</div>
        </foreignObject>
      )}
      {!thinking && dialogue && (
        <foreignObject x={bubbleX} y="-142" width="208" height="94" className="speech-object">
          <div className={`scene-speech speech-${person}`}>
            <small>{PEOPLE[person].name}</small>
            <p>{clipText(dialogue, 46)}</p>
            {decision && <span>{DECISION_LABELS[decision.decision]}</span>}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function ApartmentStage({
  game,
  stages,
  selectedPerson,
  currentEvent,
  resolving,
  onSelectPerson,
}: {
  game: GameState;
  stages: TurnStages;
  selectedPerson: CharacterId;
  currentEvent?: GameEvent;
  resolving: boolean;
  onSelectPerson: (person: CharacterId) => void;
}) {
  const eventRoom = game.status === "resolved" || game.status === "ended"
    ? roomForEvent(currentEvent)
    : undefined;
  const selectedRoom = roomForLocation(game[selectedPerson].location, selectedPerson);
  const focusRoom = eventRoom ?? selectedRoom;
  const focusPoint = focusPointForRoom(focusRoom);
  // Event focus changes only the camera/lighting. Character placement always
  // follows the resolved world state, including decline and split-room cases.
  const haruPoint = characterAnchor("haru", game.haru);
  const aoiPoint = characterAnchor("aoi", game.aoi);
  const haruDialogue = game.decisions.haru?.dialogue ?? currentEvent?.haruDialogue;
  const aoiDialogue = game.decisions.aoi?.dialogue ?? currentEvent?.aoiDialogue;

  return (
    <div className={`apartment-stage phase-${game.shared.phase} ${eventRoom ? "has-event-focus" : ""}`}>
      <svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet" role="img" aria-label="HaruとAoiが暮らす2LDKを南西側の斜め上から見た全景">
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
            <SceneCharacter person="haru" point={haruPoint} selected={selectedPerson === "haru"} thinking={resolving && stages.haru === "active"} dialogue={haruDialogue} decision={game.decisions.haru} onSelect={() => onSelectPerson("haru")} />
            <SceneCharacter person="aoi" point={aoiPoint} selected={selectedPerson === "aoi"} thinking={resolving && stages.aoi === "active"} dialogue={aoiDialogue} decision={game.decisions.aoi} onSelect={() => onSelectPerson("aoi")} />
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

function EventCard({ event, resolving, lastSuggestion }: { event?: GameEvent; resolving: boolean; lastSuggestion: string }) {
  if (!event && !resolving) {
    return (
      <div className="event-card event-welcome">
        <span className="event-icon">⌂</span>
        <div><small>DAY 1 · NEW LIFE</small><h2>ふたりの生活を見守ろう</h2><p>命令ではなく、きっかけだけを届けられます。</p></div>
      </div>
    );
  }
  if (resolving) {
    return (
      <div className="event-card event-live">
        <span className="event-icon">…</span>
        <div><small>PRODUCER CUE</small><h2>ふたりが考えています</h2><p>{clipText(lastSuggestion, 62)}</p></div>
      </div>
    );
  }
  return (
    <div className="event-card">
      <span className="event-icon">★</span>
      <div><small>いま起きたこと · DAY {event?.day}</small><h2>{event?.eventTitle}</h2><p>{clipText(event?.narration ?? "", 74)}</p></div>
    </div>
  );
}

function CharacterInspector({
  person,
  state,
  decision,
  thinking,
}: {
  person: CharacterId;
  state: CharacterState;
  decision?: AgentDecision;
  thinking: boolean;
}) {
  const info = PEOPLE[person];
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

function SchedulePanel({ game, onUseCue }: { game: GameState; onUseCue: (value: string) => void }) {
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
                  <button type="button" className={`schedule-item schedule-${person}`} key={person} onClick={() => onUseCue(`${PEOPLE[person].name}の「${plan.title}」に、ふたりで取り組んでみたら？`)} title="この予定からきっかけ文を作る">
                    <span className="plan-icon" aria-hidden="true">{plan.icon}</span>
                    <span><small>{PEOPLE[person].name}</small><strong>{plan.title}</strong><em>{plan.location}</em></span>
                    {index === activeIndex && <i>NOW</i>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="panel-note"><span>i</span><p>予定を押すと、その行動に合わせた「きっかけ」の文案を作れます。</p></div>
    </section>
  );
}

function MemoryPanel({ game, onOpenLog }: { game: GameState; onOpenLog: () => void }) {
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
              <div><small>DAY {memory.day} · IMPORTANCE {memory.importance}</small><h3>{memory.title}</h3><p>{memory.summary}</p><button type="button" onClick={onOpenLog}>この日の記録を見る ›</button></div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-memories"><span aria-hidden="true">◇</span><h3>まだ思い出はありません</h3><p>心に残った出来事が、ここへコレクションされます。</p></div>
      )}
    </section>
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
  filter,
  onFilter,
  onClose,
}: {
  events: GameEvent[];
  filter: LogFilter;
  onFilter: (filter: LogFilter) => void;
  onClose: () => void;
}) {
  const visible = events.filter((event) => {
    if (filter === "haru") return Boolean(event.haruDialogue);
    if (filter === "aoi") return Boolean(event.aoiDialogue);
    return true;
  }).slice().reverse();
  return (
    <section className="log-drawer" role="dialog" aria-modal="false" aria-labelledby="log-title">
      <header>
        <div><small>LIFE ARCHIVE</small><h2 id="log-title">ふたりの生活ログ</h2></div>
        <div className="log-filters" role="tablist" aria-label="ログの絞り込み">
          {([[
            "all", "すべて"
          ], ["haru", "Haru"], ["aoi", "Aoi"], ["event", "できごと"]] as [LogFilter, string][]).map(([id, label]) => (
            <button type="button" role="tab" aria-selected={filter === id} className={filter === id ? "is-active" : ""} onClick={() => onFilter(id)} key={id}>{label}</button>
          ))}
        </div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="ログを閉じる">×</button>
      </header>
      <div className="log-list">
        {visible.length ? visible.map((event) => (
          <article className="log-entry" key={event.id}>
            <div className="log-time"><b>DAY {event.day}</b><span>{PHASES.find((phase) => phase.id === event.phase)?.label ?? event.phase}</span></div>
            <div className="log-copy">
              <small>★ できごと</small><h3>{event.eventTitle}</h3>
              {filter !== "haru" && filter !== "aoi" && event.suggestion && <p className="log-cue"><b>きっかけ</b>{event.suggestion}</p>}
              {filter !== "haru" && filter !== "aoi" && <p>{event.narration}</p>}
              {filter !== "event" && event.haruDialogue && <blockquote className="quote-haru"><b>Haru</b>「{event.haruDialogue}」</blockquote>}
              {filter !== "event" && event.aoiDialogue && <blockquote className="quote-aoi"><b>Aoi</b>「{event.aoiDialogue}」</blockquote>}
            </div>
          </article>
        )) : <div className="empty-log"><span>⌁</span><h3>まだ記録はありません</h3><p>生活が進むと、ここから出来事を振り返れます。</p></div>}
      </div>
    </section>
  );
}

export default function App() {
  const [game, setGame] = useState<GameState>(INITIAL_GAME_STATE);
  const [suggestion, setSuggestion] = useState("");
  const [lastSuggestion, setLastSuggestion] = useState("");
  const [stages, setStages] = useState<TurnStages>(WAITING_STAGES);
  const [resolving, setResolving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [actionBusy, setActionBusy] = useState<"advance" | "reset" | "fast" | null>(null);
  const [streamMessage, setStreamMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<CharacterId>("haru");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("status");
  const [logOpen, setLogOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const turnAbortRef = useRef<AbortController | null>(null);

  const refreshGame = useCallback(async (signal?: AbortSignal) => {
    const payload = await getGame(signal);
    setGame((previous) => normalizeGameState(payload, previous));
    setOffline(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refreshGame(controller.signal)
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

  useEffect(() => () => turnAbortRef.current?.abort(), []);

  const applyStreamMessage = useCallback((message: StreamMessage) => {
    const envelope = record(message.data);
    const inner = record(envelope.data);
    const payload = Object.keys(inner).length ? inner : message.data;
    const normalizedType = stringValue(message.event, envelope.type).toLowerCase();
    const agent = stringValue(envelope.agent, record(payload).agent).toLowerCase();
    const displayMessage = stringValue(envelope.message, record(payload).message);
    if (displayMessage) setStreamMessage(displayMessage);

    if (normalizedType === "turn.started") {
      setStages({ haru: "active", aoi: "waiting", director: "waiting" });
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
        ...(agent === "aoi" ? { haru: previous.haru === "waiting" ? "active" as const : previous.haru, aoi: "active" as const } : {}),
      }));
    }
    if (normalizedType === "agent.completed") {
      setStages((previous) => ({
        ...previous,
        ...(agent === "haru" ? { haru: "complete" as const, aoi: previous.aoi === "waiting" ? "active" as const : previous.aoi } : {}),
        ...(agent === "aoi" ? { aoi: "complete" as const } : {}),
      }));
      const decision = record(payload);
      if (agent === "haru" || agent === "aoi") {
        const maybeDecision = (Object.keys(record(decision.decision)).length ? decision.decision : payload) as unknown;
        setGame((previous) => normalizeGameState({ characters: { [agent]: { lastDecision: maybeDecision } } }, previous));
      }
    }
    if (normalizedType === "director.resolving" || normalizedType === "director.completed") {
      setStages({ haru: "complete", aoi: "complete", director: normalizedType === "director.completed" ? "complete" : "active" });
    }
    if (normalizedType === "turn.completed") setStages({ haru: "complete", aoi: "complete", director: "complete" });
    if (normalizedType === "warning") setNotice(displayMessage || "一部のエージェントがモックへ切り替わりました");
    if (normalizedType === "error") setNotice(displayMessage || "ターン処理でエラーが発生しました");
    if (Object.keys(record(payload)).length) setGame((previous) => normalizeGameState(payload, previous));
  }, []);

  const submitSuggestion = async (value?: string) => {
    if (resolving || game.completed || offline) return;
    const cue = (value ?? suggestion).trim();
    if (!cue) {
      setNotice("ふたりへのきっかけを入力するか、「何もせず見守る」を選んでください。");
      return;
    }
    setNotice("");
    setLastSuggestion(cue);
    setResolving(true);
    setStreamMessage("同じ瞬間のスナップショットを準備しています…");
    setStages({ haru: "active", aoi: "waiting", director: "waiting" });
    turnAbortRef.current = new AbortController();
    try {
      await runTurn(cue, game.revision, applyStreamMessage, turnAbortRef.current.signal);
      await refreshGame();
      setSuggestion("");
    } catch (error) {
      if (turnAbortRef.current.signal.aborted) return;
      setNotice(error instanceof Error ? error.message : "ターンの処理に失敗しました");
    } finally {
      setResolving(false);
      turnAbortRef.current = null;
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

  const runAction = async (kind: "advance" | "reset" | "fast") => {
    if (resolving || actionBusy) return;
    setActionBusy(kind);
    setNotice("");
    try {
      const payload = await (kind === "advance" ? advanceGame() : kind === "reset" ? resetGame() : fastForwardGame());
      if (payload !== undefined) setGame((previous) => normalizeGameState(payload, kind === "reset" ? INITIAL_GAME_STATE : previous));
      else await refreshGame();
      if (kind === "reset") {
        setSuggestion("");
        setLastSuggestion("");
        setStages(WAITING_STAGES);
        setSelectedPerson("haru");
        setInspectorTab("status");
        setLogOpen(false);
      }
      setOffline(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作に失敗しました");
    } finally {
      setActionBusy(null);
    }
  };

  const eventLog = useMemo(() => {
    if (game.eventLog.length) return game.eventLog;
    return game.currentEvent ? [game.currentEvent] : [];
  }, [game.currentEvent, game.eventLog]);
  const latestEvent = game.currentEvent ?? eventLog[eventLog.length - 1];
  const canAdvance = !resolving && !actionBusy && !offline && game.status !== "awaiting_suggestion" && !game.completed;
  const activePhase = PHASES.find((phase) => phase.id === game.shared.phase) ?? PHASES[0];

  const selectCharacter = (person: CharacterId) => {
    setSelectedPerson(person);
    setInspectorTab("status");
  };

  const useScheduleCue = (value: string) => {
    setSuggestion(value);
    setNotice("予定から「きっかけ」を作りました。送る前に編集できます。");
  };

  return (
    <div className={`app phase-theme-${game.shared.phase}`}>
      <header className="topbar">
        <a href="#game" className="brand" aria-label="ROOMMATES ホーム"><span className="brand-mark"><i /><i /><b>♡</b></span><span><strong>ROOMMATES</strong><small>AUTONOMOUS LIFE SIM</small></span></a>
        <PhaseRail game={game} />
        <div className="header-stat relationship-status"><small>RELATIONSHIP</small><strong><span aria-hidden="true">♥</span>{RELATIONSHIPS[game.shared.relationshipLabel]}</strong></div>
        <div className="header-stat"><small>MEMORY</small><strong>{game.shared.sharedMemories.length.toString().padStart(2, "0")}</strong></div>
        <div className="header-meta">
          <RuntimeBadge runtime={game.runtime} offline={offline} />
          <button className={`header-log-button ${logOpen ? "is-open" : ""}`} type="button" onClick={() => setLogOpen((open) => !open)}><span aria-hidden="true">▤</span>生活ログ</button>
          <button className="reset-button" type="button" onClick={() => void runAction("reset")} disabled={Boolean(actionBusy) || resolving} title="ゲームを最初からやり直す"><span aria-hidden="true">↻</span></button>
        </div>
      </header>

      {notice && <div className="notice" role="alert"><span>!</span><p>{notice}</p><button type="button" onClick={() => setNotice("")} aria-label="閉じる">×</button></div>}
      {initialLoading && <div className="loading-banner"><span /><p>ふたりの生活を読み込んでいます…</p></div>}

      {game.ending && (
        <div className="ending-overlay" role="dialog" aria-modal="true" aria-labelledby="ending-title"><section className="ending-card"><span className="ending-stars" aria-hidden="true">✦ ♡ ✦</span><small>THE END · DAY 7</small><h2 id="ending-title">{game.shared.relationshipLabel === "couple" ? "ふたりは、恋人になった。" : "ふたりが選んだ、これから。"}</h2><p>{game.ending}</p><button type="button" onClick={() => void runAction("reset")}>もう一度、見守る</button></section></div>
      )}

      <main id="game" className="game-layout">
        <section className="world-column" aria-label="ふたりの生活画面">
          <div className="world-stage-wrap">
            <ApartmentStage game={game} stages={stages} selectedPerson={selectedPerson} currentEvent={latestEvent} resolving={resolving} onSelectPerson={selectCharacter} />
            <div className="resident-hud" aria-label="住人の状態">
              <ResidentChip person="haru" state={game.haru} selected={selectedPerson === "haru"} thinking={resolving && stages.haru === "active"} onSelect={() => selectCharacter("haru")} />
              <ResidentChip person="aoi" state={game.aoi} selected={selectedPerson === "aoi"} thinking={resolving && stages.aoi === "active"} onSelect={() => selectCharacter("aoi")} />
            </div>
            <ResolutionProgress stages={stages} active={resolving} message={streamMessage} />
            <EventCard event={latestEvent} resolving={resolving} lastSuggestion={lastSuggestion} />
          </div>

          <section className="interaction-dock" aria-labelledby="producer-title">
            <button type="button" className="latest-log-strip" onClick={() => setLogOpen(true)}>
              <span className="log-clock">{activePhase.time}</span><span className="log-star">★</span>
              <span className="latest-log-copy"><small>最新の生活ログ</small><b>{latestEvent?.eventTitle ?? "共同生活がはじまりました"}</b><em>{latestEvent?.haruDialogue ? `「${clipText(latestEvent.haruDialogue, 28)}」` : "ふたりは、それぞれの朝を迎えています。"}</em></span>
              <span className="open-log-label">振り返る <b>⌃</b></span>
            </button>
            <div className="producer-row">
              <div className="producer-label"><span>PRODUCER'S CUE</span><h2 id="producer-title">ふたりへのきっかけ</h2></div>
              <div className="preset-menu">
                <label htmlFor="preset-select">提案例</label>
                <select id="preset-select" value="" onChange={(event) => setSuggestion(event.target.value)} disabled={resolving || game.completed}>
                  <option value="">選ぶ…</option>{PRESETS.map((preset) => <option value={preset} key={preset}>{preset}</option>)}
                </select>
              </div>
              <form className="suggestion-form" onSubmit={handleSubmit}>
                <label htmlFor="suggestion" className="sr-only">ふたりへの提案</label>
                <textarea id="suggestion" rows={1} maxLength={240} value={suggestion} onChange={(event) => setSuggestion(event.target.value)} onKeyDown={handleInputKeyDown} disabled={resolving || game.completed || offline} placeholder="例：今日は一緒に夕食を作ってみたら？" />
                <span className="character-count">{suggestion.length}/240</span>
                <button className="submit-cue" type="submit" disabled={resolving || game.completed || offline || !suggestion.trim()}><span>{resolving ? "考え中…" : "きっかけを届ける"}</span><b aria-hidden="true">▶</b></button>
              </form>
              <div className="dock-actions">
                <button className="watch-button" type="button" onClick={() => void submitSuggestion("何も提案せず見守る")} disabled={resolving || game.completed || offline}><span aria-hidden="true">◉</span>見守る</button>
                <button type="button" className="fast-button" onClick={() => void runAction("fast")} disabled={resolving || Boolean(actionBusy) || offline || game.completed} title="デモ用に8ターン自動進行します">×8</button>
                <button type="button" className="advance-button" onClick={() => void runAction("advance")} disabled={!canAdvance}>{actionBusy === "advance" ? "進行中…" : "次の時間帯"}<span aria-hidden="true">›</span></button>
              </div>
            </div>
          </section>

          {logOpen && <LogDrawer events={eventLog} filter={logFilter} onFilter={setLogFilter} onClose={() => setLogOpen(false)} />}
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs" role="tablist" aria-label="詳細情報">
            {([[
              "status", "状態", "人"
            ], ["schedule", "予定", "予"], ["memories", "思い出", "記"]] as [InspectorTab, string, string][]).map(([id, label, icon]) => (
              <button type="button" role="tab" aria-selected={inspectorTab === id} className={inspectorTab === id ? "is-active" : ""} onClick={() => setInspectorTab(id)} key={id}><span aria-hidden="true">{icon}</span>{label}</button>
            ))}
          </div>
          <div className="inspector-body">
            {inspectorTab === "status" && <CharacterInspector person={selectedPerson} state={game[selectedPerson]} decision={game.decisions[selectedPerson]} thinking={resolving && stages[selectedPerson] === "active"} />}
            {inspectorTab === "schedule" && <SchedulePanel game={game} onUseCue={useScheduleCue} />}
            {inspectorTab === "memories" && <MemoryPanel game={game} onOpenLog={() => setLogOpen(true)} />}
          </div>
          <DebugDetails game={game} />
        </aside>
      </main>
    </div>
  );
}
