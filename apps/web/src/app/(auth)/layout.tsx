import { MessageSquare } from 'lucide-react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 flex flex-col items-center justify-center p-6">
      <Link href="/" className="flex items-center gap-2 text-white font-bold text-2xl mb-10">
        <MessageSquare className="w-7 h-7 text-indigo-400" />
        SupportHub
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
