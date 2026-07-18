import { eventAnchorId } from "./utils";

export function EvidenceLinks({ eventLogIds }: { eventLogIds: string[] }) {
  const uniqueIds = [...new Set(eventLogIds)];
  if (uniqueIds.length === 0) return null;

  return (
    <span className="result-evidence-links" aria-label="根拠ログ">
      {uniqueIds.map((eventId, index) => (
        <a href={`#${eventAnchorId(eventId)}`} key={eventId}>
          根拠{uniqueIds.length > 1 ? ` ${index + 1}` : ""}
        </a>
      ))}
    </span>
  );
}
