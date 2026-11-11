import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { BranchConfig, fetchBranchConfig, getActiveBranch, setActiveBranch } from '../api/branches';

/** Header branch picker. Renders nothing unless multi-branch is on AND the user can choose between 2+ options. */
export default function BranchSwitcher() {
  const [config, setConfig] = useState<BranchConfig | null>(null);

  useEffect(() => {
    let alive = true;
    fetchBranchConfig().then((c) => {
      if (!alive) return;
      const stored = getActiveBranch();
      // A branch that was removed / is no longer assigned is forgotten (the server already ignores it for config).
      if (stored && !c.branches.some((b) => String(b.id) === stored)) {
        setActiveBranch(null);
        if (c.multi) { window.location.reload(); return; }
      }
      if (!c.enabled || !c.multi) setActiveBranch(null);
      setConfig(c);
    });
    return () => { alive = false; };
  }, []);

  if (!config?.enabled || !config.multi) return null;
  // Fewer than two branches for this user: nothing to choose.
  if (config.branches.length < 2) return null;

  const current = getActiveBranch() || (config.active === 'all' ? 'all' : String(config.active));
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setActiveBranch(e.target.value === 'all' ? null : e.target.value);
    window.location.reload(); // every list is refetched in the new branch
  };

  return (
    <label className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600" title="شعبه">
      <Building2 className="h-3.5 w-3.5 text-sky-500" aria-hidden />
      <span className="sr-only">انتخاب شعبه</span>
      <select value={current} onChange={onChange} className="max-w-[9rem] bg-transparent py-1 text-xs font-bold text-slate-700 outline-none">
        <option value="all">{config.can_see_all ? 'همه شعبه‌ها' : 'همه شعبه‌های من'}</option>
        {config.branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
      </select>
    </label>
  );
}
