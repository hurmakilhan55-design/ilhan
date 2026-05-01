import { useEffect, useState, useMemo, useRef } from 'react';
import { 
  collection, 
  query, 
  where,
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  serverTimestamp,
  orderBy,
  setDoc,
  getDoc,
  getDocs,
  limit,
  Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  Camera, 
  CheckCircle2, 
  MapPin, 
  ClipboardCheck, 
  LogOut, 
  Plus, 
  ChevronRight, 
  Clock, 
  Phone,
  User as UserIcon,
  Home,
  CheckSquare,
  Users,
  Calendar,
  AlertTriangle,
  Package,
  CreditCard,
  LayoutDashboard,
  Search,
  Filter,
  Wrench,
  Printer,
  X,
  Edit2,
  Trash2,
  AlertCircle,
  Compass,
  ArrowRight,
  Check,
  ShieldCheck
} from 'lucide-react';
import { auth, signInWithGoogle, logOut, db } from './lib/firebase';
import { 
  ServiceRequest, 
  ServiceStatus, 
  OperationType, 
  UserRole, 
  UserProfile, 
  Customer, 
  PaymentFollowUp,
  ServiceType,
  Device
} from './types';
import { handleFirestoreError } from './utils';
import { SignaturePad } from './components/SignaturePad';
import { motion, AnimatePresence } from 'motion/react';
import { format, addMonths, addDays, subDays, isBefore, isAfter, startOfDay, endOfDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

type ManagerTab = 'DASHBOARD' | 'CUSTOMERS' | 'DISPATCH' | 'MAINTENANCE' | 'PAYMENTS' | 'STAFF';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [services, setServices] = useState<ServiceRequest[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<PaymentFollowUp[]>([]);
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  
  const [selectedService, setSelectedService] = useState<ServiceRequest | null>(null);
  const [managerTab, setManagerTab] = useState<ManagerTab>('DASHBOARD');
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);

  const handleStatClick = (tabId: ManagerTab, filter?: string) => {
    setManagerTab(tabId);
    if (filter) setSelectedFilter(filter);
    else setSelectedFilter(null);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;

    const qServices = query(collection(db, 'services'), orderBy('createdAt', 'desc'));
    const unsubServices = onSnapshot(qServices, (s) => {
      setServices(s.docs.map(d => ({ id: d.id, ...d.data() } as ServiceRequest)));
    });

    const qCustomers = query(collection(db, 'customers'), orderBy('name', 'asc'));
    const unsubCustomers = onSnapshot(qCustomers, (s) => {
      const allCustomers = s.docs.map(d => ({ id: d.id, ...d.data() } as Customer));
      // Deduplicate by name for clean view
      setCustomers(Array.from(new Map(allCustomers.map(item => [item.name, item])).values()));
    });

    const qPayments = query(collection(db, 'payments'), orderBy('dueDate', 'asc'));
    const unsubPayments = onSnapshot(qPayments, (s) => {
      setPayments(s.docs.map(d => ({ id: d.id, ...d.data() } as PaymentFollowUp)));
    });

    const qTechs = query(collection(db, 'users'), where('role', '==', 'TECHNICIAN'), orderBy('name', 'asc'));
    const unsubTechs = onSnapshot(qTechs, (s) => {
      setTechnicians(s.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));
    });

    return () => {
      unsubServices();
      unsubCustomers();
      unsubPayments();
      unsubTechs();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const generateWeeklyJobs = async () => {
      for (const customer of customers) {
        if (!customer.maintenanceIntervalMonths || customer.maintenanceIntervalMonths <= 0) continue;

        const lastDate = (customer.lastVisitDate && typeof customer.lastVisitDate.toDate === 'function') 
          ? customer.lastVisitDate.toDate() 
          : new Date(0);
        
        const nextDate = addMonths(lastDate, customer.maintenanceIntervalMonths);
        
        if (isBefore(nextDate, addDays(new Date(), 7))) {
          const maintenanceExists = services.some(s => 
            s.customerId === customer.id && 
            s.type === 'MAINTENANCE' && 
            s.status !== 'COMPLETED'
          );

          if (!maintenanceExists) {
            await addDoc(collection(db, 'services'), {
              customerId: customer.id,
              customerName: customer.name,
              customerAddress: customer.address,
              type: 'MAINTENANCE',
              status: 'PENDING',
              priority: 'NORMAL',
              description: 'Otomatik Periyodik Bakım Emri',
              createdAt: serverTimestamp(),
              checklist: [
                { id: '1', label: 'Cihaz Temizliği', completed: false },
                { id: '2', label: 'Toner Seviye Kontrolü', completed: false },
                { id: '3', label: 'Kağıt Yolu Temizliği', completed: false },
                { id: '4', label: 'Genel Fonksiyon Testi', completed: false }
              ]
            });
          }
        }
      }
    };

    generateWeeklyJobs();
  }, [customers, services, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return <AuthView />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <ManagerView 
        tab={managerTab} 
        setTab={setManagerTab}
        onStatClick={handleStatClick}
        selectedFilter={selectedFilter}
        services={services}
        customers={customers}
        payments={payments}
        technicians={technicians}
        user={user}
        selectedService={selectedService}
        setSelectedService={setSelectedService}
        onLogout={() => logOut()}
      />
    </div>
  );
}

function ManagerView({ 
  tab, 
  setTab, 
  onStatClick,
  selectedFilter,
  services, 
  customers, 
  payments, 
  technicians,
  user,
  selectedService,
  setSelectedService,
  onLogout
}: { 
  tab: ManagerTab, 
  setTab: (t: ManagerTab) => void,
  onStatClick: (tabId: ManagerTab, filter?: string) => void,
  selectedFilter: string | null,
  services: ServiceRequest[],
  customers: Customer[],
  payments: PaymentFollowUp[],
  technicians: UserProfile[],
  user: User,
  selectedService: ServiceRequest | null,
  setSelectedService: (s: ServiceRequest | null) => void,
  onLogout: () => void
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 text-slate-900 flex flex-col shrink-0 shadow-sm relative z-50">
        <div className="p-8 pb-4">
           <img src="/input_file_0.png" alt="Hürmak" className="w-32 h-auto" />
           <div className="mt-8 px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest leading-none">Yönetici Paneli</p>
           </div>
        </div>

            <nav className="flex-1 px-4 py-8 space-y-1 overflow-y-auto">
          {[
            { id: 'DASHBOARD', icon: LayoutDashboard, label: 'Panel' },
            { id: 'DISPATCH', icon: ClipboardCheck, label: 'İş Emirleri' },
            { id: 'CUSTOMERS', icon: Users, label: 'Müşteriler' },
            { id: 'MAINTENANCE', icon: Wrench, label: 'Bakım Takibi' },
            { id: 'PAYMENTS', icon: CreditCard, label: 'Ödemeler' },
            { id: 'STAFF', icon: ShieldCheck, label: 'Ekip' }
          ].map(item => (
            <button
              key={item.id}
              id={`nav-item-${item.id}`}
              onClick={() => setTab(item.id as ManagerTab)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${tab === item.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:bg-slate-50 hover:text-blue-600'}`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-slate-100">
           <button onClick={onLogout} className="w-full flex items-center gap-4 px-4 py-4 text-rose-500 hover:bg-rose-50 rounded-2xl font-black text-sm uppercase tracking-widest transition-all">
              <LogOut className="w-5 h-5" /> Çıkış Yap
           </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-slate-50 relative">
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200 px-12 py-6 flex justify-between items-center">
           <h2 className="text-xl font-black text-slate-900 uppercase tracking-tighter">
              {tab === 'DASHBOARD' && 'Genel Bakış'}
              {tab === 'CUSTOMERS' && 'Müşteri Yönetimi'}
              {tab === 'DISPATCH' && 'İş Emirleri & Sevkiyat'}
              {tab === 'MAINTENANCE' && 'Periyodik Bakım Takibi'}
              {tab === 'PAYMENTS' && 'Ödeme ve Tahsilat'}
              {tab === 'STAFF' && 'Saha Ekibi Yönetimi'}
           </h2>
           <div className="flex items-center gap-6">
              <div className="text-right">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{user.email}</p>
                 <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{user.displayName}</p>
              </div>
              <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center font-black text-white text-lg">
                 {user.displayName?.charAt(0)}
              </div>
           </div>
        </header>

        <div className="p-12 max-w-7xl mx-auto">
          {tab === 'DASHBOARD' && <Dashboard services={services} customers={customers} payments={payments} technicians={technicians} onStatClick={onStatClick} setSelectedService={setSelectedService} />}
          {tab === 'CUSTOMERS' && <CustomerManagement customers={customers} services={services} technicians={technicians} />}
          {tab === 'DISPATCH' && <ServiceRequestForm customers={customers} technicians={technicians} services={services} initialFilter={selectedFilter} setSelectedService={setSelectedService} />}
          {tab === 'MAINTENANCE' && <MaintenanceRadar customers={customers} services={services} technicians={technicians} />}
          {tab === 'PAYMENTS' && <PaymentTracking payments={payments} customers={customers} />}
          {tab === 'STAFF' && <StaffManagement technicians={technicians} services={services} setSelectedService={setSelectedService} />}
        </div>
      </main>

      {selectedService && (
        <ServiceDetailModal 
          service={selectedService} 
          onClose={() => setSelectedService(null)} 
          technicians={technicians}
        />
      )}
    </div>
  );
}

function Dashboard({ services, customers, payments, technicians, onStatClick, setSelectedService }: { 
  services: ServiceRequest[], 
  customers: Customer[], 
  payments: PaymentFollowUp[], 
  technicians: UserProfile[],
  onStatClick: (tabId: ManagerTab, filter?: string) => void,
  setSelectedService: (s: ServiceRequest | null) => void
}) {
  const stats = useMemo(() => {
    const today = new Date();
    const activeJobs = services.filter(s => s.status !== 'COMPLETED').length;
    const maintenanceDue = customers.filter(c => {
       if (!c.maintenanceIntervalMonths || c.maintenanceIntervalMonths <= 0) return false;
       const lastDate = (c.lastVisitDate && typeof c.lastVisitDate.toDate === 'function') ? c.lastVisitDate.toDate() : new Date(0);
       return isBefore(addMonths(lastDate, c.maintenanceIntervalMonths), today);
    }).length;
    
    const overduePayments = payments.filter(p => p.status === 'PENDING' && isBefore(new Date(p.dueDate), today)).length;
    
    return [
      { label: 'Aktif İşler', value: activeJobs, color: 'blue', tab: 'DISPATCH', filter: 'ACTIVE', icon: ClipboardCheck },
      { label: 'Bakımı Gelenler', value: maintenanceDue, color: 'emerald', tab: 'MAINTENANCE', icon: Wrench },
      { label: 'Geciken Ödemeler', value: overduePayments, color: 'rose', tab: 'PAYMENTS', icon: CreditCard }
    ];
  }, [services, customers, payments]);

  return (
    <div className="space-y-12">
      <div className="grid grid-cols-3 gap-8">
        {stats.map(s => (
          <motion.button
            key={s.label}
            whileHover={{ y: -4 }}
            onClick={() => onStatClick(s.tab as ManagerTab, s.filter)}
            className="bg-white p-6 rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-100 flex items-center gap-6 text-left"
          >
            <div className={`w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-900`}>
               <s.icon className="w-6 h-6" />
            </div>
            <div>
               <h4 className="text-3xl font-black text-slate-900 tracking-tight leading-none">{s.value}</h4>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">{s.label}</p>
            </div>
          </motion.button>
        ))}
      </div>

      <div className="bg-white rounded-[3rem] shadow-xl border border-slate-100 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex justify-between items-center">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Son Servis Haraketleri</h3>
          <button onClick={() => onStatClick('DISPATCH')} className="text-[10px] font-black text-blue-600 uppercase">Tümünü Gör</button>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50/50">
               <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Müşteri</th>
               <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Tür</th>
               <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Teknisyen</th>
               <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {services.slice(0, 8).map(s => (
              <tr 
                key={s.id} 
                className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                onClick={() => setSelectedService(s)}
              >
                <td className="px-8 py-5">
                   <p className="text-sm font-black text-slate-900 uppercase">{s.customerName}</p>
                   <p className="text-[10px] font-bold text-slate-400 uppercase">{s.customerAddress}</p>
                </td>
                <td className="px-8 py-5">
                   <span className={`text-[10px] font-black uppercase ${s.type === 'FAULT' ? 'text-rose-500' : 'text-blue-500'}`}>{s.type}</span>
                </td>
                <td className="px-8 py-5">
                   <span className="text-[10px] font-black text-slate-600 uppercase">{s.technicianName}</span>
                </td>
                <td className="px-8 py-5">
                   <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${s.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                      {s.status}
                   </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerManagement({ customers, services, technicians }: { customers: Customer[], services: ServiceRequest[], technicians: UserProfile[] }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newCustomer, setNewCustomer] = useState<Partial<Customer>>({ 
    name: '', address: '', city: '', district: '', phone: '', devices: [], maintenanceIntervalMonths: 6 
  });

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.address.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [customers, searchQuery]);

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.city || !newCustomer.district) {
      alert('İl ve İlçe alanları zorunludur!');
      return;
    }
    try {
      if (editingCustomer) {
        await updateDoc(doc(db, 'customers', editingCustomer.id), {
          ...newCustomer,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'customers'), { 
          ...newCustomer, 
          createdAt: serverTimestamp(),
          lastVisitDate: serverTimestamp() // Initialize
        });
      }
      setShowAddForm(false);
      setEditingCustomer(null);
      setNewCustomer({ name: '', address: '', city: '', district: '', phone: '', devices: [], maintenanceIntervalMonths: 6 });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'customers');
    }
  };

  const addSampleCustomers = async () => {
    const samples = [
      { name: 'Tekno Market A.Ş.', address: 'İkitelli OSB No:45', city: 'İstanbul', district: 'Başakşehir', phone: '0212 555 1020', maintenanceIntervalMonths: 3 },
      { name: 'Güneş Lojistik', address: 'Hadımköy Yolu 12. Km', city: 'İstanbul', district: 'Esenyurt', phone: '0212 888 3040', maintenanceIntervalMonths: 6 },
      { name: 'Mavi Kırtasiye Ltd.', address: 'Cağaloğlu Sk. No:5', city: 'İstanbul', district: 'Fatih', phone: '0212 222 0011', maintenanceIntervalMonths: 12 }
    ];
    for (const s of samples) {
      await addDoc(collection(db, 'customers'), { ...s, createdAt: serverTimestamp(), lastVisitDate: serverTimestamp(), devices: [{ brand: 'HP', model: 'M402dne', serialNumber: 'PH12345', counter: 1000, spareTonerCount: 2 }] });
    }
    alert('Örnek müşteriler eklendi!');
  };

  const addDevice = () => {
    setNewCustomer({
      ...newCustomer,
      devices: [...(newCustomer.devices || []), { brand: '', model: '', serialNumber: '', counter: 0, spareTonerCount: 0 }]
    });
  };

  const removeDevice = (index: number) => {
    const devs = [...(newCustomer.devices || [])];
    devs.splice(index, 1);
    setNewCustomer({ ...newCustomer, devices: devs });
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center bg-white p-8 rounded-[2.5rem] border border-slate-200">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Müşteri Portföyü</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Kayıtlı {customers.length} Müşteri</p>
        </div>
        <div className="flex items-center gap-4">
           <button 
             onClick={addSampleCustomers}
             className="text-[10px] font-black text-slate-400 hover:text-blue-600 uppercase tracking-widest px-4 border-r border-slate-100"
           >
             Örnek Veri Ekle
           </button>
           <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Müşteri Ara..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-12 pr-6 py-3 bg-slate-50 border-slate-100 rounded-2xl text-xs font-bold w-64 focus:bg-white focus:ring-2 focus:ring-blue-500/10 transition-all outline-none"
              />
           </div>
           <button 
             onClick={() => { setShowAddForm(true); setEditingCustomer(null); setNewCustomer({ name: '', address: '', phone: '', devices: [], maintenanceIntervalMonths: 6 }); }}
             className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-xl shadow-blue-500/20 uppercase tracking-widest active:scale-95 transition-all"
           >
             <Plus className="w-5 h-5" /> Yeni Kayıt
           </button>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Müşteri Adı</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Konum / Adres</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Cihazlar</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Bakım</th>
               <th className="px-8 py-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredCustomers.map(c => (
              <tr 
                key={c.id} 
                onClick={() => { setEditingCustomer(c); setNewCustomer(c); setShowAddForm(true); }}
                className="hover:bg-slate-50 transition-colors cursor-pointer group"
              >
                <td className="px-8 py-3">
                   <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 font-black text-xs">
                         {c.name.charAt(0)}
                      </div>
                      <div>
                         <p className="text-xs font-black text-slate-900 uppercase leading-none">{c.name}</p>
                         <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">{c.phone}</p>
                      </div>
                   </div>
                </td>
                 <td className="px-8 py-3">
                   <p className="text-[10px] font-black text-slate-900 uppercase tracking-tight truncate leading-none">
                      {c.district} / {c.city}
                   </p>
                   <p className="text-[9px] font-bold text-slate-500 uppercase max-w-[250px] truncate leading-relaxed line-clamp-1 italic mt-1">
                      {c.address}
                   </p>
                </td>
                <td className="px-8 py-3">
                   <span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-black text-slate-600 uppercase">
                      {c.devices?.length || 0} MAKİNE
                   </span>
                </td>
                <td className="px-8 py-3">
                   <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${c.maintenanceIntervalMonths > 0 ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-400'}`}>
                      {c.maintenanceIntervalMonths > 0 ? `${c.maintenanceIntervalMonths} AY` : 'YOK'}
                   </span>
                </td>
                <td className="px-8 py-3 text-right" onClick={e => e.stopPropagation()}>
                   <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingCustomer(c); setNewCustomer(c); setShowAddForm(true); }} className="p-1.5 text-slate-300 hover:text-blue-600 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={async () => { if(confirm('Emin misiniz?')) await deleteDoc(doc(db, 'customers', c.id)); }} className="p-1.5 text-slate-300 hover:text-rose-600 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                   </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-6 text-slate-900 overflow-y-auto">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-xl rounded-[3rem] shadow-2xl overflow-hidden my-auto translate-y-20 mb-20">
            <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
               <div>
                  <h3 className="text-xl font-black uppercase tracking-tight">{editingCustomer ? 'Müşteri Düzenle' : 'Yeni Müşteri Kaydı'}</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Müşteri ve Cihaz Bilgileri</p>
               </div>
               <button onClick={() => setShowAddForm(false)} className="p-2 text-slate-400 hover:text-white transition-colors"><X className="w-8 h-8" /></button>
            </div>
            <form onSubmit={handleSaveCustomer} className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
               <div className="space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Makine Bilgileri</h4>
                    <button type="button" onClick={addDevice} className="text-[10px] font-black text-blue-600 uppercase flex items-center gap-1"><Plus className="w-3 h-3" /> Ekle</button>
                  </div>
                  <div className="space-y-4">
                    {newCustomer.devices?.map((d, i) => (
                      <div key={i} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4 relative">
                         <button type="button" onClick={() => removeDevice(i)} className="absolute top-4 right-4 text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                         <div className="grid grid-cols-2 gap-4">
                            <input placeholder="Marka" className="bg-white border-slate-100 rounded-xl px-4 py-3 text-xs font-bold" value={d.brand || ''} onChange={e => { const ds = [...newCustomer.devices!]; ds[i].brand = e.target.value; setNewCustomer({...newCustomer, devices: ds}); }} />
                            <input placeholder="Model" className="bg-white border-slate-100 rounded-xl px-4 py-3 text-xs font-bold" value={d.model || ''} onChange={e => { const ds = [...newCustomer.devices!]; ds[i].model = e.target.value; setNewCustomer({...newCustomer, devices: ds}); }} />
                            <input placeholder="Seri No" className="bg-white border-slate-100 rounded-xl px-4 py-3 text-xs font-bold" value={d.serialNumber || ''} onChange={e => { const ds = [...newCustomer.devices!]; ds[i].serialNumber = e.target.value; setNewCustomer({...newCustomer, devices: ds}); }} />
                            <input type="number" placeholder="Sayaç" className="bg-white border-slate-100 rounded-xl px-4 py-3 text-xs font-bold" value={d.counter || 0} onChange={e => { const ds = [...newCustomer.devices!]; ds[i].counter = Number(e.target.value); setNewCustomer({...newCustomer, devices: ds}); }} />
                         </div>
                      </div>
                    ))}
                  </div>
               </div>

               <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-1">
                     <label className="text-[10px] font-black text-slate-400 uppercase px-1">Müşteri / Kurum Adı</label>
                     <input required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all" value={newCustomer.name || ''} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase px-1">Telefon</label>
                       <input required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold focus:bg-white transition-all" value={newCustomer.phone || ''} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase px-1">Bakım Periyodu</label>
                       <select className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold focus:bg-white transition-all" value={newCustomer.maintenanceIntervalMonths || 6} onChange={e => setNewCustomer({...newCustomer, maintenanceIntervalMonths: Number(e.target.value)})}>
                          <option value={0}>SÖZLEŞMESİ YOK</option>
                          <option value={1}>1 AY</option>
                          <option value={3}>3 AY</option>
                          <option value={6}>6 AY</option>
                          <option value={12}>12 AY</option>
                       </select>
                    </div>
                  </div>
                   <div className="grid grid-cols-2 gap-6">
                     <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase px-1">İl (Zorunlu)</label>
                        <input required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold focus:bg-white transition-all" value={newCustomer.city || ''} onChange={e => setNewCustomer({...newCustomer, city: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase px-1">İlçe (Zorunlu)</label>
                        <input required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold focus:bg-white transition-all" value={newCustomer.district || ''} onChange={e => setNewCustomer({...newCustomer, district: e.target.value})} />
                     </div>
                  </div>
                  <div className="space-y-1">
                     <label className="text-[10px] font-black text-slate-400 uppercase px-1">Adres Detayı</label>
                     <textarea required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold min-h-[80px] focus:bg-white transition-all" value={newCustomer.address || ''} onChange={e => setNewCustomer({...newCustomer, address: e.target.value})} />
                  </div>
               </div>
               
               <button type="submit" className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-2xl shadow-blue-500/20 active:scale-95 transition-all">
                 {editingCustomer ? 'Güncellemeleri Kaydet' : 'Müşteriyi Kaydol'}
               </button>

               {editingCustomer && (
                 <div className="pt-8 mt-8 border-t border-slate-100 space-y-6">
                    <div className="flex justify-between items-center px-1">
                       <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Servis Geçmişi (Son 10 Kayıt)</h4>
                       <button 
                        type="button" 
                        onClick={async () => {
                          const today = new Date();
                          for (let i = 0; i < 5; i++) {
                            await addDoc(collection(db, 'services'), {
                              customerId: editingCustomer.id,
                              customerName: editingCustomer.name,
                              customerAddress: editingCustomer.address,
                              type: i % 2 === 0 ? 'FAULT' : 'MAINTENANCE',
                              status: 'COMPLETED',
                              description: `Örnek Servis Kaydı ${i + 1}`,
                              technicianName: 'Saha Teknisyeni',
                              createdAt: new Date(today.getTime() - (i * 24 * 60 * 60 * 1000)),
                              completedAt: new Date(today.getTime() - (i * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000))
                            });
                          }
                          alert('Örnek servis kayıtları oluşturuldu!');
                        }}
                        className="text-[10px] font-black text-blue-600 uppercase"
                       >
                         Örnek Kayıt Oluştur
                       </button>
                    </div>
                    
                    <div className="space-y-3">
                       {services
                         .filter(s => s.customerId === editingCustomer.id)
                         .sort((a, b) => {
                           const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
                           const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
                           return dateB.getTime() - dateA.getTime();
                         })
                         .slice(0, 10)
                         .map(s => (
                           <div key={s.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-center">
                              <div>
                                 <p className="text-[11px] font-black text-slate-900 uppercase">{s.description}</p>
                                 <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${s.type === 'FAULT' ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'}`}>
                                       {s.type}
                                    </span>
                                    <span className="text-[8px] font-bold text-slate-400">
                                       {s.createdAt?.toDate ? format(s.createdAt.toDate(), 'dd MMM yyyy HH:mm', { locale: tr }) : 'Tarih Belirsiz'}
                                    </span>
                                 </div>
                              </div>
                              <div className="text-right">
                                 <span className={`text-[8px] font-black uppercase px-2 py-1 rounded ${s.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {s.status === 'COMPLETED' ? 'TAMAMLANDI' : 'BEKLEMEDE'}
                                 </span>
                              </div>
                           </div>
                         ))}
                       {services.filter(s => s.customerId === editingCustomer.id).length === 0 && (
                         <div className="py-12 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-center">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Henüz Kayıt Bulunmuyor</p>
                         </div>
                       )}
                    </div>
                 </div>
               )}
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function ServiceRequestForm({ customers, technicians, services, initialFilter, setSelectedService }: { customers: Customer[], technicians: UserProfile[], services: ServiceRequest[], initialFilter: string | null, setSelectedService: (s: ServiceRequest | null) => void }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dispatchSearch, setDispatchSearch] = useState('');
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  
  const columns = useMemo(() => {
    return [
      { id: 'PENDING', label: 'Bekleyen', color: 'slate' },
      { id: 'ASSIGNED', label: 'İşlenen', color: 'blue' },
      { id: 'COMPLETED', label: 'Biten', color: 'emerald' }
    ];
  }, []);

  const filteredServices = useMemo(() => {
    return services.filter(s => 
      s.customerName.toLowerCase().includes(dispatchSearch.toLowerCase()) ||
      s.description.toLowerCase().includes(dispatchSearch.toLowerCase())
    );
  }, [services, dispatchSearch]);

  const [formData, setFormData] = useState({
    customerId: '',
    customerName: '',
    customerAddress: '',
    type: 'FAULT' as ServiceType,
    deviceId: '',
    deviceModel: '',
    description: '',
    priority: 'NORMAL' as 'NORMAL' | 'URGENT',
    technicianId: '',
    technicianName: ''
  });

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [customers, searchQuery]);

  const handleSelectCustomer = (c: Customer) => {
    const devices = c.devices || [];
    setFormData({
      ...formData,
      customerId: c.id,
      customerName: c.name,
      customerAddress: c.address,
      deviceId: devices.length === 1 ? '0' : '',
      deviceModel: devices.length === 1 ? `${devices[0].brand} ${devices[0].model}` : ''
    });
    setSearchQuery(c.name);
    setShowCustomerSearch(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'services'), {
        ...formData,
        status: formData.technicianId ? 'ASSIGNED' : 'PENDING',
        createdAt: serverTimestamp(),
        checklist: [
          { id: '1', label: 'Dış Temizlik', completed: false },
          { id: '2', label: 'Baskı Testi', completed: false },
          { id: '3', label: 'Hata Kodu Kontrolü', completed: false }
        ]
      });
      setShowAddForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'services');
    }
  };

  return (
    <div className="space-y-6 h-full -mt-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] border border-slate-200">
        <div>
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight leading-none">İş Emirleri</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{filteredServices.length} Aktif Kayıt</p>
        </div>
        <div className="flex items-center gap-4">
           <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="İş Emri veya Müşteri Ara..." 
                value={dispatchSearch}
                onChange={e => setDispatchSearch(e.target.value)}
                className="pl-12 pr-6 py-3 bg-slate-50 border-slate-100 rounded-2xl text-xs font-bold w-64 focus:bg-white focus:ring-2 focus:ring-blue-500/10 transition-all outline-none"
              />
           </div>
           <button 
             onClick={() => setShowAddForm(true)}
             className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold text-xs shadow-xl shadow-blue-500/20 uppercase tracking-widest active:scale-95 transition-all"
           >
             <Plus className="w-4 h-4" /> Yeni Servis
           </button>
        </div>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-4 h-[calc(100vh-280px)] min-h-[500px]">
        {columns.map(col => (
          <div key={col.id} className="flex-1 min-w-[320px] bg-slate-100/50 rounded-[2.5rem] border border-slate-200/60 p-3 flex flex-col">
             <div className="px-5 py-3 flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                   <div className={`w-2 h-2 rounded-full ${col.id === 'PENDING' ? 'bg-slate-400' : col.id === 'ASSIGNED' ? 'bg-blue-500 shadow-lg shadow-blue-300' : 'bg-emerald-500 shadow-lg shadow-emerald-200'}`} />
                   {col.label}
                </h3>
                <span className="px-2.5 py-0.5 bg-white border border-slate-100 rounded-lg text-[9px] font-black text-slate-400">
                   {services.filter(s => s.status === col.id).length} İŞ
                </span>
             </div>

             <div className="flex-1 space-y-3 overflow-y-auto px-1 custom-scrollbar">
                {filteredServices.filter(s => s.status === col.id).map(s => (
                  <motion.div 
                    layoutId={s.id}
                    key={s.id}
                    onClick={() => setSelectedService(s)}
                    className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all group"
                  >
                     <div className="flex justify-between items-start mb-1.5">
                        <span className={`px-2 py-0.5 rounded text-[6px] font-black uppercase tracking-widest ${s.type === 'FAULT' ? 'bg-rose-50 text-rose-500' : 'bg-blue-50 text-blue-500'}`}>
                           {s.type}
                        </span>
                        <div className={`w-1 h-1 rounded-full ${s.priority === 'URGENT' ? 'bg-rose-500 animate-pulse' : 'bg-slate-200'}`} />
                     </div>
                     <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-tight mb-0.5 truncate">{s.customerName}</h4>
                     <p className="text-[8px] font-bold text-slate-400 uppercase truncate mb-2 italic">"{s.description}"</p>
                     
                     <div className="pt-2 border-t border-slate-50 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                           <div className="w-4 h-4 bg-slate-50 rounded flex items-center justify-center text-[7px] font-black text-slate-400">
                              {s.technicianName?.charAt(0) || '?'}
                           </div>
                           <span className="text-[7px] font-black text-slate-500 uppercase truncate max-w-[70px]">{s.technicianName || 'ATANMAMIŞ'}</span>
                        </div>
                        <span className="text-[6px] font-bold text-slate-300 uppercase">
                           {format(s.createdAt instanceof Timestamp ? s.createdAt.toDate() : new Date(), 'dd MMM', { locale: tr })}
                        </span>
                     </div>
                  </motion.div>
                ))}
                {filteredServices.filter(s => s.status === col.id).length === 0 && (
                   <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3 opacity-30">
                      <ClipboardCheck className="w-12 h-12 text-slate-300" />
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kayıt Bulunmuyor</p>
                   </div>
                )}
             </div>
          </div>
        ))}
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-6 text-slate-900">
           <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-xl rounded-[3rem] shadow-2xl overflow-hidden relative">
              <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
                 <h3 className="text-xl font-black uppercase tracking-tight">Yeni Servis Formu</h3>
                 <button onClick={() => setShowAddForm(false)} className="p-2 text-slate-400"><X className="w-8 h-8" /></button>
              </div>
              <form onSubmit={handleCreate} className="p-8 space-y-6">
                 <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase px-1">Müşteri Seçin (Ara)</label>
                    <div className="relative mt-1">
                      <input 
                        className="w-full bg-slate-50 border-slate-200 rounded-2xl px-12 py-4 text-sm font-bold" 
                        placeholder="Müşteri adıyla ara..."
                        value={searchQuery}
                        onChange={e => { setSearchQuery(e.target.value); setShowCustomerSearch(true); }}
                        onFocus={() => setShowCustomerSearch(true)}
                      />
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    </div>
                    {showCustomerSearch && filteredCustomers.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-[110] mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-60 overflow-y-auto">
                        {filteredCustomers.map(c => (
                          <button 
                            key={c.id} 
                            type="button"
                            onClick={() => handleSelectCustomer(c)}
                            className="w-full px-6 py-4 text-left hover:bg-slate-50 border-b border-slate-100 last:border-0 flex flex-col"
                          >
                            <span className="text-sm font-black text-slate-900 uppercase">{c.name}</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase truncate">{c.address}</span>
                          </button>
                        ))}
                      </div>
                    )}
                 </div>

                 {formData.customerId && (
                   <div className="grid grid-cols-2 gap-4">
                      <div>
                         <label className="text-[10px] font-black text-slate-400 uppercase px-1">Cihaz</label>
                         <select required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold mt-1" value={formData.deviceId || ''} onChange={e => {
                           const customer = customers.find(c => c.id === formData.customerId);
                           const devIdx = Number(e.target.value);
                           const device = customer?.devices?.[devIdx];
                           setFormData({...formData, deviceId: e.target.value, deviceModel: device ? `${device.brand} ${device.model}` : ''});
                         }}>
                            <option value="">Cihaz Seçin...</option>
                            {customers.find(c => c.id === formData.customerId)?.devices?.map((d, i) => (
                              <option key={i} value={i}>{d.brand} {d.model} ({d.serialNumber || 'SN Yok'})</option>
                            ))}
                         </select>
                      </div>
                      <div>
                         <label className="text-[10px] font-black text-slate-400 uppercase px-1">Servis Türü</label>
                         <select className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold mt-1" value={formData.type || 'FAULT'} onChange={e => setFormData({...formData, type: e.target.value as ServiceType})}>
                            <option value="FAULT">ARIZA</option>
                            <option value="MAINTENANCE">BAKIM</option>
                            <option value="INSTALLATION">KURULUM</option>
                            <option value="DELIVERY">TESLİMAT</option>
                         </select>
                      </div>
                   </div>
                 )}

                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase px-1">Arıza / İş Detayı</label>
                    <textarea required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold min-h-[80px]" value={formData.description || ''} onChange={e => setFormData({...formData, description: e.target.value})} />
                 </div>

                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase px-1">Teknisyen Ataması (Opsiyonel)</label>
                    <select className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold" value={formData.technicianId || ''} onChange={e => {
                      const t = technicians.find(tec => tec.id === e.target.value);
                      setFormData({...formData, technicianId: e.target.value, technicianName: t?.name || ''});
                    }}>
                       <option value="">Teknisyen Seçin...</option>
                       {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                 </div>

                 <button type="submit" className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-2xl shadow-blue-500/20 active:scale-95 transition-all">
                    İş Emrini Oluştur
                 </button>
              </form>
           </motion.div>
        </div>
      )}
    </div>
  );
}
function MaintenanceRadar({ customers, services, technicians }: { customers: Customer[], services: ServiceRequest[], technicians: UserProfile[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  
  const radarList = useMemo(() => {
    const today = new Date();
    return customers
      .filter(c => c.maintenanceIntervalMonths && c.maintenanceIntervalMonths > 0)
      .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.address.toLowerCase().includes(searchQuery.toLowerCase()))
      .map(c => {
        const lastVisitDate = (c.lastVisitDate && typeof c.lastVisitDate.toDate === 'function') 
          ? c.lastVisitDate.toDate() 
          : subDays(new Date(), 365); // Default to a year ago if never visited
        
        const nextDate = addMonths(lastVisitDate, c.maintenanceIntervalMonths);
        const daysLeft = Math.floor((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        return { ...c, nextDate, daysLeft, lastVisitDate };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [customers, searchQuery]);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center bg-white p-8 rounded-[2.5rem] border border-slate-200">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Periyodik Bakım Takvimi</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Sözleşmeli Cihazların Takip Çizelgesi</p>
        </div>
        <div className="relative">
           <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
           <input 
             type="text" 
             placeholder="Müşteri veya Adres Ara..." 
             value={searchQuery}
             onChange={e => setSearchQuery(e.target.value)}
             className="pl-12 pr-6 py-3 bg-slate-50 border-slate-100 rounded-2xl text-xs font-bold w-64 focus:bg-white focus:ring-2 focus:ring-blue-500/10 transition-all outline-none"
           />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Müşteri</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Son Bakım</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Planlanan Bakım</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Kalan Süre</th>
               <th className="px-8 py-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {radarList.map(c => (
              <tr 
                key={c.id} 
                className={`hover:bg-slate-50 transition-colors ${c.daysLeft <= 0 ? 'bg-rose-50/20' : ''}`}
              >
                <td className="px-8 py-6">
                   <p className="text-sm font-black text-slate-900 uppercase leading-none">{c.name}</p>
                   <p className="text-[10px] font-bold text-slate-400 uppercase mt-1.5 truncate max-w-[200px] italic">{c.address}</p>
                </td>
                <td className="px-8 py-6 text-slate-500 font-bold text-xs uppercase">
                   {format(c.lastVisitDate, 'dd MMM yyyy', { locale: tr })}
                </td>
                <td className="px-8 py-6 text-slate-900 font-black text-xs uppercase">
                   {format(c.nextDate, 'dd MMM yyyy', { locale: tr })}
                </td>
                <td className="px-8 py-6">
                   <span className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest leading-none flex items-center gap-2 w-fit ${c.daysLeft <= 0 ? 'bg-rose-100 text-rose-700' : 'bg-blue-50 text-blue-600'}`}>
                      {c.daysLeft <= 0 ? (
                        <> <AlertCircle className="w-3 h-3" /> {Math.abs(c.daysLeft)} GÜN GECİKTİ</>
                      ) : (
                        <> <Clock className="w-3 h-3" /> {c.daysLeft} GÜN KALDI</>
                      )}
                   </span>
                </td>
                <td className="px-8 py-6 text-right">
                   <button 
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await addDoc(collection(db, 'services'), {
                            customerId: c.id,
                            customerName: c.name,
                            customerAddress: c.address,
                            type: 'MAINTENANCE',
                            status: 'PENDING',
                            priority: 'NORMAL',
                            description: 'Periyodik Bakım Çağrısı',
                            createdAt: serverTimestamp(),
                            checklist: [
                             { id: '1', label: 'Cihaz Temizliği', completed: false },
                             { id: '2', label: 'Toner Seviye Kontrolü', completed: false },
                             { id: '3', label: 'Kağıt Yolu Temizliği', completed: false }
                            ]
                          });
                          // Update last visit date to "now" so it moves in the radar
                          await updateDoc(doc(db, 'customers', c.id), {
                            lastVisitDate: serverTimestamp()
                          });
                          alert('Bakım emri başarıyla oluşturuldu!');
                        } catch (err) {
                           handleFirestoreError(err, OperationType.WRITE, 'services');
                        }
                      }}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-md ${c.daysLeft <= 0 ? 'bg-rose-600 text-white shadow-rose-200 hover:bg-rose-700' : 'bg-slate-900 text-white hover:bg-blue-600 shadow-slate-200'}`}
                   >
                     İş Emri Başlat
                   </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentTracking({ payments = [], customers = [] }: { payments: PaymentFollowUp[], customers: Customer[] }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPayment, setNewPayment] = useState<Partial<PaymentFollowUp>>({
    customerId: '', customerName: '', totalAmount: 0, paidAmount: 0, status: 'PENDING', dueDate: format(new Date(), 'yyyy-MM-dd')
  });

  const pendingPayments = useMemo(() => {
    if (!payments) return [];
    return payments.filter(p => p.status === 'PENDING');
  }, [payments]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'payments'), { ...newPayment, createdAt: serverTimestamp() });
      setShowAddForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payments');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Ödeme Takibi</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Tahsilat Bekleyen {pendingPayments.length} Kayıt</p>
        </div>
        <button 
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm shadow-xl shadow-emerald-500/20 uppercase tracking-widest active:scale-95 transition-all"
        >
          <Plus className="w-5 h-5" /> Yeni Ödeme Planı
        </button>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Müşteri</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Tutar</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Durum</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Vade</th>
               <th className="px-8 py-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payments && payments.length > 0 ? payments.map(p => (
              <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-8 py-4">
                   <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{p.customerName}</p>
                </td>
                <td className="px-8 py-4 text-right">
                   <p className="text-sm font-black text-slate-700">{p.totalAmount?.toLocaleString('tr-TR')} TL</p>
                </td>
                <td className="px-8 py-4 text-center uppercase">
                   <span className={`px-2 py-1 rounded text-[9px] font-black ${p.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {p.status === 'PAID' ? 'ÖDENDİ' : 'BEKLİYOR'}
                   </span>
                </td>
                <td className="px-8 py-4 text-slate-400 text-xs font-bold">
                   {p.dueDate instanceof Timestamp ? format(p.dueDate.toDate(), 'dd MMM yyyy', { locale: tr }) : String(p.dueDate || '')}
                </td>
                <td className="px-8 py-4 text-right">
                   <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {p.status !== 'PAID' && (
                        <button onClick={async (e) => { e.stopPropagation(); await updateDoc(doc(db, 'payments', p.id), { status: 'PAID' }); }} className="p-2 text-slate-300 hover:text-emerald-600 transition-colors">
                           <CheckCircle2 className="w-5 h-5" />
                        </button>
                      )}
                      <button onClick={async (e) => { e.stopPropagation(); if(confirm('Silinecek?')) await deleteDoc(doc(db, 'payments', p.id)); }} className="p-2 text-slate-300 hover:text-rose-600 transition-colors">
                         <Trash2 className="w-5 h-5" />
                      </button>
                   </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-8 py-20 text-center opacity-30">
                   <CreditCard className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                   <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Ödeme Kaydı Bulunmuyor</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-6 text-slate-900">
           <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden">
              <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
                 <h3 className="text-xl font-black uppercase">Yeni Tahsilat</h3>
                 <button onClick={() => setShowAddForm(false)} className="p-2 text-slate-400 hover:text-white"><X className="w-8 h-8" /></button>
              </div>
              <form onSubmit={handleAdd} className="p-8 space-y-6">
                 <div className="space-y-4">
                    <select required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold" onChange={e => {
                       const c = customers.find(x => x.id === e.target.value);
                       setNewPayment({...newPayment, customerId: e.target.value, customerName: c?.name || ''});
                    }}>
                       <option value="">Müşteri Seçin...</option>
                       {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input type="number" placeholder="Toplam Tutar" className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold" onChange={e => setNewPayment({...newPayment, totalAmount: Number(e.target.value)})} />
                    <input type="date" className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold" value={newPayment.dueDate || ''} onChange={e => setNewPayment({...newPayment, dueDate: e.target.value})} />
                 </div>
                 <button type="submit" className="w-full py-5 bg-emerald-600 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 active:scale-95 transition-all">Kaydet</button>
              </form>
           </motion.div>
        </div>
      )}
    </div>
  );
}

function StaffManagement({ technicians, services, setSelectedService }: { technicians: UserProfile[], services: ServiceRequest[], setSelectedService: (s: ServiceRequest | null) => void }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', email: '', role: 'TECHNICIAN' as UserRole });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const id = Math.random().toString(36).substring(2, 11);
      await setDoc(doc(db, 'users', id), { 
        ...newStaff, 
        id, 
        status: 'ACTIVE', 
        createdAt: serverTimestamp() 
      });
      setShowAddForm(false);
      setNewStaff({ name: '', email: '', role: 'TECHNICIAN' as UserRole });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`"${name}" isimli personel silinecek. Emin misiniz?`)) {
      try {
        await deleteDoc(doc(db, 'users', id));
      } catch (error) {
        console.error("Delete Error:", error);
        alert("Silme işlemi başarısız oldu: " + (error as Error).message);
        handleFirestoreError(error, OperationType.DELETE, 'users');
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center bg-white p-8 rounded-[2.5rem] border border-slate-200">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Saha Ekibi</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Sistemdeki Aktif Personeller</p>
        </div>
        <button onClick={() => setShowAddForm(true)} className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-xl shadow-blue-500/20 flex items-center gap-2 active:scale-95 transition-all">
          <Plus className="w-5 h-5" /> Personel Ekle
        </button>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Teknisyen</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">E-Posta</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Aktif İş</th>
               <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Biten İş</th>
               <th className="px-8 py-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {technicians.map(t => (
              <tr key={t.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-8 py-4">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 font-black">
                         {t.name.charAt(0)}
                      </div>
                      <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{t.name}</p>
                   </div>
                </td>
                <td className="px-8 py-4">
                   <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t.email}</p>
                </td>
                <td className="px-8 py-4 text-center">
                   <span className="text-sm font-black text-blue-600">
                      {services.filter(s => s.technicianId === t.id && s.status !== 'COMPLETED').length}
                   </span>
                </td>
                <td className="px-8 py-4 text-center">
                   <span className="text-sm font-black text-emerald-600">
                      {services.filter(s => s.technicianId === t.id && s.status === 'COMPLETED').length}
                   </span>
                </td>
                <td className="px-8 py-4 text-right">
                   <button 
                      onClick={(e) => { e.stopPropagation(); handleDelete(t.id, t.name); }} 
                      className="p-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                      title="Personeli Sil"
                   >
                      <Trash2 className="w-5 h-5" />
                   </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-6 text-slate-900">
           <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden">
              <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
                 <h3 className="text-xl font-black uppercase tracking-tight">Yeni Personel</h3>
                 <button onClick={() => setShowAddForm(false)} className="p-2 text-slate-400 hover:text-white"><X className="w-8 h-8" /></button>
              </div>
              <form onSubmit={handleAdd} className="p-8 space-y-4">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase px-1">Ad Soyad</label>
                    <input required className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold" value={newStaff.name || ''} onChange={e => setNewStaff({...newStaff, name: e.target.value})} />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase px-1">E-Posta</label>
                    <input required type="email" className="w-full bg-slate-50 border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold" value={newStaff.email || ''} onChange={e => setNewStaff({...newStaff, email: e.target.value})} />
                 </div>
                 <button type="submit" className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all mt-4">Personeli Kaydet</button>
              </form>
           </motion.div>
        </div>
      )}
    </div>
  );
}
function ServiceDetailModal({ service, onClose, technicians }: { service: ServiceRequest, onClose: () => void, technicians?: UserProfile[] }) {
  const [updating, setUpdating] = useState(false);
  const [desc, setDesc] = useState(service.description);
  const [techId, setTechId] = useState(service.technicianId || '');

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      const tech = technicians?.find(t => t.id === techId);
      await updateDoc(doc(db, 'services', service.id), {
        description: desc,
        technicianId: techId || '',
        technicianName: tech?.name || '',
        ...(techId && service.status === 'PENDING' ? { status: 'ASSIGNED' as ServiceStatus } : {})
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'services');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteService = async () => {
    if (confirm('Bu iş emri tamamen silinecek. Emin misiniz?')) {
       try {
         await deleteDoc(doc(db, 'services', service.id));
         onClose();
       } catch (error) {
         handleFirestoreError(error, OperationType.DELETE, 'services');
       }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6 text-slate-900">
       <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden relative">
          <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
             <div className="flex items-center gap-4">
                <span className="text-[10px] font-black bg-blue-600 px-2 py-0.5 rounded uppercase tracking-widest">{service.type}</span>
                {technicians && (
                  <button onClick={handleDeleteService} className="p-2 text-rose-400 hover:text-rose-300 transition-colors">
                     <Trash2 className="w-4 h-4" />
                  </button>
                )}
             </div>
             <div className="text-center flex-1">
                <h3 className="text-xl font-black uppercase tracking-tight mt-1">{service.customerName}</h3>
             </div>
             <button onClick={onClose} className="p-2 text-slate-400 hover:text-white"><X className="w-8 h-8" /></button>
          </div>
          <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
             <div className="grid grid-cols-2 gap-8">
                <div className="space-y-4">
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Servis Bilgileri</h4>
                   <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-3">
                      <p className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-slate-400" /> {service.customerAddress}
                      </p>
                      <p className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400" /> {service.status}
                      </p>
                      {technicians ? (
                        <div className="pt-2">
                           <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Teknisyen Ata</label>
                           <select 
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-blue-600"
                            value={techId}
                            onChange={(e) => setTechId(e.target.value)}
                            disabled={updating}
                           >
                              <option value="">Teknisyen Seç...</option>
                              {technicians.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                           </select>
                        </div>
                      ) : (
                        <p className="text-sm font-bold text-slate-700 flex items-center gap-2 text-blue-600">
                          <UserIcon className="w-4 h-4" /> {service.technicianName}
                        </p>
                      )}
                   </div>
                </div>
                <div className="space-y-4">
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">İş Detayı</h4>
                   {technicians ? (
                     <textarea 
                        className="w-full bg-white p-4 rounded-2xl border border-slate-200 shadow-sm min-h-[120px] text-sm font-bold text-slate-600 leading-relaxed outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                        value={desc}
                        onChange={(e) => setDesc(e.target.value)}
                        placeholder="İş detayını buraya yazın..."
                     />
                   ) : (
                     <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-h-[120px]">
                        <p className="text-sm font-bold text-slate-600 leading-relaxed italic">"{service.description}"</p>
                     </div>
                   )}
                </div>
             </div>

             {service.status !== 'PENDING' && service.checklist && service.checklist.length > 0 && (
                <div className="space-y-4">
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kontrol Listesi</h4>
                   <div className="grid grid-cols-1 gap-2">
                      {service.checklist.map(item => (
                        <div key={item.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                           {item.completed ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <div className="w-5 h-5 border-2 border-slate-200 rounded-full" />}
                           <span className={`text-xs font-bold ${item.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{item.label}</span>
                        </div>
                      ))}
                   </div>
                </div>
             )}

             {service.status === 'COMPLETED' && (
                <div className="pt-8 border-t border-slate-100 grid grid-cols-3 gap-4">
                   <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <p className="text-[8px] font-black text-emerald-600 uppercase">Son Sayaç</p>
                      <p className="text-lg font-black text-emerald-700">{service.counterReading || 0}</p>
                   </div>
                   <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <p className="text-[8px] font-black text-emerald-600 uppercase">Kalan Toner</p>
                      <p className="text-lg font-black text-emerald-700">{service.tonerCountReported || 0}</p>
                   </div>
                   <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <p className="text-[8px] font-black text-emerald-600 uppercase">Tahsilat</p>
                      <p className="text-lg font-black text-emerald-700">{service.paymentCollected || 0} TL</p>
                   </div>
                </div>
             )}

             {technicians && (
               <button 
                onClick={handleUpdate}
                disabled={updating}
                className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all mt-4 disabled:opacity-50"
               >
                 {updating ? 'GÜNCELLENİYOR...' : 'TAMAM'}
               </button>
             )}
          </div>
       </motion.div>
    </div>
  );
}

function AuthView() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8 relative overflow-hidden">
      {/* Background Accents */}
      <div className="absolute top-0 left-0 w-full h-full">
         <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px]" />
         <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-900/20 rounded-full blur-[120px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xl text-center space-y-12 relative z-10"
      >
        <div className="space-y-4">
           <div className="flex flex-col items-center justify-center gap-4 mb-2">
              <div className="w-24 h-24 bg-blue-600 rounded-[2.5rem] flex items-center justify-center shadow-2xl shadow-blue-500/40">
                 <Compass className="w-14 h-14 text-white" />
              </div>
              <div className="text-center">
                <h1 className="text-6xl font-black text-white tracking-tighter uppercase italic leading-none">Hürmak</h1>
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.6em] mt-2">Teknik Servis Otomasyonu</p>
              </div>
           </div>
        </div>

        <button 
          onClick={signInWithGoogle}
          className="w-full max-w-sm mx-auto py-6 bg-white text-slate-900 rounded-[2rem] font-black uppercase tracking-widest shadow-2xl hover:bg-blue-600 hover:text-white transition-all active:scale-95 flex items-center justify-center gap-4 border border-white/10"
        >
           Google ile Giriş Yap
        </button>
      </motion.div>
    </div>
  );
}
