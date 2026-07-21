import { describe, expect, it } from "vitest";
import { formatCharacterDisplayText } from "../src/character-display.js";

const names = { haru: "蓮", aoi: "凛" };

describe("character display text", () => {
  it("maps legacy public names and neutral slot labels to configured profile names", () => {
    expect(formatCharacterDisplayText(
      "HaruとAoi、ハルとアオイ、住人1と住人２が話した。",
      names,
    )).toBe("蓮と凛、蓮と凛、蓮と凛が話した。");
  });

  it("maps standalone internal IDs without changing words that merely contain them", () => {
    expect(formatCharacterDisplayText(
      "haru: ACCEPT / aoi: MODIFY / Haruki / Aoiro",
      names,
    )).toBe("蓮: ACCEPT / 凛: MODIFY / Haruki / Aoiro");
  });

  it("maps event-time custom names to the currently saved profile names", () => {
    expect(formatCharacterDisplayText(
      "旧名のRenがMioへ声をかけた。",
      names,
      {
        haru: { displayName: "Ren" },
        aoi: { displayName: "Mio" },
      },
    )).toBe("旧名の蓮が凛へ声をかけた。");
  });

  it("maps custom names from every historical roster in aggregate result prose", () => {
    expect(formatCharacterDisplayText(
      "RenとMioが出会い、後半はKaiとYuiとして過ごした。",
      names,
      [
        {
          haru: { displayName: "Ren" },
          aoi: { displayName: "Mio" },
        },
        {
          haru: { displayName: "Kai" },
          aoi: { displayName: "Yui" },
        },
      ],
    )).toBe("蓮と凛が出会い、後半は蓮と凛として過ごした。");
  });

  it("does not expand configured names that include a legacy label", () => {
    const customNames = { haru: "Haru Jr.", aoi: "Aoi" };
    expect(formatCharacterDisplayText(
      "Haru Jr.とAoiが話し、Haruも笑った。",
      customNames,
    )).toBe("Haru Jr.とAoiが話し、Haru Jr.も笑った。");
  });

  it("protects overlapping configured names before replacing historical aliases", () => {
    expect(formatCharacterDisplayText(
      "蓮子と蓮が話した。",
      { haru: "蓮", aoi: "蓮子" },
      {
        haru: { displayName: "Ren" },
        aoi: { displayName: "子" },
      },
    )).toBe("蓮子と蓮が話した。");
  });

  it("leaves structured actor IDs untouched unless the caller explicitly formats prose", () => {
    const turn = { speaker: "haru" as const, text: "Aoi、おはよう。" };
    const displayed = { ...turn, text: formatCharacterDisplayText(turn.text, names) };
    expect(displayed).toEqual({ speaker: "haru", text: "凛、おはよう。" });
  });
});
