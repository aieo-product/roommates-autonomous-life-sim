import { createContext, useContext, type ReactNode } from "react";
import type { ResultCharacterId } from "./types.js";

export type ResultCharacterNames = Record<ResultCharacterId, string>;

export const DEFAULT_RESULT_CHARACTER_NAMES: ResultCharacterNames = {
  haru: "住人1",
  aoi: "住人2",
};

const ResultCharacterNamesContext = createContext<ResultCharacterNames>(
  DEFAULT_RESULT_CHARACTER_NAMES,
);

export function ResultCharacterNamesProvider({
  names,
  children,
}: {
  names?: ResultCharacterNames;
  children: ReactNode;
}) {
  return (
    <ResultCharacterNamesContext.Provider value={names ?? DEFAULT_RESULT_CHARACTER_NAMES}>
      {children}
    </ResultCharacterNamesContext.Provider>
  );
}

export const useResultCharacterNames = (): ResultCharacterNames =>
  useContext(ResultCharacterNamesContext);
