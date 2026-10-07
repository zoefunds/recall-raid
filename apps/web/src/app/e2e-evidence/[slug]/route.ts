import { NextResponse } from 'next/server';

const records: Record<string, Record<string, string>> = {
  'fisher-price-rock-n-play': {
    product: "Fisher-Price Rock 'n Play Sleeper",
    model: "Rock 'n Play Sleeper",
    hazard: 'Infant fatality risk when used without restraints or after the child can roll over',
    officialReference: 'U.S. CPSC Recall 19-105',
    officialUrl: 'https://www.cpsc.gov/Recalls/2019/Fisher-Price-Recalls-Rock-n-Play-Sleepers-Due-to-Reports-of-Deaths',
  },
  'peloton-tread-plus': {
    product: 'Peloton Tread+ Treadmill',
    model: 'TR01',
    hazard: 'Adult users, children, pets, and objects can be pulled underneath the rear roller',
    officialReference: 'U.S. CPSC Recall 21-129',
    officialUrl: 'https://www.cpsc.gov/Recalls/2021/Peloton-Recalls-Tread-Plus-Treadmills-Due-to-Risk-of-Injury-and-Death',
  },
  'anker-535-power-bank': {
    product: 'Anker 535 Power Bank (PowerCore 20K)',
    model: 'A1366',
    hazard: 'Lithium-ion battery can overheat and create a fire hazard',
    officialReference: 'U.S. CPSC recall of Anker 535 Power Bank model A1366 for fire hazard',
    officialUrl: 'https://www.cpsc.gov/Recalls/2023/Anker-Innovations-Recalls-Power-Banks-Due-to-Fire-Hazard',
  },
};

export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  const evidence = records[params.slug];
  if (!evidence) return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  return NextResponse.json(
    {
      ...evidence,
      sourceType: 'RecallRaid cross-chain E2E evidence fixture',
      networkScope: 'Base Sepolia USDC + GenLayer StudioNet',
      notice: 'Testnet evidence record. Product and recall identifiers are supplied for validator adjudication.',
    },
    { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  );
}
