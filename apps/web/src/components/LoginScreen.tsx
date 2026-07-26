import { useState } from 'react';
import { Button } from './ui';

export interface Session {
  name: string;
  email: string;
}

interface Props {
  onLogin: (session: Session) => void;
}

/**
 * A local development sign-in. It is a placeholder for Entra ID single sign-on,
 * which replaces this screen in the tenant once the app registration is in
 * place. Nothing here authenticates against a real directory; it only records
 * who is using the studio so the header and audit trail have a name.
 */
export function LoginScreen({ onLogin }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const submit = (session: Session) => {
    if (!session.email.trim()) return;
    onLogin({ name: session.name.trim() || session.email.split('@')[0]!, email: session.email.trim() });
  };

  return (
    <div className="flex h-full items-center justify-center bg-rail px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/cawt-logo-white.png" alt="CapAlpha WhiteTrust" className="mx-auto h-14 w-auto" />
          <p className="mt-4 text-[12px] font-medium uppercase tracking-[0.16em] text-slate-400">Newsletter Studio</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h1 className="text-[16px] font-semibold text-white">Sign in</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">
            Enter your name and work email to continue. Your company sign-in will replace this step.
          </p>

          <div className="mt-5 space-y-2.5">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13.5px] text-white outline-none placeholder:text-slate-500 focus:border-teal-500"
            />
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submit({ name, email })}
              placeholder="name@cawt.ai"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13.5px] text-white outline-none placeholder:text-slate-500 focus:border-teal-500"
            />
          </div>

          <Button variant="primary" className="mt-4 w-full" onClick={() => submit({ name, email })} disabled={!email.trim()}>
            Continue
          </Button>

          <button
            onClick={() => submit({ name: 'IT Support', email: 'itsupport@cawt.ai' })}
            className="mt-2 w-full rounded-lg border border-white/10 px-3 py-2 text-[12.5px] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
          >
            Continue as IT Support (itsupport@cawt.ai)
          </button>
        </div>
      </div>
    </div>
  );
}
