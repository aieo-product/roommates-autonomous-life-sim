import { describe, expect, it } from "vitest";
import {
  createInitialGameState,
  eventDefinitionSchema,
  safeSuggestionSchema,
  type AutonomousActionCandidate,
  type CharacterDecision,
  type GameSnapshot,
  type ResolvedEvent,
} from "@roommates/shared";
import { buildAutonomousActionCandidates } from "../src/engine/autonomy/action-elements.js";
import {
  composeAutonomousEvent,
  constrainAutonomousEventDraft,
  finalizeAutonomousResolvedEvent,
} from "../src/engine/autonomy/composer.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

function fixture() {
  const state = createInitialGameState("autonomy-composer");
  const snapshot: GameSnapshot = {
    seed: state.seed,
    revision: state.revision,
    characters: {
      haru: state.characters.haru.state,
      aoi: state.characters.aoi.state,
    },
    shared: state.shared,
  };
  return {
    state,
    snapshot,
    candidates: {
      haru: buildAutonomousActionCandidates(state, "haru"),
      aoi: buildAutonomousActionCandidates(state, "aoi"),
    },
  };
}

function ignore(): CharacterDecision {
  return {
    decision: "IGNORE",
    action: "自分の時間を過ごす",
    dialogue: "今は自分のペースで過ごすね。",
    publicReason: "今は静かに過ごしたいから",
    internalSummary: "無理をしない",
    expectedEffects: {},
  };
}

function initiate(
  candidate: AutonomousActionCandidate,
  invitation = candidate.invitationOptions[0]!,
): CharacterDecision {
  return {
    decision: "INITIATE",
    action: candidate.publicIntent,
    dialogue:
      invitation === "open"
        ? `${candidate.title}を一緒にどう？`
        : `${candidate.title}をしてこようかな。`,
    publicReason: "自分で選んだ行動だから",
    internalSummary: "今なら始められる",
    expectedEffects: {},
    initiative: {
      candidateId: candidate.id,
      invitation,
      publicIntent: candidate.publicIntent,
    },
  };
}

function semanticId(candidate: AutonomousActionCandidate): string {
  return candidate.id.replace(/^autonomous:(?:haru|aoi):/u, "");
}

describe("autonomous event composer", () => {
  it("turns one valid offered initiative into a bounded dynamic event", () => {
    const { snapshot, candidates } = fixture();
    const selected = candidates.aoi[0]!;

    const plan = composeAutonomousEvent({
      baseSuggestion: sanitizeSuggestion("見守る"),
      snapshot,
      decisions: { haru: ignore(), aoi: initiate(selected) },
      offeredCandidates: candidates,
    });

    expect(plan).toMatchObject({
      mode: "single",
      definition: {
        id: selected.id,
        title: selected.title,
        location: selected.location,
        effectBudget: selected.effectBudget,
        consent: {
          allowPass: true,
          allowModify: true,
          physicalContact: "none",
          secrets: "forbidden",
        },
      },
      suggestion: {
        eventDefinitionId: selected.id,
        text: selected.publicIntent,
      },
      scene: { aoi: selected.location },
    });
    expect(eventDefinitionSchema.parse(plan?.definition)).toEqual(plan?.definition);
    expect(safeSuggestionSchema.parse(plan?.suggestion)).toEqual(plan?.suggestion);
  });

  it("recognizes the same component choice as a shared action", () => {
    const { snapshot, candidates } = fixture();
    const haruCandidate = candidates.haru.find(
      (candidate) =>
        candidate.participantMode !== "solo" &&
        candidate.invitationOptions.includes("open"),
    )!;
    const aoiCandidate: AutonomousActionCandidate = {
      ...structuredClone(haruCandidate),
      id: haruCandidate.id.replace("autonomous:haru:", "autonomous:aoi:"),
    };
    candidates.aoi = [aoiCandidate];

    const plan = composeAutonomousEvent({
      baseSuggestion: sanitizeSuggestion("見守る"),
      snapshot,
      decisions: {
        haru: initiate(haruCandidate, "open"),
        aoi: initiate(aoiCandidate, "open"),
      },
      offeredCandidates: candidates,
    });

    expect(semanticId(haruCandidate)).toBe(semanticId(aoiCandidate));
    expect(plan).toMatchObject({
      mode: "shared",
      definition: { participantRange: { min: 2, max: 2 } },
      scene: {
        haru: haruCandidate.location,
        aoi: aoiCandidate.location,
      },
    });
  });

  it("keeps two identical solo choices parallel instead of implying joint consent", () => {
    const { snapshot, candidates } = fixture();
    const haruCandidate = candidates.haru.find(
      (candidate) => candidate.invitationOptions.includes("solo"),
    )!;
    const aoiCandidate: AutonomousActionCandidate = {
      ...structuredClone(haruCandidate),
      id: haruCandidate.id.replace("autonomous:haru:", "autonomous:aoi:"),
      participantMode: "solo",
      invitationOptions: ["solo"],
    };

    const plan = composeAutonomousEvent({
      baseSuggestion: sanitizeSuggestion("見守る"),
      snapshot,
      decisions: {
        haru: initiate({ ...haruCandidate, participantMode: "solo", invitationOptions: ["solo"] }),
        aoi: initiate(aoiCandidate),
      },
      offeredCandidates: {
        haru: [{ ...haruCandidate, participantMode: "solo", invitationOptions: ["solo"] }],
        aoi: [aoiCandidate],
      },
    });

    expect(plan?.mode).toBe("parallel");
  });

  it("does not execute a shared-opt-in activity without the other character choosing it", () => {
    const { snapshot, candidates } = fixture();
    const base = candidates.aoi.find((candidate) => candidate.invitationOptions.includes("open"))!;
    const sharedOnly: AutonomousActionCandidate = {
      ...structuredClone(base),
      participantMode: "shared_opt_in",
      invitationOptions: ["open"],
    };

    const plan = composeAutonomousEvent({
      baseSuggestion: sanitizeSuggestion("見守る"),
      snapshot,
      decisions: { haru: ignore(), aoi: initiate(sharedOnly, "open") },
      offeredCandidates: { haru: [], aoi: [sharedOnly] },
    });

    expect(plan).toBeUndefined();
  });

  it("keeps different initiatives as parallel actions with low relationship budgets", () => {
    const { snapshot, candidates } = fixture();
    const haruCandidate = candidates.haru[0]!;
    const aoiCandidate =
      candidates.aoi.find((candidate) => candidate.title !== haruCandidate.title) ??
      candidates.aoi[0]!;

    const plan = composeAutonomousEvent({
      baseSuggestion: sanitizeSuggestion("見守る"),
      snapshot,
      decisions: {
        haru: initiate(haruCandidate),
        aoi: initiate(aoiCandidate),
      },
      offeredCandidates: candidates,
    });

    expect(plan).toMatchObject({
      mode: "parallel",
      definition: {
        category: "rest",
        intimacyTier: 0,
        effectBudget: {
          affection: expect.any(Number),
          trust: expect.any(Number),
          romanticAwareness: expect.any(Number),
        },
      },
      scene: {
        haru: haruCandidate.location,
        aoi: aoiCandidate.location,
      },
    });
    expect(plan!.definition.effectBudget.affection).toBeLessThanOrEqual(2);
    expect(plan!.definition.effectBudget.trust).toBeLessThanOrEqual(2);
    expect(plan!.definition.effectBudget.romanticAwareness).toBeLessThanOrEqual(1);

    const extremeDraft: ResolvedEvent = {
      eventTitle: "Director title",
      narration: "Director narration",
      haruDialogue: "Haru",
      aoiDialogue: "Aoi",
      effects: {
        haru: { energy: 100, stress: -100, affection: 100, trust: 100 },
        aoi: { energy: -100, stress: 100, affection: 100, trust: 100 },
      },
      memory: {
        title: "Director memory",
        summary: "summary",
        emotionalImpact: 5,
        importance: 5,
      },
      scene: { haru: "候補外", aoi: "候補外" },
      conflictUpdate: { add: ["候補にない対立"], resolve: ["候補にない解決"] },
    };
    const constrained = finalizeAutonomousResolvedEvent(
      plan!,
      constrainAutonomousEventDraft(plan!, extremeDraft),
    );
    for (const selection of plan!.selections) {
      for (const [key, limit] of Object.entries(selection.candidate.effectBudget)) {
        const applied = constrained.effects[selection.characterId][
          key as keyof typeof selection.candidate.effectBudget
        ];
        expect(Math.abs(applied ?? 0)).toBeLessThanOrEqual(limit);
      }
      if (selection.candidate.category !== "rest") {
        expect(constrained.effects[selection.characterId].energy).toBeLessThanOrEqual(
          -selection.candidate.energyCost,
        );
      }
    }
    expect(constrained.scene).toEqual(plan!.scene);
    expect(constrained.eventTitle).toBe(plan!.definition.title);
    expect(constrained.memory.emotionalImpact).toBeLessThanOrEqual(2);
    expect(constrained.memory.importance).toBeLessThanOrEqual(4);
    expect(constrained.conflictUpdate).toBeUndefined();
  });

  it("rejects IDs, public intent, state constraints, and transformed observes that were not authorized", () => {
    const { snapshot, candidates } = fixture();
    const selected = candidates.aoi[0]!;
    const cases: Array<{
      suggestion?: ReturnType<typeof sanitizeSuggestion>;
      candidate?: AutonomousActionCandidate;
      mutate?: (decision: CharacterDecision) => void;
    }> = [
      {
        mutate: (decision) => {
          decision.initiative!.candidateId = "autonomous:aoi:not-offered";
        },
      },
      {
        mutate: (decision) => {
          decision.initiative!.publicIntent = "候補にない場所で別の行動をする";
        },
      },
      {
        candidate: { ...selected, minEnergy: 100 },
      },
      {
        suggestion: sanitizeSuggestion("タイムマシンで月へ行こう"),
      },
    ];

    for (const testCase of cases) {
      const offered = testCase.candidate ?? selected;
      const decision = initiate(offered);
      testCase.mutate?.(decision);
      const plan = composeAutonomousEvent({
        baseSuggestion: testCase.suggestion ?? sanitizeSuggestion("見守る"),
        snapshot,
        decisions: { haru: ignore(), aoi: decision },
        offeredCandidates: { haru: [], aoi: [offered] },
      });
      expect(plan).toBeUndefined();
    }
  });
});
