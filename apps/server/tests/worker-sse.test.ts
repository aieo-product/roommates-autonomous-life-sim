import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SSE_KEEPALIVE_INTERVAL_MS,
  startWorkerSseKeepalive,
} from "../src/worker.js";

describe("public Worker SSE keepalive", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enqueues SSE comments and stops the interval deterministically", async () => {
    vi.useFakeTimers();
    const enqueue = vi.fn<(bytes: Uint8Array) => void>();
    const stop = startWorkerSseKeepalive(enqueue);

    await vi.advanceTimersByTimeAsync(SSE_KEEPALIVE_INTERVAL_MS);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(enqueue.mock.calls[0]?.[0])).toBe(
      ": keepalive\n\n",
    );

    stop();
    await vi.advanceTimersByTimeAsync(SSE_KEEPALIVE_INTERVAL_MS * 2);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
