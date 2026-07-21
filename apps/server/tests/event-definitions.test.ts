import { describe, expect, it } from "vitest";
import { eventDefinitionCatalogSchema, mutableStatKeys } from "@roommates/shared";
import {
  EVENT_DEFINITIONS,
  EVENT_DEFINITIONS_BY_ID,
} from "../src/engine/event-definitions.js";

const EVERYDAY_AUTONOMY_EVENT_IDS = [
  "easy-breakfast-prep",
  "houseplant-care",
  "music-swap",
  "tabletop-mini-game",
  "fold-shared-laundry",
  "tiny-co-creation",
  "evening-cool-down",
  "shared-memory-sort",
] as const;

describe("event definition catalog", () => {
  it("contains at least three schema-valid definitions", () => {
    expect(EVENT_DEFINITIONS.length).toBeGreaterThanOrEqual(3);
    expect(eventDefinitionCatalogSchema.safeParse(EVENT_DEFINITIONS).success).toBe(true);
  });

  it("has unique IDs and only references fallbacks in the same catalog", () => {
    const ids = EVENT_DEFINITIONS.map((definition) => definition.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of EVENT_DEFINITIONS) {
      expect(EVENT_DEFINITIONS_BY_ID.get(definition.id)).toBe(definition);
      expect(EVENT_DEFINITIONS_BY_ID.has(definition.fallbackEventId)).toBe(true);
    }
  });

  it("defines every outcome branch and keeps every stat budget within ten points", () => {
    for (const definition of EVENT_DEFINITIONS) {
      expect(Object.keys(definition.branches).sort()).toEqual(
        ["bothDecline", "bothParticipate", "modified", "oneParticipates"].sort(),
      );
      for (const branch of Object.values(definition.branches)) {
        expect(branch.trim().length).toBeGreaterThan(0);
      }
      for (const stat of mutableStatKeys) {
        expect(definition.effectBudget[stat]).toBeGreaterThanOrEqual(0);
        expect(definition.effectBudget[stat]).toBeLessThanOrEqual(10);
      }
    }
  });

  it("bounds accepted free text inside an always-available low-pressure event", () => {
    const definition = EVENT_DEFINITIONS_BY_ID.get("open-low-pressure-activity");

    expect(definition).toMatchObject({
      category: "talk",
      intimacyTier: 0,
      allowedPhases: ["morning", "afternoon", "evening", "night"],
      minDay: 1,
      maxDay: 7,
      participantRange: { min: 1, max: 2 },
      durationMinutes: 20,
      preconditions: {},
      cooldownPhases: 0,
      maxUsesPerDay: 4,
      maxUsesPerRun: 28,
      consent: {
        allowPass: true,
        allowModify: true,
        physicalContact: "none",
        secrets: "forbidden",
      },
    });
    expect(definition?.effectBudget).toMatchObject({
      energy: 4,
      stress: 5,
      affection: 3,
      trust: 3,
      romanticAwareness: 1,
    });
  });

  it("offers varied everyday actions that remain safe when initiated, modified, or done solo", () => {
    const categories = new Set<string>();

    for (const id of EVERYDAY_AUTONOMY_EVENT_IDS) {
      const definition = EVENT_DEFINITIONS_BY_ID.get(id);
      expect(definition, `${id} must be present in the catalog`).toBeDefined();
      if (!definition) throw new Error(`Missing event definition: ${id}`);

      categories.add(definition.category);
      expect(definition.allowedPhases.length).toBeGreaterThan(0);
      expect(definition.minDay).toBeLessThanOrEqual(definition.maxDay);
      expect(definition.preconditions.minEnergy).toBeTypeOf("number");
      expect(definition.preconditions.maxStress).toBeTypeOf("number");
      expect(definition.cooldownPhases).toBeGreaterThan(0);
      expect(definition.maxUsesPerDay).toBeGreaterThan(0);
      expect(definition.maxUsesPerRun).toBeGreaterThanOrEqual(definition.maxUsesPerDay);
      expect(definition.participantRange.min).toBeLessThanOrEqual(1);
      expect(definition.characterChoices).toContain("INITIATE");
      expect(definition.consent).toMatchObject({
        allowPass: true,
        allowModify: true,
        physicalContact: "none",
      });
      expect(definition.producerControls.length).toBeGreaterThanOrEqual(3);
      expect(definition.branches.oneParticipates.trim().length).toBeGreaterThan(0);
      expect(definition.branches.bothDecline.trim().length).toBeGreaterThan(0);
      expect(definition.branches.modified.trim().length).toBeGreaterThan(0);
      expect(EVENT_DEFINITIONS_BY_ID.has(definition.fallbackEventId)).toBe(true);
      expect(definition.safetyNotes.length).toBeGreaterThanOrEqual(2);
    }

    expect(categories.size).toBeGreaterThanOrEqual(6);
  });
});
