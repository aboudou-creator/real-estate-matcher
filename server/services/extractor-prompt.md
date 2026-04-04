# Real Estate Extractor.js Technical Flow - Optimization Prompt

## System Overview

This is a JavaScript text extraction system that parses WhatsApp messages to detect real estate posts and extract structured information for the Senegal market (Dakar, Thiès, etc.). The system handles French and Wolof/French mixed real estate terminology.

## Key Data Structures

### 1. Geographic Data
- **SENEGAL_CITIES[]**: List of cities (Dakar, Thiès, Thies, Saint-Louis, Mbour, etc.)
- **DAKAR_NEIGHBORHOODS[]**: Specific neighborhoods in Dakar and Thiès (Plateau, Fann, Point E, Mermoz, Sacré-Cœur, Parcelles Assainies, Sicap, etc.)
- **NEIGHBORHOOD_ZONE_MAP{}**: Maps neighborhoods to zones (Centre Dakar, Nord Dakar, Ouest Dakar, Est Dakar, Thiès Centre)

### 2. Pattern Definitions

#### Offer/Demand Detection
- **OFFER_PATTERNS[]**: à vendre, je vends, disponible, offre, propose, cède
- **DEMAND_PATTERNS[]**: je cherche, recherche, besoin, demande, je veux

#### Category Detection (CURRENT ORDER - IMPORTANT!)
The system checks categories in this order: `['apartment', 'colocation', 'room', 'house', 'agricultural_ground', 'ground']`

**Current CATEGORY_PATTERNS:**
- `apartment`: appartement, studio, F[1-6], T[1-6], pièces, chambre salon, niveau, deux/trois/quatre chambre, 02/03/04 chambre
- `room`: chambre, room
- `house`: maison, villa, résidence, pavillon, duplex, triplex
- `ground`: terrain, parcelle, lot
- `agricultural_ground`: terrain agricole, champ, ferme, exploitation
- `colocation`: colocation, coloc, colocataire, partage d'appart

#### Transaction Type Detection
- **SALE_PATTERNS[]**: vente, vendre, acheter, achat
- **RENT_PATTERNS[]**: louer, location, loyer, bail, /mois

### 3. Extraction Functions

#### extractPrice(text)
- Handles: "85 000 000 FCFA", "85.000.000 CFA", "85M", "85 millions", "850K", "150mill", "250000"
- Pattern priority: millions → M/mill/mil shorthand → K/mille → formatted numbers → plain FCFA → standalone 5-6 digit numbers

#### extractBedrooms(text)
- F[1-6]/T[1-6]: returns (number - 1) for living room
- "3 chambres" → 3
- "2 pièces" → 1 (subtracts 1 for living room)

#### extractArea(text)
- Looks for patterns: 150 m², 150 m2, 150 mètres carrés

#### extractPhone(text)
- Senegal format: +221 7X XXX XX XX or 77.123.45.67

#### extractLocation(text)
1. Checks DAKAR_NEIGHBORHOODS first (most specific)
2. Checks SENEGAL_CITIES
3. Fallback: "à [Location]" or "situé à [Location]" pattern
4. Defaults to 'Dakar?' if nothing found
5. Calls inferZone() to determine zone

### 4. Main Extraction Flow

#### extractRealEstateInfo(text) - Entry Point
```
1. If text < 10 chars → return { isRealEstatePost: false }
2. Try extractSingle(text, null) → whole text as single product
3. splitIntoSegments(text) → tries numbered split or double newlines
4. If segments > 1:
   - Extract shared phone from full text
   - For each segment: extractSingle(seg, sharedPhone)
   - If >1 valid results → return { multiple: true, products: [...] }
5. Return wholeSingle or { isRealEstatePost: false }
```

#### extractSingle(text, fallbackPhone) - Core Logic
```
1. Detect offer/demand via pattern matching
2. Detect category by iterating CATEGORY_PATTERNS in order
3. extractPrice(text)
4. If no category: infer from real estate keywords + price + bedrooms/area
5. Validate: must have (isOffer OR isDemand) AND category
6. Detect transaction type: explicit patterns first, then infer from price
7. extractBedrooms(), extractArea(), extractPhone(), extractLocation()
8. Build title: "{Category} F{bedrooms?} - {neighborhood?}"
9. Determine final type (offer vs demand based on pattern position)
10. Return structured object
```

#### Category Inference (when no explicit pattern matches)
- hasRealEstateWords: immobilier, logement, étage, salon, cuisine, toilette, etc.
- hasBedrooms OR hasArea → triggers inference
- inferCategoryFromPrice(price):
  - price >= 20M → house
  - price >= 5M → apartment
  - price <= 100K → room
  - default → apartment

## Known Issues to Fix

1. **"parcelle fadia" misclassified**: "parcelle" matches ground category before checking if "fadia" is a neighborhood (Parcelles Assainies). The category detection order needs to account for context.

2. **"chambre" vs "chambre salon"**: Single "chambre" triggers room category even when followed by "salon" indicating an apartment.

3. **Price detection without currency**: Posts like "200000" without FCFA should be detected but currently only works for specific keywords (cuisine, prix, loyer).

4. **Neighborhood zone mapping**: Sacré-Cœur 1/2/3 should map to Nord Dakar, but plain Sacré-Cœur to Centre Dakar. The regex check for numbered variants needs to be more robust.

## Optimization Goals

1. **Context-aware category detection**: Don't classify as "ground" if "parcelle" is followed by a known neighborhood name
2. **Better compound pattern matching**: "chambre salon" should take priority over just "chambre"
3. **Improved price extraction**: Detect more standalone price patterns without FCFA suffix
4. **Smarter location extraction**: Distinguish between "terrain" (land) and "parcelle [name]" (neighborhood)
5. **Pattern priority system**: More specific patterns (multi-word) should match before generic single-word patterns

## Example Test Cases to Handle

```
"Deux chambre salon disponible parcelle fadia en face brioche Dorée brt 200mill"
→ Expected: apartment, Parcelles Assainies (neighborhood), 200000000 FCFA

"Appartement F2 - Ouakam"
→ Expected: apartment, Ouakam, 2 bedrooms (F2 = 1 bedroom)

"Studio séparé avec deux toilettes disponible à patte d'oie bulders 150mill"
→ Expected: apartment, Patte d'Oie, 150000000 FCFA

"Terrain 500m2 à Keur Massar"
→ Expected: ground, Keur Massar, 500m² area

"Colocation chambre à louer 150000"
→ Expected: colocation, 150000 FCFA
```

## Output Format

The extractor returns:
```javascript
{
  isRealEstatePost: true,
  type: 'offer' | 'demand',
  category: 'apartment' | 'room' | 'house' | 'ground' | 'agricultural_ground' | 'colocation',
  transactionType: 'sale' | 'rent',
  price: number | null,
  bedrooms: number | null,
  area: number | null,
  phone: string | null,
  city: string,
  neighborhood: string | null,
  zone: string | null,
  title: string,
  description: string
}
```

For multi-product posts:
```javascript
{
  isRealEstatePost: true,
  multiple: true,
  products: [/* array of above objects */]
}
```

## Constraints

- Must work with messy WhatsApp text (line breaks, mixed formatting, missing spaces)
- Must handle French and Wolof/French mixed text
- Must be fast (regex-based, no external NLP libraries)
- Must maintain backward compatibility with existing pattern format
