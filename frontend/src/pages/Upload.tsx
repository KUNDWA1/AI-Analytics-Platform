import { FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { download, errMsg, http } from '../api';
import { Card, ErrorBox, Field, Notice, PageHeader, useGet } from '../components/ui';
import { SYNTH_LABEL, bytes } from '../format';

const ALLOWED = ['.csv', '.xlsx', '.xls'];

export default function Upload() {
  const nav = useNavigate();
  const meta = useGet<any>('/datasets/meta');
  const sources = useGet<any[]>('/data-sources');
  const samples = useGet<any>('/system/samples');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ name: '', category: '', data_source_id: '', description: '', is_synthetic: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const maxMb = meta.data?.max_upload_mb ?? 10;

  function pick(file: File | null) {
    setErr(null);
    if (!file) return setFile(null);
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED.includes(ext)) { setFile(null); return setErr(`Unsupported file type "${ext}". Upload a CSV or Excel file (${ALLOWED.join(', ')}).`); }
    if (file.size > maxMb * 1048576) { setFile(null); return setErr(`File is too large (${bytes(file.size)}). The limit is ${maxMb} MB.`); }
    if (file.size === 0) { setFile(null); return setErr('The selected file is empty.'); }
    setFile(file);
    if (!f.name) setF((p) => ({ ...p, name: file.name.replace(/\.[^.]+$/, '') }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setErr('Choose a CSV or Excel file to upload.');
    if (!f.category) return setErr('Select a dataset category.');
    setBusy(true); setErr(null); setProgress(0);
    const form = new FormData();
    form.append('name', f.name || file.name);
    form.append('category', f.category);
    if (f.description) form.append('description', f.description);
    if (f.data_source_id) form.append('data_source_id', f.data_source_id);
    if (f.is_synthetic) form.append('is_synthetic', 'true');
    form.append('file', file);
    try {
      const res = await http.post('/datasets/upload', form, { onUploadProgress: (p) => setProgress(Math.round((p.loaded / (p.total || file.size)) * 100)) });
      nav(`/datasets/${res.data.data.id}`);
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Upload dataset" subtitle="Add a CSV or Excel file downloaded from an official public source. The file is validated on upload and stored unchanged." />
      <div className="grid gap-5 lg:grid-cols-3">
        <form onSubmit={submit} className="card space-y-4 p-5 lg:col-span-2" aria-label="Upload dataset">
          {err && <ErrorBox message={err} />}
          <Field label="File (CSV or Excel)" hint={`Maximum ${maxMb} MB. File contents are checked, not just the extension.`}>
            <input ref={fileRef} className="input" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => pick(e.target.files?.[0] || null)} aria-label="Dataset file" />
          </Field>
          {file && <p className="text-xs text-slate-600">Selected: <strong>{file.name}</strong> ({bytes(file.size)})</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Dataset name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={150} /></Field>
            <Field label="Category">
              <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Category">
                <option value="">Select…</option>{meta.data?.categories?.map((c: string) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Data source">
              <select className="input" value={f.data_source_id} onChange={(e) => setF({ ...f, data_source_id: e.target.value })}>
                <option value="">Not specified</option>{sources.data?.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={f.is_synthetic} onChange={(e) => setF({ ...f, is_synthetic: e.target.checked })} />
            <span>This is synthetic / demonstration data<span className="block text-xs text-slate-500">Datasets whose contents say “synthetic” are detected automatically. Synthetic data is labelled on every chart and report.</span></span></label>
          {busy && <div role="progressbar" aria-valuenow={progress} className="h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} /></div>}
          <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? `Uploading… ${progress}%` : 'Upload and validate'}</button></div>
        </form>

        <div className="space-y-5">
          <Card title="Sample demonstration files" subtitle="Download, then upload them here to try the workflow.">
            <Notice tone="amber"><strong>{SYNTH_LABEL}</strong></Notice>
            <ul className="mt-3 space-y-3 text-sm">
              {samples.data?.files?.map((s: any) => (
                <li key={s.name}><button className="font-medium text-brand-700 hover:underline" onClick={() => download(`/system/samples/${encodeURIComponent(s.name)}`, undefined, s.name)}>{s.name}</button>
                  <div className="text-xs text-slate-500">{bytes(s.size)} — {s.description}</div></li>
              ))}
            </ul>
          </Card>
          <Card title="What happens next">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>The file is validated (format, columns, types, missing values, duplicates).</li>
              <li>You review the detected columns and the suggested mapping.</li>
              <li>Processing normalises dates, checks values, removes duplicates and stores observations.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
