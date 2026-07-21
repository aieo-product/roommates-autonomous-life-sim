export type SpeechBubbleSide = "left" | "right";

export type SpeechBubblePoint = {
  x: number;
  y: number;
};

export type SpeechBubblePlacement = {
  side: SpeechBubbleSide;
  x: number;
  y: number;
  width: number;
  height: number;
};

const STAGE_WIDTH = 1280;
const STAGE_PADDING = 16;
const BUBBLE_WIDTH = 208;
const BUBBLE_HEIGHT = 94;
const BUBBLE_GAP = 12;
const BUBBLE_Y = -142;
const PEER_ORDER_EPSILON = 20;

/**
 * Places simultaneous speech bubbles outside the pair, while keeping a
 * resident near either edge from pushing their bubble outside the stage.
 */
export const resolveSpeechBubblePlacement = (
  point: SpeechBubblePoint,
  peerPoint: SpeechBubblePoint | undefined,
  fallbackSide: SpeechBubbleSide,
): SpeechBubblePlacement => {
  const leftX = -(BUBBLE_WIDTH + BUBBLE_GAP);
  const rightX = BUBBLE_GAP;
  const leftWouldClip = point.x + leftX < STAGE_PADDING;
  const rightWouldClip = point.x + rightX + BUBBLE_WIDTH > STAGE_WIDTH - STAGE_PADDING;

  let side = fallbackSide;
  if (leftWouldClip && !rightWouldClip) {
    side = "right";
  } else if (rightWouldClip && !leftWouldClip) {
    side = "left";
  } else if (peerPoint && Math.abs(point.x - peerPoint.x) > PEER_ORDER_EPSILON) {
    side = point.x < peerPoint.x ? "left" : "right";
  }

  return {
    side,
    x: side === "left" ? leftX : rightX,
    y: BUBBLE_Y,
    width: BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
  };
};
