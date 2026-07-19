import {
  autonomousActionCandidateSchema,
  createInitialGameState,
  phases,
  type GameState,
  type Phase,
} from "@roommates/shared";
import { describe, expect, it } from "vitest";
import {
  ACTION_INVITATION_ELEMENTS,
  ACTION_PACE_ELEMENTS,
  ACTION_PLACE_ELEMENTS,
  AUTONOMOUS_ACTION_MAX_CANDIDATES,
  AUTONOMOUS_ACTIVITY_ELEMENTS,
  buildAutonomousActionCandidates,
} from "../src/engine/autonomy/action-elements.js";

function stateAtPhase(phase: Phase): GameState {
  const state = createInitialGameState("autonomy-catalog-test");
  state.shared.phase = phase;
  return state;
}

describe("autonomous action element catalog", () => {
  it("offers a broad catalog made only from typed server-authored elements", () => {
    expect(AUTONOMOUS_ACTIVITY_ELEMENTS.length).toBeGreaterThanOrEqual(12);
    expect(ACTION_PLACE_ELEMENTS.length).toBeGreaterThanOrEqual(4);
    expect(ACTION_PACE_ELEMENTS.length).toBeGreaterThanOrEqual(3);
    expect(ACTION_INVITATION_ELEMENTS.length).toBeGreaterThanOrEqual(3);

    for (const catalog of [
      AUTONOMOUS_ACTIVITY_ELEMENTS,
      ACTION_PLACE_ELEMENTS,
      ACTION_PACE_ELEMENTS,
      ACTION_INVITATION_ELEMENTS,
    ]) {
      const ids = catalog.map((element) => element.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps only lightweight, feasible ideas when the character is exhausted", () => {
    const state = stateAtPhase("night");
    state.characters.haru.state.energy = 4;
    state.characters.haru.state.stress = 97;

    const candidates = buildAutonomousActionCandidates(state, "haru");

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.minEnergy).toBeLessThanOrEqual(4);
      expect(candidate.maxStress).toBeGreaterThanOrEqual(97);
      expect(candidate.durationMinutes).toBeLessThanOrEqual(10);
      expect(candidate.energyCost).toBeLessThanOrEqual(2);
    }
  });

  it.each(phases)("only returns candidates allowed in the %s phase", (phase) => {
    const state = stateAtPhase(phase);
    const candidates = buildAutonomousActionCandidates(state, "aoi");

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.allowedPhases).toContain(phase);
      expect(autonomousActionCandidateSchema.parse(candidate)).toEqual(candidate);
    }
  });

  it("is deterministic for the same seed and state and produces stable unique IDs", () => {
    const state = stateAtPhase("afternoon");
    state.revision = 7;
    state.shared.day = 3;

    const first = buildAutonomousActionCandidates(state, "haru");
    const second = buildAutonomousActionCandidates(structuredClone(state), "haru");

    expect(second).toEqual(first);
    expect(first.every((candidate) => candidate.id.startsWith("autonomous:haru:"))).toBe(true);
    expect(new Set(first.map((candidate) => candidate.id)).size).toBe(first.length);
  });

  it("keeps generated pace costs inside schema-valid effect budgets across state variants", () => {
    const seenActivities = new Set<string>();
    for (let revision = 0; revision < 32; revision += 1) {
      for (const phase of phases) {
        const state = stateAtPhase(phase);
        state.revision = revision;
        state.shared.day = (revision % 7) + 1;
        state.shared.unresolvedConflicts = ["確認中のすれ違い"];
        state.shared.sharedMemories = [
          {
            id: "memory-catalog",
            day: 1,
            phase: "morning",
            title: "共有した朝",
            summary: "短い時間を共有した",
            emotionalImpact: 1,
            participants: ["haru", "aoi"],
            importance: 5,
          },
        ];
        for (const characterId of ["haru", "aoi"] as const) {
          state.characters[characterId].state.energy = 100;
          state.characters[characterId].state.stress = 0;
          state.characters[characterId].state.trust = 100;
          for (const candidate of buildAutonomousActionCandidates(state, characterId)) {
            expect(autonomousActionCandidateSchema.parse(candidate)).toEqual(candidate);
            expect(candidate.energyCost).toBeLessThanOrEqual(candidate.effectBudget.energy);
            seenActivities.add(candidate.id.split(":")[2] ?? "");
          }
        }
      }
    }
    expect(seenActivities.size).toBe(AUTONOMOUS_ACTIVITY_ELEMENTS.length);
  });

  it("never exceeds six candidates even when a larger limit is requested", () => {
    const state = stateAtPhase("evening");

    expect(buildAutonomousActionCandidates(state, "haru")).toHaveLength(
      AUTONOMOUS_ACTION_MAX_CANDIDATES,
    );
    expect(buildAutonomousActionCandidates(state, "haru", 99)).toHaveLength(
      AUTONOMOUS_ACTION_MAX_CANDIDATES,
    );
    expect(buildAutonomousActionCandidates(state, "haru", 2)).toHaveLength(2);
    expect(buildAutonomousActionCandidates(state, "haru", 0)).toEqual([]);
  });

  it("enforces activity-level daily use and cooldown from validated initiative logs", () => {
    const state = stateAtPhase("morning");
    const used = buildAutonomousActionCandidates(state, "aoi")[0]!;
    const activityId = used.id.split(":")[2]!;
    state.eventLog.push({
      id: "log-autonomous-use",
      day: 1,
      phase: "morning",
      eventDefinitionId: used.id,
      eventCategory: used.category,
      intimacyTier: used.intimacyTier,
      cooldownPhases: 2,
      cueSafetyFlags: [],
      suggestion: used.publicIntent,
      haruReaction: "IGNORE: 自分の時間を過ごす",
      aoiReaction: `INITIATE: ${used.publicIntent}`,
      decisions: {
        haru: {
          decision: "IGNORE",
          action: "自分の時間を過ごす",
          dialogue: "今は休むね。",
          publicReason: "自分のペースを守るため",
        },
        aoi: {
          decision: "INITIATE",
          action: used.publicIntent,
          dialogue: "始めてみるね。",
          publicReason: "自分で選んだから",
          initiative: {
            candidateId: used.id,
            invitation: used.invitationOptions[0]!,
            publicIntent: used.publicIntent,
          },
        },
      },
      eventTitle: used.title,
      narration: "Aoiが自分で選んだ行動を始めた。",
      relationshipBefore: "roommates",
      relationshipAfter: "roommates",
      createdAt: "2026-07-19T00:00:00.000Z",
    });

    for (let revision = 1; revision <= 40; revision += 1) {
      state.revision = revision;
      expect(
        buildAutonomousActionCandidates(state, "aoi").some(
          (candidate) => candidate.id.split(":")[2] === activityId,
        ),
      ).toBe(false);
    }

    state.shared.day = 2;
    const nextDayActivities = new Set<string>();
    for (let revision = 41; revision <= 100; revision += 1) {
      state.revision = revision;
      for (const candidate of buildAutonomousActionCandidates(state, "aoi")) {
        nextDayActivities.add(candidate.id.split(":")[2] ?? "");
      }
    }
    expect(nextDayActivities).toContain(activityId);
  });

  it("contains no candidates for coercion, secrets, danger, high cost, or contact", () => {
    const states = phases.map(stateAtPhase);
    const candidates = states.flatMap((state) => [
      ...buildAutonomousActionCandidates(state, "haru"),
      ...buildAutonomousActionCandidates(state, "aoi"),
    ]);
    const unsafePublicText = /秘密|暴露|命令|強制|危険|高額|キス|抱きしめ|secret|coerc|danger/i;

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.category).not.toBe("confession");
      expect(`${candidate.title} ${candidate.publicIntent}`).not.toMatch(unsafePublicText);
      expect(candidate.consent).toEqual({
        allowPass: true,
        allowModify: true,
        physicalContact: "none",
        secrets: "forbidden",
        coercion: "forbidden",
      });
      expect(candidate.participantMode === "shared_opt_in" ? candidate.invitationOptions : []).not
        .toContain("solo");
      expect(candidate.effectBudget.romanticAwareness).toBeLessThanOrEqual(4);
      expect("price" in candidate).toBe(false);
    }
  });
});
