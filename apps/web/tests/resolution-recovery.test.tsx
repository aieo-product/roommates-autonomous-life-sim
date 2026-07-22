import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ApartmentStage,
  ResolutionProgress,
  getResolutionUiState,
  isRecoveredTurnEvent,
  refreshTurnAfterStreamFailure,
  type TurnStages,
} from "../src/App.js";
import { INITIAL_GAME_STATE } from "../src/api.js";
import { getGameControlState } from "../src/game-controls.js";
import {
  AssetManagerProvider,
  createDefaultAssetManagerDocument,
} from "../src/assets-manager/index.js";

const waitingStages: TurnStages = {
  navigator: "waiting",
  haru: "waiting",
  aoi: "waiting",
  director: "waiting",
};

const people = {
  haru: { name: "Haru", job: "Engineer", age: 28 },
  aoi: { name: "Aoi", job: "Designer", age: 26 },
};

function renderResolutionState(
  status: typeof INITIAL_GAME_STATE.status,
  localResolving = false,
  stages: TurnStages = waitingStages,
): { markup: string; ui: ReturnType<typeof getResolutionUiState> } {
  const game = { ...INITIAL_GAME_STATE, status };
  const ui = getResolutionUiState(status, localResolving, stages);
  const markup = renderToStaticMarkup(
    <AssetManagerProvider
      initialDocument={createDefaultAssetManagerDocument()}
      storage={undefined}
    >
      <ApartmentStage
        game={game}
        people={people}
        stages={ui.activeStages}
        selectedPerson="haru"
        furnitureObstacles={[]}
        resolving={ui.resolving}
        onSelectPerson={() => undefined}
      />
      <ResolutionProgress
        stages={ui.activeStages}
        active={ui.resolving}
        message=""
        people={people}
      />
    </AssetManagerProvider>,
  );
  return { markup, ui };
}

describe("persisted resolution progress recovery", () => {
  it("restores resident thinking indicators and progress after a reload or in another tab", () => {
    const { markup, ui } = renderResolutionState("resolving");

    expect(ui).toEqual({
      serverResolving: true,
      resolving: true,
      activeStages: {
        navigator: "active",
        haru: "active",
        aoi: "active",
        director: "active",
      },
    });
    expect(markup.match(/character-thinking-progress/g)).toHaveLength(2);
    expect(markup.match(/progress-step step-active/g)).toHaveLength(4);
    expect(markup).toContain('class="resolution-progress"');
    expect(markup).toContain("ふたりがそれぞれの気持ちで考えています…");
  });

  it("does not show recovery progress during normal idle play", () => {
    const { markup, ui } = renderResolutionState("awaiting_suggestion");

    expect(ui).toEqual({
      serverResolving: false,
      resolving: false,
      activeStages: waitingStages,
    });
    expect(markup).not.toContain("character-thinking-progress");
    expect(markup).not.toContain("resolution-progress");
  });

  it("preserves live SSE stages for a locally submitted turn", () => {
    const streamedStages: TurnStages = {
      navigator: "complete",
      haru: "active",
      aoi: "waiting",
      director: "waiting",
    };
    const { ui } = renderResolutionState(
      "resolving",
      true,
      streamedStages,
    );

    expect(ui.serverResolving).toBe(true);
    expect(ui.resolving).toBe(true);
    expect(ui.activeStages).toBe(streamedStages);
  });

  it("refreshes persisted state after a non-abort stream failure", async () => {
    const refresh = vi.fn(async () => undefined);

    await expect(refreshTurnAfterStreamFailure(false, refresh)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledOnce();

    const ui = getResolutionUiState("resolving", false, waitingStages);
    const controls = getGameControlState({
      status: "resolving",
      completed: false,
      loading: false,
      offline: false,
      resolving: ui.resolving,
      actionBusy: null,
    });
    expect(ui.resolving).toBe(true);
    expect(controls.canSubmitCue).toBe(false);
    expect(controls.canAdvance).toBe(false);
    expect(controls.canFastForward).toBe(false);
  });

  it("does not issue a recovery request for an intentionally aborted stream", async () => {
    const refresh = vi.fn(async () => undefined);

    await expect(refreshTurnAfterStreamFailure(true, refresh)).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("recognizes only the event committed after a recovered resolving state", () => {
    expect(isRecoveredTurnEvent("event-before", "event-after", "resolved")).toBe(true);
    expect(isRecoveredTurnEvent(null, "first-event", "resolved")).toBe(true);
    expect(isRecoveredTurnEvent("event-before", "event-before", "resolved")).toBe(false);
    expect(isRecoveredTurnEvent("event-before", "event-after", "resolving")).toBe(false);
    expect(isRecoveredTurnEvent(undefined, "event-after", "resolved")).toBe(false);
  });
});
