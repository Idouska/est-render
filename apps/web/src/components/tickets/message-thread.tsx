import { formatDate, getInitials } from '@/lib/utils';

interface Message {
  id: string;
  content: string;
  type: string;
  isPublic: boolean;
  senderName: string | null;
  senderEmail: string | null;
  createdAt: Date | string;
  author: { name: string } | null;
}

interface Props { messages: Message[] }

export function MessageThread({ messages }: Props) {
  if (messages.length === 0) {
    return (
      <div className="p-8 text-center text-gray-400 text-sm">
        Aucun message pour l'instant.
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-50">
      {messages.map((msg) => {
        const isAgent = !!msg.author;
        const name = isAgent ? msg.author!.name : (msg.senderName ?? 'Client');
        const isNote = msg.type === 'NOTE';
        const isSystem = msg.type === 'SYSTEM' || msg.type === 'STATUS_CHANGE';

        if (isSystem) {
          return (
            <div key={msg.id} className="px-6 py-3 text-center">
              <span className="text-xs bg-gray-100 text-gray-400 px-3 py-1 rounded-full">
                {msg.content}
              </span>
            </div>
          );
        }

        return (
          <div
            key={msg.id}
            className={`px-6 py-4 ${isNote ? 'bg-amber-50/50' : ''}`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                  isAgent ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {getInitials(name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">{name}</span>
                  {isNote && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                      Note interne
                    </span>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">{formatDate(msg.createdAt)}</span>
                </div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
