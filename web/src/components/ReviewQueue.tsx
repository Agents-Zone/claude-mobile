import { useEffect, useState } from 'react';
import {
  fetchBatch,
  postDecisions,
  type BatchItem,
  type Decision,
  type Role,
  type Verdict,
} from '../api';

/**
 * Review queue panel — the human half of the App-in-Skill loop. A skill writes
 * a batch to .data/current_batch.json; the human approves / rejects / edits each
 * item here; decisions go back to .data/decisions.json for the skill to act on.
 * This panel never touches the outside world — it only reads the batch and
 * writes decisions. External side effects stay the skill's responsibility.
 */
export function ReviewQueue({ role }: { role: Role }) {
  const [items, setItems] = useState<BatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  function load() {
    setError(null);
    setDone(null);
    fetchBatch(role.id)
      .then((b) => setItems(b?.items ?? []))
      .catch((e) => setError(e.message));
  }

  useEffect(load, [role.id]);

  function setVerdict(id: string, v: Verdict) {
    setVerdicts((m) => ({ ...m, [id]: v }));
  }

  async function submit() {
    if (!items) return;
    const decisions: Decision[] = items
      .filter((it) => verdicts[it.id])
      .map((it) => {
        const verdict = verdicts[it.id];
        const d: Decision = { itemId: it.id, verdict };
        if (verdict === 'edit') d.editedText = edits[it.id] ?? it.after ?? '';
        return d;
      });
    if (decisions.length === 0) {
      setError('还没有任何决策');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await postDecisions(role.id, decisions);
      setDone(decisions.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error && items === null) {
    return <div className="reviewq"><div className="banner error">{error}</div></div>;
  }
  if (items === null) {
    return <div className="reviewq"><div className="empty-hint">加载中…</div></div>;
  }
  if (items.length === 0) {
    return <div className="reviewq"><div className="empty-hint">没有待审条目</div></div>;
  }

  const decidedCount = items.filter((it) => verdicts[it.id]).length;

  return (
    <div className="reviewq">
      {error && <div className="banner error">{error}</div>}
      {done !== null && (
        <div className="banner ok">已提交 {done} 条决策，skill 将据此执行</div>
      )}
      <div className="rq-list">
        {items.map((it) => {
          const v = verdicts[it.id];
          return (
            <div key={it.id} className={`rq-item ${it.risk === 'high' ? 'risk-high' : ''}`}>
              <div className="rq-head">
                <span className="rq-title">{it.title ?? it.id}</span>
                {it.risk === 'high' && <span className="rq-risk">⚠ 危险</span>}
              </div>
              {it.action && <div className="rq-action">{it.action}</div>}
              {(it.before != null || it.after != null) && (
                <div className="rq-diff">
                  {it.before != null && <pre className="rq-before">{it.before}</pre>}
                  {it.after != null && <pre className="rq-after">{it.after}</pre>}
                </div>
              )}
              {v === 'edit' && (
                <textarea
                  className="rq-edit"
                  value={edits[it.id] ?? it.after ?? ''}
                  onChange={(e) => setEdits((m) => ({ ...m, [it.id]: e.target.value }))}
                  rows={3}
                />
              )}
              <div className="rq-actions">
                <button
                  className={`rq-btn approve ${v === 'approve' ? 'on' : ''}`}
                  onClick={() => setVerdict(it.id, 'approve')}
                >批准</button>
                <button
                  className={`rq-btn edit ${v === 'edit' ? 'on' : ''}`}
                  onClick={() => setVerdict(it.id, 'edit')}
                >改写</button>
                <button
                  className={`rq-btn reject ${v === 'reject' ? 'on' : ''}`}
                  onClick={() => setVerdict(it.id, 'reject')}
                >打回</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="rq-submit">
        <button onClick={submit} disabled={submitting || decidedCount === 0}>
          {submitting ? '提交中…' : `提交 ${decidedCount}/${items.length} 条决策`}
        </button>
      </div>
    </div>
  );
}
