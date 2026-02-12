
import React, { useState, useRef, useEffect, useMemo } from 'react';
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
import * as XLSX from 'xlsx';
import { toPng } from 'html-to-image';
import './App.css';

// --- Constants ---

const INITIAL_ZOOM = 0.8;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const STORAGE_KEY = "licensing_map_collection_v4";
const ADMIN_STORAGE_KEY = "licensing_admins_v4";

// --- Helper Functions ---

const safeLower = (s) => String(s || "").toLowerCase();
const generateId = () => Math.random().toString(36).substr(2, 9);

const getSemanticFingerprint = (str) => {
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
        .replace(/[^a-z0-9]/g, '');
};

const normalizeName = (name) => {
    return name.trim().replace(/\s+/g, ' ');
};

// --- Components ---

const StatusIcon = ({ status }) => {
    const s = safeLower(status);
    if (s.includes('included') || s.includes('yes') || s === 'full')
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (s.includes('partial') || s.includes('limited'))
        return <MinusCircle className="w-4 h-4 text-amber-500" />;
    return <XCircle className="w-4 h-4 text-rose-400" />;
};

const FeatureNode = ({ feature, tier, isAdmin, isSelected, onSelect }) => {
    const status = feature.status?.[tier] || 'Excluded';
    const sLower = safeLower(status);
    const isIncluded = sLower.includes('included') || sLower === 'full';

    return (
        <div className={`
      feature-node group cursor-pointer
      ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : ''}
      ${isIncluded ? 'bg-white' : 'bg-slate-50 opacity-60'}
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
    const [view, setView] = useState('landing');
    const [maps, setMaps] = useState([]);
    const [comparisonTiers, setComparisonTiers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [diffOnly, setDiffOnly] = useState(false);
    const [matrixMode, setMatrixMode] = useState('full'); // 'full' or 'availability'

    // Auth State
    const [isAdmin, setIsAdmin] = useState(false);
    const [, setCurrentUser] = useState(null);
    const [admins, setAdmins] = useState([]);
    const [showAuthModal, setShowAuthModal] = useState(null);
    const [authInputs, setAuthInputs] = useState({ username: '', password: '' });

    // Settings & Edit State
    const [, setShowSettings] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadTrack, setUploadTrack] = useState('Enterprise');
    const [selectedCategories] = useState([]);
    const [selectedFeatureKeys] = useState(new Set());
    const [managementMapId, setManagementMapId] = useState(null);

    // Map interaction state
    const [zoom, setZoom] = useState(INITIAL_ZOOM);
    const [offset, setOffset] = useState({ x: 50, y: 50 });
    const [isDragging, setIsDragging] = useState(false);
    const mapRef = useRef(null);
    const dragStart = useRef({ x: 0, y: 0 });

    // Persistence: Fetch from MongoDB on mount
    useEffect(() => {
        const fetchMaps = async () => {
            try {
                const response = await fetch('/api/maps');
                if (response.ok) {
                    const data = await response.json();
                    // Maps from DB use _id, we'll map them to id for compatibility
                    setMaps(data.map(m => ({ ...m, id: m._id })));
                }
            } catch (err) {
                console.warn("DB Fetch failed, falling back to localStorage", err);
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) setMaps(JSON.parse(saved));
            }
        };
        fetchMaps();

        const savedAdmins = localStorage.getItem(ADMIN_STORAGE_KEY);
        let adminList = savedAdmins ? JSON.parse(savedAdmins) : [];

        if (!adminList.some(a => a.username === 'meridian')) {
            adminList.push({
                username: 'meridian',
                password: 'Meridian@#$',
                isApproved: true,
                isSuperAdmin: true
            });
            localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminList));
        }

        setAdmins(adminList);

        const session = sessionStorage.getItem("admin_session");
        if (session) {
            setCurrentUser(JSON.parse(session));
            setIsAdmin(true);
        }
    }, []);

    // Also sync to localStorage as secondary cache
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
    }, [maps]);

    useEffect(() => {
        localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(admins));
    }, [admins]);

    // Deep AI Extraction via Backend
    const handleFileUpload = async (e) => {
        if (!isAdmin) return;
        const file = e.target.files?.[0];
        if (!file) return;
        setLoading(true);
        setShowUploadModal(false);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('track', uploadTrack);

            const response = await fetch('/api/extract', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    const errData = await response.json();
                    throw new Error(errData.error || 'Server error occurred');
                } else {
                    const text = await response.text();
                    throw new Error(`Server returned error (${response.status}): ${text.substring(0, 100)}`);
                }
            }

            const savedMap = await response.json();
            // Assign DB id to local id
            const newMap = { ...savedMap, id: savedMap._id };
            setMaps(prev => [newMap, ...prev]);
            setView('library');
        } catch (err) {
            console.error("AI EXTRACTION ERROR:", err);
            alert(`AI Processing Failed: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const deleteMap = async (mapId) => {
        if (!window.confirm("Are you sure you want to delete this knowledge source from the cloud?")) return;

        try {
            const response = await fetch(`/api/maps/${mapId}`, { method: 'DELETE' });
            if (response.ok) {
                setMaps(prev => prev.filter(m => m.id !== mapId));
            } else {
                throw new Error("Failed to delete from server");
            }
        } catch (err) {
            alert("Error deleting map: " + err.message);
        }
    };

    // Improved Semantic Merging Logic
    const activeMap = useMemo(() => {
        if (comparisonTiers.length === 0) return null;

        const configs = comparisonTiers.map(s => {
            const map = maps.find(m => m.id === s.mapId);
            return { tier: s.tier, map: map, col: `${map?.title} - ${s.tier}` };
        }).filter(c => c.map);

        const columnNames = configs.map(c => c.col);
        const unifiedCategories = new Map();

        configs.forEach(({ map, tier, col }) => {
            map.data.categories.forEach(cat => {
                const catKey = getSemanticFingerprint(cat.name);
                if (!unifiedCategories.has(catKey)) {
                    unifiedCategories.set(catKey, { name: cat.name, features: [] });
                }

                const targetCat = unifiedCategories.get(catKey);

                cat.features.forEach(feat => {
                    const featKey = getSemanticFingerprint(feat.name);
                    let uFeat = targetCat.features.find(uf => getSemanticFingerprint(uf.name) === featKey);

                    if (!uFeat) {
                        uFeat = { ...feat, name: feat.name, status: {} };
                        columnNames.forEach(cn => uFeat.status[cn] = 'Excluded');
                        targetCat.features.push(uFeat);
                    }

                    if (!uFeat.link && feat.link) uFeat.link = feat.link;
                    if (feat.description.length > (uFeat.description?.length || 0)) uFeat.description = feat.description;

                    uFeat.status[col] = feat.status[tier] || 'Excluded';

                    // Tag as difference if statuses diverge
                    const sValues = Object.values(uFeat.status);
                    uFeat.isDiff = new Set(sValues).size > 1;
                });
            });
        });

        return {
            tiers: columnNames,
            categories: Array.from(unifiedCategories.values())
        };
    }, [maps, comparisonTiers]);

    const filteredCategories = useMemo(() => {
        if (!activeMap) return [];
        const base = activeMap.categories.filter(c => selectedCategories.length === 0 || selectedCategories.includes(c.name));
        const q = searchQuery.toLowerCase();

        return base.map(c => {
            let feats = c.features;
            // Filter by search
            if (q) {
                feats = feats.filter(f => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q));
            }
            // Filter by differences
            if (diffOnly) {
                feats = feats.filter(f => f.isDiff);
            }
            return { ...c, features: feats };
        }).filter(c => c.features.length > 0);
    }, [activeMap, searchQuery, selectedCategories, diffOnly]);

    // Auth & UI Handlers
    const handleAuth = (e) => {
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

    const toggleSelection = (mapId, tier) => {
        setComparisonTiers(prev => {
            const exists = prev.find(p => p.mapId === mapId && p.tier === tier);
            if (exists) return prev.filter(p => !(p.mapId === mapId && p.tier === tier));
            return [...prev, { mapId, tier }];
        });
    };

    const handleWheel = (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const zoomDelta = e.deltaY * -0.001;
            setZoom(z => Math.min(Math.max(z + zoomDelta, MIN_ZOOM), MAX_ZOOM));
        } else {
            setOffset(prev => ({
                x: prev.x - e.deltaX,
                y: prev.y - e.deltaY
            }));
        }
    };

    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        setIsDragging(true);
        dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        setOffset({
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y
        });
    };

    const onMouseUp = () => setIsDragging(false);

    return (
        <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-900 select-none">
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-40 shadow-sm shrink-0">
                <div className="flex items-center gap-4 cursor-pointer" onClick={() => setView('landing')}>
                    <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-200"><Layers className="text-white w-6 h-6" /></div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight leading-none">LicenseMap</h1>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-black">Architecture</p>
                    </div>
                </div>

                {view !== 'landing' && (
                    <div className="hidden md:flex items-center gap-3 flex-1 max-w-4xl mx-8">
                        <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                            <input type="text" placeholder="Search capabilities..." className="w-full pl-12 pr-4 py-2.5 bg-slate-100 border-none rounded-2xl text-sm focus:ring-4 focus:ring-blue-500/10 transition-all font-medium" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        </div>

                        <div className="flex bg-slate-100 p-1 rounded-2xl">
                            <button onClick={() => setView('map')} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'map' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><MapIcon className="w-4 h-4" /> Map</button>
                            <button onClick={() => setView('matrix')} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'matrix' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><TableIcon className="w-4 h-4" /> Matrix</button>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-3">
                    {isAdmin && (
                        <button onClick={() => setShowUploadModal(true)} title="Extract with AI" className="p-2.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-xl transition-all border border-slate-200">
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
                    <div className="h-full overflow-auto bg-[radial-gradient(#e2e8f0_1.5px,transparent_1.5px)] [background-size:32px_32px]">
                        <div className="container-responsive py-12 lg:py-20 animate-fade-in">
                            <div className="text-center mb-16 lg:mb-24">
                                <span className="bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] mb-6 inline-block">Architecture Comparison Engine</span>
                                <h2 className="text-4xl lg:text-7xl font-black text-slate-900 tracking-tighter mb-6 leading-none">Master your Licensing <br className="hidden md:block" />Ground Truth.</h2>
                                <p className="text-slate-500 text-lg lg:text-xl max-w-2xl mx-auto leading-relaxed px-4">
                                    Automatically synchronize, verify, and visualize Microsoft 365 licensing tracks with deep verification and semantic terminology merging.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16">
                                <section>
                                    <div className="flex items-center gap-4 mb-8">
                                        <div className="p-3.5 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-100"><ShieldCheck className="w-6 h-6 lg:w-8 lg:h-8" /></div>
                                        <h3 className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight text-outfit">Enterprise Tracks</h3>
                                    </div>
                                    <div className="grid-responsive-cards">
                                        {maps.filter(m => m.type === 'Enterprise').map(m => (
                                            <div key={m.id} className="card-premium p-6 lg:p-8 flex flex-col">
                                                <h4 className="font-bold text-slate-800 mb-6 truncate text-lg pr-8">{m.title}</h4>
                                                <div className="space-y-3 mt-auto">
                                                    {m.data.tiers.map(t => (
                                                        <button key={t} onClick={() => toggleSelection(m.id, t)} className={`w-full flex items-center justify-between px-5 py-3.5 rounded-2xl border-2 transition-all font-black text-[10px] uppercase tracking-widest ${comparisonTiers.some(p => p.mapId === m.id && p.tier === t) ? 'bg-blue-600 border-blue-600 text-white shadow-xl translate-y-[-2px]' : 'bg-slate-50/50 border-slate-100 text-slate-500 hover:border-slate-300 hover:bg-white'}`}>
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
                                        <div className="p-3.5 bg-emerald-600 text-white rounded-2xl shadow-xl shadow-emerald-100"><Users className="w-6 h-6 lg:w-8 lg:h-8" /></div>
                                        <h3 className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight text-outfit">Business Tracks</h3>
                                    </div>
                                    <div className="grid-responsive-cards">
                                        {maps.filter(m => m.type === 'Business').map(m => (
                                            <div key={m.id} className="card-premium p-6 lg:p-8 flex flex-col hover:border-emerald-400">
                                                <h4 className="font-bold text-slate-800 mb-6 truncate text-lg pr-8">{m.title}</h4>
                                                <div className="space-y-3 mt-auto">
                                                    {m.data.tiers.map(t => (
                                                        <button key={t} onClick={() => toggleSelection(m.id, t)} className={`w-full flex items-center justify-between px-5 py-3.5 rounded-2xl border-2 transition-all font-black text-[10px] uppercase tracking-widest ${comparisonTiers.some(p => p.mapId === m.id && p.tier === t) ? 'bg-emerald-600 border-emerald-600 text-white shadow-xl translate-y-[-2px]' : 'bg-slate-50/50 border-slate-100 text-slate-500 hover:border-slate-300 hover:bg-white'}`}>
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
                            <div className="fixed bottom-6 lg:bottom-12 left-1/2 -translate-x-1/2 glass-panel px-6 lg:px-8 py-4 lg:py-6 rounded-[2rem] lg:rounded-[3rem] border border-white shadow-2xl flex flex-col md:flex-row items-center gap-6 lg:gap-12 z-50 animate-in slide-in-from-bottom-12 duration-500 w-[90%] md:w-auto">
                                <div className="flex flex-col items-center md:items-start text-center md:text-left">
                                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Architecture Comparison Summary</span>
                                    <div className="flex flex-wrap justify-center md:justify-start gap-2 max-w-md">
                                        {comparisonTiers.slice(0, 3).map(c => <span key={c.mapId + c.tier} className="text-slate-700 font-bold text-[10px] bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">{c.tier}</span>)}
                                        {comparisonTiers.length > 3 && <span className="text-slate-400 font-bold text-[10px] py-1">+{comparisonTiers.length - 3} more tracks</span>}
                                    </div>
                                </div>
                                <div className="flex gap-4 w-full md:w-auto">
                                    <button onClick={() => setComparisonTiers([])} className="flex-1 md:flex-none text-slate-400 font-black uppercase tracking-widest text-[9px] hover:text-rose-500 px-4 transition-all">Clear All</button>
                                    <button onClick={() => setView('matrix')} className="flex-1 md:flex-none bg-blue-600 text-white px-8 lg:px-10 py-3 lg:py-4 rounded-xl lg:rounded-2xl font-black text-xs lg:text-sm hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 active:scale-95 flex items-center justify-center gap-3">
                                        Generate Matrix <ChevronRight className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Map View */}
                {view === 'map' && activeMap && (
                    <div
                        className={`absolute inset-0 bg-slate-50 overflow-hidden map-canvas ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                        onWheel={handleWheel}
                        onMouseDown={onMouseDown}
                        onMouseMove={onMouseMove}
                        onMouseUp={onMouseUp}
                        onMouseLeave={onMouseUp}
                    >
                        {/* Background Grid */}
                        <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                            style={{
                                backgroundImage: `radial-gradient(#000 1.5px, transparent 1.5px)`,
                                backgroundSize: '32px 32px',
                                transform: `translate(${offset.x % 32}px, ${offset.y % 32}px)`
                            }}
                        />

                        <div
                            ref={mapRef}
                            className="absolute transition-transform duration-75 origin-top-left flex gap-12 p-[200px]"
                            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
                        >
                            {activeMap.tiers.map(tier => (
                                <div key={tier} className="flex flex-col w-[340px] shrink-0 group/tier">
                                    <div className="bg-slate-900 text-white p-7 rounded-t-[2.5rem] shadow-2xl relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 opacity-50" />
                                        <h3 className="text-xl font-black truncate tracking-tight">{tier}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Infrastructure</span>
                                        </div>
                                    </div>
                                    <div className="bg-white/90 backdrop-blur-xl border-x border-b border-slate-200 rounded-b-[2.5rem] p-8 space-y-12 min-h-[700px] shadow-[0_20px_50px_rgba(0,0,0,0.05)] transition-all group-hover/tier:shadow-[0_40px_80px_rgba(0,0,0,0.1)]">
                                        {filteredCategories.map(cat => (
                                            <div key={cat.name} className="relative">
                                                <div className="absolute -left-4 top-0 bottom-0 w-0.5 bg-slate-100 rounded-full" />
                                                <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em] mb-6 flex items-center justify-between">
                                                    <span>{cat.name}</span>
                                                    <span className="bg-slate-100 px-2 py-0.5 rounded text-[8px]">{cat.features.length}</span>
                                                </h4>
                                                <div className="space-y-3">
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

                        {/* Map Controls */}
                        <div className="fixed bottom-10 right-10 flex flex-col gap-3 z-50">
                            <div className="glass p-2 rounded-[2rem] shadow-2xl border border-slate-200 flex flex-col gap-2">
                                <button onClick={() => setZoom(z => Math.min(z + 0.1, MAX_ZOOM))} className="p-4 hover:bg-slate-100 rounded-full transition-all text-slate-600"><Plus className="w-5 h-5" /></button>
                                <div className="h-px bg-slate-100 mx-2" />
                                <button onClick={() => setZoom(z => Math.max(z - 0.1, MIN_ZOOM))} className="p-4 hover:bg-slate-100 rounded-full transition-all text-slate-600"><MinusCircle className="w-5 h-5" /></button>
                            </div>
                            <button onClick={() => { setZoom(INITIAL_ZOOM); setOffset({ x: 50, y: 50 }); }} className="bg-slate-900 text-white p-4 rounded-full shadow-2xl hover:bg-slate-800 transition-all flex items-center justify-center">
                                <Maximize className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Matrix View */}
                {view === 'matrix' && activeMap && (
                    <div className="absolute inset-0 bg-white overflow-auto flex flex-col animate-fade-in">
                        <div className="container-responsive py-12">
                            <div className="flex flex-col lg:flex-row items-center justify-between gap-8 mb-16">
                                <div className="text-center lg:text-left">
                                    <h2 className="text-3xl lg:text-5xl font-black text-slate-900 tracking-tight leading-none">
                                        {matrixMode === 'full' ? 'Semantic Merged Matrix' : 'Availability Matrix'}
                                    </h2>
                                    <p className="text-slate-500 mt-4 font-medium text-sm lg:text-base">Auto-collapsing identical capabilities across {comparisonTiers.length} tracks using deep grounded extraction.</p>
                                </div>
                                <div className="flex flex-wrap justify-center items-center gap-4">
                                    <div className="flex bg-slate-100 p-1.5 rounded-2xl shadow-inner border border-slate-200">
                                        <button
                                            onClick={() => setMatrixMode('full')}
                                            className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] transition-all ${matrixMode === 'full' ? 'bg-white shadow-md text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                                        >
                                            Detailed
                                        </button>
                                        <button
                                            onClick={() => setMatrixMode('availability')}
                                            className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] transition-all ${matrixMode === 'availability' ? 'bg-white shadow-md text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}
                                        >
                                            Presence
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => setDiffOnly(!diffOnly)}
                                        className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border-2 ${diffOnly ? 'bg-amber-500 border-amber-500 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                    >
                                        <ArrowLeftRight className="w-4 h-4" /> {diffOnly ? 'Differences' : 'All Feature'}
                                    </button>
                                    <button onClick={() => setView('landing')} className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10">Modify Set</button>
                                </div>
                            </div>

                            <div className="overflow-x-auto rounded-[2.5rem] border border-slate-200 shadow-2xl bg-white">
                                <table className="w-full border-separate border-spacing-0">
                                    <thead className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl">
                                        <tr>
                                            <th className="p-8 text-left border-b-2 font-black text-xl lg:text-2xl min-w-[300px]">Capability Area</th>
                                            {activeMap.tiers.map(t => <th key={t} className="p-8 text-center border-b-2 font-black text-[9px] uppercase tracking-[0.2em] text-slate-400 max-w-[150px]">{t}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredCategories.map(cat => (
                                            <React.Fragment key={cat.name}>
                                                <tr className="bg-slate-900 text-white">
                                                    <td colSpan={activeMap.tiers.length + 1} className="p-4 px-8 text-[9px] font-black uppercase tracking-[0.3em] opacity-80">{cat.name}</td>
                                                </tr>
                                                {cat.features.map(f => (
                                                    <tr key={f.name} className="hover:bg-slate-50/50 transition-colors group">
                                                        <td className="p-8 border-b border-slate-100">
                                                            <div className="flex items-center gap-3">
                                                                <span className="font-bold text-base lg:text-lg text-slate-800">{f.name}</span>
                                                                {f.link && <a href={f.link} target="_blank" className="text-blue-500 hover:text-blue-700 transition-colors"><ExternalLink className="w-4 h-4" /></a>}
                                                            </div>
                                                            <p className="text-xs text-slate-500 mt-2 leading-relaxed max-w-lg font-medium">{f.description}</p>
                                                        </td>
                                                        {activeMap.tiers.map(t => {
                                                            const status = f.status[t];
                                                            const sLower = safeLower(status);
                                                            const isIncluded = sLower.includes('included') || sLower.includes('yes') || sLower === 'full';

                                                            return (
                                                                <td key={t} className={`p-8 text-center border-b border-slate-100 ${matrixMode === 'availability' && isIncluded ? 'bg-emerald-50/20' : ''}`}>
                                                                    <div className="flex flex-col items-center gap-2">
                                                                        {matrixMode === 'full' ? (
                                                                            <>
                                                                                <StatusIcon status={status} />
                                                                                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mt-1">{status}</span>
                                                                            </>
                                                                        ) : (
                                                                            isIncluded ? <Check className="w-6 h-6 text-emerald-500 stroke-[3px]" /> : null
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
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
                                                    <button onClick={() => deleteMap(m.id)} className="text-slate-300 hover:text-rose-500 p-2 transition-colors"><Trash2 className="w-5 h-5" /></button>
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
                            Syncing with Microsoft Learn to ensure terminology and documentation links are 100% accurate.
                        </p>
                    </div>
                )}

                {/* Auth Modal */}
                {showAuthModal && (
                    <div className="absolute inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6">
                        <div className="bg-white rounded-[3rem] shadow-2xl p-10 w-full max-sm">
                            <h2 className="text-2xl font-black mb-8">{showAuthModal === 'login' ? 'Admin Access' : 'Register Admin'}</h2>
                            <form onSubmit={handleAuth} className="space-y-4">
                                <input type="text" placeholder="Username" className="w-full px-6 py-4 bg-slate-50 rounded-2xl outline-none" value={authInputs.username} onChange={e => setAuthInputs({ ...authInputs, username: e.target.value })} required />
                                <input type="password" placeholder="Password" className="w-full px-6 py-4 bg-slate-50 rounded-2xl outline-none" value={authInputs.password} onChange={e => setAuthInputs({ ...authInputs, password: e.target.value })} required />
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
                        <Database className="w-3.5 h-3.5" /> Cloud Context Storage (MongoDB Atlas)
                    </div>
                    <div className="w-[1px] h-4 bg-slate-200"></div>
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <Library className="w-3.5 h-3.5" /> {maps.length} Knowledge Sources
                    </div>
                </div>
                <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                    LicenseMap Explorer V5.0.0
                </div>
            </footer>
        </div>
    );
};

export default App;
