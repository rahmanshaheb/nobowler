const BASE = 'http://localhost:3000/api';
const failures = [];
const log = [];

function curlEquiv(method, path, body) {
  const b = body != null ? ` -H 'Content-Type: application/json' -d '${JSON.stringify(body)}'` : '';
  return `curl -s -w '\\nHTTP:%{http_code}' -X ${method} '${BASE}${path}'${b}`;
}

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body != null) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let data;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const entry = { method, path, status: res.status, body: data, curl: curlEquiv(method, path, body) };
  log.push(entry);
  return { status: res.status, data, ok: res.ok, raw: text };
}

function fail(step, msg, r) {
  failures.push({ step, msg, status: r?.status, body: r?.data ?? r?.raw, curl: r ? log[log.length - 1]?.curl : undefined });
  console.error(`FAIL [${step}]: ${msg}`);
  if (r) console.error(JSON.stringify({ status: r.status, body: r.data ?? r.raw }, null, 2));
}

function ok(step, detail) {
  console.log(`OK   [${step}]: ${detail}`);
}

(async () => {
  // 1. Passcode
  const auth = await req('POST', '/auth/scorer-passcode/verify', { passcode: '0000' });
  if (auth.status !== 200 || auth.data?.valid !== true) {
    fail('1-passcode', 'Expected 200 {valid:true}', auth);
    printReport();
    process.exit(1);
  }
  ok('1-passcode', `valid=${auth.data.valid}`);

  // 2. Create match
  const matchBody = {
    matchDate: '2026-07-27',
    teamAName: 'E2E Team A',
    teamBName: 'E2E Team B',
    wideCountEnabled: true,
  };
  const create = await req('POST', '/matches', matchBody);
  if (create.status !== 201 || !create.data?.id) {
    fail('2-create-match', 'Expected 201 with match id', create);
    printReport();
    process.exit(1);
  }
  const matchId = create.data.id;
  const joinCode = create.data.join_code;
  ok('2-create-match', `id=${matchId} join_code=${joinCode}`);

  // 3. Add players (16 total: 8 per team)
  const teamANames = Array.from({ length: 8 }, (_, i) => `A-Player-${i + 1}`);
  const teamBNames = Array.from({ length: 8 }, (_, i) => `B-Player-${i + 1}`);
  const addA = await req('POST', `/matches/${matchId}/players`, { team: 'A', names: teamANames });
  const addB = await req('POST', `/matches/${matchId}/players`, { team: 'B', names: teamBNames });
  if (addA.status !== 201 || addB.status !== 201) {
    fail('3-add-players', 'Expected 201 for both team rosters', addA.status !== 201 ? addA : addB);
    printReport();
    process.exit(1);
  }
  const teamAPlayers = addA.data;
  const teamBPlayers = addB.data;
  ok('3-add-players', `${teamAPlayers.length}+${teamBPlayers.length} players`);

  // Start innings - Team A bats first
  const innings = await req('POST', `/matches/${matchId}/innings`, { battingTeam: 'A' });
  if (innings.status !== 201 || !innings.data?.id) {
    fail('4-start-innings', 'Expected 201 innings', innings);
    printReport();
    process.exit(1);
  }
  const inningsId = innings.data.id;
  ok('4-start-innings', `inningsId=${inningsId}`);

  const batter1 = teamAPlayers[0];
  const batter2 = teamAPlayers[1];
  const pair = await req('POST', `/matches/${matchId}/innings/${inningsId}/pairs`, {
    batter1Id: batter1.id,
    batter2Id: batter2.id,
    pairNumber: 1,
    stintNumber: 1,
  });
  if (pair.status !== 201 || !pair.data?.id) {
    fail('5-start-pair', 'Expected 201 pair', pair);
    printReport();
    process.exit(1);
  }
  const pairInningsId = pair.data.id;
  ok('5-start-pair', `pairInningsId=${pairInningsId}`);

  const bowler = teamBPlayers[0];
  const spell = await req('POST', `/matches/${matchId}/innings/${inningsId}/bowling-spells`, { bowlerId: bowler.id });
  if (spell.status !== 200 || !spell.data?.id) {
    fail('6-bowling-spell', 'Expected 200 spell', spell);
    printReport();
    process.exit(1);
  }
  const bowlingSpellId = spell.data.id;
  ok('6-bowling-spell', `spellId=${bowlingSpellId}`);

  const strikerId = batter1.id;
  const nonStrikerId = batter2.id;

  const deliveries = [
    { label: '4 runs zone 4', body: { pairInningsId, bowlingSpellId, strikerId, nonStrikerId, deliveryType: 'normal', zoneHit: 4, battersCrossed: false, manualRunAdjustment: 0, isWicket: false } },
    { label: '1 run zone 1', body: { pairInningsId, bowlingSpellId, strikerId, nonStrikerId, deliveryType: 'normal', zoneHit: 1, battersCrossed: true, manualRunAdjustment: 0, isWicket: false } },
    { label: 'bowled wicket', body: { pairInningsId, bowlingSpellId, strikerId, nonStrikerId, deliveryType: 'normal', zoneHit: null, battersCrossed: false, manualRunAdjustment: 0, isWicket: true, wicketType: 'bowled', dismissedPlayerId: strikerId } },
  ];

  let expectedRuns = 0;
  let expectedWickets = 0;
  for (const d of deliveries) {
    const r = await req('POST', `/innings/${inningsId}/deliveries`, d.body);
    if (r.status !== 201 && r.status !== 200) {
      fail(`7-delivery-${d.label}`, `Unexpected status`, r);
      continue;
    }
    const tr = Number(r.data?.totalRuns ?? r.data?.total_runs ?? 0);
    const pen = Number(r.data?.penaltyRuns ?? r.data?.penalty_runs ?? 0);
    expectedRuns += tr + pen;
    if (d.body.isWicket) expectedWickets += 1;
    ok(`7-delivery`, `${d.label} status=${r.status}`);
  }

  // 4. Public match detail + consistency
  const detail = await req('GET', `/public/matches/${matchId}`);
  if (detail.status !== 200) {
    fail('8-public-detail', 'Expected 200', detail);
  } else {
    ok('8-public-detail', '200 OK');
    const inn = detail.data.innings?.[0];
    const totalRuns = Number(inn?.total_runs ?? inn?.totalRuns ?? NaN);
    const totalWickets = Number(inn?.total_wickets ?? inn?.totalWickets ?? NaN);

    const batRuns = (detail.data.battingStats || []).reduce((s, b) => s + Number(b.runs_scored || 0), 0);
    const bowlWickets = (detail.data.bowlingStats || []).reduce((s, b) => s + Number(b.bowler_credited_wickets || 0), 0);

    console.log('     Stats snapshot:', JSON.stringify({
      inningsTotals: { totalRuns, totalWickets },
      sumBattingRuns: batRuns,
      sumBowlingWickets: bowlWickets,
      validation: detail.data.validation,
      matchStatus: detail.data.match?.status,
    }));

    if (Number.isNaN(totalRuns) || Number.isNaN(totalWickets)) {
      fail('8-consistency', 'Missing innings totals in public detail', detail);
    } else if (totalWickets !== expectedWickets) {
      fail('8-consistency', `Innings wickets ${totalWickets} !== expected ${expectedWickets} from deliveries`, detail);
    } else if (bowlWickets !== expectedWickets) {
      fail('8-consistency', `Bowling wickets sum ${bowlWickets} !== expected ${expectedWickets}`, detail);
    } else {
      ok('8-consistency', `wickets=${totalWickets} runs=${totalRuns} (batting sum=${batRuns})`);
    }

    if (detail.data.validation && detail.data.validation.isValid === false) {
      fail('8-validation', 'validateMatchData reported issues', { status: 200, data: detail.data.validation });
    }
  }

  // 5. DELETE wrong join code
  const wrongDel = await req('DELETE', `/public/matches/${matchId}`, { joinCode: '9999' });
  if (wrongDel.status !== 403) {
    fail('9-delete-wrong-code', 'Expected 403', wrongDel);
  } else {
    ok('9-delete-wrong-code', `403 ${JSON.stringify(wrongDel.data)}`);
  }

  // Verify still exists
  const stillThere = await req('GET', `/public/matches/${matchId}`);
  if (stillThere.status !== 200) {
    fail('9-after-wrong-delete', 'Match should still exist', stillThere);
  }

  // DELETE correct join code
  const joinCodeStr = String(joinCode).padStart(4, '0');
  const goodDel = await req('DELETE', `/public/matches/${matchId}`, { joinCode: joinCodeStr });
  if (goodDel.status !== 200 || goodDel.data?.deleted !== true) {
    fail('10-delete-correct-code', 'Expected 200 {deleted:true}', goodDel);
  } else {
    ok('10-delete-correct-code', 'deleted=true');
  }

  const gone = await req('GET', `/public/matches/${matchId}`);
  if (gone.status !== 404) {
    fail('10-after-delete', 'Expected 404 for deleted match', gone);
  } else {
    ok('10-after-delete', '404 as expected');
  }

  printReport();
  process.exit(failures.length ? 1 : 0);

  function printReport() {
    console.log('\n========== E2E REPORT ==========');
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) {
      console.log('\n---', f.step, '---');
      console.log(f.msg);
      if (f.curl) console.log('Curl:', f.curl);
      console.log('Response:', JSON.stringify({ status: f.status, body: f.body }, null, 2));
    }
    if (failures.length === 0) console.log('All steps passed.');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
