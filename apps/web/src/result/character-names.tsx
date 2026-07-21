import { createContext, useContext, type ReactNode } from "react";
import {
  formatCharacterDisplayText,
  type CharacterDisplayRoster,
} from "../character-display.js";
import type { ResultCharacterId } from "./types.js";

export type ResultCharacterNames = Record<ResultCharacterId, string>;

export const DEFAULT_RESULT_CHARACTER_NAMES: ResultCharacterNames = {
  haru: "住人1",
  aoi: "住人2",
};

const ResultCharacterNamesContext = createContext<ResultCharacterNames>(
  DEFAULT_RESULT_CHARACTER_NAMES,
);
const ResultCharacterRosterContext = createContext<readonly CharacterDisplayRoster[]>([]);

export function ResultCharacterNamesProvider({
  names,
  rosters = [],
  children,
}: {
  names?: ResultCharacterNames;
  rosters?: readonly CharacterDisplayRoster[];
  children: ReactNode;
}) {
  return (
    <ResultCharacterNamesContext.Provider value={names ?? DEFAULT_RESULT_CHARACTER_NAMES}>
      <ResultCharacterRosterContext.Provider value={rosters}>
        {children}
      </ResultCharacterRosterContext.Provider>
    </ResultCharacterNamesContext.Provider>
  );
}

export const useResultCharacterNames = (): ResultCharacterNames =>
  useContext(ResultCharacterNamesContext);

export const useResultCharacterText = () => {
  const names = useResultCharacterNames();
  const rosters = useContext(ResultCharacterRosterContext);
  return (
    value: string | undefined,
    eventRoster?: CharacterDisplayRoster,
  ): string | undefined =>
    formatCharacterDisplayText(
      value,
      names,
      eventRoster ? [eventRoster, ...rosters] : rosters,
    );
};
