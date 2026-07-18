export const DEKOPIN_NAME = "デコピン";

export type DekopinMood = "idle" | "ready" | "working" | "complete" | "offline";

export type DekopinEventSummary = {
  eventTitle: string;
  narration: string;
  navigatorMessage?: string;
};

type DekopinPresentationInput = {
  resolving: boolean;
  offline: boolean;
  draft: string;
  streamMessage: string;
  event?: DekopinEventSummary;
  sessionMessage?: string;
};

export type DekopinPresentation = {
  mood: DekopinMood;
  message: string;
  statusLabel: string;
};

/**
 * Keeps Dekopin's response deterministic even when an older server does not
 * emit navigator SSE events yet. New servers can override the fallback with
 * navigator.thinking / navigator.completed messages.
 */
export function getDekopinPresentation({
  resolving,
  offline,
  draft,
  streamMessage,
  event,
  sessionMessage,
}: DekopinPresentationInput): DekopinPresentation {
  if (offline) {
    return {
      mood: "offline",
      statusLabel: "接続待ち",
      message: "ゲームサーバーとつながったら、指示をイベントへ反映するよ。",
    };
  }

  if (resolving) {
    return {
      mood: "working",
      statusLabel: "反映中",
      message: streamMessage || "指示を受け取ったよ。ふたりの意思を確認しているところ…",
    };
  }

  const trimmedDraft = draft.trim();
  if (trimmedDraft) {
    return {
      mood: "ready",
      statusLabel: "入力確認",
      message: `「${trimmedDraft}」だね。ふたりの意思を大切にして反映するよ。`,
    };
  }

  const completedMessage = event?.navigatorMessage?.trim() || sessionMessage?.trim();
  if (event) {
    return {
      mood: "complete",
      statusLabel: "反映完了",
      message: completedMessage || `「${event.eventTitle}」をイベントへ反映したよ。`,
    };
  }

  return {
    mood: "idle",
    statusLabel: "受付中",
    message: "してほしいことを教えて。ふたりがどう応えるか見届けるね。",
  };
}
