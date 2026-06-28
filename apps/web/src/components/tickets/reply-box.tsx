'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, FileText, Loader2 } from 'lucide-react';

interface Props {
  ticketId: string;
  agentId: string;
  cannedResponses: { id: string; title: string; content: string }[];
}

export function ReplyBox({ ticketId, agentId, cannedResponses }: Props) {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCanned, setShowCanned] = useState(false);

  async function send() {
    if (!content.trim()) return;
    setLoading(true);

    await fetch(`/api/tickets/${ticketId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content.trim(),
        type: isNote ? 'NOTE' : 'REPLY',
        isPublic: !isNote,
        authorId: agentId,
      }),
    });

    setContent('');
    setLoading(false);
    router.refresh();
  }

  function applyCanned(canned: { content: string }) {
    setContent(canned.content);
    setShowCanned(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
        <button
          onClick={() => setIsNote(false)}
          className={`text-sm font-medium pb-0.5 border-b-2 transition-colors ${
            !isNote ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Réponse au client
        </button>
        <button
          onClick={() => setIsNote(true)}
          className={`text-sm font-medium pb-0.5 border-b-2 transition-colors ${
            isNote ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Note interne
        </button>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
        placeholder={isNote ? 'Note visible uniquement par votre équipe…' : 'Écrivez votre réponse au client…'}
        className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm resize-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
      />

      <div className="flex items-center justify-between">
        <div className="relative">
          <button
            onClick={() => setShowCanned(!showCanned)}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Réponses types
          </button>

          {showCanned && cannedResponses.length > 0 && (
            <div className="absolute bottom-full mb-2 left-0 bg-white border border-gray-200 rounded-xl shadow-lg w-72 z-10 overflow-hidden">
              {cannedResponses.map((cr) => (
                <button
                  key={cr.id}
                  onClick={() => applyCanned(cr)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors"
                >
                  <p className="text-sm font-medium text-gray-800">{cr.title}</p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{cr.content}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={send}
          disabled={!content.trim() || loading}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {isNote ? 'Ajouter la note' : 'Envoyer'}
        </button>
      </div>
    </div>
  );
}
