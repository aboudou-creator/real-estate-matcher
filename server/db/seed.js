const { pool, initDB } = require('./postgres');

// ── Senegal locations ──────────────────────────────────────────────
const locations = [
  { city: 'Dakar', neighborhood: 'Plateau', lat: 14.6697, lng: -17.4441 },
  { city: 'Dakar', neighborhood: 'Médina', lat: 14.6742, lng: -17.4520 },
  { city: 'Dakar', neighborhood: 'Fann', lat: 14.6935, lng: -17.4690 },
  { city: 'Dakar', neighborhood: 'Mermoz', lat: 14.7055, lng: -17.4785 },
  { city: 'Dakar', neighborhood: 'Sacré-Cœur', lat: 14.7130, lng: -17.4680 },
  { city: 'Dakar', neighborhood: 'Ouakam', lat: 14.7220, lng: -17.4890 },
  { city: 'Dakar', neighborhood: 'Ngor', lat: 14.7450, lng: -17.5150 },
  { city: 'Dakar', neighborhood: 'Almadies', lat: 14.7380, lng: -17.5090 },
  { city: 'Dakar', neighborhood: 'Yoff', lat: 14.7400, lng: -17.4900 },
  { city: 'Dakar', neighborhood: 'Liberté', lat: 14.6950, lng: -17.4580 },
  { city: 'Dakar', neighborhood: 'Point E', lat: 14.6930, lng: -17.4650 },
  { city: 'Dakar', neighborhood: 'Sicap Baobab', lat: 14.7000, lng: -17.4550 },
  { city: 'Dakar', neighborhood: 'HLM', lat: 14.6900, lng: -17.4480 },
  { city: 'Dakar', neighborhood: 'Grand Dakar', lat: 14.6830, lng: -17.4430 },
  { city: 'Dakar', neighborhood: 'Colobane', lat: 14.6810, lng: -17.4500 },
  { city: 'Dakar', neighborhood: 'Castor', lat: 14.7100, lng: -17.4420 },
  { city: 'Dakar', neighborhood: 'Dieuppeul', lat: 14.7050, lng: -17.4500 },
  { city: 'Dakar', neighborhood: 'Mamelles', lat: 14.7280, lng: -17.5000 },
  { city: 'Dakar', neighborhood: 'Ouest Foire', lat: 14.7350, lng: -17.4750 },
  { city: 'Dakar', neighborhood: 'Cité Keur Gorgui', lat: 14.7150, lng: -17.4700 },
  { city: 'Pikine', neighborhood: 'Pikine', lat: 14.7570, lng: -17.3930 },
  { city: 'Guédiawaye', neighborhood: 'Guédiawaye', lat: 14.7730, lng: -17.3970 },
  { city: 'Rufisque', neighborhood: 'Rufisque Centre', lat: 14.7160, lng: -17.2730 },
  { city: 'Keur Massar', neighborhood: 'Keur Massar', lat: 14.7710, lng: -17.3120 },
  { city: 'Mbao', neighborhood: 'Mbao', lat: 14.7350, lng: -17.3300 },
  { city: 'Diamniadio', neighborhood: 'Diamniadio Centre', lat: 14.7080, lng: -17.1790 },
  { city: 'Diamniadio', neighborhood: 'Pôle Urbain', lat: 14.7150, lng: -17.1700 },
  { city: 'Thiès', neighborhood: 'Thiès Centre', lat: 14.7886, lng: -16.9260 },
  { city: 'Thiès', neighborhood: 'Thiès Nord', lat: 14.8050, lng: -16.9200 },
  { city: 'Saint-Louis', neighborhood: 'Île Saint-Louis', lat: 16.0200, lng: -16.4890 },
  { city: 'Saint-Louis', neighborhood: 'Sor', lat: 16.0100, lng: -16.4700 },
  { city: 'Mbour', neighborhood: 'Mbour Centre', lat: 14.4165, lng: -16.9640 },
  { city: 'Mbour', neighborhood: 'Saly', lat: 14.4480, lng: -17.0170 },
  { city: 'Saly', neighborhood: 'Saly Portudal', lat: 14.4500, lng: -17.0200 },
  { city: 'Touba', neighborhood: 'Touba Centre', lat: 14.8510, lng: -15.8820 },
  { city: 'Kaolack', neighborhood: 'Kaolack Centre', lat: 14.1390, lng: -16.0760 },
  { city: 'Ziguinchor', neighborhood: 'Ziguinchor Centre', lat: 12.5640, lng: -16.2720 },
  { city: 'Somone', neighborhood: 'Somone', lat: 14.4800, lng: -17.0700 },
  { city: 'Ngaparou', neighborhood: 'Ngaparou', lat: 14.4350, lng: -17.0350 },
  { city: 'Popenguine', neighborhood: 'Popenguine', lat: 14.5520, lng: -17.1100 },
  { city: 'Lac Rose', neighborhood: 'Lac Rose', lat: 14.8380, lng: -17.2330 },
];

// ── Titles ─────────────────────────────────────────────────────────
const titles = {
  apartment: [
    'Bel appartement F3 lumineux', 'Appartement F4 standing avec balcon',
    'Studio meublé moderne', 'Appartement F2 rénové', 'Penthouse vue mer',
    'Appartement F5 familial', 'Duplex haut standing', 'Appartement F3 meublé climatisé',
    'Grand appartement F4 neuf', 'Appartement F2 proche centre',
    'Appartement F3 avec terrasse', 'Appartement F4 sécurisé',
    'Studio avec parking', 'Appartement F3 vue océan', 'Appartement F5 avec piscine',
  ],
  house: [
    'Villa 4 chambres avec jardin', 'Maison R+1 à vendre', 'Villa standing bord de mer',
    'Maison traditionnelle rénovée', 'Villa 5 chambres avec piscine',
    'Maison 3 chambres avec garage', 'Villa moderne neuve', 'Maison plain-pied 4 chambres',
  ],
  ground: [
    'Terrain 300m² viabilisé', 'Parcelle constructible 500m²',
    'Terrain titre foncier 200m²', 'Lot de terrain 1000m²', 'Terrain bien situé 400m²',
  ],
  agricultural_ground: [
    'Terrain agricole 2 hectares', 'Parcelle agricole irrigable',
    'Ferme avec terrain 5 hectares', 'Terrain maraîcher 1 hectare',
  ],
};

const senders = [
  'Amadou Diallo', 'Fatou Sow', 'Moussa Ndiaye', 'Awa Ba', 'Ibrahima Fall',
  'Mariama Diop', 'Ousmane Sarr', 'Aissatou Sy', 'Abdoulaye Gueye', 'Khady Mbaye',
  'Cheikh Seck', 'Ndèye Diouf', 'Mamadou Cissé', 'Sokhna Touré', 'Pape Thiam',
  'Mame Diarra Kane', 'Babacar Lo', 'Rama Ndour', 'Modou Faye', 'Adama Traoré',
  'Oumar Sané', 'Bineta Diagne', 'Aliou Tall', 'Coumba Dieng', 'Lamine Kamara',
];

// ── Helpers ────────────────────────────────────────────────────────
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const jitter = (val, amt) => val + (Math.random() - 0.5) * 2 * amt;
const randFloat = (min, max) => min + Math.random() * (max - min);

function makeProduct({ type, category, transactionType, loc, bedrooms, bathrooms, area, price, isDuplicate }) {
  const title = pick(titles[category]);
  const sender = pick(senders);
  const phone = `+221 7${rand(0, 9)} ${rand(100, 999)} ${rand(10, 99)} ${rand(10, 99)}`;
  const description = `${title} situé à ${loc.neighborhood}, ${loc.city}. ` +
    (bedrooms ? `${bedrooms} chambre(s), ${bathrooms} salle(s) de bain. ` : '') +
    `Surface: ${area}m². ` +
    (transactionType === 'rent' ? `Loyer: ${price.toLocaleString()} FCFA/mois.` : `Prix: ${price.toLocaleString()} FCFA.`) +
    ` Contact: ${sender} ${phone}.`;

  return {
    title, description, type, category,
    transaction_type: transactionType,
    price, currency: 'XOF',
    location: `${loc.neighborhood}, ${loc.city}`,
    city: loc.city, neighborhood: loc.neighborhood,
    latitude: jitter(loc.lat, 0.004),
    longitude: jitter(loc.lng, 0.004),
    bedrooms, bathrooms, area,
    sender, phone, is_duplicate: isDuplicate || false,
  };
}

// ── Description templates for realistic duplicate variation ───────
// Same property, different wording by different people
const descTemplates = {
  apartment: [
    (p) => `${p.title} à ${p.neighborhood}, ${p.city}. ${p.bedrooms}ch/${p.bathrooms}sdb, ${p.area}m². ${p.transLabel}: ${p.priceLabel}. Appelez ${p.sender} ${p.phone}.`,
    (p) => `🏢 ${p.type === 'offer' ? 'À VENDRE' : 'RECHERCHE'} - Appart ${p.bedrooms} chambres à ${p.neighborhood} (${p.city}). Surface ${p.area}m², ${p.bathrooms} SDB. ${p.priceLabel}. Contact: ${p.phone} (${p.sender})`,
    (p) => `Bonjour, ${p.type === 'offer' ? 'je propose' : 'je cherche'} un appartement de ${p.bedrooms} pièces situé au quartier ${p.neighborhood}, ${p.city}. ${p.area} mètres carrés. ${p.transLabel} ${p.priceLabel}. Merci de contacter ${p.sender} au ${p.phone}`,
    (p) => `Appartement ${p.bedrooms}ch ${p.area}m² - ${p.neighborhood}/${p.city}. ${p.bathrooms} salles de bain. ${p.priceLabel} ${p.transType === 'rent' ? 'par mois' : ''}. Info: ${p.sender} (${p.phone})`,
    (p) => `📍${p.neighborhood}, ${p.city}\n${p.type === 'offer' ? 'Disponible' : 'Recherché'}: appartement F${p.bedrooms + 1}, ${p.area}m², ${p.bathrooms} toilettes.\n💰 ${p.priceLabel}\n📞 ${p.sender} - ${p.phone}`,
  ],
  house: [
    (p) => `${p.title} à ${p.neighborhood}, ${p.city}. ${p.bedrooms} chambres, ${p.bathrooms} SDB, terrain ${p.area}m². ${p.transLabel}: ${p.priceLabel}. ${p.sender} ${p.phone}.`,
    (p) => `🏠 Villa/Maison ${p.bedrooms}ch à ${p.neighborhood} ${p.city}. ${p.area}m² avec ${p.bathrooms} salles d'eau. ${p.priceLabel}. Contactez ${p.sender} au ${p.phone}`,
    (p) => `${p.type === 'offer' ? 'VENTE MAISON' : 'CHERCHE MAISON'} - ${p.neighborhood}, ${p.city}. ${p.bedrooms} pièces, ${p.bathrooms} douches, ${p.area}m². Prix: ${p.priceLabel}. Tél: ${p.phone} ${p.sender}`,
    (p) => `Maison de ${p.bedrooms} chambres sur ${p.area}m² au cœur de ${p.neighborhood}, ${p.city}. ${p.bathrooms} sdb. ${p.priceLabel}. Pour plus d'infos: ${p.sender} ${p.phone}`,
  ],
  ground: [
    (p) => `${p.title} à ${p.neighborhood}, ${p.city}. Surface: ${p.area}m². ${p.transLabel}: ${p.priceLabel}. ${p.sender} ${p.phone}.`,
    (p) => `🏗️ Terrain ${p.area}m² - ${p.neighborhood}, ${p.city}. ${p.priceLabel}. Contact: ${p.sender} (${p.phone})`,
    (p) => `Terrain à ${p.type === 'offer' ? 'vendre' : 'acheter'} à ${p.neighborhood}/${p.city}, ${p.area} m². ${p.priceLabel}. Appelez ${p.phone} (${p.sender})`,
  ],
  agricultural_ground: [
    (p) => `${p.title} à ${p.neighborhood}, ${p.city}. Surface: ${p.area}m². ${p.transLabel}: ${p.priceLabel}. ${p.sender} ${p.phone}.`,
    (p) => `Terrain agricole de ${p.area}m² situé à ${p.neighborhood}, ${p.city}. ${p.priceLabel}. Info: ${p.sender} ${p.phone}`,
    (p) => `🌾 Parcelle agricole ${p.area}m² - ${p.neighborhood} (${p.city}). ${p.priceLabel}. Tél: ${p.phone}`,
  ],
};

// Alternate titles for the same property
const altTitles = {
  apartment: [
    (bed) => `Appart F${bed + 1} dispo`,
    (bed) => `Appartement ${bed} chambres`,
    (bed) => `Bel appart ${bed}ch standing`,
    (bed) => `F${bed + 1} à saisir`,
    (bed) => `Appartement ${bed} pièces rénové`,
  ],
  house: [
    (bed) => `Villa ${bed} chambres`,
    (bed) => `Maison ${bed}ch`,
    (bed) => `Belle villa ${bed} pièces`,
    (bed) => `Résidence ${bed} chambres`,
  ],
  ground: [
    () => 'Terrain à vendre',
    () => 'Parcelle disponible',
    () => 'Terrain TF',
    () => 'Lot terrain viabilisé',
  ],
  agricultural_ground: [
    () => 'Terrain agricole',
    () => 'Parcelle agricole dispo',
    () => 'Ferme terrain',
  ],
};

function randomProduct() {
  const catRoll = Math.random();
  let category, bedrooms, bathrooms, area;

  if (catRoll < 0.50) {
    category = 'apartment'; bedrooms = rand(1, 5); bathrooms = rand(1, 3); area = rand(30, 250);
  } else if (catRoll < 0.75) {
    category = 'house'; bedrooms = rand(2, 7); bathrooms = rand(1, 4); area = rand(80, 600);
  } else if (catRoll < 0.90) {
    category = 'ground'; bedrooms = null; bathrooms = null; area = rand(150, 2000);
  } else {
    category = 'agricultural_ground'; bedrooms = null; bathrooms = null; area = rand(5000, 50000);
  }

  const transactionType = Math.random() < 0.65 ? 'sale' : 'rent';
  let price;
  if (transactionType === 'rent') {
    price = rand(5, 200) * 10000;
  } else {
    price = category === 'apartment' ? rand(25, 350) * 1000000
          : category === 'house' ? rand(40, 800) * 1000000
          : category === 'ground' ? rand(5, 200) * 1000000
          : rand(2, 100) * 1000000;
  }

  return makeProduct({
    type: Math.random() < 0.55 ? 'offer' : 'demand',
    category, transactionType, loc: pick(locations),
    bedrooms, bathrooms, area, price,
  });
}

// ── Seed logic ─────────────────────────────────────────────────────
async function seed() {
  try {
    await initDB();
    const client = await pool.connect();

    try {
      await client.query('TRUNCATE TABLE duplicates, matches, products, real_products RESTART IDENTITY CASCADE');

      const allProducts = [];
      const matchPairs = [];     // { idx1, idx2, score }
      const duplicatePairs = []; // { origIdx, dupIdx, similarity }
      // Track which raw product indices belong to the same real product
      // Each entry: { indices: [idx, idx, ...], representative: product-data }
      const realProductGroups = [];

      // ── BLOCK 1: 40 deliberate match pairs (80 products) ──────
      // Each pair = 1 offer + 1 demand with same location/category/similar price
      for (let i = 0; i < 40; i++) {
        const loc = pick(locations);
        const catRoll = Math.random();
        let category, bedrooms, bathrooms, areaBase;

        if (catRoll < 0.55) {
          category = 'apartment'; bedrooms = rand(2, 4); bathrooms = rand(1, 2); areaBase = rand(60, 180);
        } else if (catRoll < 0.80) {
          category = 'house'; bedrooms = rand(3, 6); bathrooms = rand(2, 3); areaBase = rand(120, 400);
        } else {
          category = 'ground'; bedrooms = null; bathrooms = null; areaBase = rand(200, 1000);
        }

        const transType = Math.random() < 0.6 ? 'sale' : 'rent';
        let basePrice;
        if (transType === 'rent') {
          basePrice = rand(10, 150) * 10000;
        } else {
          basePrice = category === 'apartment' ? rand(30, 250) * 1000000
                    : category === 'house' ? rand(50, 500) * 1000000
                    : rand(10, 150) * 1000000;
        }

        // Offer
        const offerIdx = allProducts.length;
        const offerProduct = makeProduct({
          type: 'offer', category, transactionType: transType, loc,
          bedrooms, bathrooms, area: areaBase + rand(-10, 10),
          price: basePrice,
        });
        allProducts.push(offerProduct);
        realProductGroups.push({ indices: [offerIdx], rep: offerProduct });

        // Demand — similar price (±15%), same location, same bedrooms ±1
        const demandIdx = allProducts.length;
        const priceDiff = basePrice * randFloat(-0.15, 0.15);
        const demandProduct = makeProduct({
          type: 'demand', category, transactionType: transType, loc,
          bedrooms: bedrooms ? bedrooms + rand(-1, 1) : null,
          bathrooms, area: areaBase + rand(-15, 15),
          price: Math.round((basePrice + priceDiff) / 10000) * 10000,
        });
        allProducts.push(demandProduct);
        realProductGroups.push({ indices: [demandIdx], rep: demandProduct });

        // Calculate a realistic score
        let score = 0.3; // base: same location + category + transaction type
        const pricePct = Math.abs(priceDiff) / basePrice;
        score += (1 - pricePct) * 0.35;
        if (bedrooms) score += 0.15;
        score += rand(5, 15) / 100; // noise
        score = Math.min(score, 0.98);

        matchPairs.push({ idx1: offerIdx, idx2: demandIdx, score: parseFloat(score.toFixed(3)) });
      }

      // ── BLOCK 2: 40 duplicate clusters (varying 2-5 copies each) ─
      // Simulates the same property posted by different people in different
      // WhatsApp groups with different wording, titles, and contact info.
      // Targets >30% duplicate rate across all 300 posts.
      let block2Count = 0;
      for (let i = 0; i < 40; i++) {
        const loc = pick(locations);
        const catRoll = Math.random();
        let category, bedrooms, bathrooms, area;

        if (catRoll < 0.55) {
          category = 'apartment'; bedrooms = rand(2, 5); bathrooms = rand(1, 3); area = rand(50, 200);
        } else if (catRoll < 0.80) {
          category = 'house'; bedrooms = rand(3, 6); bathrooms = rand(2, 4); area = rand(100, 500);
        } else if (catRoll < 0.92) {
          category = 'ground'; bedrooms = null; bathrooms = null; area = rand(200, 1500);
        } else {
          category = 'agricultural_ground'; bedrooms = null; bathrooms = null; area = rand(5000, 30000);
        }

        const transType = Math.random() < 0.65 ? 'sale' : 'rent';
        let basePrice;
        if (transType === 'rent') {
          basePrice = rand(8, 180) * 10000;
        } else {
          basePrice = category === 'apartment' ? rand(25, 300) * 1000000
                    : category === 'house' ? rand(40, 600) * 1000000
                    : category === 'ground' ? rand(8, 150) * 1000000
                    : rand(3, 80) * 1000000;
        }

        const type = Math.random() < 0.7 ? 'offer' : 'demand';
        const copies = rand(2, 5); // 2-5 people posting the same property
        const usedSenders = [];
        const usedTemplates = [];
        const origIdx = allProducts.length;
        const clusterIndices = []; // track all indices for this real product

        for (let c = 0; c < copies; c++) {
          // Different sender for each copy
          let sender;
          do { sender = pick(senders); } while (usedSenders.includes(sender));
          usedSenders.push(sender);

          const phone = `+221 7${rand(0, 9)} ${rand(100, 999)} ${rand(10, 99)} ${rand(10, 99)}`;

          // Slightly varied price (agents round differently, ≤5% spread)
          const priceVariation = c === 0 ? 0
            : rand(-1, 1) * (transType === 'rent' ? 10000 : Math.round(basePrice * 0.02));
          const price = Math.max(basePrice + priceVariation, transType === 'rent' ? 50000 : 5000000);

          // Slightly varied area (people estimate differently, ≤3m² spread)
          const areaVariation = c === 0 ? 0 : rand(-2, 2);
          const finalArea = Math.max(area + areaVariation, 20);

          // Different title for each copy
          const titleFns = altTitles[category];
          let title;
          if (c === 0) {
            title = pick(titles[category]);
          } else {
            const fn = titleFns[c % titleFns.length];
            title = fn(bedrooms || 0);
          }

          // Different description wording using templates
          const templates = descTemplates[category];
          let templateIdx;
          do { templateIdx = rand(0, templates.length - 1); } while (usedTemplates.includes(templateIdx) && usedTemplates.length < templates.length);
          usedTemplates.push(templateIdx);

          const priceLabel = price.toLocaleString() + ' FCFA' + (transType === 'rent' ? '/mois' : '');
          const transLabel = transType === 'rent' ? 'Loyer' : 'Prix';

          const description = templates[templateIdx]({
            title, type, category, bedrooms, bathrooms, area: finalArea,
            neighborhood: loc.neighborhood, city: loc.city,
            sender, phone, priceLabel, transLabel, transType,
          });

          const product = {
            title, description, type, category,
            transaction_type: transType,
            price, currency: 'XOF',
            location: `${loc.neighborhood}, ${loc.city}`,
            city: loc.city, neighborhood: loc.neighborhood,
            latitude: jitter(loc.lat, c === 0 ? 0.003 : 0.001), // copies are very close on map
            longitude: jitter(loc.lng, c === 0 ? 0.003 : 0.001),
            bedrooms, bathrooms, area: finalArea,
            sender, phone, is_duplicate: c > 0,
          };

          allProducts.push(product);
          clusterIndices.push(allProducts.length - 1);
          block2Count++;

          // Link every copy after the first back to the original
          if (c > 0) {
            const dupIdx = allProducts.length - 1;
            const similarity = c === 1 ? randFloat(0.88, 0.97) : randFloat(0.78, 0.92);
            duplicatePairs.push({ origIdx, dupIdx, similarity: parseFloat(similarity.toFixed(3)) });
          }
        }

        // All copies in this cluster map to ONE real product
        realProductGroups.push({
          indices: clusterIndices,
          rep: allProducts[origIdx], // use the original as representative
        });
      }

      // ── BLOCK 3: fill remaining to reach 300 total ─────────────
      const remaining = 300 - allProducts.length;
      for (let i = 0; i < remaining; i++) {
        const idx = allProducts.length;
        const p = randomProduct();
        allProducts.push(p);
        realProductGroups.push({ indices: [idx], rep: p });
      }

      // ── BLOCK 4: 15 extra cross-matches from standalone pool ──
      // Pick some random offer/demand pairs from block 3 with moderate scores
      const block3Start = 80 + block2Count; // match pairs + duplicate cluster products
      const block3Offers = [];
      const block3Demands = [];
      allProducts.forEach((p, idx) => {
        if (idx >= block3Start) {
          if (p.type === 'offer') block3Offers.push(idx);
          else block3Demands.push(idx);
        }
      });

      for (let i = 0; i < 15 && block3Offers.length > 0 && block3Demands.length > 0; i++) {
        const oIdx = block3Offers.splice(rand(0, block3Offers.length - 1), 1)[0];
        const dIdx = block3Demands.splice(rand(0, block3Demands.length - 1), 1)[0];
        const o = allProducts[oIdx];
        const d = allProducts[dIdx];
        let score = 0.15;
        if (o.category === d.category) score += 0.2;
        if (o.city === d.city) score += 0.15;
        if (o.transaction_type === d.transaction_type) score += 0.1;
        score += randFloat(0.05, 0.15);
        score = Math.min(score, 0.95);
        matchPairs.push({ idx1: oIdx, idx2: dIdx, score: parseFloat(score.toFixed(3)) });
      }

      console.log(`Inserting ${realProductGroups.length} real products, ${allProducts.length} raw posts...`);

      // ── Insert real_products ───────────────────────────────────────
      // Maps raw-product-index → real_product DB id
      const rawIdxToRealProductId = {};
      for (const group of realProductGroups) {
        const r = group.rep;
        const res = await client.query(
          `INSERT INTO real_products (
            title, type, category, transaction_type,
            price, currency, city, neighborhood,
            latitude, longitude, bedrooms, bathrooms, area, post_count
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          RETURNING id`,
          [
            r.title, r.type, r.category, r.transaction_type,
            r.price, r.currency, r.city, r.neighborhood,
            r.latitude, r.longitude, r.bedrooms, r.bathrooms, r.area,
            group.indices.length,
          ]
        );
        const realId = res.rows[0].id;
        for (const idx of group.indices) {
          rawIdxToRealProductId[idx] = realId;
        }
      }

      // ── Insert products (raw posts) ────────────────────────────────
      const insertedIds = [];
      for (let i = 0; i < allProducts.length; i++) {
        const p = allProducts[i];
        const res = await client.query(
          `INSERT INTO products (
            real_product_id, title, description, type, category, transaction_type,
            price, currency, location, city, neighborhood,
            latitude, longitude, bedrooms, bathrooms, area,
            sender, phone, is_duplicate
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          RETURNING id`,
          [
            rawIdxToRealProductId[i],
            p.title, p.description, p.type, p.category, p.transaction_type,
            p.price, p.currency, p.location, p.city, p.neighborhood,
            p.latitude, p.longitude, p.bedrooms, p.bathrooms, p.area,
            p.sender, p.phone, p.is_duplicate,
          ]
        );
        insertedIds.push(res.rows[0].id);
      }

      // ── Insert matches (between real products, not raw posts) ────
      const seenMatchPairs = new Set();
      for (const m of matchPairs) {
        const rp1 = rawIdxToRealProductId[m.idx1];
        const rp2 = rawIdxToRealProductId[m.idx2];
        const key = rp1 < rp2 ? `${rp1}-${rp2}` : `${rp2}-${rp1}`;
        if (seenMatchPairs.has(key)) continue; // avoid duplicate matches between same real products
        seenMatchPairs.add(key);
        await client.query(
          `INSERT INTO matches (product1_id, product2_id, score, match_type)
           VALUES ($1, $2, $3, $4)`,
          [rp1, rp2, m.score,
           m.score >= 0.75 ? 'excellent' : m.score >= 0.5 ? 'good' : 'partial']
        );
      }

      // ── Insert duplicates ────────────────────────────────────────
      for (const d of duplicatePairs) {
        await client.query(
          `INSERT INTO duplicates (original_id, duplicate_id, similarity)
           VALUES ($1, $2, $3)`,
          [insertedIds[d.origIdx], insertedIds[d.dupIdx], d.similarity]
        );
      }

      const multiPostProducts = realProductGroups.filter(g => g.indices.length > 1).length;
      console.log(`\n✅ Seeded:`);
      console.log(`   ${allProducts.length} raw posts`);
      console.log(`   ${realProductGroups.length} real products (${multiPostProducts} with multiple posts)`);
      console.log(`   ${matchPairs.length} matches (${matchPairs.filter(m => m.score >= 0.75).length} excellent, ${matchPairs.filter(m => m.score >= 0.5 && m.score < 0.75).length} good, ${matchPairs.filter(m => m.score < 0.5).length} partial)`);
      console.log(`   ${duplicatePairs.length} duplicate links`);

      // Summary
      const stats = await client.query(`
        SELECT category, type, COUNT(*) as count FROM products GROUP BY category, type ORDER BY category, type
      `);
      console.log('\nRaw posts by category/type:');
      console.table(stats.rows);

      const rpStats = await client.query(`
        SELECT post_count, COUNT(*) as products FROM real_products GROUP BY post_count ORDER BY post_count
      `);
      console.log('Real products by post count:');
      console.table(rpStats.rows);

      const mStats = await client.query(`
        SELECT match_type, COUNT(*) as count, ROUND(AVG(score)::numeric, 2) as avg_score
        FROM matches GROUP BY match_type ORDER BY avg_score DESC
      `);
      console.log('Matches:');
      console.table(mStats.rows);

    } finally {
      client.release();
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

seed();
