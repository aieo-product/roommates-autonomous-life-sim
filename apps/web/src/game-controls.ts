import type { GameState } from "./types.js";

export type ActionBusy = "advance" | "reset" | "fast" | null;

type GameControlInput = Pick<GameState, "status" | "completed"> & {
  loading: boolean;
  offline: boolean;
  resolving: boolean;
  actionBusy: ActionBusy;
};

export type GameControlState = {
  canSubmitCue: boolean;
  canAdvance: boolean;
  canFastForward: boolean;
  cueStatusMessage: string;
};

/**
 * Keeps every entry point aligned with the server's game-state machine.
 * In particular, a persisted `resolving` state must not look actionable just
 * because this browser did not start that request itself.
 */
export function getGameControlState({
  status,
  completed,
  loading,
  offline,
  resolving,
  actionBusy,
}: GameControlInput): GameControlState {
  const idle = !completed && !loading && !offline && !resolving && actionBusy === null;

  if (!idle) {
    return {
      canSubmitCue: false,
      canAdvance: false,
      canFastForward: false,
      cueStatusMessage: loading
        ? "ゲームの保存データを読み込んでいます。"
        : offline
          ? "ゲームサーバーへの再接続を待っています。"
          : completed
            ? "7日間の共同生活は完了しました。"
            : "ゲームの更新が終わるまでお待ちください。",
    };
  }

  if (status === "awaiting_suggestion") {
    return {
      canSubmitCue: true,
      canAdvance: false,
      canFastForward: true,
      cueStatusMessage: "デコピンへ指示するか、何も提案せず見守ってください。",
    };
  }

  if (status === "resolved") {
    return {
      canSubmitCue: false,
      canAdvance: true,
      canFastForward: true,
      cueStatusMessage: "次の指示を送る前に、次の時間帯へ進んでください。",
    };
  }

  return {
    canSubmitCue: false,
    canAdvance: false,
    canFastForward: false,
    cueStatusMessage: status === "resolving"
      ? "デコピンが現在の指示を反映しています。"
      : "7日間の共同生活は完了しました。",
  };
}
