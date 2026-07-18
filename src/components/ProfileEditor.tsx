import type {
  CharacterProfile,
  CharacterId
} from "../domain/characterSettings";

interface ProfileEditorProps {
  characterId: CharacterId;
  profile: CharacterProfile;
  onChange: (profile: CharacterProfile) => void;
}

interface TagListEditorProps {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}

const TagListEditor = ({
  id,
  label,
  values,
  onChange
}: TagListEditorProps) => {
  function updateValue(index: number, value: string): void {
    onChange(
      values.map((currentValue, currentIndex) =>
        currentIndex === index ? value : currentValue
      )
    );
  }

  function removeValue(index: number): void {
    onChange(values.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <fieldset className="tag-editor">
      <legend>{label}</legend>
      <div className="tag-editor__items">
        {values.map((value, index) => (
          <div className="tag-editor__item" key={`${id}-${index}`}>
            <input
              id={`${id}-${index}`}
              value={value}
              maxLength={40}
              aria-label={`${label} ${index + 1}`}
              onChange={(event) => updateValue(index, event.target.value)}
            />
            <button
              type="button"
              aria-label={`${value || `${label} ${index + 1}`}を削除`}
              onClick={() => removeValue(index)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="tag-editor__add"
        type="button"
        disabled={values.length >= 10}
        onClick={() => onChange([...values, ""])}
      >
        ＋ 追加
      </button>
    </fieldset>
  );
}

export const ProfileEditor = ({
  characterId,
  profile,
  onChange
}: ProfileEditorProps) => {
  const fieldId = (fieldName: string) => `${characterId}-${fieldName}`;

  function update<Key extends keyof CharacterProfile>(
    key: Key,
    value: CharacterProfile[Key]
  ): void {
    onChange({
      ...profile,
      [key]: value
    });
  }

  return (
    <div className="profile-grid">
      <label htmlFor={fieldId("name")}>
        名前
        <input
          id={fieldId("name")}
          value={profile.name}
          maxLength={20}
          onChange={(event) => update("name", event.target.value)}
        />
      </label>
      <label htmlFor={fieldId("age")}>
        年齢
        <input
          id={fieldId("age")}
          type="number"
          min="18"
          max="100"
          value={profile.age}
          onChange={(event) => update("age", Number(event.target.value))}
        />
      </label>
      <label className="profile-grid__wide" htmlFor={fieldId("occupation")}>
        職業
        <input
          id={fieldId("occupation")}
          value={profile.occupation}
          maxLength={40}
          onChange={(event) => update("occupation", event.target.value)}
        />
      </label>
      <label className="profile-grid__wide" htmlFor={fieldId("introduction")}>
        人物紹介
        <textarea
          id={fieldId("introduction")}
          value={profile.introduction}
          maxLength={160}
          rows={2}
          onChange={(event) => update("introduction", event.target.value)}
        />
      </label>
      <TagListEditor
        id={fieldId("likes")}
        label="好きなこと"
        values={profile.likes}
        onChange={(values) => update("likes", values)}
      />
      <TagListEditor
        id={fieldId("dislikes")}
        label="苦手なこと"
        values={profile.dislikes}
        onChange={(values) => update("dislikes", values)}
      />
      <label className="profile-grid__wide" htmlFor={fieldId("life-style")}>
        生活習慣
        <textarea
          id={fieldId("life-style")}
          value={profile.lifeStyle}
          maxLength={160}
          rows={2}
          onChange={(event) => update("lifeStyle", event.target.value)}
        />
      </label>
      <label className="profile-grid__wide" htmlFor={fieldId("romance-view")}>
        恋愛観
        <textarea
          id={fieldId("romance-view")}
          value={profile.romanceView}
          maxLength={160}
          rows={2}
          onChange={(event) => update("romanceView", event.target.value)}
        />
      </label>
      <label className="profile-grid__wide" htmlFor={fieldId("speech-style")}>
        話し方の特徴
        <textarea
          id={fieldId("speech-style")}
          value={profile.speechStyle}
          maxLength={160}
          rows={2}
          onChange={(event) => update("speechStyle", event.target.value)}
        />
      </label>
    </div>
  );
};
