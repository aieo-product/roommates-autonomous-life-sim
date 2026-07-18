import type { NavigatorAgentOutput, NavigatorInput } from "@roommates/shared";
import { fallbackNavigatorOutput } from "../navigator.js";

export class MockNavigatorAgent {
  async respond(input: NavigatorInput): Promise<NavigatorAgentOutput> {
    return fallbackNavigatorOutput(input);
  }
}
