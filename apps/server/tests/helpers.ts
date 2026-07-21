import type {
  AgentResult,
} from "../src/agents/coordinator.js";
import type {
  AgentCoordinator,
} from "../src/agents/coordinator.js";
import type {
  CharacterDecision,
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  NavigatorAgentOutput,
  NavigatorInput,
  ResolvedEvent,
} from "@roommates/shared";

export const acceptedDecision: CharacterDecision = {
  decision: "ACCEPT",
  action: "一緒に過ごす",
  dialogue: "うん、やってみよう。",
  publicReason: "今なら楽しめそうだから",
  internalSummary: "自分のペースで少し近づきたい",
  expectedEffects: {},
};

export const resolvedEvent: ResolvedEvent = {
  eventTitle: "二人の穏やかな時間",
  narration: "二人は互いの意思を確かめて、短い時間を一緒に過ごした。",
  haruDialogue: "一緒にやろうか。",
  aoiDialogue: "うん、楽しそう。",
  effects: {
    haru: { energy: -5, stress: -3, affection: 6, trust: 5, romanticAwareness: 4 },
    aoi: { energy: -4, stress: -4, affection: 7, trust: 5, romanticAwareness: 5 },
  },
  memory: {
    title: "穏やかな共同時間",
    summary: "二人が自分の意思で時間を共有した",
    emotionalImpact: 5,
    importance: 7,
  },
  scene: { haru: "リビング", aoi: "リビング" },
};

export function mockResult<T>(value: T): AgentResult<T> {
  return { value, runtime: { source: "mock", latencyMs: 0 } };
}
export class StaticAgentCoordinator implements AgentCoordinator {
  readonly inputs: Partial<Record<CharacterId, CharacterDecisionInput>> = {};
  navigatorInput?: NavigatorInput;
  directorInput?: DirectorInput;

  constructor(
    private readonly decisions: Partial<Record<CharacterId, CharacterDecision>> = {},
    private readonly event: ResolvedEvent = resolvedEvent,
    private readonly navigatorOutput: NavigatorAgentOutput = {
      message: "デコピンが二人へきっかけを届けるね。",
    },
  ) {}

  async navigate(input: NavigatorInput): Promise<AgentResult<NavigatorAgentOutput>> {
    this.navigatorInput = input;
    return mockResult(this.navigatorOutput);
  }

  async decide(
    id: CharacterId,
    input: CharacterDecisionInput,
  ): Promise<AgentResult<CharacterDecision>> {
    this.inputs[id] = input;
    return mockResult(this.decisions[id] ?? acceptedDecision);
  }

  async resolve(input: DirectorInput): Promise<AgentResult<ResolvedEvent>> {
    this.directorInput = input;
    return mockResult(structuredClone(this.event));
  }
}
