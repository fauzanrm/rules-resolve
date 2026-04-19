import Link from "next/link";

interface ChatroomCardProps {
  chatroomId: number;
  name: string;
  coverImageUrl?: string | null;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export default function ChatroomCard({ chatroomId: _chatroomId, name, coverImageUrl = null }: ChatroomCardProps) {
  return (
    <Link href={`/admin/${slugify(name)}`} className="chatroom-card">
      {coverImageUrl ? (
        <img className="card-image" src={coverImageUrl} alt={name} />
      ) : (
        <div className="card-fallback" aria-hidden="true" />
      )}
      <div className="card-info">
        <span className="card-name">{name}</span>
      </div>
    </Link>
  );
}
