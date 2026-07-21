# Character Runtime Contract

ROOMMATES separates persistent actor slots from replaceable character presentation.

## Stable actor IDs

The runtime, save data, event schema, and animation choreography continue to use
the actor IDs `haru` and `aoi`. These are compatibility slots, not display names.
Changing a character asset or profile must not rename these keys.

## Public character settings

Each `CharacterDefinition` contains:

- `id`: stable `haru | aoi` actor slot
- `role`: public `male | female` presentation role
- `profile.name`: player-facing display name
- `profile` and `personality`: agent behavior settings

Settings saved before `role` existed remain valid. Validation supplies `male`
for the legacy `haru` slot and `female` for the legacy `aoi` slot.

At turn start, the server derives a small public `characterRoster`:

```json
{
  "haru": { "id": "haru", "displayName": "蓮", "role": "male" },
  "aoi": { "id": "aoi", "displayName": "凛", "role": "female" }
}
```

The same roster is supplied to both resident agents and the Director, saved on
`GameState`, and reused for event fallbacks, stream messages, result scoring,
narrative generation, and reflection recovery. Public prose uses `displayName`;
structured `speaker` and `actor` fields keep the stable actor IDs.

When an old save has no roster, presentation fallbacks use neutral labels
`住人1` and `住人2`. They do not assume the legacy Haru/Aoi display names.

`role` is explicit asset/presentation metadata. Runtime code must not infer
personality, speech, consent, or behavior from gender; those remain controlled
by the validated profile and personality settings.
