'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { requestEvidenceUploadUrl, syncInvestigation, syncEvidenceForInvestigation } from '@/lib/api';
import { sha256Hex } from '@/lib/hash';
import { genToWei } from '@/lib/format';
import { useContractWrite } from '@/hooks/useContractWrite';
import { useConnectedAddress } from '@/components/ConnectWalletButton';
import { useWalletSession } from '@/hooks/useWalletSession';
import { TransactionStatusModal } from '@/components/TransactionStatusModal';

const HAZARD_OPTIONS = [
  { value: 1, label: 'Critical', hint: 'Fire / electrical / choking / structural risk' },
  { value: 2, label: 'High', hint: 'Active recall reported, non-imminent risk' },
  { value: 3, label: 'Moderate', hint: 'Quality or labeling discrepancy' },
];

interface FormState {
  product_name: string;
  brand: string;
  model_number: string;
  serial_number: string;
  marketplace: string;
  marketplace_url: string;
  manufacturer_url: string;
  recall_source_url: string;
  description: string;
  category: string;
  hazard_class: number;
  stakeGen: string;
}

const INITIAL: FormState = {
  product_name: '',
  brand: '',
  model_number: '',
  serial_number: '',
  marketplace: '',
  marketplace_url: '',
  manufacturer_url: '',
  recall_source_url: '',
  description: '',
  category: '',
  hazard_class: 2,
  stakeGen: '',
};

interface StagedFile {
  file: File;
  evidenceType: 'product_photo' | 'listing_screenshot' | 'manufacturer_doc';
  description: string;
}

export default function SubmitEvidencePage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [productPhoto, setProductPhoto] = useState<File | null>(null);
  const [listingScreenshot, setListingScreenshot] = useState<File | null>(null);
  const [evidenceDoc, setEvidenceDoc] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const router = useRouter();

  const write = useContractWrite();
  const { isConnected } = useConnectedAddress();
  const { ensureSession } = useWalletSession();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function next() {
    setStep((s) => Math.min(4, s + 1));
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
  }

  const step1Valid = form.product_name && form.marketplace && form.marketplace_url;
  const step2Valid = form.description && [1, 2, 3].includes(form.hazard_class);
  const step3Valid = !!productPhoto && !!listingScreenshot;
  const step4Valid = Number(form.stakeGen) > 0;

  async function uploadEvidenceFile(investigationId: number, file: File, evidenceType: string) {
    const { upload_url, fields } = await requestEvidenceUploadUrl({
      investigationId,
      contentType: file.type,
      declaredSizeBytes: file.size,
      fileName: file.name,
    });

    // Cloudinary's signed-upload flow is a multipart POST carrying the
    // signed fields alongside the file — not a raw PUT like an S3-style
    // presigned URL. Cloudinary's own JSON response (not our backend's)
    // carries the final `secure_url`, since the asset's resolved path
    // isn't known until Cloudinary has actually processed the upload.
    const body = new FormData();
    body.append('file', file);
    for (const [key, value] of Object.entries(fields)) {
      body.append(key, value);
    }
    const uploadRes = await fetch(upload_url, { method: 'POST', body });
    if (!uploadRes.ok) throw new Error(`Upload failed for ${evidenceType}`);
    const uploaded = (await uploadRes.json()) as { secure_url?: string; error?: { message?: string } };
    if (!uploaded.secure_url) {
      throw new Error(uploaded.error?.message || `Upload failed for ${evidenceType}`);
    }

    const contentHash = await sha256Hex(file);
    return { url: uploaded.secure_url, contentHash };
  }

  async function handleSubmit() {
    if (!isConnected) return;
    setUploading(true);
    setUploadError(null);
    try {
      // Evidence upload requires an authenticated session
      // (/evidence/upload-url is requireAuth-gated) — establish it up
      // front so the wallet's signature prompt appears before the user
      // has already sat through the submit_investigation transaction.
      await ensureSession();

      const stakeWei = genToWei(form.stakeGen);
      const submitRes = await write.send(
        'submit_investigation',
        [
          form.product_name,
          form.brand,
          form.model_number,
          form.serial_number,
          form.marketplace,
          form.marketplace_url,
          form.manufacturer_url,
          form.recall_source_url,
          form.description,
          form.category,
          form.hazard_class,
        ],
        stakeWei,
      );
      if (!submitRes) {
        setUploading(false);
        return;
      }

      // Parse the returned investigation_id from the write result if the
      // client surfaces it; fall back to letting the user find it via the
      // hunts list if the return shape differs.
      let investigationId: number | null = null;
      try {
        const parsed = typeof submitRes.result === 'string' ? JSON.parse(submitRes.result) : submitRes.result;
        investigationId = (parsed as { investigation_id?: number })?.investigation_id ?? null;
      } catch {
        investigationId = null;
      }

      if (investigationId != null) {
        // Seed the cache immediately from the confirmed submit_investigation
        // tx — otherwise the investigation detail page the user is about to
        // land on would 404 ("not in the cache yet") until the next
        // deadline-watcher sweep.
        await syncInvestigation(investigationId, submitRes.txHash);

        const uploads = await Promise.all(
          [
            { file: productPhoto, type: 'product_photo' },
            { file: listingScreenshot, type: 'listing_screenshot' },
            { file: evidenceDoc, type: 'manufacturer_doc' },
          ]
            .filter((x) => !!x.file)
            .map(async (x) => ({ type: x.type, ...(await uploadEvidenceFile(investigationId as number, x.file as File, x.type)) })),
        );

        for (const u of uploads) {
          // Anchor each evidence item on-chain: content_hash + URL only.
          const evidenceRes = await write.send('add_evidence', [investigationId, u.type, u.contentHash, u.url, '']);
          if (evidenceRes) {
            let evidenceId: number | null = null;
            try {
              const parsed = typeof evidenceRes.result === 'string' ? JSON.parse(evidenceRes.result) : evidenceRes.result;
              evidenceId = (parsed as { evidence_id?: number })?.evidence_id ?? null;
            } catch {
              evidenceId = null;
            }
            // The contract requires every evidence item to have gone
            // through verify_evidence (a real GenVM fetch + consensus
            // check that the claimed content_hash matches the bytes
            // actually at the URL) before request_verdict will accept the
            // investigation — request_verdict reverts otherwise. Calling
            // it here means the "Request Verdict" step on the detail page
            // never hits that guard for evidence submitted through this
            // flow.
            if (evidenceId != null) {
              await write.send('verify_evidence', [evidenceId]);
            }
            await syncEvidenceForInvestigation(investigationId, evidenceRes.txHash);
          }
        }
        // Evidence submission flips the on-chain status from OPEN to
        // EVIDENCE_SUBMITTED — re-sync the investigation row itself too,
        // not just the evidence rows, so the detail page's status chip and
        // "Request Verdict" button are correct on first paint.
        if (uploads.length > 0) {
          await syncInvestigation(investigationId);
        }
        router.push(`/hunts/${investigationId}`);
      } else {
        // The write succeeded but the investigation_id couldn't be parsed
        // from the return value — evidence uploads need a real id to
        // attach to, so send the user to the hunts list rather than
        // silently dropping their evidence files.
        router.push('/hunts');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Something went wrong uploading evidence.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-margin-mobile py-10 md:px-margin-desktop">
      <h1 className="mb-2 font-sans text-headline-lg">Submit Evidence</h1>
      <p className="mb-6 text-body-sm text-muted">Report a hazardous or misrepresented marketplace listing and stake a bounty.</p>

      <StepIndicator step={step} />

      <Card className="mt-6">
        <CardBody className="space-y-4">
          {step === 1 && (
            <>
              <Field label="Product name *">
                <Input value={form.product_name} onChange={(v) => update('product_name', v)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Brand">
                  <Input value={form.brand} onChange={(v) => update('brand', v)} />
                </Field>
                <Field label="Model number">
                  <Input value={form.model_number} onChange={(v) => update('model_number', v)} />
                </Field>
              </div>
              <Field label="Serial number">
                <Input value={form.serial_number} onChange={(v) => update('serial_number', v)} />
              </Field>
              <Field label="Marketplace *">
                <Input value={form.marketplace} onChange={(v) => update('marketplace', v)} placeholder="Amazon, eBay, Etsy…" />
              </Field>
              <Field label="Marketplace listing URL *">
                <Input value={form.marketplace_url} onChange={(v) => update('marketplace_url', v)} placeholder="https://…" />
              </Field>
              <Field label="Manufacturer page URL">
                <Input value={form.manufacturer_url} onChange={(v) => update('manufacturer_url', v)} placeholder="https://…" />
              </Field>
              <Field label="Recall source URL">
                <Input value={form.recall_source_url} onChange={(v) => update('recall_source_url', v)} placeholder="https://cpsc.gov/…" />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="Category">
                <Input value={form.category} onChange={(v) => update('category', v)} placeholder="e.g. electronics, toys, appliances" />
              </Field>
              <Field label="Hazard description *">
                <textarea
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  rows={5}
                  className="w-full rounded border border-border-subtle bg-bg-deep p-2 text-body-md text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
                  placeholder="Describe exactly what makes this listing dangerous or misrepresented."
                />
              </Field>
              <Field label="Hazard classification *">
                <div className="space-y-2">
                  {HAZARD_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${
                        form.hazard_class === opt.value ? 'border-primary bg-primary/5' : 'border-border-subtle'
                      }`}
                    >
                      <input
                        type="radio"
                        name="hazard_class"
                        checked={form.hazard_class === opt.value}
                        onChange={() => update('hazard_class', opt.value)}
                        className="mt-1 accent-primary"
                      />
                      <div>
                        <div className="font-mono text-label-caps uppercase text-on-surface">{opt.label}</div>
                        <div className="text-body-sm text-muted">{opt.hint}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <FileField label="Product photo *" file={productPhoto} onChange={setProductPhoto} />
              <FileField label="Marketplace screenshot *" file={listingScreenshot} onChange={setListingScreenshot} />
              <FileField label="Evidence document (optional)" file={evidenceDoc} onChange={setEvidenceDoc} />
              <p className="text-body-sm text-muted">
                Files upload directly to secure storage; a sha256 hash of each file is computed in your browser and
                anchored on-chain alongside the file&apos;s URL for tamper-evidence.
              </p>
            </>
          )}

          {step === 4 && (
            <>
              <Field label="Bounty stake (GEN) *">
                <Input value={form.stakeGen} onChange={(v) => update('stakeGen', v.replace(/[^0-9.]/g, ''))} placeholder="e.g. 50" />
              </Field>
              <p className="text-body-sm text-muted">
                This GEN is escrowed by the contract and paid out to you if the investigation confirms a real issue, or
                refunded if the verdict is NO_ISSUE.
              </p>
              {!isConnected && <p className="text-body-sm text-secondary">Connect your wallet to submit this investigation.</p>}
              {uploadError && <p className="text-body-sm text-danger">{uploadError}</p>}
            </>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={back} disabled={step === 1}>
              Back
            </Button>
            {step < 4 ? (
              <Button
                onClick={next}
                disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid) || (step === 3 && !step3Valid)}
              >
                Continue
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={!step4Valid || !isConnected} loading={uploading}>
                Submit Investigation
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {write.status !== 'idle' && (
        <TransactionStatusModal status={write.status} message={write.message} txHash={write.txHash} onClose={write.reset} />
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: number }) {
  const labels = ['Product', 'Hazard', 'Evidence', 'Stake'];
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] ${
                done ? 'bg-status-safe text-black' : active ? 'bg-primary text-primary-on' : 'bg-surface-high text-muted'
              }`}
            >
              {done ? '✓' : n}
            </div>
            <span className={`hidden font-mono text-label-caps uppercase sm:inline ${active ? 'text-on-surface' : 'text-muted'}`}>
              {label}
            </span>
            {i < labels.length - 1 && <div className="h-px flex-1 bg-border-subtle" />}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 font-mono text-label-caps uppercase text-muted">{label}</div>
      {children}
    </label>
  );
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-border-subtle bg-bg-deep px-3 py-2 font-mono text-data-mono text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
    />
  );
}

function FileField({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  return (
    <label className="block">
      <div className="mb-1 font-mono text-label-caps uppercase text-muted">{label}</div>
      <div className="flex items-center justify-between rounded border border-dashed border-border-subtle bg-bg-deep px-3 py-3">
        <span className="truncate text-body-sm text-muted">{file ? file.name : 'No file selected'}</span>
        <input
          type="file"
          accept="image/*,.pdf"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          className="text-body-sm text-primary"
        />
      </div>
    </label>
  );
}
