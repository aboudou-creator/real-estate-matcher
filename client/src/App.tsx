import React, { useState, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import {
  Building2, Users, TrendingUp, Home, MapPin,
  DollarSign, BedDouble, Square, Layers, Map as MapIcon, Bath,
  LayoutGrid, MapPinned, Flame, ChevronDown, ChevronUp, FileText
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import HeatmapLayer from './HeatmapLayer';
import 'leaflet/dist/leaflet.css';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3002';
const SENEGAL_CENTER: [number, number] = [14.6928, -17.4467];

const offerIcon = new L.DivIcon({
  className: 'map-marker-icon',
  html: '<div class="marker-dot offer-dot"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});
const demandIcon = new L.DivIcon({
  className: 'map-marker-icon',
  html: '<div class="marker-dot demand-dot"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

interface Post {
  _id: string;
  whatsappMessageId: string;
  groupId: string;
  sender: string;
  text: string;
  type: 'offer' | 'demand';
  category: 'apartment' | 'house' | 'ground' | 'agricultural_ground';
  transactionType: 'sale' | 'rent';
  location?: string;
  price?: number;
  bedrooms?: number;
  area?: number;
  description?: string;
  timestamp: string;
  isDuplicate?: boolean;
  duplicates?: Array<{ postId: string; similarityScore: number }>;
}

interface MatchProduct {
  _id: number;
  title: string;
  type: 'offer' | 'demand';
  category: string;
  transaction_type: string;
  price: number;
  location: string;
  city: string;
  neighborhood: string;
  bedrooms: number | null;
  area: number;
  post_count: number;
}

interface Match {
  _id: string;
  post1: MatchProduct;
  post2: MatchProduct;
  score: number;
  match_type: string;
  createdAt: string;
}

interface AggregatedPost {
  originalPost: Post;
  variants: Post[];
  duplicateCount: number;
  uniquePosters: number;
  priceRange: { min: number; max: number };
  averageSimilarity: number;
}

interface Product {
  id: number;
  title: string;
  description: string;
  type: 'offer' | 'demand';
  category: string;
  transaction_type: string;
  price: number;
  currency: string;
  location: string;
  city: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  bedrooms: number | null;
  bathrooms: number | null;
  area: number;
  sender: string;
  phone: string;
  is_duplicate: boolean;
  created_at: string;
}

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  category: string;
  price: number;
  city: string;
  neighborhood: string;
}

interface LinkedPost {
  id: number;
  title: string;
  description: string;
  sender: string;
  phone: string;
  price: number;
  location: string;
  city: string;
  neighborhood: string;
  area: number;
  is_duplicate: boolean;
  created_at: string;
}

interface RealProduct {
  id: number;
  title: string;
  type: 'offer' | 'demand';
  category: string;
  transaction_type: string;
  price: number;
  currency: string;
  city: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  bedrooms: number | null;
  bathrooms: number | null;
  area: number;
  post_count: number;
  created_at: string;
  linked_posts: LinkedPost[];
}

type TabType = 'products' | 'posts' | 'matches' | 'aggregated';
type FilterType = 'all' | 'offers' | 'demands';
type CategoryFilter = 'all' | 'apartment' | 'house' | 'ground' | 'agricultural_ground';
type TransactionFilter = 'all' | 'sale' | 'rent';
type MatchTierFilter = 'all' | 'high' | 'mid' | 'low';
type BedroomsFilter = 'all' | '1' | '2' | '3' | '4' | '5+';

const getCategoryIcon = (category: string) => {
  const size = 16;
  switch (category) {
    case 'apartment':           return <Building2 size={size} />;
    case 'house':               return <Home size={size} />;
    case 'ground':              return <Square size={size} />;
    case 'agricultural_ground': return <TrendingUp size={size} />;
    default:                    return <Building2 size={size} />;
  }
};

const formatCFA = (price?: number) => {
  if (!price) return 'N/A';
  return new Intl.NumberFormat('fr-SN', { style: 'decimal', maximumFractionDigits: 0 }).format(price) + ' FCFA';
};

const formatPrice = (price?: number) => {
  if (!price) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(price);
};

const formatDate = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function App() {
  const [, setPosts] = useState<Post[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [aggregatedPosts] = useState<AggregatedPost[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [realProducts, setRealProducts] = useState<RealProduct[]>([]);
  const [heatmapPoints, setHeatmapPoints] = useState<HeatmapPoint[]>([]);
  const [connected, setConnected] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('products');
  const [filter, setFilter] = useState<FilterType>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('all');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [bedroomsFilter, setBedroomsFilter] = useState<BedroomsFilter>('all');
  const [priceMax, setPriceMax] = useState<string>('');
  const [matchTierFilter, setMatchTierFilter] = useState<MatchTierFilter>('all');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [showHeatmap, setShowHeatmap] = useState(true);
  const productListMode = 'products' as const;
  const [expandedRealProduct, setExpandedRealProduct] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInitialData = useCallback(async () => {
    try {
      setLoading(true);
      const [productsRes, heatmapRes, matchesRes, realProductsRes] = await Promise.all([
        fetch(`${API_URL}/api/products?limit=500`).catch(() => null),
        fetch(`${API_URL}/api/products/heatmap`).catch(() => null),
        fetch(`${API_URL}/api/matches`).catch(() => null),
        fetch(`${API_URL}/api/real-products`).catch(() => null),
      ]);

      const productsData = productsRes ? await productsRes.json().catch(() => []) : [];
      const heatmapData = heatmapRes ? await heatmapRes.json().catch(() => []) : [];
      const matchesData = matchesRes ? await matchesRes.json().catch(() => []) : [];
      const realProductsData = realProductsRes ? await realProductsRes.json().catch(() => []) : [];

      if (Array.isArray(productsData)) setProducts(productsData);
      if (Array.isArray(heatmapData)) setHeatmapPoints(heatmapData);
      if (Array.isArray(matchesData)) setMatches(matchesData);
      if (Array.isArray(realProductsData)) setRealProducts(realProductsData);
    } catch (error) {
      console.error('Error fetching initial data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch initial WhatsApp status via HTTP
    fetch(`${API_URL}/api/status`).then(r => r.json()).then(s => {
      setConnected(!!s.connected);
      if (s.qrCode) setQrCode(s.qrCode);
    }).catch(() => {});

    const socket = io(API_URL);
    socket.on('connect', () => console.log('Connected to server'));
    socket.on('qr', (qr: string) => setQrCode(qr));
    socket.on('connected', () => { setConnected(true); setQrCode(null); });
    socket.on('disconnected', () => { setConnected(false); setQrCode(null); });
    socket.on('newPost', (post: Post) => setPosts(prev => [post, ...prev]));
    socket.on('newMatch', (match: Match) => setMatches(prev => [match, ...prev]));
    return () => { socket.close(); };
  }, []);

  useEffect(() => { fetchInitialData(); }, [fetchInitialData]);

  const cities = Array.from(new Set(products.map(p => p.city))).sort();

  const filteredProducts = products.filter((p) => {
    if (filter !== 'all' && p.type !== (filter === 'offers' ? 'offer' : 'demand')) return false;
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (transactionFilter !== 'all' && p.transaction_type !== transactionFilter) return false;
    if (cityFilter !== 'all' && p.city !== cityFilter) return false;
    if (bedroomsFilter !== 'all') {
      const bed = p.bedrooms || 0;
      if (bedroomsFilter === '5+' ? bed < 5 : bed !== parseInt(bedroomsFilter)) return false;
    }
    if (priceMax && p.price > parseInt(priceMax)) return false;
    return true;
  });

  const filteredHeatmap = heatmapPoints.filter((p) => {
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (cityFilter !== 'all' && p.city !== cityFilter) return false;
    return true;
  });

  const filteredRealProducts = realProducts.filter((p) => {
    if (filter !== 'all' && p.type !== (filter === 'offers' ? 'offer' : 'demand')) return false;
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (transactionFilter !== 'all' && p.transaction_type !== transactionFilter) return false;
    if (cityFilter !== 'all' && p.city !== cityFilter) return false;
    if (bedroomsFilter !== 'all') {
      const bed = p.bedrooms || 0;
      if (bedroomsFilter === '5+' ? bed < 5 : bed !== parseInt(bedroomsFilter)) return false;
    }
    if (priceMax && p.price > parseInt(priceMax)) return false;
    return true;
  });

  const renderEmpty = (label: string) => (
    <div className="empty-state">
      <div className="empty-icon"><Layers size={28} /></div>
      <h3>No {label} yet</h3>
      <p>New {label} will appear here in real-time once WhatsApp is connected.</p>
    </div>
  );

  const resetProductFilters = () => {
    setFilter('all'); setCategoryFilter('all'); setTransactionFilter('all');
    setCityFilter('all'); setBedroomsFilter('all'); setPriceMax('');
  };

  const activeFilterCount = [
    filter !== 'all', categoryFilter !== 'all', transactionFilter !== 'all',
    cityFilter !== 'all', bedroomsFilter !== 'all', priceMax !== '',
  ].filter(Boolean).length;

  const renderProducts = () => (
    <>
      <div className="card">
        <div className="filter-row">
          <div className="filters">
            <button onClick={() => setFilter('all')} className={`filter-btn ${filter === 'all' ? 'active-all' : ''}`}>All</button>
            <button onClick={() => setFilter('offers')} className={`filter-btn ${filter === 'offers' ? 'active-offers' : ''}`}>Offers</button>
            <button onClick={() => setFilter('demands')} className={`filter-btn ${filter === 'demands' ? 'active-demands' : ''}`}>Demands</button>
            <span className="filter-divider" />
            <button onClick={() => setCategoryFilter('all')} className={`filter-btn ${categoryFilter === 'all' ? 'active-all' : ''}`}>All Types</button>
            <button onClick={() => setCategoryFilter('apartment')} className={`filter-btn ${categoryFilter === 'apartment' ? 'active-all' : ''}`}>Apartments</button>
            <button onClick={() => setCategoryFilter('house')} className={`filter-btn ${categoryFilter === 'house' ? 'active-all' : ''}`}>Houses</button>
            <button onClick={() => setCategoryFilter('ground')} className={`filter-btn ${categoryFilter === 'ground' ? 'active-all' : ''}`}>Ground</button>
          </div>
        </div>

        <div className="filter-row">
          <div className="filters">
            <button onClick={() => setTransactionFilter('all')} className={`filter-btn ${transactionFilter === 'all' ? 'active-all' : ''}`}>Sale & Rent</button>
            <button onClick={() => setTransactionFilter('sale')} className={`filter-btn ${transactionFilter === 'sale' ? 'active-all' : ''}`}>Sale</button>
            <button onClick={() => setTransactionFilter('rent')} className={`filter-btn ${transactionFilter === 'rent' ? 'active-all' : ''}`}>Rent</button>
            <span className="filter-divider" />

            <select
              className="filter-select"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
            >
              <option value="all">All Cities</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select
              className="filter-select"
              value={bedroomsFilter}
              onChange={(e) => setBedroomsFilter(e.target.value as BedroomsFilter)}
            >
              <option value="all">Bedrooms</option>
              <option value="1">1 Bed</option>
              <option value="2">2 Beds</option>
              <option value="3">3 Beds</option>
              <option value="4">4 Beds</option>
              <option value="5+">5+ Beds</option>
            </select>

            <input
              type="number"
              className="filter-input"
              placeholder="Max price (FCFA)"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
            />

            {activeFilterCount > 0 && (
              <button onClick={resetProductFilters} className="filter-btn filter-reset">
                Clear ({activeFilterCount})
              </button>
            )}
          </div>
        </div>

        <div className="filter-results">
          <span>{filteredRealProducts.length} of {realProducts.length} products</span>
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'map' ? 'active' : ''}`}
              onClick={() => setViewMode('map')}
              title="Map view"
            >
              <MapPinned size={16} />
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'list' ? (
          <div className="product-grid">
            {filteredRealProducts.map((rp) => (
              <div key={rp.id} className={`product-card real-product-card ${rp.post_count > 1 ? 'has-dupes' : ''}`}>
                <div className="post-header">
                  <div className="post-badges">
                    <span className="category-icon">{getCategoryIcon(rp.category)}</span>
                    <span className={`badge ${rp.type === 'offer' ? 'badge-offer' : 'badge-demand'}`}>
                      {rp.type}
                    </span>
                    <span className="badge badge-category">{rp.category.replace('_', ' ')}</span>
                    <span className="badge badge-transaction">{rp.transaction_type}</span>
                    {rp.post_count > 1 && (
                      <span className="badge badge-post-count">{rp.post_count} posts</span>
                    )}
                  </div>
                </div>

                <h4 className="product-title">{rp.title}</h4>

                <div className="product-price">{formatCFA(rp.price)}</div>

                <div className="post-meta">
                  <div className="meta-item"><MapPin size={14} /><span>{rp.neighborhood}, {rp.city}</span></div>
                  {rp.bedrooms && <div className="meta-item"><BedDouble size={14} /><span>{rp.bedrooms} bed</span></div>}
                  {rp.bathrooms && <div className="meta-item"><Bath size={14} /><span>{rp.bathrooms} bath</span></div>}
                  {rp.area && <div className="meta-item"><Square size={14} /><span>{rp.area} m²</span></div>}
                </div>

                {rp.post_count > 1 && (
                  <button
                    className={`linked-posts-toggle ${expandedRealProduct === rp.id ? 'expanded' : ''}`}
                    onClick={() => setExpandedRealProduct(expandedRealProduct === rp.id ? null : rp.id)}
                  >
                    <FileText size={14} />
                    <span>{rp.post_count} linked posts from {rp.linked_posts.map(lp => lp.sender).filter((s, i, a) => a.indexOf(s) === i).length} different people</span>
                    {expandedRealProduct === rp.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}

                {expandedRealProduct === rp.id && rp.linked_posts && (
                  <div className="linked-posts-panel">
                    {rp.linked_posts.map((lp, idx) => (
                      <div key={lp.id} className={`linked-post-item ${idx === 0 ? 'original' : 'duplicate'}`}>
                        <div className="linked-post-header">
                          <span className="linked-post-sender">{lp.sender}</span>
                          <span className="linked-post-phone">{lp.phone}</span>
                          {idx === 0 ? (
                            <span className="badge badge-original">original</span>
                          ) : (
                            <span className="badge badge-duplicate">copy</span>
                          )}
                        </div>
                        <div className="linked-post-title">{lp.title}</div>
                        <div className="linked-post-price">{formatCFA(lp.price)}</div>
                        <div className="linked-post-desc">{lp.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
      ) : (
        <div className="card map-view-card">
          <MapContainer
            center={SENEGAL_CENTER}
            zoom={12}
            style={{ height: '75vh', width: '100%', borderRadius: '12px' }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            {showHeatmap && <HeatmapLayer points={filteredHeatmap} />}
            {filteredProducts
              .filter(p => p.latitude && p.longitude)
              .map((product) => (
                <Marker
                  key={product.id}
                  position={[product.latitude, product.longitude]}
                  icon={product.type === 'offer' ? offerIcon : demandIcon}
                >
                  <Popup className="product-popup">
                    <div className="popup-content">
                      <div className="popup-badges">
                        <span className={`popup-badge ${product.type}`}>{product.type}</span>
                        <span className="popup-badge cat">{product.category.replace('_', ' ')}</span>
                        <span className="popup-badge tx">{product.transaction_type}</span>
                      </div>
                      <h4 className="popup-title">{product.title}</h4>
                      <div className="popup-price">{formatCFA(product.price)}</div>
                      <div className="popup-meta">
                        <span>{product.neighborhood}, {product.city}</span>
                        {product.bedrooms && <span>{product.bedrooms} bed</span>}
                        {product.area && <span>{product.area} m²</span>}
                      </div>
                      <div className="popup-sender">{product.sender}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
          </MapContainer>
          <div className="map-controls">
            <div className="map-legend">
              <span className="legend-item"><span className="legend-dot offer-dot"></span> Offer</span>
              <span className="legend-item"><span className="legend-dot demand-dot"></span> Demand</span>
            </div>
            <button
              className={`heatmap-toggle ${showHeatmap ? 'active' : ''}`}
              onClick={() => setShowHeatmap(!showHeatmap)}
            >
              <Flame size={15} />
              <span>Heatmap</span>
              <span className={`toggle-switch ${showHeatmap ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );

  const renderPosts = () => (
    <>
      <div className="card">
        <div className="filter-row">
          <div className="filters">
            <button onClick={() => setFilter('all')} className={`filter-btn ${filter === 'all' ? 'active-all' : ''}`}>All ({filteredProducts.length})</button>
            <button onClick={() => setFilter('offers')} className={`filter-btn ${filter === 'offers' ? 'active-offers' : ''}`}>Offers</button>
            <button onClick={() => setFilter('demands')} className={`filter-btn ${filter === 'demands' ? 'active-demands' : ''}`}>Demands</button>
            <span className="filter-divider" />
            <button onClick={() => setCategoryFilter('all')} className={`filter-btn ${categoryFilter === 'all' ? 'active-all' : ''}`}>All Types</button>
            <button onClick={() => setCategoryFilter('apartment')} className={`filter-btn ${categoryFilter === 'apartment' ? 'active-all' : ''}`}>Apartments</button>
            <button onClick={() => setCategoryFilter('house')} className={`filter-btn ${categoryFilter === 'house' ? 'active-all' : ''}`}>Houses</button>
            <button onClick={() => setCategoryFilter('ground')} className={`filter-btn ${categoryFilter === 'ground' ? 'active-all' : ''}`}>Ground</button>
          </div>
        </div>
        <div className="filter-results">
          <span>{filteredProducts.length} raw posts — {filteredProducts.filter(p => p.is_duplicate).length} duplicates ({filteredProducts.length > 0 ? ((filteredProducts.filter(p => p.is_duplicate).length / filteredProducts.length) * 100).toFixed(0) : 0}%)</span>
        </div>
      </div>

      <div className="product-grid">
        {filteredProducts.map((product) => (
          <div key={product.id} className={`product-card ${product.is_duplicate ? 'duplicate-card' : ''}`}>
            <div className="post-header">
              <div className="post-badges">
                <span className="category-icon">{getCategoryIcon(product.category)}</span>
                <span className={`badge ${product.type === 'offer' ? 'badge-offer' : 'badge-demand'}`}>
                  {product.type}
                </span>
                <span className="badge badge-category">{product.category.replace('_', ' ')}</span>
                <span className="badge badge-transaction">{product.transaction_type}</span>
                {product.is_duplicate && <span className="badge badge-duplicate">duplicate</span>}
              </div>
            </div>

            <h4 className="product-title">{product.title}</h4>

            <div className="product-price">{formatCFA(product.price)}</div>

            <div className="post-meta">
              <div className="meta-item"><MapPin size={14} /><span>{product.neighborhood}, {product.city}</span></div>
              {product.bedrooms && <div className="meta-item"><BedDouble size={14} /><span>{product.bedrooms} bed</span></div>}
              {product.bathrooms && <div className="meta-item"><Bath size={14} /><span>{product.bathrooms} bath</span></div>}
              {product.area && <div className="meta-item"><Square size={14} /><span>{product.area} m²</span></div>}
            </div>

            <div className="product-description">{product.description}</div>

            <div className="post-footer">
              <span className="sender">{product.sender}</span>
              <span className="timestamp">{formatDate(product.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  const getScoreTier = (score: number): 'high' | 'mid' | 'low' =>
    score >= 0.75 ? 'high' : score >= 0.5 ? 'mid' : 'low';

  const ScoreRing = ({ score }: { score: number }) => {
    const pct = score * 100;
    const tier = getScoreTier(score);
    const r = 24;
    const circ = 2 * Math.PI * r;
    const offset = circ - (score * circ);
    return (
      <div className="match-score-ring">
        <svg viewBox="0 0 60 60">
          <circle className="ring-bg" cx="30" cy="30" r={r} />
          <circle
            className={`ring-fill ${tier}`}
            cx="30" cy="30" r={r}
            strokeDasharray={circ}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="match-score-text">{pct.toFixed(0)}%</div>
      </div>
    );
  };

  const sortedMatches = [...matches]
    .filter(m => matchTierFilter === 'all' || getScoreTier(m.score) === matchTierFilter)
    .sort((a, b) => b.score - a.score);

  const matchCounts = {
    all: matches.length,
    high: matches.filter(m => m.score >= 0.75).length,
    mid: matches.filter(m => m.score >= 0.5 && m.score < 0.75).length,
    low: matches.filter(m => m.score < 0.5).length,
  };

  const renderMatches = () => (
    <>
      <div className="card">
        <div className="filters">
          <button onClick={() => setMatchTierFilter('all')} className={`filter-btn ${matchTierFilter === 'all' ? 'active-all' : ''}`}>
            All ({matchCounts.all})
          </button>
          <button onClick={() => setMatchTierFilter('high')} className={`filter-btn ${matchTierFilter === 'high' ? 'active-offers' : ''}`}>
            Excellent ({matchCounts.high})
          </button>
          <button onClick={() => setMatchTierFilter('mid')} className={`filter-btn ${matchTierFilter === 'mid' ? 'active-all' : ''}`}>
            Good ({matchCounts.mid})
          </button>
          <button onClick={() => setMatchTierFilter('low')} className={`filter-btn ${matchTierFilter === 'low' ? 'active-demands' : ''}`}>
            Partial ({matchCounts.low})
          </button>
        </div>
        <div className="filter-results">
          {sortedMatches.length} of {matches.length} matches
        </div>
      </div>

      {sortedMatches.length === 0
        ? renderEmpty('matches')
        : sortedMatches.map((match) => {
          const tier = getScoreTier(match.score);
          return (
            <div key={match._id} className={`match-card ${tier}-score`}>
              <div className="match-header">
                <ScoreRing score={match.score} />
                <div className="match-info">
                  <div className="match-label">Match quality</div>
                  <div className="match-type-label">
                    {tier === 'high' ? 'Excellent Match' : tier === 'mid' ? 'Good Match' : 'Partial Match'}
                  </div>
                </div>
                <span className="timestamp">{formatDate(match.createdAt)}</span>
              </div>
              <div className="match-body">
                <div className="match-sides">
                  {[match.post1, match.post2].map((prod, i) => (
                    <div key={i} className={`match-side ${prod.type}`}>
                      <div className="match-side-header">
                        <span className={`badge ${prod.type === 'offer' ? 'badge-offer' : 'badge-demand'}`}>{prod.type}</span>
                        <span className="badge badge-category">{prod.category.replace('_', ' ')}</span>
                        <span className="badge badge-transaction">{prod.transaction_type}</span>
                        {prod.post_count > 1 && <span className="badge badge-post-count">{prod.post_count} posts</span>}
                      </div>
                      <h4 className="match-product-title">{prod.title}</h4>
                      <div className="match-product-price">{formatCFA(prod.price)}</div>
                      <div className="match-product-meta">
                        <span><MapPin size={13} /> {prod.location}</span>
                        {prod.bedrooms && <span><BedDouble size={13} /> {prod.bedrooms} bed</span>}
                        {prod.area && <span><Square size={13} /> {prod.area} m²</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
    </>
  );

  const renderAggregated = () =>
    aggregatedPosts.length === 0
      ? renderEmpty('aggregated posts')
      : aggregatedPosts.map((agg) => (
          <div key={agg.originalPost._id} className="aggregated-card">
            <div className="agg-header">
              <div className="agg-badges">
                <span className="category-icon">{getCategoryIcon(agg.originalPost.category)}</span>
                <span className="badge badge-duplicate">{agg.duplicateCount} duplicates</span>
                <span className="badge badge-category">{agg.uniquePosters} posters</span>
              </div>
              <span className="timestamp">{(agg.averageSimilarity * 100).toFixed(1)}% similarity</span>
            </div>
            <p className="agg-text">{agg.originalPost.text}</p>
            <p className="sender">
              Original from: {agg.originalPost.sender} &bull; {formatDate(agg.originalPost.timestamp)}
            </p>
            {agg.priceRange.min > 0 && agg.priceRange.max > 0 && (
              <div className="price-range">
                <DollarSign size={16} />
                <strong>Price Range:</strong>
                <span>{formatPrice(agg.priceRange.min)} &ndash; {formatPrice(agg.priceRange.max)}</span>
              </div>
            )}
            <details>
              <summary>View all variants ({agg.variants.length})</summary>
              <div className="variants-list">
                {agg.variants.map((variant) => (
                  <div key={variant._id} className="variant-item">
                    <p>{variant.text.substring(0, 120)}...</p>
                    <p className="sender">{variant.sender} &bull; {formatDate(variant.timestamp)}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ));

  const tabConfig: { key: TabType; label: string; count: number }[] = [
    { key: 'products', label: 'Products', count: realProducts.length },
    { key: 'posts', label: 'Posts', count: products.length },
    { key: 'matches', label: 'Matches', count: matches.length },
    { key: 'aggregated', label: 'Aggregated', count: aggregatedPosts.length },
  ];

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>Real Estate Matcher</h1>
          <p>Senegal real estate &mdash; WhatsApp posts matching &amp; aggregation</p>
        </header>

        <div className="card">
          <div className="status-bar">
            <div className="status-indicator">
              <div className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
              <span>{connected ? 'Connected to WhatsApp' : 'WhatsApp Disconnected'}</span>
              {!connected && !qrCode && (
                <button className="btn-reconnect" onClick={() => {
                  fetch(`${API_URL}/api/whatsapp/reconnect`, { method: 'POST' }).catch(() => {});
                }}>Reconnect</button>
              )}
            </div>
            {qrCode && (
              <div className="qr-section">
                <p>Scan this QR code with WhatsApp on your phone</p>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrCode)}`}
                  alt="WhatsApp QR Code"
                  width={250}
                  height={250}
                  style={{ background: '#fff', padding: 8, borderRadius: 12 }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-icon blue"><Building2 size={22} /></div>
            <div className="stat-value">{realProducts.length}</div>
            <div className="stat-label">Products</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon orange"><FileText size={22} /></div>
            <div className="stat-value">{products.length}</div>
            <div className="stat-label">Raw Posts</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green"><Users size={22} /></div>
            <div className="stat-value">{matches.length}</div>
            <div className="stat-label">Matches</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon purple"><MapIcon size={22} /></div>
            <div className="stat-value">{heatmapPoints.length}</div>
            <div className="stat-label">Locations</div>
          </div>
        </div>

        <div className="card">
          <div className="tabs">
            {tabConfig.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`tab-button ${activeTab === key ? 'active' : ''}`}
              >
                {label} ({count})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="loading">
            <div className="loading-spinner" />
            <p>Loading data...</p>
          </div>
        ) : (
          <div>
            {activeTab === 'products' && renderProducts()}
            {activeTab === 'posts' && renderPosts()}
            {activeTab === 'matches' && renderMatches()}
            {activeTab === 'aggregated' && renderAggregated()}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
