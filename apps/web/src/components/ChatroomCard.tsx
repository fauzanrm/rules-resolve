interface ChatroomCardProps {
  name: string;
  coverImageUrl?: string | null;
}

export default function ChatroomCard({ name, coverImageUrl = null }: ChatroomCardProps) {
  return (
    <div className="chatroom-card">
      {coverImageUrl ? (
        <img className="card-image" src={coverImageUrl} alt={name} />
      ) : (
        <div className="card-fallback" aria-hidden="true" />
      )}
      <div className="card-info">
        <span className="card-name">{name}</span>
        <span className="card-status">Under construction</span>
      </div>
    </div>
  );
}
