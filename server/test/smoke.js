// End-to-end smoke test on real WhatsApp export (spec §2 pipeline).
// Bypasses PostgreSQL. Run:
//   node server/test/smoke.js [path-to-json] [max]

const fs = require('fs');
const path = require('path');

const { normalizeRawText, exactDedupHash } = require('../services/normalize');
const { classifyRealEstate } = require('../services/realEstateClassifier');
const { scoreType } = require('../services/typeScorer');
const { parsePrice } = require('../services/priceParser');
const { parseCategory, inferTransactionType, CATEGORY_LABELS } = require('../services/categoryParser');
const { parseLocation, parseAllLocations } = require('../services/locationParser');
const { parseBedrooms, parseArea, parsePhone } = require('../services/bedroomsParser');
const { scoreMatch } = require('../services/matcher');

const file = process.argv[2] || '/Users/solutionmakers/Downloads/raw_messages_export_2026-04-05 (1).json';
const MAX = parseInt(process.argv[3] || '500', 10);

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const raws = Array.isArray(data.messages) ? data.messages : (Array.isArray(data) ? data : []);
const sample = raws.slice(0, MAX);

console.log(`\n▶ Smoke test on ${sample.length} / ${raws.length} messages from ${path.basename(file)}\n`);

// 1. Exact dedup clustering (§4)
const clusters = new Map();
for (const m of sample) {
  const hash = exactDedupHash(m.text || '');
  if (!hash) continue;
  if (!clusters.has(hash)) {
    clusters.set(hash, {
      hash,
      representative_text: m.text,
      messages: [],
      senders: new Set(),
      groups: new Set(),
    });
  }
  const c = clusters.get(hash);
  c.messages.push(m);
  if (m.sender) c.senders.add(m.sender);
  if (m.group_id) c.groups.add(m.group_id);
}

console.log(`═══ §4 Exact dedup clustering ═══`);
console.log(`  Raw messages   : ${sample.length}`);
console.log(`  Unique clusters: ${clusters.size}`);
const multi = [...clusters.values()].filter(c => c.messages.length > 1);
console.log(`  Multi-copy     : ${multi.length} clusters (${multi.reduce((s, c) => s + c.messages.length, 0)} copies)`);
console.log(`  Top 3 dup      :`);
multi.sort((a, b) => b.messages.length - a.messages.length).slice(0, 3).forEach((c, i) => {
  console.log(`    ${i + 1}. [${c.messages.length}x from ${c.senders.size} sender(s)] "${c.representative_text.slice(0, 80).replace(/\n/g, ' ')}"`);
});

// 2. Classification + extraction per cluster (§5-§11)
let reCount = 0, nonRe = 0;
const typeDist = { offer: 0, demand: 0, ambiguous: 0 };
const catDist = {};
let conflicts = 0;
const listings = [];

for (const c of clusters.values()) {
  const text = c.representative_text;
  const rec = classifyRealEstate(text);
  if (!rec.isRealEstate) { nonRe++; continue; }
  reCount++;

  const tr = scoreType(text);
  typeDist[tr.type_final]++;
  if (tr.conflict_flags.length > 0) conflicts++;

  if (tr.type_final === 'ambiguous') continue;

  const cat = parseCategory(text);
  if (!cat.category) continue;
  catDist[cat.category] = (catDist[cat.category] || 0) + 1;

  const price = parsePrice(text);
  const loc = parseLocation(text);
  const bedrooms = parseBedrooms(text);
  const area = parseArea(text);
  const phone = parsePhone(text);

  let transaction = inferTransactionType(text);
  if (!transaction) {
    transaction = price.price_kind === 'monthly_rent' ? 'rent'
      : price.price_kind === 'total_sale' ? 'sale'
      : (price.price_amount && price.price_amount < 2_000_000 ? 'rent' : 'sale');
  }

  const preferred = tr.type_final === 'demand' ? parseAllLocations(text) : null;

  listings.push({
    type: tr.type_final,
    category: cat.category,
    title: `${CATEGORY_LABELS[cat.category] || cat.category}${bedrooms ? ` ${bedrooms}ch` : ''}${loc.neighborhood ? ` - ${loc.neighborhood}` : loc.city ? ` - ${loc.city}` : ''}`,
    transaction_type: transaction,
    price_amount: price.price_amount,
    price_kind: price.price_kind,
    conditions_months: price.conditions_months,
    city: loc.city,
    neighborhood: loc.neighborhood,
    zone: loc.zone,
    bedrooms, area, phone,
    offer_score: tr.offer_score,
    demand_score: tr.demand_score,
    type_confidence: tr.type_confidence,
    conflict_flags: tr.conflict_flags,
    preferred_locations: preferred,
    text,
  });
}

console.log(`\n═══ §5 Real-estate classifier ═══`);
console.log(`  Real-estate clusters : ${reCount} (${(100 * reCount / clusters.size).toFixed(1)}%)`);
console.log(`  Non-real-estate      : ${nonRe}`);

console.log(`\n═══ §6-§7 Offer/Demand typing ═══`);
console.log(`  offer     : ${typeDist.offer}`);
console.log(`  demand    : ${typeDist.demand}`);
console.log(`  ambiguous : ${typeDist.ambiguous}`);
console.log(`  conflict flags raised: ${conflicts}`);

console.log(`\n═══ §10 Category distribution ═══`);
Object.entries(catDist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${k.padEnd(22)}: ${v}`);
});

// 3. Matching (§12)
const offers = listings.filter(l => l.type === 'offer');
const demands = listings.filter(l => l.type === 'demand');
let matchCount = 0;
let best = null;
for (let i = 0; i < offers.length; i++) {
  for (let j = 0; j < demands.length; j++) {
    const o = { ...offers[i], id: i };
    const d = { ...demands[j], id: j };
    const r = scoreMatch(o, d);
    if (r.score >= 50) {
      matchCount++;
      if (!best || r.score > best.score) best = { ...r, offer: offers[i], demand: demands[j] };
    }
  }
}

console.log(`\n═══ §12 Matching (>=50 score) ═══`);
console.log(`  Offers : ${offers.length}`);
console.log(`  Demands: ${demands.length}`);
console.log(`  Matches >=50: ${matchCount}`);
if (best) {
  console.log(`  Best match: ${best.score}/100`);
  console.log(`    breakdown: ${JSON.stringify(best.breakdown)}`);
  console.log(`    reasons  : ${best.reasons.join(', ')}`);
  console.log(`    OFFER  [${best.offer.category}/${best.offer.transaction_type}] in ${best.offer.neighborhood || best.offer.city || '?'}/${best.offer.zone || '?'} @ ${best.offer.price_amount}`);
  console.log(`      "${best.offer.text.slice(0, 140).replace(/\n/g, ' ')}"`);
  console.log(`    DEMAND [${best.demand.category}/${best.demand.transaction_type}] in ${best.demand.neighborhood || best.demand.city || '?'}/${best.demand.zone || '?'} @ ${best.demand.price_amount}`);
  console.log(`      "${best.demand.text.slice(0, 140).replace(/\n/g, ' ')}"`);
  if (Array.isArray(best.demand.preferred_locations)) {
    console.log(`      demand preferred:`, best.demand.preferred_locations);
  }
}

// 4. Sample listings
console.log(`\n═══ Sample listings (first 5) ═══`);
listings.slice(0, 5).forEach((l, i) => {
  const flags = l.conflict_flags.length ? ` [${l.conflict_flags.join(',')}]` : '';
  console.log(`\n  ${i + 1}. ${l.type.toUpperCase()} / ${l.category} / ${l.transaction_type}${flags}`);
  console.log(`     ${l.title}`);
  console.log(`     price: ${l.price_amount} (${l.price_kind || '?'})${l.conditions_months ? ` / ${l.conditions_months} mois caution` : ''}`);
  console.log(`     score: offer=${l.offer_score}, demand=${l.demand_score}, conf=${l.type_confidence}`);
});

console.log(`\n✓ Smoke test complete.\n`);
