import React, { useState } from 'react';
import { Lock, User, AlertCircle } from 'lucide-react';
import * as api from '../api/client';

export default function LoginScreen({ onLoggedIn }: { onLoggedIn: (user?: { username: string; role?: string; full_name?: string }) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(username.trim(), password);
      onLoggedIn(data.user);
    } catch (err: any) {
      setError(err?.message || 'ورود ناموفق بود');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-slate-950" dir="rtl">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-sky-500 text-white flex items-center justify-center font-black text-xl">C</div>
          <h1 className="text-white text-lg font-bold">Carla CRM</h1>
          <p className="text-slate-400 text-xs mt-1">ورود به پنل آموزشگاه</p>
        </div>
        {error && (
          <div className="mb-4 flex items-center gap-2 text-rose-300 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <label className="block text-slate-400 text-xs mb-1">نام کاربری</label>
        <div className="relative mb-3">
          <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            className="w-full bg-slate-800 text-white rounded-xl pr-10 pl-3 py-2.5 text-sm outline-none border border-white/10 focus:border-sky-500"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
          />
        </div>
        <label className="block text-slate-400 text-xs mb-1">رمز عبور</label>
        <div className="relative mb-5">
          <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="password"
            className="w-full bg-slate-800 text-white rounded-xl pr-10 pl-3 py-2.5 text-sm outline-none border border-white/10 focus:border-sky-500"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white rounded-xl py-2.5 text-sm font-semibold"
        >
          {loading ? 'در حال ورود...' : 'ورود'}
        </button>
      </form>
    </div>
  );
}
