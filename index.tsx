
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, 
  Map as MapIcon, 
  Table as TableIcon, 
  Upload, 
  ZoomIn, 
  ZoomOut, 
  Maximize, 
  Download,
  Info,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  FileText,
  FileJson,
  FileSpreadsheet,
  Lock,
  Unlock,
  LogOut,
  User,
  ExternalLink,
  Filter,
  ChevronDown,
  Check,
  Settings,
  ShieldCheck,
  Library,
  Plus,
  Trash2,
  ArrowLeftRight,
  ChevronRight,
  Eye,
  Layers,
  Edit3,
  Save,
  UserPlus,
  Users,
  Camera,
  CheckSquare,
  Square,
  UserCheck,
  UserMinus,
  Bell,
  KeyRound,
  Mail,
  ArrowLeft,
  ShieldAlert,
  ShieldAlert as ShieldMinus,
  Shield as ShieldPlus,
  Link2,
  ArrowLeft as BackIcon,
  Globe,
  Database
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import * as XLSX from 'xlsx';
import { toPng } from 'https://esm.sh/html-to-image@1.11.11';

// --- Types ---

interface Feature {
  name: string;
  description: string;
  status: Record<string, string>;
  link?: string;
}

interface Category {
  name: string;
  features: Feature[];
}

interface LicensingData {
  tiers: string[];
  categories: Category[];
}

interface MapEntry {
  id: string;
  title: string;
  type: 'Enterprise' | 'Business';
  data: LicensingData;
  timestamp: number;
}

interface ComparisonTier {
  mapId: string;
  tier: string;
}

interface AdminUser {
  username: string;
  password: string;
  isApproved: boolean;
  isSuperAdmin?: boolean;
}

// --- Constants ---

const INITIAL_ZOOM = 0.8;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const STORAGE_KEY = "licensing_map_collection_v4";
const ADMIN_STORAGE_KEY = "licensing_admins_v4";

// --- Helper Functions ---

const safeLower = (s: any) => String(s || "").toLowerCase();
const generateId = () => Math.random().toString(36).substr(2, 9);

/**
 * Super-Accurate Normalization Fingerprinting: 
 * Strips all common variations to identify semantically identical features.
 * Prevents "M365 Defender" and "Microsoft Defender" from appearing as separate rows.
 */
const getSemanticFingerprint = (str: string) => {
  return str.trim().toLowerCase()
    .replace(/^microsoft\s+365\s+/i, '')
    .replace(/^m365\s+/i, '')
    .replace(/^office\s+365\s+/i, '')
    .replace(/^o365\s+/i, '')
    .replace(/^ms\s+/i, '')
    .replace(/^microsoft\s+/i, '')
    .replace(/\s+for\s+business$/i, '')
    .replace(/\s+for\s+enterprise$/i, '')
    .replace(/\s+plan\s+\d+$/i, '')
    .replace(/[^a-z0-9]/g, ''); // Remove all symbols for strict matching
};

const normalizeName = (name: string) => {
  return name.trim().replace(/\s+/g, ' ');
};

// --- Components ---

const StatusIcon = ({ status }: { status: string }) => {
  const s = safeLower(status);
  if (s.includes('included') || s.includes('yes') || s === 'full') 
    return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (s.includes('partial') || s.includes('limited')) 
    return <MinusCircle className="w-4 h-4 text-amber-500" />;
  return <XCircle className="w-4 h-4 text-rose-400" />;
};

const FeatureNode = ({ feature, tier, onEdit, isAdmin, isSelected, onSelect }: { 
  feature: Feature, 
  tier: string, 
  onEdit?: () => void, 
  isAdmin: boolean,
  isSelected?: boolean,
  onSelect?: () => void
}) => {
  const status = feature.status?.[tier] || 'Excluded';
  const sLower = safeLower(status);
  const isIncluded = sLower.includes('included') || sLower === 'full';
  
  return (
    <div className={`
      feature-node p-3 mb-2 rounded-lg border transition-all duration-200 group
      ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : ''}
      ${isIncluded ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-50/50 border-slate-100 opacity-60'}
    `}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {isAdmin && onSelect && (
            <button onClick={onSelect} className="mr-1 flex-shrink-0">
              {isSelected ? <CheckSquare className="w-3 h-3 text-blue-600" /> : <Square className="w-3 h-3 text-slate-300" />}
            </button>
          )}
          <span className="text-xs font-semibold text-slate-700 truncate">{feature.name}</span>
          {feature.link && (
            <a 
              href={feature.link} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-blue-500 hover:text-blue-700 transition-colors flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <StatusIcon status={status} />
      </div>
      <p className="text-[10px] text-slate-500 leading-tight line-clamp-2">{feature.description}</p>
    </div>
  );
};

// --- Main App ---

const App = () => {
  const [view, setView] = useState<'landing' | 'map' | 'matrix' | 'library'>('landing');
  const [maps, setMaps] = useState<MapEntry[]>([]);
  const [comparisonTiers, setComparisonTiers] = useState<ComparisonTier[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Auth State
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [showAuthModal, setShowAuthModal] = useState<'login' | 'register' | null>(null);
  const [authInputs, setAuthInputs] = useState({ username: '', password: '' });
  
  // Settings & Edit State
  const [showSettings, setShowSettings] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTrack, setUploadTrack] = useState<'Enterprise' | 'Business'>('Enterprise');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedFeatureKeys, setSelectedFeatureKeys] = useState<Set<string>>(new Set());
  const [managementMapId, setManagementMapId] = useState<string | null>(null);
  
  // Map interaction state
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [offset, setOffset] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const mapRef = useRef<HTMLDivElement>(null);

  // Persistence
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setMaps(JSON.parse(saved));
    const savedAdmins = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (savedAdmins) setAdmins(JSON.parse(savedAdmins));
    const session = sessionStorage.getItem("admin_session");
    if (session) {
      setCurrentUser(JSON.parse(session));
      setIsAdmin(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  }, [maps]);

  useEffect(() => {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(admins));
  }, [admins]);

  // Deep AI Extraction with Search Grounding
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setShowUploadModal(false);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((res) => {
        reader.onload = () => res((reader.result as string).split(',')[1]);
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [
          { 
            parts: [
              { inlineData: { data: base64Data, mimeType: 'application/pdf' } }, 
              { text: `Deep Analyze this Microsoft Licensing PDF for ${uploadTrack} tracks.
              
              MANDATORY GROUNDING PROTOCOL:
              1. For every feature identified, use the Google Search tool to find its current official marketing name and technical description.
              2. DO NOT skip documentation links. Every feature MUST have an official Microsoft Learn URL starting with 'https://learn.microsoft.com/'.
              3. If the PDF description is vague, use the internet to provide a precise technical breakdown.
              4. Consolidate branding: ensure 'Azure AD' is mapped to 'Microsoft Entra ID' and other current rebrands.
              
              Return JSON:
              {
                "tiers": ["Tier Name A", "Tier Name B"],
                "categories": [
                  {
                    "name": "Standard Category Name",
                    "features": [
                      {
                        "name": "Official Verified Name",
                        "description": "Precise technical description from web grounding",
                        "link": "https://learn.microsoft.com/en-us/...",
                        "status": { "Tier Name A": "Included", "Tier Name B": "Excluded" }
                      }
                    ]
                  }
                ]
              }` }
            ] 
          }
        ],
        config: { 
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json' 
        }
      });

      const parsed = JSON.parse(response.text || '{}');
      if (parsed.tiers && parsed.categories) {
        const newMap: MapEntry = {
          id: generateId(),
          title: file.name.replace(/\.pdf$/i, ''),
          type: uploadTrack,
          data: parsed,
          timestamp: Date.now()
        };
        setMaps(prev => [newMap, ...prev]);
        setView('library');
      }
    } catch (err) {
      alert("AI Processing Failed. Ensure the PDF is a valid licensing source.");
    } finally {
      setLoading(false);
    }
  };

  // Improved Semantic Merging Logic
  const activeMap = useMemo(() => {
    if (comparisonTiers.length === 0) return null;
    
    const configs = comparisonTiers.map(s => {
      const map = maps.find(m => m.id === s.mapId);
      return { tier: s.tier, map: map!, col: `${map?.title} - ${s.tier}` };
    }).filter(c => c.map);
    
    const columnNames = configs.map(c => c.col);
    const unifiedCategories = new Map<string, Category>();

    configs.forEach(({ map, tier, col }) => {
      map.data.categories.forEach(cat => {
        const catKey = getSemanticFingerprint(cat.name);
        if (!unifiedCategories.has(catKey)) {
          unifiedCategories.set(catKey, { name: cat.name, features: [] });
        }
        
        const targetCat = unifiedCategories.get(catKey)!;

        cat.features.forEach(feat => {
          const featKey = getSemanticFingerprint(feat.name);
          let uFeat = targetCat.features.find(uf => getSemanticFingerprint(uf.name) === featKey);
          
          if (!uFeat) {
            uFeat = { ...feat, name: feat.name, status: {} };
            columnNames.forEach(cn => uFeat!.status[cn] = 'Excluded');
            targetCat.features.push(uFeat);
          }
          
          // Data Enrichment: Merge links and better descriptions if missing
          if (!uFeat.link && feat.link) uFeat.link = feat.link;
          if (feat.description.length > uFeat.description.length) uFeat.description = feat.description;
          
          uFeat.status[col] = feat.status[tier] || 'Excluded';
        });
      });
    });

    return { 
      tiers: columnNames, 
      categories: Array.from(unifiedCategories.values()) 
    } as LicensingData;
  }, [maps, comparisonTiers]);

  const filteredCategories = useMemo(() => {
    if (!activeMap) return [];
    const base = activeMap.categories.filter(c => selectedCategories.length === 0 || selectedCategories.includes(c.name));
    if (!searchQuery) return base;
    const q = searchQuery.toLowerCase();
    return base.map(c => ({ 
      ...c, 
      features: c.features.filter(f => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)) 
    })).filter(c => c.features.length > 0);
  }, [activeMap, searchQuery, selectedCategories]);

  // Auth & UI Handlers
  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (showAuthModal === 'login') {
      const u = admins.find(a => a.username === authInputs.username && a.password === authInputs.password);
      if (u && u.isApproved) {
        setIsAdmin(true);
        setCurrentUser(u);
        sessionStorage.setItem("admin_session", JSON.stringify(u));
        setShowAuthModal(null);
      } else alert("Invalid or pending credentials.");
    } else {
      const exists = admins.some(a => a.username === authInputs.username);
      if (exists) return alert("Username taken.");
      const isFirst = admins.length === 0;
      setAdmins(prev => [...prev, { ...authInputs, isApproved: isFirst, isSuperAdmin: isFirst }]);
      alert(isFirst ? "Super Admin created!" : "Registration requested.");
      setShowAuthModal('login');
    }
  };

  const toggleSelection = (mapId: string, tier: string) => {
    setComparisonTiers(prev => {
      const exists = prev.find(p => p.mapId === mapId && p.tier === tier);
      if (exists) return prev.filter(p => !(p.mapId === mapId && p.tier === tier));
      return [...prev, { mapId, tier }];
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      setZoom(z => Math.min(Math.max(z + e.deltaY * -0.001, MIN_ZOOM), MAX_ZOOM));
    } else {
      setOffset(o => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 font-sans text-slate-900 select-none">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-40 shadow-sm shrink-0">
        <div className="flex items-center gap-4 cursor-pointer" onClick={() => setView('landing')}>
          <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-200"><Layers className="text-white w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-black tracking-tight leading-none">LicenseMap</h1>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-black">Architecture</p>
          </div>
        </div>

        {view !== 'landing' && (
          <div className="flex items-center gap-3 flex-1 max-w-4xl mx-8">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input type="text" placeholder="Search capabilities..." className="w-full pl-12 pr-4 py-2.5 bg-slate-100 border-none rounded-2xl text-sm focus:ring-4 focus:ring-blue-500/10 transition-all" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            
            <div className="flex bg-slate-100 p-1 rounded-2xl">
              <button onClick={() => setView('map')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${view === 'map' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><MapIcon className="w-4 h-4" /> Map</button>
              <button onClick={() => setView('matrix')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${view === 'matrix' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><TableIcon className="w-4 h-4" /> Matrix</button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          {isAdmin && (
            <button onClick={() => setShowUploadModal(true)} title="Extract with AI Grounding" className="p-2.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-xl transition-all border border-slate-200">
              <Upload className="w-5 h-5" />
            </button>
          )}

          {isAdmin ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setView('library')} className="p-2.5 text-slate-400 hover:text-blue-600"><Library className="w-5 h-5" /></button>
              <button onClick={() => { setIsAdmin(false); sessionStorage.clear(); setView('landing'); }} className="p-2.5 text-slate-400 hover:text-rose-500"><LogOut className="w-5 h-5" /></button>
            </div>
          ) : (
            <button onClick={() => setShowAuthModal('login')} className="flex items-center gap-2 bg-slate-100 text-slate-600 px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all"><Lock className="w-3.5 h-3.5" /> Admin</button>
          )}
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        {/* Landing View */}
        {view === 'landing' && (
          <div className="h-full overflow-auto bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:32px_32px]">
            <div className="max-w-7xl mx-auto px-12 py-20">
              <div className="text-center mb-24 animate-in fade-in slide-in-from-top-4 duration-700">
                <span className="bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest mb-6 inline-block">V5 Semantic Merging Engine</span>
                <h2 className="text-6xl font-black text-slate-900 tracking-tighter mb-6 leading-tight">Master your Licensing <br/>Ground Truth.</h2>
                <p className="text-slate-500 text-xl max-w-2xl mx-auto leading-relaxed">
                  Automatically synchronize, verify, and visualize Microsoft 365 licensing tracks with deep web grounding and semantic terminology merging.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <section>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="p-4 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-100"><ShieldCheck className="w-8 h-8" /></div>
                    <h3 className="text-3xl font-black text-slate-900">Enterprise</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {maps.filter(m => m.type === 'Enterprise').map(m => (
                      <div key={m.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all">
                        <h4 className="font-bold text-slate-800 mb-6 truncate">{m.title}</h4>
                        <div className="space-y-2">
                          {m.data.tiers.map(t => (
                            <button key={t} onClick={() => toggleSelection(m.id, t)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all font-bold text-xs ${comparisonTiers.some(p => p.mapId === m.id && p.tier === t) ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-300'}`}>
                              {t}
                              {comparisonTiers.some(p => p.mapId === m.id && p.tier === t) ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4 opacity-20" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="p-4 bg-emerald-600 text-white rounded-2xl shadow-xl shadow-emerald-100"><Users className="w-8 h-8" /></div>
                    <h3 className="text-3xl font-black text-slate-900">Business</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {maps.filter(m => m.type === 'Business').map(m => (
                      <div key={m.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all">
                        <h4 className="font-bold text-slate-800 mb-6 truncate">{m.title}</h4>
                        <div className="space-y-2">
                          {m.data.tiers.map(t => (
                            <button key={t} onClick={() => toggleSelection(m.id, t)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all font-bold text-xs ${comparisonTiers.some(p => p.mapId === m.id && p.tier === t) ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-300'}`}>
                              {t}
                              {comparisonTiers.some(p => p.mapId === m.id && p.tier === t) ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4 opacity-20" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            {/* Float Comparison Action */}
            {comparisonTiers.length > 0 && (
              <div className="fixed bottom-12 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-2xl px-8 py-6 rounded-[3rem] border border-white/20 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] flex items-center gap-12 z-50 animate-in slide-in-from-bottom-12 duration-500">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1">Architecture Comparison</span>
                  <div className="flex gap-2">
                    {comparisonTiers.map(c => <span key={c.mapId+c.tier} className="text-white font-bold text-sm bg-white/10 px-3 py-1 rounded-lg">{c.tier}</span>)}
                  </div>
                </div>
                <div className="flex gap-4">
                  <button onClick={() => setComparisonTiers([])} className="text-white/60 font-bold hover:text-white">Reset</button>
                  <button onClick={() => setView('matrix')} className="bg-blue-500 text-white px-8 py-4 rounded-2xl font-black text-lg hover:bg-blue-400 transition-all shadow-xl shadow-blue-500/20 active:scale-95 flex items-center gap-3">
                    View Comparison <ChevronRight className="w-6 h-6" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Map View */}
        {view === 'map' && activeMap && (
          <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:24px_24px] overflow-hidden" onWheel={handleWheel}>
            <div 
              className="absolute transition-transform duration-75 origin-top-left flex gap-12 p-40" 
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
            >
              {activeMap.tiers.map(tier => (
                <div key={tier} className="flex flex-col w-80 shrink-0">
                  <div className="bg-slate-900 text-white p-6 rounded-t-[2rem] shadow-2xl">
                    <h3 className="text-lg font-black truncate">{tier}</h3>
                  </div>
                  <div className="bg-white/80 backdrop-blur-md border border-slate-200 rounded-b-[2rem] p-6 space-y-10 min-h-[600px] shadow-xl">
                    {filteredCategories.map(cat => (
                      <div key={cat.name}>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span>{cat.name}
                        </h4>
                        <div className="space-y-2">
                          {cat.features.map(feat => (
                            <FeatureNode 
                              key={feat.name} 
                              feature={feat} 
                              tier={tier} 
                              isAdmin={isAdmin} 
                              isSelected={selectedFeatureKeys.has(`${cat.name}|${feat.name}`)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Matrix View */}
        {view === 'matrix' && activeMap && (
          <div className="absolute inset-0 bg-white overflow-auto p-12 custom-scrollbar">
            <div className="max-w-screen-2xl mx-auto">
              <div className="flex items-center justify-between mb-12">
                <div>
                  <h2 className="text-4xl font-black text-slate-900 tracking-tight">Semantic Merged Matrix</h2>
                  <p className="text-slate-500 mt-2 font-medium">Auto-collapsing identical capabilities across {comparisonTiers.length} tracks using deep grounded extraction.</p>
                </div>
                <button onClick={() => setView('landing')} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-6 py-3 rounded-2xl font-bold transition-all">Modify Set</button>
              </div>
              <table className="w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-30 bg-white">
                  <tr>
                    <th className="p-8 text-left border-b-2 font-black text-2xl min-w-[350px]">Capability Area</th>
                    {activeMap.tiers.map(t => <th key={t} className="p-8 text-center border-b-2 font-black text-[10px] uppercase tracking-[0.2em] text-slate-400">{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredCategories.map(cat => (
                    <React.Fragment key={cat.name}>
                      <tr className="bg-slate-900 text-white">
                        <td colSpan={activeMap.tiers.length + 1} className="p-3 px-8 text-[10px] font-black uppercase tracking-[0.3em]">{cat.name}</td>
                      </tr>
                      {cat.features.map(f => (
                        <tr key={f.name} className="hover:bg-slate-50 transition-colors group">
                          <td className="p-8 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-lg">{f.name}</span>
                              {f.link && <a href={f.link} target="_blank" className="text-blue-500 hover:text-blue-700"><ExternalLink className="w-4 h-4" /></a>}
                            </div>
                            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed max-w-lg">{f.description}</p>
                          </td>
                          {activeMap.tiers.map(t => (
                            <td key={t} className="p-8 text-center border-b border-slate-100">
                              <div className="flex flex-col items-center gap-2">
                                <StatusIcon status={f.status[t]} />
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{f.status[t]}</span>
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Library View */}
        {view === 'library' && isAdmin && (
          <div className="h-full overflow-auto p-12 bg-slate-50/50">
            <div className="max-w-7xl mx-auto">
              {!managementMapId ? (
                <>
                  <div className="flex justify-between items-center mb-12">
                    <h2 className="text-4xl font-black text-slate-900 tracking-tight">Context Library</h2>
                    <button onClick={() => setShowUploadModal(true)} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200">
                      <Plus className="w-5 h-5" /> Add Source
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {maps.map(m => (
                      <div key={m.id} className="bg-white rounded-[2.5rem] border border-slate-200 p-8 flex flex-col shadow-sm hover:shadow-xl transition-all">
                        <div className="flex justify-between items-start mb-6">
                          <div className={`p-4 rounded-2xl ${m.type === 'Enterprise' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}><FileText className="w-7 h-7" /></div>
                          <button onClick={() => setMaps(prev => prev.filter(x => x.id !== m.id))} className="text-slate-300 hover:text-rose-500 p-2 transition-colors"><Trash2 className="w-5 h-5" /></button>
                        </div>
                        <h3 className="text-xl font-bold mb-2">{m.title}</h3>
                        <p className="text-[10px] text-slate-400 font-black uppercase mb-6 tracking-widest">{m.type} Track</p>
                        <button onClick={() => setManagementMapId(m.id)} className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-4 rounded-2xl font-bold text-sm hover:bg-slate-800 transition-all">
                          <Settings className="w-4 h-4" /> Manage Documentation
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="animate-in slide-in-from-right-8 duration-500">
                  <div className="flex items-center gap-4 mb-12">
                    <button onClick={() => setManagementMapId(null)} className="p-3 bg-white rounded-2xl border border-slate-200 text-slate-500 hover:text-blue-600 shadow-sm"><BackIcon className="w-6 h-6" /></button>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">Managing: {maps.find(m => m.id === managementMapId)?.title}</h2>
                  </div>
                  <div className="bg-white rounded-[3rem] border border-slate-200 p-8 shadow-sm">
                    {maps.find(m => m.id === managementMapId)?.data.categories.map(cat => (
                      <div key={cat.name} className="mb-12">
                        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-6 flex items-center gap-2"><span className="w-2 h-2 bg-blue-500 rounded-full"></span> {cat.name}</h3>
                        <div className="space-y-4">
                          {cat.features.map(feat => (
                            <div key={feat.name} className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-100">
                              <div className="max-w-md">
                                <h4 className="font-bold text-slate-900 mb-1">{feat.name}</h4>
                                <p className="text-xs text-slate-500 leading-relaxed">{feat.description}</p>
                              </div>
                              <div className="flex-1 max-w-sm ml-8">
                                <div className="relative">
                                  <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                  <input 
                                    className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20"
                                    defaultValue={feat.link}
                                    placeholder="Learn.microsoft.com URL..."
                                    onBlur={(e) => {
                                      const updatedMaps = [...maps];
                                      const mIdx = updatedMaps.findIndex(m => m.id === managementMapId);
                                      const cIdx = updatedMaps[mIdx].data.categories.findIndex(c => c.name === cat.name);
                                      const fIdx = updatedMaps[mIdx].data.categories[cIdx].features.findIndex(f => f.name === feat.name);
                                      updatedMaps[mIdx].data.categories[cIdx].features[fIdx].link = e.target.value;
                                      setMaps(updatedMaps);
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 z-[110] bg-white/95 backdrop-blur-xl flex flex-col items-center justify-center p-12 text-center">
            <div className="relative mb-8">
              <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Globe className="w-6 h-6 text-blue-400 animate-pulse" />
              </div>
            </div>
            <h3 className="text-3xl font-black mb-4">Deep Extraction & Verification</h3>
            <p className="text-slate-500 max-w-md mx-auto leading-relaxed">
              Gemini is performing recursive grounding on Microsoft Learn to ensure terminology and documentation links are 100% accurate.
            </p>
          </div>
        )}

        {/* Auth Modal */}
        {showAuthModal && (
          <div className="absolute inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-white rounded-[3rem] shadow-2xl p-10 w-full max-w-sm animate-in zoom-in duration-300">
              <h2 className="text-2xl font-black mb-8">{showAuthModal === 'login' ? 'Admin Access' : 'Register Admin'}</h2>
              <form onSubmit={handleAuth} className="space-y-4">
                <input type="text" placeholder="Username" className="w-full px-6 py-4 bg-slate-50 rounded-2xl outline-none" value={authInputs.username} onChange={e => setAuthInputs({...authInputs, username: e.target.value})} required />
                <input type="password" placeholder="Password" className="w-full px-6 py-4 bg-slate-50 rounded-2xl outline-none" value={authInputs.password} onChange={e => setAuthInputs({...authInputs, password: e.target.value})} required />
                <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black hover:bg-blue-700 transition-all shadow-xl">Authenticate</button>
                <button type="button" onClick={() => setShowAuthModal(showAuthModal === 'login' ? 'register' : 'login')} className="w-full text-slate-400 font-bold py-2">{showAuthModal === 'login' ? 'Request Access' : 'Back to Login'}</button>
              </form>
            </div>
          </div>
        )}

        {isAdmin && showUploadModal && (
          <div className="absolute inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 w-full max-w-md animate-in zoom-in duration-300">
               <h2 className="text-2xl font-bold mb-6 text-center">New Knowledge Source</h2>
               <div className="space-y-6">
                 <div>
                   <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block text-center">Licensing Track</label>
                   <div className="p-1 bg-slate-100 rounded-2xl flex">
                     <button onClick={() => setUploadTrack('Enterprise')} className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${uploadTrack === 'Enterprise' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200'}`}>Enterprise</button>
                     <button onClick={() => setUploadTrack('Business')} className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${uploadTrack === 'Business' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200'}`}>Business</button>
                   </div>
                 </div>
                 <label className="flex items-center justify-center gap-3 bg-slate-900 text-white py-5 rounded-2xl font-black cursor-pointer hover:bg-slate-800 transition-all shadow-xl">
                    <Plus className="w-6 h-6" /> Select PDF Audit Source
                    <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} />
                 </label>
                 <button onClick={() => setShowUploadModal(false)} className="w-full text-slate-400 font-bold py-2 hover:text-slate-600 transition-colors">Cancel</button>
               </div>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <Database className="w-3.5 h-3.5" /> Persistent Local Workspace
          </div>
          <div className="w-[1px] h-4 bg-slate-200"></div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <Library className="w-3.5 h-3.5" /> {maps.length} Knowledge Sources
          </div>
        </div>
        <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
          LicenseMap Explorer V4.0.0 Alpha
        </div>
      </footer>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
