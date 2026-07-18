import type { GameState } from "./domain.js";

export function createInitialGameState(seed = "demo-heart"): GameState {
  return {
    version: 1,
    seed,
    revision: 0,
    status: "awaiting_suggestion",
    characters: {
      haru: {
        state: {
          energy: 70,
          stress: 25,
          affection: 20,
          trust: 30,
          romanticAwareness: 5,
          mood: "少し緊張",
          location: "リビング",
          currentGoal: "新しい共同生活のペースをつかむ",
        },
      },
      aoi: {
        state: {
          energy: 65,
          stress: 30,
          affection: 20,
          trust: 30,
          romanticAwareness: 5,
          mood: "わくわく",
          location: "リビング",
          currentGoal: "Haruと自然に話せるきっかけを探す",
        },
      },
    },
    shared: {
      day: 1,
      phase: "morning",
      relationshipLabel: "roommates",
      unresolvedConflicts: [],
      sharedMemories: [],
    },
    eventLog: [],
    runtime: {
      haru: { source: "mock" },
      aoi: { source: "mock" },
      director: { source: "mock" },
    },
  };
}
