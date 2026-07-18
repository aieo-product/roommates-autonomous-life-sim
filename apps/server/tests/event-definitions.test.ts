import { describe, expect, it } from "vitest";
import { eventDefinitionCatalogSchema, mutableStatKeys } from "@roommates/shared";
import {
  EVENT_DEFINITIONS,
  EVENT_DEFINITIONS_BY_ID,
} from "../src/engine/event-definitions.js";

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
});
