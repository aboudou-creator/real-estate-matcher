import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import {
  Building2, Users, TrendingUp, Home, MapPin, Phone, X, DoorOpen,
  DollarSign, BedDouble, Square, Layers, Map as MapIcon, Bath,
  LayoutGrid, MapPinned, Flame, ChevronDown, ChevronUp, FileText, MessageSquare
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
  category: 'apartment' | 'house' | 'ground' | 'agricultural_ground' | 'room';
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
  phone: string | null;
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
  group_name?: string;
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
  group_name?: string;
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
  match_count: number;
  created_at: string;
  linked_posts: LinkedPost[];
}

type TabType = 'products' | 'posts' | 'matches' | 'aggregated';
type FilterType = 'all' | 'offers' | 'demands';
type CategoryFilter = 'all' | 'apartment' | 'room' | 'house' | 'ground' | 'agricultural_ground';
type TransactionFilter = 'all' | 'sale' | 'rent';
type MatchTierFilter = 'all' | 'high' | 'mid' | 'low';
type MatchCriteria = 'city' | 'category' | 'transaction' | 'bedrooms';
type BedroomsFilter = 'all' | '1' | '2' | '3' | '4' | '5+';

const getCategoryIcon = (category: string) => {
  const size = 16;
  switch (category) {
    case 'apartment':           return <Building2 size={size} />;
    case 'room':                return <DoorOpen size={size} />;
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
  const [matches, setMatches] = useState<Match[]>([]);
  const [aggregatedPosts] = useState<AggregatedPost[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [realProducts, setRealProducts] = useState<RealProduct[]>([]);
  const [heatmapPoints, setHeatmapPoints] = useState<HeatmapPoint[]>([]);
  const [connected, setConnected] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [waStatus, setWaStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('products');
  const [filter, setFilter] = useState<FilterType>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('all');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [bedroomsFilter, setBedroomsFilter] = useState<BedroomsFilter>('all');
  const [priceMax, setPriceMax] = useState<string>('');
  const [matchTierFilter, setMatchTierFilter] = useState<MatchTierFilter>('all');
  const [matchCriteriaFilters, setMatchCriteriaFilters] = useState<Set<MatchCriteria>>(new Set());
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [expandedRealProduct, setExpandedRealProduct] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<RealProduct | null>(null);
  const [selectedPost, setSelectedPost] = useState<Product | null>(null);
  const [flushConfirm, setFlushConfirm] = useState(false);
  const [flushStatus, setFlushStatus] = useState<string | null>(null);

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

  // Buffers for high-frequency socket events — flushed to state every 750ms
  const newPostsBuffer = useRef<Product[]>([]);
  const newMatchesBuffer = useRef<Match[]>([]);
  const newRPBuffer = useRef<RealProduct[]>([]);
  const updatedRPBuffer = useRef<RealProduct[]>([]);

  useEffect(() => {
    // Fetch initial WhatsApp status via HTTP
    fetch(`${API_URL}/api/status`).then(r => r.json()).then(s => {
      setConnected(!!s.connected);
      if (s.qrCode) setQrCode(s.qrCode);
    }).catch(() => {});

    const socket = io(API_URL, { transports: ['websocket'] });
    socket.on('connect', () => console.log('Connected to server'));
    socket.on('qr', (qr: string) => { setQrCode(qr); setWaStatus('QR code ready — scan with WhatsApp'); });
    socket.on('connected', () => { setConnected(true); setQrCode(null); setWaStatus('Connected to WhatsApp'); });
    socket.on('disconnected', () => { setConnected(false); setQrCode(null); });
    socket.on('wa_error', (msg: string) => setWaStatus(msg));

    // Buffer high-frequency events instead of setState on every message
    socket.on('newPost', (post: Product) => { newPostsBuffer.current.push(post); });
    socket.on('newMatch', (match: Match) => { newMatchesBuffer.current.push(match); });
    socket.on('newRealProduct', (rp: RealProduct) => { newRPBuffer.current.push(rp); });
    socket.on('realProductUpdated', (rp: RealProduct) => { updatedRPBuffer.current.push(rp); });

    // Flush buffers to state at most every 750ms
    const flush = setInterval(() => {
      const posts = newPostsBuffer.current.splice(0);
      const matchs = newMatchesBuffer.current.splice(0);
      const newRPs = newRPBuffer.current.splice(0);
      const updatedRPs = updatedRPBuffer.current.splice(0);

      if (posts.length)    setProducts(prev => [...posts, ...prev]);
      if (matchs.length)   setMatches(prev => [...matchs, ...prev]);
      if (newRPs.length || updatedRPs.length) {
        setRealProducts(prev => {
          let next = newRPs.length ? [...newRPs, ...prev] : [...prev];
          if (updatedRPs.length) {
            const updMap = new Map(updatedRPs.map(r => [r.id, r]));
            next = next.map(p => updMap.get(p.id) ?? p);
          }
          return next;
        });
      }
    }, 750);

    return () => { socket.close(); clearInterval(flush); };
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
            <button onClick={() => setCategoryFilter('room')} className={`filter-btn ${categoryFilter === 'room' ? 'active-all' : ''}`}>Rooms</button>
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
            {filteredRealProducts.map((rp) => {
              const primaryPhone = rp.linked_posts?.find(lp => lp.phone)?.phone;
              return (
              <div key={rp.id} className={`product-card real-product-card ${rp.post_count > 1 ? 'has-dupes' : ''}`} onClick={() => setSelectedProduct(rp)} style={{ cursor: 'pointer' }}>
                <div className="post-header">
                  <div className="post-badges">
                    <span className="category-icon">{getCategoryIcon(rp.category)}</span>
                    <span className={`badge ${rp.type === 'offer' ? 'badge-offer' : 'badge-demand'}`}>
                      {rp.type}
                    </span>
                    <span className="badge badge-category">{rp.category.replace('_', ' ')}</span>
                    <span className="badge badge-transaction">{rp.transaction_type}</span>
                    <span className="badge badge-post-count">{rp.post_count} post{rp.post_count > 1 ? 's' : ''}</span>
                    {rp.match_count > 0 && (
                      <span className="badge badge-match-count"><Users size={11} /> {rp.match_count} match{rp.match_count > 1 ? 'es' : ''}</span>
                    )}
                  </div>
                  {primaryPhone && (
                    <div className="card-phone-corner"><Phone size={12} /> {primaryPhone}</div>
                  )}
                </div>

                <h4 className="product-title">{rp.title}</h4>

                <div className="product-price">{formatCFA(rp.price)}</div>

                <div className="post-meta">
                  <div className="meta-item"><MapPin size={14} /><span>{rp.neighborhood ? `${rp.neighborhood}, ` : ''}{rp.city}</span></div>
                  {rp.bedrooms && <div className="meta-item"><BedDouble size={14} /><span>{rp.bedrooms} bed</span></div>}
                  {rp.bathrooms && <div className="meta-item"><Bath size={14} /><span>{rp.bathrooms} bath</span></div>}
                  {rp.area && <div className="meta-item"><Square size={14} /><span>{rp.area} m²</span></div>}
                </div>

                <button
                  className={`linked-posts-toggle ${expandedRealProduct === rp.id ? 'expanded' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setExpandedRealProduct(expandedRealProduct === rp.id ? null : rp.id); }}
                >
                  <FileText size={14} />
                  <span>{rp.post_count} linked post{rp.post_count > 1 ? 's' : ''}{rp.post_count > 1 ? ` from ${rp.linked_posts.map(lp => lp.sender).filter((s, i, a) => a.indexOf(s) === i).length} people` : ''}</span>
                  {expandedRealProduct === rp.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {expandedRealProduct === rp.id && rp.linked_posts && (
                  <div className="linked-posts-panel" onClick={(e) => e.stopPropagation()}>
                    {rp.linked_posts.map((lp, idx) => (
                      <div key={lp.id} className={`linked-post-item ${idx === 0 ? 'original' : 'duplicate'}`}>
                        <div className="linked-post-header">
                          <span className="linked-post-sender">{lp.sender}</span>
                          {lp.phone && <span className="linked-post-phone"><Phone size={12} /> {lp.phone}</span>}
                          {lp.group_name && <span className="linked-post-group"><MessageSquare size={12} /> {lp.group_name}</span>}
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
              );
            })}
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
            <button onClick={() => setCategoryFilter('room')} className={`filter-btn ${categoryFilter === 'room' ? 'active-all' : ''}`}>Rooms</button>
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
          <div key={product.id} className={`product-card ${product.is_duplicate ? 'duplicate-card' : ''}`} onClick={() => setSelectedPost(product)} style={{ cursor: 'pointer' }}>
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

            {product.phone && (
              <div className="product-phone"><Phone size={14} /> <strong>{product.phone}</strong></div>
            )}

            <div className="product-price">{formatCFA(product.price)}</div>

            <div className="post-meta">
              <div className="meta-item"><MapPin size={14} /><span>{product.neighborhood ? `${product.neighborhood}, ` : ''}{product.city}</span></div>
              {product.bedrooms && <div className="meta-item"><BedDouble size={14} /><span>{product.bedrooms} bed</span></div>}
              {product.bathrooms && <div className="meta-item"><Bath size={14} /><span>{product.bathrooms} bath</span></div>}
              {product.area && <div className="meta-item"><Square size={14} /><span>{product.area} m²</span></div>}
            </div>

            {product.group_name && (
              <div className="post-group"><MessageSquare size={13} /> {product.group_name}</div>
            )}

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

  const toggleCriteria = (c: MatchCriteria) =>
    setMatchCriteriaFilters(prev => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });

  const sortedMatches = [...matches]
    .filter(m => matchTierFilter === 'all' || getScoreTier(m.score) === matchTierFilter)
    .filter(m => {
      if (matchCriteriaFilters.has('city')        && m.post1.city !== m.post2.city) return false;
      if (matchCriteriaFilters.has('category')    && m.post1.category !== m.post2.category) return false;
      if (matchCriteriaFilters.has('transaction') && m.post1.transaction_type !== m.post2.transaction_type) return false;
      if (matchCriteriaFilters.has('bedrooms')    && (m.post1.bedrooms == null || m.post1.bedrooms !== m.post2.bedrooms)) return false;
      return true;
    })
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
        <div className="filter-row">
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
        </div>
        <div className="filter-row">
          <span className="criteria-label">Identical criteria:</span>
          <div className="criteria-chips">
            {(['city', 'category', 'transaction', 'bedrooms'] as MatchCriteria[]).map(c => {
              const labels: Record<MatchCriteria, string> = {
                city: '📍 Same City',
                category: '🏠 Same Category',
                transaction: '💰 Same Transaction',
                bedrooms: '🛏 Same Bedrooms',
              };
              const active = matchCriteriaFilters.has(c);
              return (
                <button
                  key={c}
                  className={`criteria-chip ${active ? 'active' : ''}`}
                  onClick={() => toggleCriteria(c)}
                >
                  {labels[c]}
                </button>
              );
            })}
            {matchCriteriaFilters.size > 0 && (
              <button className="criteria-chip-clear" onClick={() => setMatchCriteriaFilters(new Set())}>
                ✕ Clear
              </button>
            )}
          </div>
        </div>
        <div className="filter-results">
          {sortedMatches.length} of {matches.length} matches
          {matchCriteriaFilters.size > 0 && <span className="criteria-active-hint"> — {matchCriteriaFilters.size} criteria active</span>}
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
                      {prod.phone && (
                        <div className="match-product-phone"><Phone size={13} /> <strong>{prod.phone}</strong></div>
                      )}
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
              <span>{connected ? 'Connected to WhatsApp' : 'WhatsApp Not Connected'}</span>
              {!connected && !qrCode && (
                <button className="btn-reconnect" onClick={() => {
                  setWaStatus('Connecting to WhatsApp...');
                  fetch(`${API_URL}/api/whatsapp/connect`, { method: 'POST' })
                    .then(r => r.json())
                    .then(d => { if (!d.ok) setWaStatus(d.message); })
                    .catch(() => setWaStatus('Failed to reach server'));
                }}>Connect WhatsApp</button>
              )}
              <button className="btn-newqr" onClick={() => {
                setWaStatus('Disconnecting...');
                setConnected(false);
                setQrCode(null);
                fetch(`${API_URL}/api/whatsapp/disconnect`, { method: 'POST' })
                  .then(r => r.json())
                  .then(() => {
                    setWaStatus('Session cleared — connecting for new QR...');
                    return fetch(`${API_URL}/api/whatsapp/connect`, { method: 'POST' });
                  })
                  .then(r => r.json())
                  .then(d => { if (!d.ok) setWaStatus(d.message); })
                  .catch(() => setWaStatus('Failed to reach server'));
              }} title="Disconnect and get a fresh QR code">🔄 New QR</button>
              {!flushConfirm ? (
                <button className="btn-flush" onClick={() => setFlushConfirm(true)} title="Clear all database data">🗑 Flush DB</button>
              ) : (
                <span className="flush-confirm">
                  <span>Delete all data?</span>
                  <button className="btn-flush-confirm" onClick={() => {
                    setFlushConfirm(false);
                    setFlushStatus('Flushing...');
                    fetch(`${API_URL}/api/admin/flush`, { method: 'POST' })
                      .then(r => r.json())
                      .then(d => {
                        setFlushStatus(d.ok ? '✅ DB flushed' : '❌ ' + d.message);
                        if (d.ok) {
                          setProducts([]);
                          setRealProducts([]);
                          setMatches([]);
                          setTimeout(() => setFlushStatus(null), 3000);
                        }
                      })
                      .catch(() => setFlushStatus('❌ Failed'));
                  }}>Yes, delete</button>
                  <button className="btn-flush-cancel" onClick={() => setFlushConfirm(false)}>Cancel</button>
                </span>
              )}
              {flushStatus && <span className="flush-status">{flushStatus}</span>}
            </div>
            {waStatus && (
              <div style={{ padding: '8px 0', color: connected ? '#22c55e' : '#f59e0b', fontSize: 14 }}>
                {waStatus}
              </div>
            )}
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

        {/* Product Detail Dialog */}
        {selectedProduct && (
          <div className="dialog-overlay" onClick={() => setSelectedProduct(null)}>
            <div className="dialog" onClick={(e) => e.stopPropagation()}>
              <button className="dialog-close" onClick={() => setSelectedProduct(null)}><X size={20} /></button>
              <div className="dialog-header">
                <div className="post-badges">
                  <span className="category-icon">{getCategoryIcon(selectedProduct.category)}</span>
                  <span className={`badge ${selectedProduct.type === 'offer' ? 'badge-offer' : 'badge-demand'}`}>{selectedProduct.type}</span>
                  <span className="badge badge-category">{selectedProduct.category.replace('_', ' ')}</span>
                  <span className="badge badge-transaction">{selectedProduct.transaction_type}</span>
                </div>
                <h2>{selectedProduct.title}</h2>
              </div>
              <div className="dialog-body">
                <div className="dialog-price">{formatCFA(selectedProduct.price)}</div>
                <div className="dialog-meta">
                  <div className="meta-item"><MapPin size={16} /><span>{selectedProduct.neighborhood ? `${selectedProduct.neighborhood}, ` : ''}{selectedProduct.city}</span></div>
                  {selectedProduct.bedrooms && <div className="meta-item"><BedDouble size={16} /><span>{selectedProduct.bedrooms} bedrooms</span></div>}
                  {selectedProduct.bathrooms && <div className="meta-item"><Bath size={16} /><span>{selectedProduct.bathrooms} bathrooms</span></div>}
                  {selectedProduct.area && <div className="meta-item"><Square size={16} /><span>{selectedProduct.area} m²</span></div>}
                </div>

                {(() => {
                  const productMatches = matches.filter(m => m.post1._id === selectedProduct.id || m.post2._id === selectedProduct.id);
                  return productMatches.length > 0 ? (
                    <>
                      <h3 className="dialog-section-title"><Users size={15} /> Matches ({productMatches.length})</h3>
                      <div className="dialog-matches">
                        {productMatches.map(m => {
                          const other = m.post1._id === selectedProduct.id ? m.post2 : m.post1;
                          return (
                            <div key={m._id} className="dialog-match-item">
                              <div className="dialog-match-score">{(m.score * 100).toFixed(0)}%</div>
                              <div className="dialog-match-info">
                                <strong>{other.title}</strong>
                                <span>{formatCFA(other.price)}</span>
                                {other.phone && <span><Phone size={12} /> {other.phone}</span>}
                                <span>{other.location}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null;
                })()}

                <h3 className="dialog-section-title"><FileText size={15} /> Linked Posts ({selectedProduct.post_count})</h3>
                <div className="dialog-linked-posts">
                  {selectedProduct.linked_posts?.map((lp, idx) => (
                    <div key={lp.id} className={`linked-post-item ${idx === 0 ? 'original' : 'duplicate'}`}>
                      <div className="linked-post-header">
                        <span className="linked-post-sender">{lp.sender}</span>
                        {lp.phone && <span className="linked-post-phone"><Phone size={12} /> {lp.phone}</span>}
                        {lp.group_name && <span className="linked-post-group"><MessageSquare size={12} /> {lp.group_name}</span>}
                        {idx === 0 ? <span className="badge badge-original">original</span> : <span className="badge badge-duplicate">copy</span>}
                      </div>
                      <div className="linked-post-price">{formatCFA(lp.price)}</div>
                      <div className="linked-post-desc">{lp.description}</div>
                      <div className="linked-post-date">{formatDate(lp.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Post Detail Dialog */}
        {selectedPost && (
          <div className="dialog-overlay" onClick={() => setSelectedPost(null)}>
            <div className="dialog" onClick={(e) => e.stopPropagation()}>
              <button className="dialog-close" onClick={() => setSelectedPost(null)}><X size={20} /></button>
              <div className="dialog-header">
                <div className="post-badges">
                  <span className="category-icon">{getCategoryIcon(selectedPost.category)}</span>
                  <span className={`badge ${selectedPost.type === 'offer' ? 'badge-offer' : 'badge-demand'}`}>{selectedPost.type}</span>
                  <span className="badge badge-category">{selectedPost.category.replace('_', ' ')}</span>
                  <span className="badge badge-transaction">{selectedPost.transaction_type}</span>
                  {selectedPost.is_duplicate && <span className="badge badge-duplicate">duplicate</span>}
                </div>
                <h2>{selectedPost.title}</h2>
              </div>
              <div className="dialog-body">
                {selectedPost.phone && (
                  <div className="dialog-phone"><Phone size={16} /> <strong>{selectedPost.phone}</strong></div>
                )}
                <div className="dialog-price">{formatCFA(selectedPost.price)}</div>
                <div className="dialog-meta">
                  <div className="meta-item"><MapPin size={16} /><span>{selectedPost.neighborhood ? `${selectedPost.neighborhood}, ` : ''}{selectedPost.city}</span></div>
                  {selectedPost.bedrooms && <div className="meta-item"><BedDouble size={16} /><span>{selectedPost.bedrooms} bedrooms</span></div>}
                  {selectedPost.bathrooms && <div className="meta-item"><Bath size={16} /><span>{selectedPost.bathrooms} bathrooms</span></div>}
                  {selectedPost.area && <div className="meta-item"><Square size={16} /><span>{selectedPost.area} m²</span></div>}
                </div>
                {selectedPost.group_name && (
                  <div className="dialog-group"><MessageSquare size={14} /> Group: {selectedPost.group_name}</div>
                )}
                <div className="dialog-sender">From: {selectedPost.sender} — {formatDate(selectedPost.created_at)}</div>
                <div className="dialog-description">{selectedPost.description}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
