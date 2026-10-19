'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { requestEvidenceUploadUrl, syncInvestigation, syncEvidenceForInvestigation, syncInvestigationUntilVisible } from '@/lib/api';
import { sha256Hex } from '@/lib/hash';
import { usdcToBaseUnits } from '@/lib/format';
import { fundInvestigation, makeEscrowId, type BaseTransactionProgress } from '@/lib/base-sepolia';
import { useContractWrite } from '@/hooks/useContractWrite';
import { callContractView, type TxLifecycleStatus } from '@/lib/genlayer-client';
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
  bountyUsdc: string;
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
  bountyUsdc: '',
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
  const [loadingExample, setLoadingExample] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [baseFunding, setBaseFunding] = useState<BaseTransactionProgress>({ status: 'idle' });
  const [baseFundingHashes, setBaseFundingHashes] = useState<{ approvalHash: string; fundingHash: string } | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const write = useContractWrite();
  const { address, connector } = useAccount();
  const { isConnected } = useConnectedAddress();
  const { ensureSession } = useWalletSession();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function loadTestExample() {
    setLoadingExample(true);
    setUploadError(null);
    try {
      const suffix = new Date().toISOString().replace(/[:.]/g, '-');
      const [productImage, listingImage] = await Promise.all([
        createTestEvidenceImage({
          filename: `fisher-price-rock-n-play-product-${suffix}.png`,
          title: "Fisher-Price Rock 'n Play Sleeper",
          subtitle: 'Test product evidence · CPSC Recall 19-105',
          accent: '#00d4e5',
        }),
        createTestEvidenceImage({
          filename: `fisher-price-rock-n-play-listing-${suffix}.png`,
          title: 'RecallRaid Test Listing',
          subtitle: "Fisher-Price Rock 'n Play Sleeper · CPSC Recall 19-105",
          accent: '#ff9f1a',
        }),
      ]);

      setForm({
        product_name: "Fisher-Price Rock 'n Play Sleeper",
        brand: 'Fisher-Price',
        model_number: "Rock 'n Play Sleeper",
        serial_number: `TEST-${suffix.slice(-8).toUpperCase()}`,
        marketplace: 'RecallRaid test marketplace',
        marketplace_url: 'https://recall-raid.vercel.app/e2e-evidence/fisher-price-rock-n-play',
        manufacturer_url: '',
        recall_source_url: 'https://www.cpsc.gov/Recalls/2019/Fisher-Price-Recalls-Rock-n-Play-Sleepers-Due-to-Reports-of-Deaths',
        description:
          "Test submission: Fisher-Price Rock 'n Play Sleeper is being checked against CPSC Recall 19-105. The product is recalled because of infant deaths when used without restraints or after an infant can roll over. The exact product model and official recall source are included for GenLayer verification.",
        category: 'Baby products',
        hazard_class: 1,
        bountyUsdc: '0.50',
      });
      setProductPhoto(productImage);
      setListingScreenshot(listingImage);
      setEvidenceDoc(null);
      setStep(1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not create the test example files.');
    } finally {
      setLoadingExample(false);
    }
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
  const step4Valid = Number(form.bountyUsdc) > 0;

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

      if (!address || !connector) throw new Error('Connect your wallet first.');
      const bountyUsdcBaseUnits = usdcToBaseUnits(form.bountyUsdc);
      const baseCaseId = makeEscrowId('case', address);
      const provider = await connector.getProvider();
      const baseFundingResult = await fundInvestigation(provider, address, baseCaseId, bountyUsdcBaseUnits, setBaseFunding);
      setBaseFundingHashes(baseFundingResult);
      // Base escrow is now independently confirmed. Clear its progress
      // modal before opening the separate GenLayer signing flow, while
      // retaining both Base transaction links below for auditability.
      setBaseFunding({ status: 'idle' });
      const submitRes = await write.send(
        'submit_investigation',
        [
          baseCaseId,
          Number(bountyUsdcBaseUnits),
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
      );
      if (!submitRes) {
        setUploading(false);
        return;
      }

      // The SDK has used more than one return-payload nesting across
      // StudioNet versions. Prefer the returned id, but independently find
      // the newest matching on-chain record if that payload shape changes.
      // This is safe because base_case_id is unique and was just funded by
      // this wallet.
      let investigationId = investigationIdFromResult(submitRes.result)
        ?? await findSubmittedInvestigationId(baseCaseId, address);

      if (investigationId != null) {
        // Poll the API cache immediately after finality. GenVM finality and
        // its read endpoint can briefly disagree, so one failed sync must
        // never hide a confirmed investigation from its creator.
        await syncInvestigationUntilVisible(investigationId, submitRes.txHash);
        await queryClient.invalidateQueries({ queryKey: ['investigations'] });

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
        throw new Error('The investigation finalized but could not be located on GenLayer. Please retry shortly using the transaction link.');
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-primary/30 bg-primary/5 p-4">
        <div>
          <div className="font-mono text-label-caps uppercase text-primary">Test the full flow</div>
          <p className="mt-1 text-body-sm text-muted">Load a detailed CPSC Recall 19-105 example, including generated PNG evidence files and a 0.50 USDC test bounty.</p>
        </div>
        <Button type="button" variant="ghost" loading={loadingExample} onClick={loadTestExample}>
          Load test example
        </Button>
      </div>

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
              <Field label="Bounty escrow (USDC on Base Sepolia) *">
                <Input value={form.bountyUsdc} onChange={(v) => update('bountyUsdc', v.replace(/[^0-9.]/g, ''))} placeholder="e.g. 50" />
              </Field>
              <p className="text-body-sm text-muted">
                Your wallet first deposits USDC into the RecallRaid escrow on Base Sepolia. GenLayer only adjudicates
                the evidence; its final decision is relayed back to Base Sepolia for settlement.
              </p>
              {baseFundingHashes && (
                <div className="rounded border border-status-safe/40 bg-status-safe/5 p-3 text-body-sm">
                  <div className="mb-1 font-mono text-label-caps uppercase text-status-safe">USDC confirmed in Base Sepolia escrow</div>
                  <a
                    href={`https://sepolia.basescan.org/tx/${baseFundingHashes.approvalHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-mono text-primary underline"
                  >
                    Approval: {baseFundingHashes.approvalHash}
                  </a>
                  <a
                    href={`https://sepolia.basescan.org/tx/${baseFundingHashes.fundingHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-mono text-primary underline"
                  >
                    Escrow funding: {baseFundingHashes.fundingHash}
                  </a>
                </div>
              )}
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

      {(baseFunding.status !== 'idle' || write.status !== 'idle') && (
        <TransactionStatusModal
          status={(baseFunding.status !== 'idle' ? baseFunding.status : write.status) as TxLifecycleStatus}
          message={baseFunding.status !== 'idle' ? baseFunding.message : write.message}
          txHash={baseFunding.status !== 'idle' ? baseFunding.txHash : write.txHash}
          onClose={baseFunding.status !== 'idle' ? () => setBaseFunding({ status: 'idle' }) : write.reset}
        />
      )}
    </div>
  );
}

function investigationIdFromResult(result: unknown): number | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown): number | null => {
    if (value === null || value === undefined || seen.has(value)) return null;
    if (typeof value === 'string') {
      try {
        return visit(JSON.parse(value));
      } catch {
        return null;
      }
    }
    if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
    if (typeof value !== 'object') return null;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found != null) return found;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    const direct = record.investigation_id ?? record.investigationId;
    if (typeof direct === 'number' && Number.isInteger(direct) && direct > 0) return direct;
    if (typeof direct === 'string' && /^\d+$/.test(direct) && Number(direct) > 0) return Number(direct);
    for (const nested of Object.values(record)) {
      const found = visit(nested);
      if (found != null) return found;
    }
    return null;
  };
  return visit(result);
}

async function findSubmittedInvestigationId(baseCaseId: string, submitter: string): Promise<number | null> {
  // Poll the chain directly only when the finalized write receipt has no
  // usable result. The normal path avoids these additional reads entirely.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const rawCount = await callContractView<unknown>({ method: 'get_investigation_count' });
      const count = Number(rawCount);
      if (Number.isInteger(count) && count > 0) {
        // A case id is unique, so checking the newest few records avoids a
        // broad scan while covering concurrent submissions.
        for (let id = count; id >= Math.max(1, count - 12); id--) {
          const investigation = await callContractView<{ base_case_id?: string; submitter?: string }>({
            method: 'get_investigation',
            args: [id],
          });
          if (
            investigation.base_case_id?.toLowerCase() === baseCaseId.toLowerCase()
            && investigation.submitter?.toLowerCase() === submitter.toLowerCase()
          ) {
            return id;
          }
        }
      }
    } catch {
      // The next bounded poll handles the same short propagation delay that
      // can affect API sync immediately after transaction finality.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return null;
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

async function createTestEvidenceImage({
  filename,
  title,
  subtitle,
  accent,
}: {
  filename: string;
  title: string;
  subtitle: string;
  accent: string;
}): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not generate the test evidence image.');

  context.fillStyle = '#101418';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = accent;
  context.fillRect(0, 0, canvas.width, 14);
  context.fillStyle = '#e8edf2';
  context.font = 'bold 52px Arial, sans-serif';
  context.fillText(title, 70, 220);
  context.fillStyle = '#9da8b3';
  context.font = '32px Arial, sans-serif';
  wrapCanvasText(context, subtitle, 70, 300, 1040, 46);
  context.fillStyle = accent;
  context.font = 'bold 24px monospace';
  context.fillText('RECALLRAID TEST EVIDENCE · BASE SEPOLIA', 70, 510);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Could not encode the test evidence image.'))), 'image/png');
  });
  return new File([blob], filename, { type: 'image/png' });
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  let cursorY = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > maxWidth && line) {
      context.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) context.fillText(line, x, cursorY);
}
